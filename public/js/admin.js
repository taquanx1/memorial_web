/* Admin panel logic */
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  let TOKEN = localStorage.getItem('mem_admin_token') || '';
  let admins = [];

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const r = await fetch(path, Object.assign({}, opts, { headers }));
    let d; try { d = await r.json(); } catch (e) { d = {}; }
    if (r.status === 401) { logout(); throw new Error('unauthorized'); }
    return d;
  }
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

  /* ---------- auth ---------- */
  async function init() {
    if (!TOKEN) { showLogin(); return; }
    try {
      const d = await api('/admin-api/me');
      if (d.ok) { enterApp(d.admin.username); }
      else showLogin();
    } catch (e) { showLogin(); }
  }
  function showLogin() {
    $('#loginWrap').style.display = 'flex';
    $('#adminShell').hidden = true;
  }
  function enterApp(username) {
    $('#loginWrap').style.display = 'none';
    $('#adminShell').hidden = false;
    $('#adminUser').textContent = '👤 ' + username;
    loadDashboard();
    loadAdmins();
    loadSettings();
    loadReview();
  }
  function logout() {
    TOKEN = ''; localStorage.removeItem('mem_admin_token');
    showLogin();
  }

  $('#loginBtn').addEventListener('click', async () => {
    const username = $('#loginUser').value.trim();
    const password = $('#loginPass').value;
    if (!username || !password) { $('#loginErr').textContent = '请输入账号和密码'; return; }
    $('#loginBtn').textContent = '登录中…';
    const d = await api('/admin-api/login', { method: 'POST', body: { username, password } }).catch(()=>({error:'网络错误'}));
    if (d.ok) {
      TOKEN = d.token; localStorage.setItem('mem_admin_token', TOKEN);
      enterApp(d.username);
    } else {
      $('#loginErr').textContent = d.error || '登录失败';
    }
    $('#loginBtn').textContent = '登 录';
  });
  $('#loginForm').addEventListener('submit', e => e.preventDefault());
  $('#logoutBtn').addEventListener('click', logout);

  /* tab nav */
  $$('.nav-item').forEach(b => b.addEventListener('click', () => {
    $$('.nav-item').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $$('.tab-panel').forEach(p => p.classList.remove('active'));
    $('#tab-' + b.dataset.tab).classList.add('active');
    if (b.dataset.tab === 'dashboard') loadDashboard();
    if (b.dataset.tab === 'review') loadReview();
  }));

  /* ---------- dashboard ---------- */
  async function loadDashboard() {
    const d = await api('/admin-api/traffic');
    $('#stTotal').textContent = d.total || 0;
    $('#stToday').textContent = d.today || 0;
    $('#stViews').textContent = d.views || 0;
    const pending = (await api('/admin-api/activity'));
    $('#stPending').textContent = (pending.activity || []).filter(m => m.status === 'pending').length;
    $('#routeList').innerHTML = (d.byRoute || []).map(r =>
      `<span class="rg"><b>${esc(r.c)}</b> 次 · ${esc(r.route)}</span>`).join('');
    const tb = $('#trafficTable tbody');
    tb.innerHTML = (d.recent || []).map(t =>
      `<tr><td>${fmtDT(t.ts)}</td><td>${esc(t.route)}</td><td>${esc(t.ip)}</td><td>${esc(t.ua)}</td></tr>`).join('');
  }

  /* ---------- admins ---------- */
  async function loadAdmins() {
    const d = await api('/admin-api/admins');
    admins = d.admins || [];
    $('#adminTable tbody').innerHTML = admins.map(a =>
      `<tr><td>${a.id}</td><td>${esc(a.username)}</td><td>${fmtDT(a.created_at)}</td></tr>`).join('');
  }
  $('#addAdminBtn').addEventListener('click', async () => {
    const username = $('#newAdminUser').value.trim();
    const password = $('#newAdminPass').value;
    const msg = $('#adminMsg');
    if (!username || !password) { msg.textContent='请输入账号和密码'; msg.className='form-msg err'; return; }
    const d = await api('/admin-api/admins', { method:'POST', body:{username,password} });
    if (d.ok) {
      msg.textContent='管理员添加成功'; msg.className='form-msg ok';
      $('#newAdminUser').value=''; $('#newAdminPass').value='';
      loadAdmins();
    } else { msg.textContent=d.error||'添加失败'; msg.className='form-msg err'; }
  });

  /* ---------- design ---------- */
  async function loadSettings() {
    const d = await api('/admin-api/settings');
    const s = d.settings || {};
    $('#ds_site_title').value = s.site_title || '';
    $('#ds_hero_title').value = s.hero_title || '';
    $('#ds_hero_sub').value = s.hero_sub || '';
    $('#ds_hero_image').value = s.hero_image || '';
    $('#ds_about_title').value = s.about_title || '';
    $('#ds_about_body').value = s.about_body || '';
    $('#ds_memorywall_title').value = s.memorywall_title || '';
    $('#ds_gallery_title').value = s.gallery_title || '';
    $('#ds_maintained_by').value = s.maintained_by || '';
    let theme = {}; try { theme = JSON.parse(s.theme||'{}'); } catch(e){}
    $('#ds_accent').value = theme.accent || '#b9a15f';
    $('#ds_tone').value = theme.tone || 'light';
    $('#ds_font').value = theme.font || 'serif';
  }
  $('#saveDesignBtn').addEventListener('click', async () => {
    const body = {
      site_title: $('#ds_site_title').value,
      hero_title: $('#ds_hero_title').value,
      hero_sub: $('#ds_hero_sub').value,
      hero_image: $('#ds_hero_image').value,
      about_title: $('#ds_about_title').value,
      about_body: $('#ds_about_body').value,
      memorywall_title: $('#ds_memorywall_title').value,
      gallery_title: $('#ds_gallery_title').value,
      maintained_by: $('#ds_maintained_by').value,
      theme: { accent: $('#ds_accent').value, tone: $('#ds_tone').value, font: $('#ds_font').value },
    };
    const d = await api('/admin-api/settings', { method:'POST', body });
    const msg = $('#designMsg');
    if (d.ok) { msg.textContent='设计已保存并生效'; msg.className='form-msg ok'; }
    else { msg.textContent='保存失败'; msg.className='form-msg err'; }
  });
  $('#resetDesignBtn').addEventListener('click', async () => {
    const d = await api('/admin-api/settings', { method:'POST', body:{
      site_title:'纪念 · 永怀', hero_title:'永远的怀念', hero_sub:'以温暖的方式，留住每一份思念',
      hero_image:'', about_title:'生平简介', memorywall_title:'思念之墙', gallery_title:'相册',
      maintained_by:'纪念网站管理团队', theme:{accent:'#b9a15f',tone:'light',font:'serif'} }});
    if (d.ok) { loadSettings(); $('#designMsg').textContent='已恢复默认'; $('#designMsg').className='form-msg ok'; }
  });

  /* ---------- content (bypass) ---------- */
  $('#addContentBtn').addEventListener('click', async () => {
    const section = $('#cc_section').value;
    const content = $('#cc_content').value;
    const msg = $('#ccMsg');
    if (!content.trim()) { msg.textContent='内容不能为空'; msg.className='form-msg err'; return; }
    // validate JSON for timeline/gallery
    if (section === 'timeline' || section === 'gallery') {
      try { JSON.parse(content); } catch(e) { msg.textContent='JSON 格式错误，请检查'; msg.className='form-msg err'; return; }
    }
    const d = await api('/admin-api/content', { method:'POST', body:{ section, content } });
    if (d.ok) { msg.textContent='内容已直接发布（无需审核）'; msg.className='form-msg ok'; $('#cc_content').value=''; }
    else { msg.textContent=d.error||'发布失败'; msg.className='form-msg err'; }
  });

  /* ---------- review ---------- */
  let reviewFilter = 'all', reviewData = [];
  async function loadReview() {
    const d = await api('/admin-api/memories/all');
    reviewData = d.memories || [];
    renderReview();
  }
  function renderReview() {
    const list = reviewData.filter(m => reviewFilter === 'all' ? true : m.status === reviewFilter);
    const wrap = $('#reviewList');
    if (!list.length) { wrap.innerHTML = '<div class="empty">暂无记录</div>'; return; }
    wrap.innerHTML = list.map(m => {
      const photos = safeArr(m.photos);
      return `
      <div class="review-card">
        <div class="review-head">
          <span class="review-who">${esc(m.name)||'匿名'}</span>
          <span class="badge ${esc(m.status)}">${statusCN(m.status)}</span>
          <span style="font-size:.8rem;color:#a89f91">${fmtDT(m.created_at)}</span>
        </div>
        <div class="review-text">${esc(m.text)}</div>
        ${photos.length?`<div class="review-photos">${photos.map(p=>`<img src="${esc(p)}">`).join('')}</div>`:''}
        <div class="review-meta">来源：📨 留下思念${m.sync_flag? ' · 管理员直接发布':''}</div>
        <div class="review-actions">
          ${m.status!=='published'?`<button class="b-pub" data-id="${m.id}" data-st="published">发布</button>`:''}
          ${m.status!=='rejected'?`<button class="b-rej" data-id="${m.id}" data-st="rejected">拒绝</button>`:''}
          ${m.status!=='pending'?`<button class="b-back" data-id="${m.id}" data-st="pending">转回待审</button>`:''}
        </div>
      </div>`;
    }).join('');
    wrap.querySelectorAll('button[data-st]').forEach(b => b.addEventListener('click', async () => {
      await api(`/admin-api/memories/${b.dataset.id}/status`, { method:'POST', body:{ status:b.dataset.st }});
      loadReview();
    }));
  }
  function safeArr(x){try{const a=JSON.parse(x||'[]');return Array.isArray(a)?a:[]}catch(e){return[]}}
  function statusCN(s){return s==='published'?'已发布':s==='rejected'?'已拒绝':'待审核'}
  $$('.chip').forEach(c => c.addEventListener('click', () => {
    $$('.chip').forEach(x=>x.classList.remove('active'));
    c.classList.add('active');
    reviewFilter = c.dataset.f;
    renderReview();
  }));

  function fmtDT(ts){ const d=new Date(Number(ts)*1000); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes()); }
  function pad(n){return n<10?'0'+n:n}

  init();
})();
