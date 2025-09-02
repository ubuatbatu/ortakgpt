// Apps/Settings/main.js — VFS tabanlı görsel seçici + modal onay desteği
const SETTINGS_PATH = '/System/settings.json';

export async function mount(root, { vfs }) {
  // mevcut ayarları yükle
  let current = {};
  try { current = JSON.parse((await vfs.readFile(SETTINGS_PATH)) || '{}'); }
  catch { current = {}; }

  root.innerHTML = `
    <div class="settings">
      <aside class="s-nav">
        <button data-pane="genel" class="active">Genel</button>
        <button data-pane="arkaplan">Arkaplan</button>
        <button data-pane="masaustu">Masaüstü</button>
        <button data-pane="dosyalar">Dosyalar</button>
      </aside>

      <section class="s-body">
        <!-- GENEL -->
        <div class="pane" data-pane="genel">
          <h2>Genel</h2>
          <label class="row">
            <span>Tema</span>
            <select id="theme">
              <option value="dark">Koyu</option>
              <option value="light">Açık</option>
            </select>
          </label>

          <label class="row">
            <span>Kompakt görev çubuğu</span>
            <input type="checkbox" id="taskbarCompact"/>
          </label>

          <label class="row">
            <span>Başlat menüsü yüksekliği (px)</span>
            <input type="number" id="startMenuHeight" min="360" max="900" step="10"/>
          </label>

          <label class="row">
            <span>Explorer varsayılan görünüm</span>
            <select id="defaultExplorerView">
              <option value="small">Küçük</option>
              <option value="medium">Orta</option>
              <option value="large">Büyük</option>
              <option value="list">Liste</option>
              <option value="details">Detaylar</option>
            </select>
          </label>
        </div>

        <!-- ARKA PLAN -->
        <div class="pane" data-pane="arkaplan" hidden>
          <h2>Arkaplan</h2>
          <label class="row">
            <span>Mod</span>
            <select id="bgMode">
              <option value="sphere">Dinamik (Sphere)</option>
              <option value="solid">Düz Renk</option>
              <option value="image">Görsel</option>
            </select>
          </label>

          <label class="row">
            <span>Renk</span>
            <input type="color" id="bgColor"/>
          </label>

          <div class="row">
            <span>Görsel (VFS)</span>
            <div class="v" style="gap:6px; align-items:center;">
              <input type="text" id="bgImagePath" placeholder="/Documents/wallpapers/..." readonly style="width:280px;"/>
              <button id="pickVfsImage">VFS'ten Seç</button>
              <button id="clearImage" class="ghost">Temizle</button>
            </div>
          </div>
          <div class="hint" style="margin-left:220px; color:var(--text-2); font-size:12px;">
            Not: VFS içindeki görsel dosyaları tercihen <code>data:image/...;base64,...</code> biçiminde saklayın. Dosya içeriği bu biçimde değilse otomatik olarak base64'e çevirmeyi deneriz.
          </div>
        </div>

        <!-- MASAÜSTÜ -->
        <div class="pane" data-pane="masaustu" hidden>
          <h2>Masaüstü Izgarası</h2>
          <label class="row"><span>Genişlik</span><input type="number" id="gridW" min="60" max="200" step="2"/></label>
          <label class="row"><span>Yükseklik</span><input type="number" id="gridH" min="60" max="200" step="2"/></label>
          <label class="row"><span>Sol boşluk</span><input type="number" id="gridMX" min="0" max="60" step="2"/></label>
          <label class="row"><span>Üst boşluk</span><input type="number" id="gridMY" min="0" max="60" step="2"/></label>
        </div>

        <!-- DOSYALAR -->
        <div class="pane" data-pane="dosyalar" hidden>
          <h2>Dosya İlişkilendirmeleri</h2>
          <div class="hint">Örnek: .txt → app.notepad</div>
          <textarea id="assoc" rows="6" spellcheck="false"
            placeholder='{"\\.txt":"app.notepad",".png":"app.paint"}'></textarea>
        </div>

        <footer class="s-foot">
          <div class="left">
            <button id="btnDefaults" class="ghost">Varsayılanlara Dön</button>
          </div>
          <div class="right">
            <button id="btnApply">Uygula</button>
            <button id="btnSave">Kaydet</button>
          </div>
        </footer>
      </section>
    </div>
  `;

  // yardımcılar
  const byId = (id)=> root.querySelector('#'+id);
  const val = (obj, path, def)=> path.split('.').reduce((a,k)=> (a&&a[k]!=null?a[k]:undefined), obj) ?? def;

  // formu doldur
  byId('theme').value = val(current,'theme','dark');
  byId('taskbarCompact').checked = !!val(current,'taskbarCompact', false);
  byId('startMenuHeight').value = val(current,'startMenuHeight',520);
  byId('defaultExplorerView').value = val(current,'defaultExplorerView','medium');

  byId('bgMode').value = val(current,'background.mode','sphere');
  byId('bgColor').value = val(current,'background.color','#0b0f14');
  if (val(current,'background.imagePath','')) byId('bgImagePath').value = current.background.imagePath || '';

  const grid = current.desktopGrid || { w:96, h:100, marginX:16, marginY:16 };
  byId('gridW').value  = grid.w;
  byId('gridH').value  = grid.h;
  byId('gridMX').value = grid.marginX;
  byId('gridMY').value = grid.marginY;

  byId('assoc').value = JSON.stringify(current.assoc || {}, null, 2);

  // Sekme geçişleri
  root.querySelector('.s-nav').addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    root.querySelectorAll('.s-nav button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const pane = btn.dataset.pane;
    root.querySelectorAll('.pane').forEach(p=>p.hidden = (p.dataset.pane !== pane));
  });

  // VFS görsel seçici
  byId('pickVfsImage').addEventListener('click', async ()=>{
    const picker = (window.ui && window.ui.pickVfsFile) ? window.ui.pickVfsFile : localPickVfsFile;
    const path = await picker({ title:'Görsel Seç (VFS)', startPath:'/Documents', acceptExts:['.png','.jpg','.jpeg','.gif','.webp'] });
    if (!path) return;
    byId('bgImagePath').value = path;

    let content = '';
    try { content = await vfs.readFile(path); } catch { content=''; }
    let data = content;
    if (!/^data:image\\//i.test(content||'')) {
      // içeriği base64'e çevirmeyi dene (başarısız olursa iptal)
      const ext = (path.match(/\\.[^.]+$/)?.[0]||'').toLowerCase();
      const mime = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp' }[ext] || 'application/octet-stream';
      try { data = `data:${mime};base64,${btoa(content)}`; }
      catch { alert('Seçilen VFS dosyası görüntü olarak çözümlenemedi. Lütfen data URL olarak kaydedin.'); return; }
    }
    // önizleme için dataset'te tut
    byId('pickVfsImage').dataset.preview = data;
  });
  byId('clearImage').addEventListener('click', ()=>{
    byId('bgImagePath').value = '';
    delete byId('pickVfsImage').dataset.preview;
  });

  // Uygula: kaydetmeden canlı uygula
  byId('btnApply').addEventListener('click', async ()=>{
    const next = collectForm(current, root);
    window.dispatchEvent(new CustomEvent('settings-changed', { detail: next }));
    if (next.desktopGrid) window.dispatchEvent(new CustomEvent('update-desktop-grid', { detail: next.desktopGrid }));
  });

  // Kaydet (+ canlı uygula)
  byId('btnSave').addEventListener('click', async ()=>{
    const next = collectForm(current, root);
    await vfs.writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2));
    window.dispatchEvent(new CustomEvent('settings-changed', { detail: next }));
    if (next.desktopGrid) window.dispatchEvent(new CustomEvent('update-desktop-grid', { detail: next.desktopGrid }));
    alert('Ayarlar kaydedildi.');
  });

  // Varsayılanlar
  byId('btnDefaults').addEventListener('click', ()=>{
    byId('theme').value = 'dark';
    byId('taskbarCompact').checked = false;
    byId('startMenuHeight').value = 520;
    byId('defaultExplorerView').value = 'medium';
    byId('bgMode').value = 'sphere';
    byId('bgColor').value = '#0b0f14';
    byId('gridW').value = 96;
    byId('gridH').value = 100;
    byId('gridMX').value = 16;
    byId('gridMY').value = 16;
    byId('assoc').value = JSON.stringify({ ".txt":"app.notepad",".md":"app.notepad",".png":"app.paint",".jpg":"app.paint",".jpeg":"app.paint" }, null, 2);
    byId('bgImagePath').value = '';
    delete byId('pickVfsImage').dataset.preview;
  });
}

