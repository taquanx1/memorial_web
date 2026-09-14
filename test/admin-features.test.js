const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { beijingDate, dayRange, locate, initTraffic, classifyClient } = require('../lib/traffic');

const testData = fs.mkdtempSync(path.join(os.tmpdir(), 'memorial-admin-test-'));
process.env.DATA_DIR = testData;
const { app, db } = require('../server');
let server, base, token;
const stamp = 'admin-feature-test';
async function request(route, { method = 'GET', body, authenticated = true } = {}) {
  const response = await fetch(base + route, { method, headers: {
    ...(authenticated && token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await request('/admin-api/login', { method: 'POST', body: { username: 'Taquanx1', password: '68554968' } });
  token = login.body.token;
  assert.ok(token);
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  fs.rmSync(testData, { recursive: true, force: true });
});

test('Beijing days use UTC+8, including midnight and leap days', () => {
  assert.equal(beijingDate(Date.parse('2026-09-10T16:00:00Z')), '2026-09-11');
  assert.deepEqual(dayRange('2026-09-11'), [Date.parse('2026-09-10T16:00:00Z') / 1000, Date.parse('2026-09-11T16:00:00Z') / 1000]);
  assert.equal(dayRange('2026-02-29'), null);
  assert.ok(dayRange('2024-02-29'));
  assert.equal(dayRange('2026-99-01'), null);
  assert.equal(dayRange(['2026-01-01']), null);
});

test('local/unknown IPs stay unlocated and country-only results never invent a city point', () => {
  for (const ip of ['127.0.0.1','::1','::ffff:192.168.1.1','10.0.0.5','fd12::1']) assert.equal(locate(ip).geo_status, 'local');
  assert.equal(locate('invalid').geo_status, 'unknown');
  assert.equal(locate('8.8.8.8', () => null).geo_status, 'unknown');
  const countryOnly = locate('8.8.8.8', () => ({country:'US', city:'', ll:[37,-97]}));
  assert.equal(countryOnly.country, 'US');
  assert.equal(countryOnly.latitude, null);
  const city = locate('223.5.5.5');
  assert.equal(city.country, 'CN');
  assert.ok(city.city && city.latitude && city.longitude);
});

test('old traffic is migrated and located without changing historical dates', () => {
  const old = new DatabaseSync(':memory:');
  old.exec("CREATE TABLE traffic (id INTEGER PRIMARY KEY, ts INTEGER, route TEXT, ip TEXT, ua TEXT)");
  old.prepare('INSERT INTO traffic VALUES (1,12345,?,?,?)').run('home','223.5.5.5','legacy');
  initTraffic(old);
  initTraffic(old);
  const row = old.prepare('SELECT * FROM traffic').get();
  assert.equal(row.ts,12345);
  assert.equal(row.country,'CN');
  assert.ok(row.city);
  old.close();
});

test('daily report filters assets and admin traffic; includes international and unknown origins', async () => {
  const [start,end] = dayRange('2026-08-20');
  const insert = db.prepare('INSERT INTO traffic (ts,route,ip,ua,country,city,region,latitude,longitude,geo_status) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const add = (ts, route, country, city, lat=null, lon=null) => insert.run(ts,route,'fixture','test',country,city,'',lat,lon,'located');
  add(start-1,'home','US','New York');
  add(start,'home','CN','Beijing',39.9,116.4);
  add(start+1,'memo','CN','Beijing',39.9,116.4);
  add(end-1,'home','SG','Singapore',1.3,103.8);
  add(start+2,'home','HK','Hong Kong',22.3,114.1);
  add(start+3,'home','','');
  add(end,'home','US','New York');
  add(start+4,'/assets/photo.jpg','CN','Beijing');
  add(start+5,'admin-login','CN','Beijing');
  const {status,body} = await request('/admin-api/traffic?date=2026-08-20&audience=all');
  assert.equal(status,200);
  assert.equal(body.selectedTotal,5);
  assert.equal(body.unknown,1);
  assert.equal(body.mainland.length,1);
  assert.equal(body.mainland[0].visits,2);
  assert.deepEqual(body.outside.map(r=>r.country).sort(),['HK','SG']);
  assert.equal(body.origins[0].city,'Beijing');
  assert.equal(body.recent.length,5);
  assert.equal('byRoute' in body,false);
  assert.equal((await request('/admin-api/traffic?date=2026-02-30')).status,400);
  assert.equal((await request('/admin-api/traffic?date=2999-01-01')).status,400);
  assert.equal((await request('/admin-api/traffic?date=2026-08-20&audience=nobody')).status,400);
  assert.equal((await request('/admin-api/traffic', {authenticated:false})).status,401);
});

test('crawlers, HTTP clients and empty agents are classified apart from browsers', () => {
  const browser = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
  for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', 'Bytespider',
    'curl/8.7.1', 'python-requests/2.31.0', 'Go-http-client/1.1', 'Mozilla/5.0 (compatible; Censys)',
    'HeadlessChrome/120.0.0.0', '', '   ']) assert.equal(classifyClient(ua), 'bot', ua);
  for (const ua of [browser, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15',
    'Mozilla/5.0 (Linux; Android 11; CUBOT_X30) AppleWebKit/537.36 Chrome/120.0.0.0'])
    assert.equal(classifyClient(ua), 'unverified', ua);
});

test('a visit counts as human only once the same client fetches what the page renders', async () => {
  const browser = 'memorial-test-browser/1.0';
  const latest = () => db.prepare("SELECT * FROM traffic WHERE ua=? AND route='home' ORDER BY id DESC LIMIT 1").get(browser);
  await fetch(base + '/', { headers: { 'User-Agent': browser } });
  assert.equal(latest().client_class, 'unverified');
  await fetch(base + '/api/sections', { headers: { 'User-Agent': browser } });
  assert.equal(latest().client_class, 'human');

  const scanner = 'memorial-test-scanner/1.0';
  await fetch(base + '/', { headers: { 'User-Agent': scanner } });
  assert.equal(db.prepare("SELECT client_class c FROM traffic WHERE ua=? ORDER BY id DESC LIMIT 1").get(scanner).c, 'unverified');
  // A different client's asset request must not vouch for the scanner's visit.
  await fetch(base + '/api/sections', { headers: { 'User-Agent': browser } });
  assert.equal(db.prepare("SELECT client_class c FROM traffic WHERE ua=? ORDER BY id DESC LIMIT 1").get(scanner).c, 'unverified');

  await fetch(base + '/', { headers: { 'User-Agent': 'curl/8.7.1' } });
  assert.equal(db.prepare("SELECT client_class c FROM traffic WHERE ua='curl/8.7.1' ORDER BY id DESC LIMIT 1").get().c, 'bot');
});

test('bot page requests do not inflate the public view counter', async () => {
  const views = () => Number(db.prepare("SELECT value v FROM settings WHERE key='view_count'").get().v);
  const before = views();
  await fetch(base + '/', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } });
  assert.equal(views(), before);
  await fetch(base + '/', { headers: { 'User-Agent': 'memorial-test-counter/1.0' } });
  assert.equal(views(), before + 1);
});

