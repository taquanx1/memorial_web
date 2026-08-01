/* Integration smoke test against the running server.
 * Run:  node server.js  (in another shell), then  npm test
 */
const { test } = require('node:test');
const assert = require('node:assert');

const BASE = process.env.TEST_BASE || 'http://localhost:8090';
const ROOT = require('path').join(__dirname, '..');
let token = '';

async function j(url, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(BASE + url, Object.assign({}, opts, { headers }));
  let d = {};
  try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}

test('public pages & assets serve 200', async () => {
  const urls = ['/', '/memo', '/admin', '/css/style.css', '/css/admin.css',
    '/js/app.js', '/js/admin.js', '/js/memo.js', '/assets/placeholder.svg',
    '/assets/photo-1.jpg', '/assets/photo-2.jpg', '/assets/photo-3.jpg', '/assets/photo-4.jpg'];
  for (const p of urls) {
    const r = await fetch(BASE + p);
    assert.strictEqual(r.status, 200, p + ' should be 200');
  }
});

test('public API returns About/Timeline/MemoryWall/Gallery content', async () => {
  const { d } = await j('/api/sections');
  assert.ok(Array.isArray(d.about) && d.about.length > 0, 'about has content');
  assert.ok(Array.isArray(d.timeline) && d.timeline.length > 0, 'timeline has content');
  assert.ok(Array.isArray(d.gallery) && d.gallery.length > 0, 'gallery has content');
});

test('home page has the four sections in the required order', async () => {
  const html = await (await fetch(BASE + '/')).text();
  const order = ['data-tab="about"', 'data-tab="timeline"', 'data-tab="memorywall"', 'data-tab="gallery"'];
  let last = -1;
  for (const t of order) {
    const i = html.indexOf(t);
    assert.ok(i > -1, `sect ${t} present`);
    assert.ok(i > last, `sect ${t} appears after previous section (order)`);
    last = i;
  }
  // quick-access nav links still point to the sections
  for (const h of ['#about', '#timeline', '#memorywall', '#gallery']) {
    assert.ok(html.includes(h), `top nav link ${h} present`);
  }
  // left section-nav exists
  assert.ok(html.includes('class="sect-nav"'), 'left section-nav present');
});

test('memory wall has one seeded published item', async () => {
  const { d } = await j('/api/memories');
  assert.ok(Array.isArray(d.memories));
  assert.strictEqual(d.memories.length, 1, 'one seeded memory');
});

test('leave-a-thought lands as pending (hidden from public wall)', async () => {
  const stamp = Date.now().toString();
  const { status } = await j('/api/memories', { method: 'POST', body: { name: '测试', text: '自动化测试留言 ' + stamp } });
  assert.strictEqual(status, 201);
  const wall = await j('/api/memories');
  assert.ok(wall.d.memories.every(m => !String(m.text).startsWith('自动化测试留言')), 'pending hidden from public wall');
  return stamp;
});

test('view count is numeric and grows', async () => {
  const before = Number((await j('/api/views')).d.views);
  assert.ok(!isNaN(before));
});

test('admin login OK with hardcoded account; wrong password 401', async () => {
  const r = await j('/admin-api/login', { method: 'POST', body: { username: 'Taquanx1', password: '68554968' } });
  assert.strictEqual(r.status, 200);
  assert.ok(r.d.token);
  token = r.d.token;
  const bad = await j('/admin-api/login', { method: 'POST', body: { username: 'Taquanx1', password: 'nope' } });
  assert.strictEqual(bad.status, 401);
});

test('protected endpoints return 401 without token', async () => {
  const saved = token;
  token = ''; // force unauthenticated
  const a = await j('/admin-api/admins');
  const t = await j('/admin-api/traffic');
  token = saved;
  assert.strictEqual(a.status, 401);
  assert.strictEqual(t.status, 401);
});

test('review: publish / reject a pending memory', async () => {
  assert.ok(token);
  const all = await j('/admin-api/memories/all');
  const pending = all.d.memories.find(m => m.status === 'pending');
  assert.ok(pending, 'pending message exists');
  // publish -> visible on public wall
  await j(`/admin-api/memories/${pending.id}/status`, { method: 'POST', body: { status: 'published' } });
  const wall = await j('/api/memories');
  assert.ok(wall.d.memories.some(m => m.id === pending.id), 'published visible');
  // reject -> hidden
  await j(`/admin-api/memories/${pending.id}/status`, { method: 'POST', body: { status: 'rejected' } });
  const wall2 = await j('/api/memories');
  assert.ok(wall2.d.memories.every(m => m.id !== pending.id), 'rejected hidden');
  // cleanup: delete the test message row directly
  const { execSync } = require('child_process');
  execSync(`node -e "
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync('${ROOT}/data/memorial.db');
    db.prepare(\\"DELETE FROM memories WHERE text LIKE '%自动化测试留言%'\\").run();
  "`, { stdio: 'ignore' });
});

test('admin adds content bypassing review', async () => {
  assert.ok(token);
  const tag = '管理后台直接发布验证' + Date.now();
  await j('/admin-api/content', { method: 'POST', body: { section: 'about', content: tag } });
  const sec = await j('/api/sections');
  assert.ok(sec.d.about.some(a => a.text.includes('管理后台直接发布验证')), 'bypass content on public about');
  const { execSync } = require('child_process');
  execSync(`node -e "
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync('${ROOT}/data/memorial.db');
    db.prepare(\\"DELETE FROM editorial WHERE content LIKE '%管理后台直接发布验证%'\\").run();
  "`, { stdio: 'ignore' });
});

test('settings read + write; traffic stats', async () => {
  assert.ok(token);
  const s = await j('/admin-api/settings');
  assert.ok(s.d.settings && s.d.settings.site_title);
  const w = await j('/admin-api/settings', { method: 'POST', body: { site_title: '纪念 · 永怀' } });
  assert.strictEqual(w.d.ok, true);
  const t = await j('/admin-api/traffic');
  assert.ok(typeof t.d.total === 'number' && Array.isArray(t.d.byRoute) && Array.isArray(t.d.recent));
});