// Form to settings object
function collectForm(prev, root){
  const g = {
    w: num(root, 'gridW', 96),
    h: num(root, 'gridH', 100),
    marginX: num(root, 'gridMX', 16),
    marginY: num(root, 'gridMY', 16),
  };
  const assoc = safeParseJSON(root.querySelector('#assoc').value, prev.assoc || {});
  const imagePath = root.querySelector('#bgImagePath').value || '';
  const imageData = root.querySelector('#pickVfsImage').dataset.preview || (prev.background?.imageData || '');
  const bg = {
    mode: root.querySelector('#bgMode').value,
    color: root.querySelector('#bgColor').value,
    imagePath,
    imageData,
    sphere: prev.background?.sphere || undefined
  };
  return {
    ...prev,
    theme: root.querySelector('#theme').value,
    taskbarCompact: root.querySelector('#taskbarCompact').checked,
    startMenuHeight: num(root, 'startMenuHeight', 520),
    defaultExplorerView: root.querySelector('#defaultExplorerView').value,
    desktopGrid: g,
    background: bg,
    assoc
  };
}

function num(root, id, def){ const v = Number(root.querySelector('#'+id).value); return Number.isFinite(v) ? v : def; }
function safeParseJSON(s, fallback){ try{ return JSON.parse(s); }catch{ return fallback; } }