test('reports filter by audience and always report what was filtered out', async () => {
  const [start] = dayRange('2026-08-22');
  const insert = db.prepare('INSERT INTO traffic (ts,route,ip,ua,country,city,region,latitude,longitude,geo_status,client_class) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  insert.run(start,'home','1.1.1.1','ua','CN','Beijing','',39.9,116.4,'located','human');
  insert.run(start+1,'home','1.1.1.2','ua','US','Reston','',38.9,-77.3,'located','bot');
  insert.run(start+2,'home','1.1.1.3','ua','SG','Singapore','',1.3,103.8,'located','unverified');
  const report = async audience => (await request('/admin-api/traffic?date=2026-08-22&audience=' + audience)).body;
  assert.equal((await report('human')).selectedTotal, 1);
  assert.equal((await report('nonbot')).selectedTotal, 2);
  assert.equal((await report('all')).selectedTotal, 3);
  const human = await report('human');
  assert.deepEqual(human.breakdown, { human: 1, unverified: 1, bot: 1 });
  assert.equal(human.mainland.length, 1);
  assert.equal(human.outside.length, 0);
  assert.equal(human.recent[0].client_class, 'human');
  // The calendar range must not move when the audience changes.
  assert.equal(human.firstDate, (await report('all')).firstDate);
  assert.equal((await request('/admin-api/traffic?date=2026-08-22')).body.audience, 'human');
});

test('traffic logged before classification is judged on stored agents and asset requests', () => {
  const old = new DatabaseSync(':memory:');
  old.exec("CREATE TABLE traffic (id INTEGER PRIMARY KEY, ts INTEGER, route TEXT, ip TEXT, ua TEXT)");
  const add = (id, ts, route, ip, ua) => old.prepare('INSERT INTO traffic VALUES (?,?,?,?,?)').run(id, ts, route, ip, ua);
  const browser = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
  add(1, 12345, 'home', '223.5.5.5', browser);
  add(2, 12350, '/js/app.js', '223.5.5.5', browser);
  add(3, 20000, 'home', '8.8.8.8', browser);
  add(4, 30000, 'home', '8.8.4.4', 'Googlebot/2.1');
  initTraffic(old);
  initTraffic(old);
  const classOf = id => old.prepare('SELECT client_class c FROM traffic WHERE id=?').get(id).c;
  assert.equal(classOf(1), 'human');
  assert.equal(classOf(3), 'unverified');
  assert.equal(classOf(4), 'bot');
  assert.equal(old.prepare('SELECT ts FROM traffic WHERE id=1').get().ts, 12345);
  old.close();
});

test('only public page requests increment visits; geolocation works through the trusted local proxy', async () => {
  const before = db.prepare("SELECT COUNT(*) c FROM traffic WHERE route IN ('home','memo')").get().c;
  await fetch(base + '/css/style.css');
  await fetch(base + '/admin');
  await fetch(base + '/', {headers:{'X-Forwarded-For':'223.5.5.5'}});
  const after = db.prepare("SELECT COUNT(*) c FROM traffic WHERE route IN ('home','memo')").get().c;
  assert.equal(after-before,1);
  const row = db.prepare("SELECT * FROM traffic WHERE route='home' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.country,'CN');
  assert.ok(row.city);
});

test('auto-approve defaults off, requires auth, persists, and applies only to future submissions', async () => {
  assert.equal((await request('/admin-api/moderation')).body.autoApprove,false);
  assert.equal((await request('/admin-api/moderation',{method:'PUT',authenticated:false,body:{autoApprove:true}})).status,401);
  assert.equal((await request('/admin-api/moderation',{method:'PUT',body:{autoApprove:'true'}})).status,400);
  const submit = text => request('/api/memories',{method:'POST',authenticated:false,body:{name:stamp,text,status:'published',autoApprove:true}});
  assert.equal((await submit(stamp+'-pending')).body.status,'pending');
  assert.ok(!(await request('/api/memories')).body.memories.some(m=>m.text===stamp+'-pending'));
  await request('/admin-api/moderation',{method:'PUT',body:{autoApprove:true}});
  const persisted = new DatabaseSync(path.join(testData,'memorial.db'));
  assert.equal(persisted.prepare("SELECT value FROM settings WHERE key='auto_approve'").get().value,'true');
  persisted.close();
  assert.equal((await submit(stamp+'-published')).body.status,'published');
  assert.ok((await request('/api/memories')).body.memories.some(m=>m.text===stamp+'-published'));
  assert.equal(db.prepare('SELECT status FROM memories WHERE text=?').get(stamp+'-pending').status,'pending');
  await request('/admin-api/moderation',{method:'PUT',body:{autoApprove:false}});
  assert.equal((await submit(stamp+'-pending-again')).body.status,'pending');
});
