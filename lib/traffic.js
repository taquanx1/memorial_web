const { isIP } = require('node:net');
const geoip = require('geoip-lite');

const DAY = 86400;
const PUBLIC_VISIT = "route IN ('home','memo')";

function beijingDate(now = Date.now()) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}

function dayRange(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(date + 'T00:00:00+08:00');
  if (!Number.isFinite(ms) || beijingDate(ms) !== date) return null;
  return [ms / 1000, ms / 1000 + DAY];
}

function locate(rawIP, lookup = geoip.lookup) {
  const ip = String(rawIP || '').replace(/^::ffff:/i, '');
  const empty = { country: '', region: '', city: '', latitude: null, longitude: null, geo_status: 'unknown' };
  if (!isIP(ip)) return empty;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) ||
      /^(::1$|::$|f[cd]|fe[89ab])/i.test(ip)) return { ...empty, geo_status: 'local' };
  const geo = lookup(ip);
  if (!geo || !/^[A-Z]{2}$/.test(geo.country || '')) return empty;
  const city = geo.city || '';
  const [latitude, longitude] = geo.ll || [];
  const coordinates = city && Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  return { country: geo.country, region: geo.region || '', city,
    latitude: coordinates ? latitude : null, longitude: coordinates ? longitude : null,
    geo_status: city ? 'located' : 'country-only' };
}

function initTraffic(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(traffic)').all().map(c => c.name));
  for (const [name, type] of Object.entries({ country: "TEXT DEFAULT ''", region: "TEXT DEFAULT ''",
    city: "TEXT DEFAULT ''", latitude: 'REAL', longitude: 'REAL', geo_status: "TEXT DEFAULT ''" })) {
    if (!columns.has(name)) db.exec(`ALTER TABLE traffic ADD COLUMN ${name} ${type}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS traffic_route_ts ON traffic(route, ts)');
  const update = db.prepare(`UPDATE traffic SET country=?,region=?,city=?,latitude=?,longitude=?,geo_status=?
    WHERE ip=? AND geo_status=''`);
  // Recover approximate origins from existing IPs without changing visit dates.
  const oldIPs = db.prepare("SELECT DISTINCT ip FROM traffic WHERE geo_status=''").all();
  db.exec('BEGIN');
  try {
    for (const { ip } of oldIPs) {
      const g = locate(ip);
      update.run(g.country, g.region, g.city, g.latitude, g.longitude, g.geo_status, ip);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function trafficReport(db, date) {
  const range = dayRange(date);
  if (!range) throw new Error('Invalid report date');
  const todayRange = dayRange(beijingDate());
  const count = (suffix = '', args = []) => db.prepare(`SELECT COUNT(*) c FROM traffic WHERE ${PUBLIC_VISIT} ${suffix}`).get(...args).c;
  const origins = db.prepare(`SELECT country, region, city, COUNT(*) visits,
    AVG(latitude) latitude, AVG(longitude) longitude
    FROM traffic WHERE ${PUBLIC_VISIT} AND ts>=? AND ts<?
    GROUP BY country, region, city ORDER BY visits DESC, country, city`).all(...range);
  const minTS = db.prepare(`SELECT MIN(ts) ts FROM traffic WHERE ${PUBLIC_VISIT}`).get().ts;
  return {
    date, timezone: 'Asia/Shanghai', todayDate: beijingDate(),
    firstDate: minTS === null ? beijingDate() : beijingDate(minTS * 1000),
    total: count(), today: count('AND ts>=? AND ts<?', todayRange),
    selectedTotal: origins.reduce((sum, row) => sum + row.visits, 0),
    unknown: origins.filter(row => !row.country).reduce((sum, row) => sum + row.visits, 0),
    mainland: origins.filter(row => row.country === 'CN'),
    outside: origins.filter(row => row.country && row.country !== 'CN'),
    origins,
    pending: db.prepare("SELECT COUNT(*) c FROM memories WHERE status='pending'").get().c,
    views: Number(db.prepare("SELECT value FROM settings WHERE key='view_count'").get()?.value || 0),
    recent: db.prepare(`SELECT ts, route, ip, ua, country, city FROM traffic
      WHERE ${PUBLIC_VISIT} AND ts>=? AND ts<? ORDER BY ts DESC,id DESC LIMIT 50`).all(...range),
  };
}

module.exports = { beijingDate, dayRange, locate, initTraffic, trafficReport };
