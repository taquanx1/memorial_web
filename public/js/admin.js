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
  let dashboardRequest = 0, mapDataPromise;
  const countryNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
  const chinaToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10);
  $('#trafficDate').value = chinaToday();
  $('#trafficDate').max = chinaToday();
  const countryName = code => /^[A-Z]{2}$/.test(code || '') ? countryNames.of(code) : '未知 / 本地';
  const cityName = row => row.city || '未知城市';
  const emptyRow = (columns, message) => `<tr><td colspan="${columns}" class="empty">${esc(message)}</td></tr>`;
  function mapData() {
    if (!mapDataPromise) mapDataPromise = fetch('/assets/china-mainland.geojson').then(r => {
      if (!r.ok) throw new Error('底图加载失败');
      return r.json();
    }).catch(error => { mapDataPromise = null; throw error; });
    return mapDataPromise;
  }
  async function loadDashboard() {
    const request = ++dashboardRequest;
    const date = $('#trafficDate').value || chinaToday();
    $('#trafficError').textContent = '';
    $('#trafficSummary').textContent = '正在读取访问数据…';
    $('#chinaMap').setAttribute('aria-busy', 'true');
    try {
      const [d, geometry] = await Promise.all([
        api('/admin-api/traffic?date=' + encodeURIComponent(date)), mapData().catch(() => null)
      ]);
      if (request !== dashboardRequest) return;
      if (d.error) throw new Error(d.error);
      $('#stTotal').textContent = d.total;
      $('#stToday').textContent = d.today;
      $('#stViews').textContent = d.views;
      $('#stPending').textContent = d.pending;
      $('#trafficDate').max = d.todayDate;
      $('#trafficDate').min = d.firstDate;
      $('#trafficSummary').textContent = `${d.date} · ${d.selectedTotal} 次访问 · ${d.unknown} 次来源未知 / 本地（北京时间）`;
      $('#mainlandTable tbody').innerHTML = d.mainland.map(row =>
        `<tr><td>${esc(cityName(row))}</td><td>${row.visits}</td></tr>`).join('') || emptyRow(2, '该日暂无中国大陆访问');
      $('#outsideTable tbody').innerHTML = d.outside.map(row =>
        `<tr><td>${esc(countryName(row.country))}</td><td>${esc(cityName(row))}</td><td>${row.visits}</td></tr>`).join('') || emptyRow(3, '该日暂无中国大陆以外的已定位访问');
      $('#originTable tbody').innerHTML = d.origins.map((row, index) =>
        `<tr><td>${index + 1}</td><td>${esc(countryName(row.country))}</td><td>${esc(cityName(row))}</td><td>${row.visits}</td><td>${(row.visits / d.selectedTotal * 100).toFixed(1)}%</td></tr>`).join('') || emptyRow(5, '该日暂无访问记录');
      $('#trafficTable tbody').innerHTML = d.recent.map(t =>
        `<tr><td>${fmtDT(t.ts)}</td><td>${esc(t.route)}</td><td>${esc(t.ip)}</td><td>${esc(t.ua)}</td></tr>`).join('') || emptyRow(4, '该日暂无访问记录');
      renderChinaMap(geometry, d.mainland);
    } catch (error) {
      if (request !== dashboardRequest) return;
      $('#trafficError').textContent = '读取失败：' + error.message + '。请点击刷新重试。';
      $('#trafficSummary').textContent = '';
      $('#chinaMap').innerHTML = '<p class="empty">访问数据加载失败</p>';
      for (const id of ['mainlandTable', 'outsideTable', 'originTable', 'trafficTable']) {
        $('#' + id + ' tbody').innerHTML = emptyRow(id === 'originTable' ? 5 : id === 'mainlandTable' ? 2 : id === 'outsideTable' ? 3 : 4, '数据加载失败');
      }
    } finally {
      if (request === dashboardRequest) $('#chinaMap').setAttribute('aria-busy', 'false');
    }
  }
  function renderChinaMap(feature, rows) {
    if (!feature) {
      $('#chinaMap').innerHTML = '<p class="empty">地图加载失败，请点击刷新重试。下方表格仍可查看访问来源。</p>';
      $('#mapDetail').textContent = '';
      return;
    }
    const project = (lon, lat) => [40 + (lon - 73) / 63 * 720, 30 + (54 - lat) / 37 * 460];
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const path = polygons.map(polygon => polygon.map(ring => ring.map(([lon,lat],index) => {
      const [x,y] = project(lon,lat);
      return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ') + 'Z').join(' ')).join(' ');
    const cities = rows.filter(row => row.city && Number.isFinite(row.latitude) && Number.isFinite(row.longitude) &&
      row.longitude >= 73 && row.longitude <= 136 && row.latitude >= 17 && row.latitude <= 54);
    const maximum = Math.max(1, ...cities.map(row => row.visits));
    const dots = cities.map((row,index) => {
      const [x,y] = project(row.longitude,row.latitude);
      const intensity = row.visits / maximum;
      const radius = 5 + Math.sqrt(intensity) * 12;
      const label = `${cityName(row)} · ${row.visits} 次`;
      return `<g class="city-marker" tabindex="0" role="button" data-city="${index}" aria-label="${esc(label)}">
        <title>${esc(label)}</title><circle cx="${x}" cy="${y}" r="${radius}" fill="hsl(278 52% ${73 - intensity * 37}%)" fill-opacity=".8"/>
        <text x="${x + radius + 3}" y="${y + 4}">${esc(label)}</text></g>`;
    }).join('');
    $('#chinaMap').innerHTML = `<svg viewBox="0 0 800 520" role="group" aria-label="中国大陆城市访问热力图">
      <path class="china-land" d="${path}" fill-rule="evenodd"/>${dots}</svg>`;
    const noCity = rows.reduce((sum,row) => sum + row.visits,0) - cities.reduce((sum,row) => sum + row.visits,0);
    $('#mapDetail').textContent = cities.length ? `${cities.length} 个已定位城市${noCity ? ` · ${noCity} 次访问无法在地图定位，请查看下方明细` : ''}` :
      (noCity ? `${noCity} 次中国大陆访问尚无城市坐标，请查看下方明细` : '该日暂无中国大陆城市访问');
    $$('#chinaMap [data-city]').forEach(marker => {
      const show = () => { const row = cities[Number(marker.dataset.city)]; $('#mapDetail').textContent = `${cityName(row)} · ${row.visits} 次访问`; };
      marker.addEventListener('click', show);
      marker.addEventListener('focus', show);
      marker.addEventListener('keydown', event => { if (['Enter',' '].includes(event.key)) { event.preventDefault(); show(); } });
    });
  }
  $('#trafficDate').addEventListener('change', loadDashboard);
  $('#trafficRefresh').addEventListener('click', loadDashboard);
  $('#trafficToday').addEventListener('click', () => { $('#trafficDate').value = chinaToday(); loadDashboard(); });

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
    loadModeration();
    const d = await api('/admin-api/memories/all');
    reviewData = d.memories || [];
    renderReview();
  }
  let moderationBusy = false;
  function showModeration(enabled) {
    const button = $('#autoApproveBtn');
    button.setAttribute('aria-checked', String(enabled));
    button.textContent = 'Auto-approve · ' + (enabled ? '开启' : '关闭');
    $('#moderationStatus').textContent = enabled ? '新留言提交后立即发布' : '新留言需管理员审核';
  }
  async function loadModeration() {
    if (moderationBusy) return;
    const button = $('#autoApproveBtn');
    button.disabled = true;
    try {
      const d = await api('/admin-api/moderation');
      if (d.error) throw new Error(d.error);
      showModeration(d.autoApprove);
      button.disabled = false;
    } catch (error) { $('#moderationStatus').textContent = '设置读取失败，请重新打开留言审核。'; }
  }
  $('#autoApproveBtn').addEventListener('click', async () => {
    if (moderationBusy) return;
    moderationBusy = true;
    const button = $('#autoApproveBtn');
    const previous = button.getAttribute('aria-checked') === 'true';
    button.disabled = true;
    $('#moderationStatus').textContent = '正在保存…';
    try {
      const d = await api('/admin-api/moderation', { method: 'PUT', body: { autoApprove: !previous } });
      if (d.error) throw new Error(d.error);
      showModeration(d.autoApprove);
    } catch (error) {
      showModeration(previous);
      $('#moderationStatus').textContent = '保存失败，请重试。';
    } finally { moderationBusy = false; button.disabled = false; }
  });
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

  function fmtDT(ts){ const d=new Date(Number(ts)*1000 + 8*3600000); return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate())+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes()); }
  function pad(n){return n<10?'0'+n:n}

  init();
})();
