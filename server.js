const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

/* ---------------- Database ---------------- */
const db = new DatabaseSync(path.join(DATA, 'memorial.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT DEFAULT '',
  text TEXT NOT NULL,
  photos TEXT DEFAULT '[]',
  status TEXT DEFAULT 'pending',        -- pending | published | rejected
  sync_flag INTEGER DEFAULT 0,          -- 1 = added via admin bypass (skip review)
  ip TEXT DEFAULT '',
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE TABLE IF NOT EXISTS editorial (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,                -- about | timeline | memorywall | gallery
  content TEXT NOT NULL,
  kind TEXT DEFAULT 'txt',              -- txt | html
  status TEXT DEFAULT 'published',
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE TABLE IF NOT EXISTS traffic (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER DEFAULT (strftime('%s','now')),
  route TEXT,
  ip TEXT,
  ua TEXT
);
`);

/* ---- seed settings defaults ---- */
const defaults = {
  view_count: '0',
  maintained_by: '纪念网站管理团队',
  theme: JSON.stringify({ tone: 'light', accent: '#b9a15f', font: 'serif' }),
  site_title: '纪念 · 永怀',
  hero_title: '永远的怀念',
  hero_sub: '以温暖的方式，留住每一份思念',
  hero_image: '',
  about_title: '生平简介',
  about_body: '',
  timeline_data: '',
  memorywall_title: '思念之墙',
  gallery_title: '相册',
};
for (const [k, v] of Object.entries(defaults)) {
  db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').run(k, v);
}

/* seed editorial demo content (Chinese) */
const seedEditorial = () => {
  const has = db.prepare('SELECT COUNT(*) c FROM editorial').get().c;
  if (has > 0) return;
  const ins = db.prepare('INSERT INTO editorial (section,content,kind,status) VALUES (?,?,?,?)');
  ins.run('about', '陈鸿刚，祖籍浙江绍兴，一九六三年出生于北京。一九八六年毕业于北京清华大学水利工程系。', 'txt', 'published');
  ins.run('about', '大学毕业后曾长期在国外生活和工作，先后在伊拉克和泰国的大中型国际水利承包工程中，从事工程技术、商务谈判等方面的具体工作。在泰国家族式工厂和企业中从事过技术和管理工作。', 'txt', 'published');
  ins.run('about', '1993年应聘到泰国艺宝集团总公司(COSMO Group of Companies) ,并受命到中国海口创建海南万达包装制造有限公司，并在该公司工作长达20多年，先后任生产部经理，总经理。', 'txt', 'published');
  ins.run('about', '曾经从事的主要社会工作有：海口市人大常委会华侨外事民族宗教工作委员会委员、海南省侨资企业协会常务理事、海南省工业经济联合会理事、海南省企业家协会会员，清华大学海南校友会秘书长等职。', 'txt', 'published');
  ins.run('about', '业余时间著有《总经理读〈道德经〉学习笔记》等文稿、书籍。', 'txt', 'published');
  ins.run('timeline', JSON.stringify([
    { year: '1963年3月', title: '出生于北京', text: ' ' },
    { year: '1986年7月', title: '毕业于清华大学水利工程系', text: ' ' },
    { year: '1987年', title: '移居泰国', text: ' ' },
    { year: '1993年', title: '移居海口', text: ' ' },
    { year: '2016年9月', title: '病故于海口', text: ' ' },
  ]), 'json', 'published');
  ins.run('gallery', JSON.stringify([
    { src: '/assets/photo-1.jpg', caption: '岁月留影 · 一' },
    { src: '/assets/photo-2.jpg', caption: '岁月留影 · 二' },
    { src: '/assets/photo-3.jpg', caption: '岁月留影 · 三' },
    { src: '/assets/photo-4.jpg', caption: '岁月留影 · 四' },
  ]), 'json', 'published');
};
seedEditorial();

/* seed first admin (hardcoded) */
{
  const n = db.prepare('SELECT COUNT(*) c FROM admins').get().c;
  if (n === 0) {
    db.prepare('INSERT INTO admins (username, pass_hash) VALUES (?,?)')
      .run('Taquanx1', hash('68554968'));
  }
}
/* seed a sample published memory so the wall is not empty */
{
  const n = db.prepare('SELECT COUNT(*) c FROM memories').get().c;
  if (n === 0) {
    db.prepare('INSERT INTO memories (name,text,status) VALUES (?,?,?)')
      .run('一位朋友', '那些你曾说过的话，如今都成了我们前行的光。', 'published');
  }
}

function hash(pw) {
  return crypto.createHash('sha256').update('memorial::' + pw).digest('hex');
}
function compareHash(pw, h) {
  return hash(pw) === h;
}

/* ---------------- Session store (simple in-memory token) ---------------- */
const sessions = new Map(); // token -> {adminId, username, expires}
function createSession(admin) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { adminId: admin.id, username: admin.username, expires: Date.now() + 1000 * 60 * 60 * 12 });
  return token;
}
function auth(req) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token || !sessions.has(token)) return null;
  const s = sessions.get(token);
  if (s.expires < Date.now()) { sessions.delete(token); return null; }
  return s;
}

/* ---------------- multer upload ---------------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, f, cb) => {
      const d = path.join(PUB, 'uploads');
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      cb(null, d);
    },
    filename: (req, f, cb) => {
      const ext = (path.extname(f.originalname) || '.jpg').toLowerCase();
      cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/* ---------------- helpers ---------------- */
function logTraffic(req, route) {
  try {
    db.prepare('INSERT INTO traffic (route, ip, ua) VALUES (?,?,?)')
      .run(route || req.path, req.ip || '', (req.get('user-agent') || '').slice(0, 200));
  } catch (e) {}
}
function bumpViews() {
  db.prepare("UPDATE settings SET value = CAST(value AS INTEGER)+1 WHERE key='view_count'").run();
  return db.prepare("SELECT value v FROM settings WHERE key='view_count'").get().v;
}

/* ---------------- app ---------------- */
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

/* View-count increments on page hit (public, idempotent per request) */
app.use((req, res, next) => {
  if (req.method === 'GET' && req.path === '/') {
    bumpViews();
    logTraffic(req, 'home');
  } else if (req.method === 'GET' && req.path === '/memo') {
    logTraffic(req, 'memo');
  } else if (req.path.startsWith('/api') || req.path.startsWith('/admin-api')) {
    /* skip */
  } else if (req.method === 'GET') {
    logTraffic(req, req.path);
  }
  next();
});

/* ---------- Public API ---------- */
app.get('/api/views', (req, res) => {
  res.json({ views: db.prepare("SELECT value v FROM settings WHERE key='view_count'").get().v });
});
app.get('/api/site', (req, res) => {
  const get = (k) => db.prepare('SELECT value v FROM settings WHERE key=?').get(k).v;
  res.json({
    title: get('site_title'), hero_title: get('hero_title'), hero_sub: get('hero_sub'),
    hero_image: get('hero_image'), maintained_by: get('maintained_by'),
    about_title: get('about_title'), about_body: get('about_body'),
    memorywall_title: get('memorywall_title'), gallery_title: get('gallery_title'),
    theme: JSON.parse(get('theme')),
  });
});
app.get('/api/sections', (req, res) => {
  const rows = db.prepare("SELECT section, content, kind FROM editorial WHERE status='published' ORDER BY id").all();
  const out = { about: [], timeline: [], gallery: [] };
  for (const r of rows) {
    if (r.section === 'timeline' || r.section === 'gallery') {
      try { out[r.section] = JSON.parse(r.content); } catch (e) {}
    } else if (r.section === 'about') {
      out.about.push({ text: r.content });
    }
  }
  res.json(out);
});
app.get('/api/memories', (req, res) => {
  const rows = db.prepare("SELECT id, name, text, photos, created_at FROM memories WHERE status='published' ORDER BY created_at DESC LIMIT 100").all();
  res.json({ memories: rows });
});
/* Leave-a-thought: store as pending (needs admin review) */
app.post('/api/memories', (req, res) => {
  const { name, text, photos } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: '内容不能为空' });
  db.prepare('INSERT INTO memories (name,text,photos,status,sync_flag,ip) VALUES (?,?,?,?,?,?)')
    .run(String(name||'').slice(0,50), String(text).slice(0,5000),
         JSON.stringify(Array.isArray(photos)?photos:[]), 'pending', 0, req.ip||'');
  res.status(201).json({ ok: true, message: '已收到，处理中' });
});
app.post('/api/memories/photo', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未上传文件' });
  res.status(201).json({ ok: true, url: '/uploads/' + req.file.filename });
});

/* ---------- Admin API (all require auth) ---------- */
function requireAuth(req, res, next) {
  const s = auth(req);
  if (!s) return res.status(401).json({ error: '未登录或登录已过期' });
  req.admin = s;
  next();
}

app.post('/admin-api/login', (req, res) => {
  const { username, password } = req.body || {};
  const row = db.prepare('SELECT * FROM admins WHERE username=?').get(String(username||''));
  if (!row || !compareHash(String(password||''), row.pass_hash)) {
    logTraffic(req, 'admin-login-fail');
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = createSession(row);
  logTraffic(req, 'admin-login');
  res.json({ ok: true, token, username: row.username });
});
app.get('/admin-api/me', requireAuth, (req, res) => res.json({ ok: true, admin: req.admin }));

/* 1. add another admin */
app.post('/admin-api/admins', requireAuth, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  if (String(password).length < 6) return res.status(400).json({ error: '密码至少6位' });
  try {
    db.prepare('INSERT INTO admins (username, pass_hash) VALUES (?,?)')
      .run(String(username), hash(String(password)));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: '该用户名已存在' });
  }
});
app.get('/admin-api/admins', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, username, created_at FROM admins').all();
  res.json({ admins: rows });
});

/* 2. change design/layout (settings) */
app.get('/admin-api/settings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {}; rows.forEach(r => s[r.key] = r.value);
  res.json({ settings: s });
});
app.post('/admin-api/settings', requireAuth, (req, res) => {
  const body = req.body || {};
  const allowed = ['site_title','hero_title','hero_sub','hero_image','maintained_by',
    'about_title','about_body','memorywall_title','gallery_title'];
  for (const k of allowed) {
    if (body[k] !== undefined) db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(body[k]), k);
  }
  if (body.theme) {
    try { db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(body.theme), 'theme'); } catch(e){}
  }
  res.json({ ok: true });
});

/* 3. traffic + activity monitoring */
app.get('/admin-api/traffic', requireAuth, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM traffic').get().c;
  const today = db.prepare("SELECT COUNT(*) c FROM traffic WHERE ts >= strftime('%s','now','start of day')").get().c;
  const byRoute = db.prepare('SELECT route, COUNT(*) c FROM traffic GROUP BY route ORDER BY c DESC').all();
  const recent = db.prepare('SELECT * FROM traffic ORDER BY id DESC LIMIT 50').all();
  const views = db.prepare("SELECT value v FROM settings WHERE key='view_count'").get().v;
  res.json({ total, today, views, byRoute, recent });
});
app.get('/admin-api/activity', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM memories ORDER BY id DESC LIMIT 30').all();
  res.json({ activity: rows });
});

/* 4. add content to any section bypassing review (sync_flag=1) */
app.post('/admin-api/content', requireAuth, (req, res) => {
  const { section, content } = req.body || {};
  if (!['about','timeline','memorywall','gallery'].includes(section))
    return res.status(400).json({ error: '无效板块' });
  db.prepare('INSERT INTO editorial (section, content, kind, status) VALUES (?,?,?,?)')
    .run(section, String(content), section==='gallery'||section==='timeline'?'json':'txt', 'published');
  res.json({ ok: true });
});
/* edit / delete editorial for bypass & review flows */
app.put('/admin-api/content/:id', requireAuth, (req, res) => {
  const { content } = req.body || {};
  db.prepare('UPDATE editorial SET content=? WHERE id=?').run(String(content||''), Number(req.params.id));
  res.json({ ok: true });
});
app.delete('/admin-api/content/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM editorial WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

/* 5. review memory-wall content (publish/reject) */
app.get('/admin-api/memories/all', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM memories ORDER BY id DESC LIMIT 200').all();
  res.json({ memories: rows });
});
app.post('/admin-api/memories/:id/status', requireAuth, (req, res) => {
  const { status } = req.body || {};
  if (!['published','rejected','pending'].includes(status)) return res.status(400).json({ error: '无效状态' });
  db.prepare('UPDATE memories SET status=? WHERE id=?').run(status, Number(req.params.id));
  res.json({ ok: true });
});

/* ---------- admin SPA ---------- */
app.get('/admin', (req, res) => res.sendFile(path.join(PUB, 'admin.html')));

/* ---------- static (CDN-friendly: hash-versioned, long cache) ---------- */
app.use('/assets', express.static(path.join(PUB, 'assets'), { maxAge: '30d', immutable: true }));
app.use('/uploads', express.static(path.join(PUB, 'uploads'), { maxAge: '7d' }));
app.use('/css', express.static(path.join(PUB, 'css'), { maxAge: '1h' }));
app.use('/js', express.static(path.join(PUB, 'js'), { maxAge: '1h' }));

/* ---------- pages ---------- */
app.get('/memo', (req, res) => res.sendFile(path.join(PUB, 'memo.html')));
app.get('/', (req, res) => res.sendFile(path.join(PUB, 'index.html')));

/* 404 + errors */
app.use((req, res) => res.status(404).send('404'));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '服务器错误' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Memorial site listening on http://0.0.0.0:' + PORT);
});