// Basit yerel VFS dosya seçici (window.ui.pickVfsFile yoksa)
function localPickVfsFile({ title='VFS Dosya Seç', startPath='/Documents', acceptExts=['.png','.jpg','.jpeg','.gif','.webp'] }={}){
  return new Promise((resolve)=>{
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="hd">${title}</div>
        <div class="bd">
          <div class="crumbs" style="font-size:12px; color:var(--text-2); margin-bottom:8px;"></div>
          <div class="list" style="max-height:360px; overflow:auto; border:1px solid var(--border); border-radius:10px;"></div>
        </div>
        <div class="ft">
          <button class="btn cancel">İptal</button>
          <button class="btn primary ok" disabled>Seç</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const listEl = ov.querySelector('.list');
    const crumbs = ov.querySelector('.crumbs');
    const btnOk = ov.querySelector('.ok');
    const btnCancel = ov.querySelector('.cancel');
    let cwd = startPath || '/Documents';
    let sel = null;
    function full(p, name){ return (p==='/'?'':p) + '/' + name; }

    async function render(){
      crumbs.textContent = cwd;
      listEl.innerHTML = '';
      if (cwd!=='/') {
        const up = document.createElement('div');
        up.className = 'item';
        up.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 10px;';
        up.innerHTML = '<div>⬆️</div><div class="name">..</div>';
        up.onclick = ()=>{ cwd = cwd.split('/').slice(0,-1).join('/') || '/'; sel=null; btnOk.disabled=true; render(); };
        listEl.appendChild(up);
      }
      const rows = await window.vfs.list(cwd).catch(()=>[]);
      const dirs = rows.filter(r=>r.type==='dir').sort((a,b)=> a.name.localeCompare(b.name,'tr'));
      const files = rows.filter(r=>r.type==='file').sort((a,b)=> a.name.localeCompare(b.name,'tr'));
      const accept = (it)=> !acceptExts || !it.ext || acceptExts.includes((it.ext||'').toLowerCase());

      for (const d of dirs) {
        const el = document.createElement('div');
        el.className = 'item';
        el.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 10px;cursor:pointer;';
        el.innerHTML = '<div>📁</div><div class="name"></div>'; el.querySelector('.name').textContent = d.name;
        el.onclick = ()=>{ cwd = full(cwd, d.name); sel=null; btnOk.disabled=true; render(); };
        listEl.appendChild(el);
      }
      for (const f of files) {
        if (!accept(f)) continue;
        const el = document.createElement('div');
        el.className = 'item';
        el.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 10px;cursor:pointer;';
        el.innerHTML = '<div>🖼️</div><div class="name"></div>'; el.querySelector('.name').textContent = f.name;
        el.onclick = ()=>{
          sel = full(cwd, f.name);
          Array.from(listEl.children).forEach(x=> x.classList.remove('sel'));
          el.classList.add('sel');
          btnOk.disabled = !sel;
        };
        el.ondblclick = ()=>{ sel = full(cwd, f.name); close(sel); };
        listEl.appendChild(el);
      }
    }
    function close(v){ ov.remove(); resolve(v); }
    btnCancel.onclick = ()=> close(null);
    btnOk.onclick = ()=> close(sel);
    ov.addEventListener('pointerdown', (e)=>{ if (e.target===ov) close(null); });
    render();
  });
}
