/* Public memorial page */
(function () {
  const $ = (s) => document.querySelector(s);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  async function fetchJSON(url, opts) {
    const r = await fetch(url, opts);
    return r.json();
  }

  async function init() {
    // view count
    if ($('#viewCount')) {
      fetchJSON('/api/views').then(d => { if (d.views != null) $('#viewCount').textContent = d.views; }).catch(()=>{});
    }
    // site settings + theme
    let site;
    try { site = await fetchJSON('/api/site'); } catch (e) { return; }
    if (site.title) document.title = site.title + ' | 网上纪念';
    if (site.hero_title) $('#heroTitle').textContent = site.hero_title;
    if (site.hero_sub) $('#heroSub').textContent = site.hero_sub;
    if (site.about_title) $('#aboutTitle').textContent = site.about_title;
    if (site.wall_title) $('#wallTitle').textContent = site.wall_title && $('#wallTitle').textContent === '思念之墙' ? site.wall_title : $('#wallTitle').textContent;
    if (site.gallery_title) $('#galleryTitle').textContent = site.gallery_title;
    if (site.maintained_by) $('#maintainedBy').textContent = site.maintained_by;
    if (site.theme) {
      const t = site.theme;
      if (t.accent) document.documentElement.style.setProperty('--accent', t.accent);
      if (t.font === 'sans') document.documentElement.style.setProperty('--serif', 'var(--sans)');
      if (t.tone === 'dark') {
        document.documentElement.style.setProperty('--bg','#1c1917');
        document.documentElement.style.setProperty('--panel','#262220');
        document.documentElement.style.setProperty('--ink','#efe9df');
        document.documentElement.style.setProperty('--ink-soft','#c9c2b7');
        document.documentElement.style.setProperty('--line','#3a352f');
      }
    }
    if (site.hero_image && $('#heroAvatar')) $('#heroAvatar').style.backgroundImage = `url(${site.hero_image})`;

    // sections
    let sec;
    try { sec = await fetchJSON('/api/sections'); } catch (e) { sec = {}; }

    // about
    if (sec.about && $('#aboutBody')) {
      $('#aboutBody').innerHTML = sec.about.map(a => `<p>${esc(a.text).replace(/\n/g,'<br>')}</p>`).join('');
    }

    // timeline
    const tWrap = $('#timelineWrap');
    if (sec.timeline && tWrap) {
      tWrap.innerHTML = sec.timeline.map(it => `
        <div class="tl-item">
          <div class="tl-year">${esc(it.year)}</div>
          <div class="tl-title">${esc(it.title)}</div>
          <div class="tl-text">${esc(it.text)}</div>
        </div>`).join('');
    }

    // gallery
    const gGrid = $('#galleryGrid');
    if (sec.gallery && gGrid) {
      const groups = [...new Set([...(sec.gallerySections || []), ...sec.gallery.map(it => it.group || '其他')])];
      gGrid.innerHTML = sec.gallery.map((it, i) => `
        <div class="g-item" id="gallery-photo-${i}" data-group="${esc(it.group || '其他')}" style="--gallery-order:${groups.indexOf(it.group || '其他')}" onclick="window.__lightbox('${esc(it.src)}')">
          <img src="${esc(it.src)}" alt="${esc(it.caption)}" ${it.width > 0 && it.height > 0 ? `width="${Number(it.width)}" height="${Number(it.height)}"` : ''} loading="lazy" onerror="this.src='/assets/placeholder.svg'">
          <div class="g-cap">${esc(it.caption)}</div>
        </div>`).join('');
      initGalleryReveal(gGrid);
      initGalleryFocus(gGrid, groups);
      if (location.hash.startsWith('#gallery/')) followLocation();
    } else if (gGrid) {
      gGrid.innerHTML = '<p style="color:#a89f91">相册内容准备中，敬请期待。</p>';
    }

    // memory wall
    loadWall();
  }

  function initGalleryFocus(grid, groups) {
    const mobile = window.matchMedia('(max-width: 900px)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const header = $('.topnav');
    const cards = [...grid.querySelectorAll('.g-item')];
    const sections = groups.map(name => ({ name, card: cards.find(card => card.dataset.group === name) }))
      .filter(section => section.card);
    if (!sections.length) return;
    const nav = document.createElement('nav');
    nav.className = 'gallery-section-nav';
    nav.setAttribute('aria-label', '相册分组');
    nav.innerHTML = sections.map(section =>
      `<a href="#gallery/${encodeURIComponent(section.name)}">${esc(section.name)}</a>`).join('');
    header.appendChild(nav);
    const links = [...nav.querySelectorAll('a')];
    let active = -1;
    let scheduled = false;

    function update() {
      scheduled = false;
      if (grid.closest('.sect-panel').hidden) {
        document.body.classList.remove('gallery-focus', 'gallery-browsing');
        return;
      }
      const bounds = grid.getBoundingClientRect();
      const watching = bounds.top < window.innerHeight * .7 &&
        bounds.bottom > $('.topnav-inner').getBoundingClientRect().bottom + 60;
      document.body.classList.toggle('gallery-browsing', watching);
      document.body.classList.toggle('gallery-focus', mobile.matches && watching);
      if (!watching) return;
      const headerBottom = header.getBoundingClientRect().bottom;
      document.documentElement.style.setProperty('--gallery-scroll-offset', `${headerBottom + 16}px`);
      const readingLine = headerBottom + (window.innerHeight - headerBottom) * .3;
      let current = 0;
      sections.forEach((section, index) => {
        if (section.card.getBoundingClientRect().top <= readingLine) current = index;
      });
      if (current === active) return;
      active = current;
      links.forEach((link, index) => {
        link.classList.toggle('active', index === current);
        if (index === current) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
      const link = links[current];
      nav.scrollTo({ left: link.offsetLeft - nav.clientWidth / 2 + link.offsetWidth / 2,
        behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
    function schedule() {
      if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
    }
    links.forEach(link => link.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (location.hash === link.getAttribute('href')) {
        event.preventDefault();
        followLocation();
      }
    }));
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    mobile.addEventListener('change', schedule);
    new MutationObserver(schedule).observe(grid.closest('.sect-panel'), { attributes: true, attributeFilter: ['hidden'] });
    if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(grid);
    schedule();
  }

  function initGalleryReveal(grid) {
    // Photos stay visible when animation or IntersectionObserver is unavailable.
    if (!('IntersectionObserver' in window)) return;
    const motion = window.matchMedia('(max-width: 900px) and (prefers-reduced-motion: no-preference)');
    const cards = [...grid.querySelectorAll('.g-item')];
    let observer;
    function update() {
      if (observer) observer.disconnect();
      cards.forEach(card => card.classList.remove('reveal-pending', 'reveal-visible'));
      if (!motion.matches) return;
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.remove('reveal-pending');
          entry.target.classList.add('reveal-visible');
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.08 });
      cards.forEach(card => {
        card.classList.add('reveal-pending');
        observer.observe(card);
      });
    }
    motion.addEventListener('change', update);
    update();
  }

  async function loadWall() {
    const grid = $('#wallGrid');
    if (!grid) return;
    let data;
    try { data = await fetchJSON('/api/memories'); } catch (e) { return; }
    const list = (data.memories || []);
    if (!list.length) { grid.innerHTML = '<p style="color:#a89f91">还没有留言，成为第一个写下思念的人吧。</p>'; return; }
    grid.innerHTML = list.map(m => `
      <div class="wall-card">
        <div class="who">${m.name ? esc(m.name) : '匿名'}</div>
        <div class="txt">${esc(m.text)}</div>
        ${(photosOf(m).length ? `<div class="wall-photos">${photosOf(m).slice(0,3).map(p=>`<img src="${esc(p)}" alt="">`).join('')}</div>` : '')}
        <div class="when">${fmtTime(m.created_at)}</div>
      </div>`).join('');
  }

  function photosOf(m) {
    try { const a = JSON.parse(m.photos || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }

  function fmtTime(ts) {
    const d = new Date(Number(ts) * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  function pad(n){return n<10?'0'+n:n}

  window.shareLink = function () {
    const url = location.href;
    const t = $('#shareLinkText');
    if (t) t.textContent = url;
    const overlay = $('#shareOverlay');
    if (overlay) overlay.classList.add('show');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).catch(()=>{});
      } else {
        const ta = document.createElement('textarea');
        ta.value = url; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      }
    } catch (e) {}
  };
  window.closeOverlay = function () { const o = $('#shareOverlay'); if (o) o.classList.remove('show'); };

  window.__lightbox = function (src) {
    let lb = document.getElementById('lb');
    if (!lb) { lb = document.createElement('div'); lb.id='lb'; lb.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99;display:flex;align-items:center;justify-content:center;cursor:zoom-out;'; lb.onclick=()=>lb.remove(); document.body.appendChild(lb); }
    lb.innerHTML = `<img src="${esc(src)}" style="max-width:92vw;max-height:92vh;border-radius:6px;background:#000">`;
  };

  /* ---------- Section navigation (left nav, like original) ---------- */
  function activateTab(name, scroll = true) {
    const target = name === 'timeline' ? $('#timelineTitle') : $(`#panel-${name}`);
    if (name === 'timeline') name = 'about';
    const link = document.querySelector(`.sect-link[data-tab="${name}"]`);
    const panel = document.querySelector(`.sect-panel[data-panel="${name}"]`);
    if (!link || !panel) return;
    if (name !== 'gallery') document.body.classList.remove('gallery-focus', 'gallery-browsing');
    document.querySelectorAll('.sect-link').forEach(l => { l.classList.toggle('active', l === link); });
    document.querySelectorAll('.sect-panel').forEach(p => {
      const on = p === panel;
      p.classList.toggle('active', on);
      p.hidden = !on;
      p.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    if (scroll && target) target.scrollIntoView({ block: 'start' });
  }
  document.querySelectorAll('.sect-link').forEach(l => l.addEventListener('click', (e) => {
    // Switch the visible panel while preserving normal hash navigation.
    activateTab(l.dataset.tab);
  }));
  document.querySelectorAll('.topnav-links a[href^="#"]').forEach(a =>
    a.addEventListener('click', () => activateTab(a.getAttribute('href').slice(1))));

  function followLocation() {
    let hash;
    try { hash = decodeURIComponent(location.hash.slice(1)); }
    catch { return; }
    if (hash.startsWith('gallery/')) {
      activateTab('gallery', false);
      const group = hash.slice('gallery/'.length);
      const card = [...document.querySelectorAll('#galleryGrid .g-item')]
        .find(photo => photo.dataset.group === group);
      if (!card) {
        // Gallery data may still be loading; init retries after rendering it.
        $('#panel-gallery').scrollIntoView({ block: 'start' });
        return;
      }
      document.body.classList.add('gallery-browsing');
      document.body.classList.toggle('gallery-focus', window.matchMedia('(max-width: 900px)').matches);
      document.documentElement.style.setProperty('--gallery-scroll-offset',
        `${$('.topnav').getBoundingClientRect().bottom + 16}px`);
      card.scrollIntoView({ block: 'start', behavior:
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    } else if (['about','timeline','memorywall','gallery'].includes(hash)) {
      activateTab(hash);
    } else if (!hash) {
      activateTab('about', false);
    }
  }
  window.addEventListener('DOMContentLoaded', followLocation);
  window.addEventListener('hashchange', followLocation);

  document.addEventListener('DOMContentLoaded', init);
})();
