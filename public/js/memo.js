/* 留下思念 page logic */
(function () {
  const $ = (s) => document.querySelector(s);
  let photos = []; // array of {url, name}

  // toolbar commands on contenteditable
  document.querySelectorAll('.toolbar button').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      const val = btn.dataset.val || null;
      document.execCommand(cmd, false, val);
      $('#memoText').focus();
    });
  });

  // placeholder behavior for contenteditable
  const editor = $('#memoText');
  function place() {
    if (editor.innerText.trim() === '') { editor.dataset.ph = '1'; editor.style.color = '#a89f91'; renderPh(); }
    else { delete editor.dataset.ph; editor.style.color = ''; }
  }
  function renderPh(){ if(editor.dataset.ph){ if(!editor.querySelector('.ph')){ editor.innerHTML='<span class="ph">写下您想说的话……</span>'; } } }
  editor.addEventListener('focus', () => { if (editor.dataset.ph){ editor.innerHTML=''; delete editor.dataset.ph; editor.style.color=''; } });
  editor.addEventListener('blur', place);
  place();

  // photo picker
  const zone = $('#photoZone');
  const input = $('#photoInput');
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const files = Array.from(input.files || []).slice(0, 5 - photos.length);
    files.forEach(async f => {
      const fd = new FormData();
      fd.append('photo', f);
      const msg = $('#uploadingMsg');
      if (msg) msg.textContent = '照片上传中…';
      try {
        const r = await fetch('/api/memories/photo', { method: 'POST', body: fd });
        const d = await r.json();
        if (d.ok && d.url) {
          photos.push(d.url);
          renderPhotoPreviews();
        }
      } catch (e) {}
      if (msg) msg.textContent = '';
    });
    input.value = '';
  });

  function renderPhotoPreviews() {
    const pv = $('#photoPreviews');
    pv.innerHTML = photos.map((u, i) => `
      <div class="ph">
        <img src="${u}" alt="照片">
        <button class="x" type="button" data-i="${i}">×</button>
      </div>`).join('');
    pv.querySelectorAll('.x').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      photos.splice(Number(b.dataset.i), 1);
      renderPhotoPreviews();
    }));
  }

  // submit
  $('#submitBtn').addEventListener('click', async () => {
    const text = editor.innerText.trim();
    if (!text) { editor.style.borderColor = '#c0392b'; editor.focus(); return; }
    const btn = $('#submitBtn');
    btn.disabled = true; btn.textContent = '提交中…';
    try {
      const r = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: $('#memoName').value, text, photos }),
      });
      const d = await r.json();
      if (d.ok) {
        $('#doneOverlay').classList.add('show');
      } else {
        alert(d.error || '提交失败，请重试');
        btn.disabled = false; btn.textContent = '上传';
      }
    } catch (e) {
      alert('网络错误，请重试');
      btn.disabled = false; btn.textContent = '上传';
    }
  });
})();
