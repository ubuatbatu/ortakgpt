// MyExplorerV2 — Renderer (Desktop + Explorer + Start + Settings entegrasyonu)

const $  = (s, el=document)=>el.querySelector(s);
const $$ = (s, el=document)=>Array.from(el.querySelectorAll(s));
const jn = (a,b)=> (a==='/'? '' : a) + '/' + b;
const dn = (p)=> p.split('/').slice(0,-1).join('/') || '/';
const isRoot = (p)=> p === '/';
const isRecycle = (p)=> p === '/Recycle';

/* ===========================================================
   Settings (kalıcı) + Runner (geçici) + Dinamik Arkaplan
   =========================================================== */
const SETTINGS_PATH = '/System/settings.json';
const DEFAULT_SETTINGS = {
  version: 1,
  theme: 'dark',
  taskbarCompact: false,
  startMenuHeight: 520,
  defaultExplorerView: 'medium',
  desktopGrid: { w:96, h:100, marginX:16, marginY:16 },
  assoc: { '.txt':'app.notepad', '.md':'app.notepad', '.png':'app.paint', '.jpg':'app.paint', '.jpeg':'app.paint' },
  taskbarStartStyle: 'label', // 'label' | 'icon'
  background: {
    mode: 'sphere',              // 'sphere' | 'solid' | 'image'
    color: '#0b0f14',
    imageData: '',
    sphere: {
      points: 900, rings: 5, innerRings: 3,
      radius: 220, speed: 0.28, innerSpeed: 0.7, orbitSpeed: 0.22,
      dotSize: 1.6, noise: 0.06
    }
  }
};

let CURRENT_SETTINGS = { ...DEFAULT_SETTINGS };    // ilişkilendirme/tema için
window.runtimeSettings = { ...DEFAULT_SETTINGS };  // arkaplan & grid için

let DynamicBG = null;
function ensureDynamicBG(){
  if (DynamicBG) return Promise.resolve(DynamicBG);
  return import('./Themes/DynamicBG/main.js').then(m=> (DynamicBG = m));
}

async function loadSettingsIntoRenderer() {
  try {
    const raw = await window.vfs.readFile(SETTINGS_PATH);
    CURRENT_SETTINGS = { ...DEFAULT_SETTINGS, ...JSON.parse(raw||'{}') };
  } catch { CURRENT_SETTINGS = { ...DEFAULT_SETTINGS }; }
  document.body.classList.toggle('theme-light', CURRENT_SETTINGS.theme === 'light');
  document.body.classList.toggle('taskbar-compact', !!CURRENT_SETTINGS.taskbarCompact);
  document.documentElement.style.setProperty('--start-fixed-height', (CURRENT_SETTINGS.startMenuHeight||520)+'px');
}

async function loadRuntimeSettings() {
  try {
    const raw = await window.vfs.readFile(SETTINGS_PATH);
    window.runtimeSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw||'{}') };
  } catch { window.runtimeSettings = { ...DEFAULT_SETTINGS }; }
  applySettings(window.runtimeSettings);
}

function applySettings(s) {
  document.body.classList.toggle('theme-light', s.theme === 'light');
  document.body.classList.toggle('taskbar-compact', !!s.taskbarCompact);
  document.documentElement.style.setProperty('--start-fixed-height', (s.startMenuHeight||520)+'px');

  if (s.desktopGrid) {
    DESK_GRID.w = s.desktopGrid.w ?? DESK_GRID.w;
    DESK_GRID.h = s.desktopGrid.h ?? DESK_GRID.h;
    DESK_GRID.marginX = s.desktopGrid.marginX ?? DESK_GRID.marginX;
    DESK_GRID.marginY = s.desktopGrid.marginY ?? DESK_GRID.marginY;
  }

  const mode = s.background?.mode || 'sphere';
  const body = document.body;
  body.style.backgroundImage = '';
  body.style.backgroundColor = '';

  if (mode === 'solid'){
    ensureDynamicBG().then(m => m.stop()).catch(()=>{});
    body.style.backgroundColor = s.background?.color || '#0b0f14';
  } else if (mode === 'image'){
    ensureDynamicBG().then(m => m.stop()).catch(()=>{});
    const url = s.background?.imageData || '';
    if (url){
      body.style.backgroundImage = `url("${url}")`;
      body.style.backgroundSize = 'cover';
      body.style.backgroundPosition = 'center';
    } else {
      body.style.backgroundColor = s.background?.color || '#0b0f14';
    }
  } else {
    const cfg = s.background?.sphere || {};
    ensureDynamicBG().then(m => m.start(cfg));
  }
  setStartAppearance?.();
}

window.addEventListener('settings-changed', (e)=>{
  const ns = e.detail || {};
  CURRENT_SETTINGS = { ...CURRENT_SETTINGS, ...ns };
  window.runtimeSettings = { ...window.runtimeSettings, ...ns };
  applySettings(window.runtimeSettings);
});
window.addEventListener('update-desktop-grid', (e)=>{
  const g = e.detail||{};
  Object.assign(DESK_GRID, g);
  renderDesktop();
});
window.addEventListener('render-desktop', ()=> renderDesktop());
window.addEventListener('empty-recycle', async ()=>{ await emptyRecycle(); });

/* ===========================================================
   Start (Başlat) Menüsü
   =========================================================== */
function ensureStartMenuDOM() {
  let sm = document.getElementById('startMenu');
  if (sm) return sm;

  sm = document.createElement('div');
  sm.id = 'startMenu';
  sm.innerHTML = `
    <div class="sm-layout">
      <div class="sm-header">
        <button class="sm-gear" title="Ayarlar">⚙️</button>
      </div>
      <div class="sm-body">
        <div class="sm-left">
          <div class="sm-left-item active" data-pane="apps">Uygulamalar</div>
          <div class="sm-left-item" data-pane="places">Yerler</div>
          <div class="sm-left-item" data-pane="recent">Son Açılanlar</div>
        </div>
        <div class="sm-right">
          <div class="pane pane-apps"></div>
          <div class="pane pane-places" style="display:none"></div>
          <div class="pane pane-recent" style="display:none"></div>
        </div>
      </div>
      <div class="sm-footer">
        <button class="power" title="Kapat">⏻</button>
        <input class="filter" placeholder="Ara: uygulamalar & dosyalar..." spellcheck="false"/>
      </div>
    </div>`;
  document.body.appendChild(sm);

  sm.querySelector('.sm-left').addEventListener('click', (e)=>{
    const it = e.target.closest('.sm-left-item'); if (!it) return;
    sm.querySelectorAll('.sm-left-item').forEach(x=>x.classList.remove('active'));
    it.classList.add('active');
    const pane = it.getAttribute('data-pane');
    sm.querySelectorAll('.sm-right .pane').forEach(p=> p.style.display='none');
    sm.querySelector(`.pane-${pane}`).style.display='';
  });

  window.addEventListener('pointerdown', (e)=>{
    if (!sm.classList.contains('visible')) return;
    const btn = document.getElementById('btn-start');
    if (sm.contains(e.target) || btn?.contains(e.target)) return;
    sm.classList.remove('visible');
  });

  window.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape' && sm.classList.contains('visible')) sm.classList.remove('visible');
  });

  sm.querySelector('.power').addEventListener('click', ()=> sm.classList.remove('visible'));

  sm.querySelector('.sm-gear').addEventListener('click', ()=> {
    sm.classList.remove('visible');
    launchApp('app.settings', {});
  });

  return sm;
}
function cleanupLegacyExplorerButton(){
  document.querySelectorAll(
    '[data-app-id="app.explorer"],[data-action="open-explorer"],[data-app="explorer"],#btn-explorer,.btn-explorer'
  ).forEach(el => el.remove());
}

async function ensureStartUI() {
  const taskbar = $('#taskbar');
  if (!taskbar) return;

  let btn = $('#btn-start');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'btn-start';
    btn.innerHTML = '<span class="logo">⊞</span> Başlat';
    taskbar.insertBefore(btn, taskbar.firstChild);
  }
  btn.onclick = ()=> toggleStart();
  ensureStartMenuDOM();

  let host = $('#task-buttons', taskbar);
  if (!host) {
    host = document.createElement('div');
    host.id = 'task-buttons';
    taskbar.insertBefore(host, btn.nextSibling);
  } else if (host.previousElementSibling !== btn) {
    taskbar.insertBefore(host, btn.nextSibling);
  }

  enableTaskButtonReorder();
  ensureShowDesktopButton();
  cleanupLegacyExplorerButton?.();
}

function enableTaskButtonReorder(){
  const host = window.wmTaskbarHost();
  if (!host || host.__reorderInit) return; host.__reorderInit = true;

  host.addEventListener('dragstart', e=>{
    const btn = e.target.closest('.task-btn'); if (!btn) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', btn.dataset.win);
    btn.classList.add('dragging');
  });
  host.addEventListener('dragover', e=>{
    e.preventDefault();
    const host = window.wmTaskbarHost();
    const dragging = host.querySelector('.task-btn.dragging');
    const over = e.target.closest('.task-btn');
    if (!dragging || !over || dragging===over) return;
    const r = over.getBoundingClientRect();
    const before = e.clientX < r.left + r.width/2;
    host.insertBefore(dragging, before ? over : over.nextSibling);
  });
  ['drop','dragend'].forEach(ev=>{
    host.addEventListener(ev, ()=> host.querySelector('.task-btn.dragging')?.classList.remove('dragging'));
  });
}
window.wm = {
  setBadge(target, text){
    const id = typeof target==='string' ? target : target?.dataset?.winId;
    const btn = window.__wm.get(id)?.taskBtn; if (!btn) return;
    if (text==null || text==='') btn.removeAttribute('data-badge');
    else btn.setAttribute('data-badge', String(text));
  },
  setProgress(target, value){
    const id = typeof target==='string' ? target : target?.dataset?.winId;
    const btn = window.__wm.get(id)?.taskBtn; if (!btn) return;
    if (value==null){ btn.style.backgroundImage=''; btn.removeAttribute('data-progress'); return; }
    const pct = Math.max(0, Math.min(1, value))*100;
    btn.style.backgroundImage = `linear-gradient(to right, rgba(255,255,255,.12) ${pct}%, transparent ${pct}%)`;
    btn.setAttribute('data-progress', pct.toFixed(0));
  },
  attention(target, on=true){
    const id = typeof target==='string' ? target : target?.dataset?.winId;
    const btn = window.__wm.get(id)?.taskBtn; if (!btn) return;
    btn.classList.toggle('attention', !!on);
  },
  button(target){
    const id = typeof target==='string' ? target : target?.dataset?.winId;
    return window.__wm.get(id)?.taskBtn || null;
  },
  list(){ return Array.from(window.__wm.keys()); }
};

function ensureShowDesktopButton(){
  const taskbar = $('#taskbar'); if (!taskbar) return;
  let b = $('#btn-show-desktop', taskbar);
  if (!b){
    b = document.createElement('button');
    b.id = 'btn-show-desktop';
    b.title = 'Masaüstünü Göster';
    b.textContent = '▭';
    taskbar.appendChild(b);
  }
  let minimizedAll = false;
  b.onclick = ()=>{
if (!minimizedAll){ window.__wm.forEach(r=>{ if (!r.minimized) window.wmMinimize(r.el); }); minimizedAll = true; }
 else { window.__wm.forEach(r=>{ if (r.minimized) window.wmRestore(r.el); }); minimizedAll = false; }
  };
}

/* ===== Window Manager ===== */
(function(){
  if (window.__WM_DEFINED__) return;
  window.__WM_DEFINED__ = true;

  window.__wmZ = window.__wmZ || 100;
  window.__wm  = window.__wm  || new Map();

  window.wmTaskbarHost = window.wmTaskbarHost || function(){
    return document.getElementById('task-buttons');
  };

  window.wmSetActive = window.wmSetActive || function(id){
    window.__wm.forEach(rec => {
      const mine = rec.el.dataset.winId === id;
      rec.el.classList.toggle('active', mine);
      rec.taskBtn?.classList.toggle('active', mine && !rec.minimized);
      rec.taskBtn?.classList.toggle('minimized', !!rec.minimized);
    });
  };

  window.wmBringToFront = window.wmBringToFront || function(winEl){
    winEl.style.display = '';
    winEl.style.zIndex = String(++window.__wmZ);
    window.wmSetActive(winEl.dataset.winId);
  };

 window.wmRegister = window.wmRegister || function(winEl, { title='Uygulama' } = {}){
  const id = winEl.dataset.winId || ('win'+Math.random().toString(36).slice(2));
  winEl.dataset.winId = id;
  window.__wm.set(id, { el: winEl, taskBtn: null, minimized:false });

  const host = window.wmTaskbarHost();
  if (host) {
    const btn = document.createElement('button');
    btn.className = 'task-btn';
    btn.dataset.win = id;
    btn.textContent = title;
    btn.title = title;
    btn.draggable = true;
    btn.addEventListener('click', ()=>{
      const rec = window.__wm.get(id); if (!rec) return;
      const isActive = rec.el.classList.contains('active');
      if (rec.minimized || rec.el.style.display==='none')      window.wmRestore(rec.el);
      else if (!isActive)                                      window.wmBringToFront(rec.el);
      else                                                     window.wmMinimize(rec.el);
    });
    host.appendChild(btn);
    window.__wm.get(id).taskBtn = btn;
    enhanceTaskButton(btn, id);
  }

  winEl.addEventListener('mousedown', ()=> window.wmBringToFront(winEl));
  window.wmBringToFront(winEl);
  return id;
};

  window.wmMinimize = window.wmMinimize || function(winEl){
    const id = winEl.dataset.winId;
    const rec = window.__wm.get(id); if (!rec) return;
    winEl.style.display = 'none';
    rec.minimized = true;
    window.wmSetActive(null);
  };

  window.wmRestore = window.wmRestore || function(winEl){
    const id = winEl.dataset.winId;
    const rec = window.__wm.get(id); if (!rec) return;
    winEl.style.display = '';
    rec.minimized = false;
    window.wmBringToFront(winEl);
  };

  window.wmClose = window.wmClose || function(winEl){
    const id = winEl.dataset.winId;
    const rec = window.__wm.get(id);
    winEl.remove();
    rec?.taskBtn?.remove();
    window.__wm.delete(id);
    let top = null, topZ = -Infinity;
    window.__wm.forEach(r=>{
      const z = parseInt(r.el.style.zIndex||'0',10);
      if (!r.minimized && z > topZ) { top = r; topZ = z; }
    });
    window.wmSetActive(top?.el?.dataset?.winId || null);
  };

  window.wmToggleMaximize = window.wmToggleMaximize || function(winEl){
    toggleMaximize(winEl);
  };

let _taskPreviewEl = null;
let _pvHideTo = null;
let _currentPreviewId = null;
let _previewLock = false;

function ensureTaskPreview(){
  if (_taskPreviewEl) return _taskPreviewEl;
  
  const el = document.createElement('div');
  el.className = 'task-preview';
  Object.assign(el.style, {
    position: 'fixed', zIndex: '999999', display: 'none',
    width: '320px', height: '220px', background: '#121418',
    border: '1px solid #2a2f3a', borderRadius: '6px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden'
  });

  const headerEl = document.createElement('div');
  headerEl.className = 'pv-header';
  Object.assign(headerEl.style, {
    height: '28px', padding: '0 8px', display: 'flex',
    alignItems: 'center', background: '#1a1d23',
    borderBottom: '1px solid #2a2f3a'
  });

  const titleEl = document.createElement('div');
  titleEl.className = 'pv-title';
  Object.assign(titleEl.style, {
    flex: '1', fontSize: '12px', fontWeight: '500', color: '#eee',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', userSelect: 'none'
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'pv-close';
  Object.assign(closeBtn.style, {
    width: '20px', height: '20px', padding: '0', marginLeft: '8px',
    background: 'transparent', border: 'none', color: '#999',
    fontSize: '14px', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', borderRadius: '4px'
  });
  closeBtn.innerHTML = '&#x2715;';
  closeBtn.title = 'Pencereyi Kapat';
  
  closeBtn.onmouseenter = () => { closeBtn.style.background = '#e81123'; closeBtn.style.color = '#fff'; };
  closeBtn.onmouseleave = () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = '#999'; };

  const previewEl = document.createElement('div');
  previewEl.className = 'pv-preview';
  Object.assign(previewEl.style, {
    position: 'relative', width: '100%', height: 'calc(100% - 28px)',
    overflow: 'hidden', background: '#0a0c0f'
  });

  headerEl.appendChild(titleEl);
  headerEl.appendChild(closeBtn);
  el.appendChild(headerEl);
  el.appendChild(previewEl);

  _taskPreviewEl = el;
  document.body.appendChild(el);

  el.addEventListener('mouseenter', () => { clearTimeout(_pvHideTo); _previewLock = true; });
  el.addEventListener('mouseleave', () => { _previewLock = false; hideTaskPreviewSoon(); });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const win = _taskPreviewEl._currentWindow;
    if (win) {
      _previewLock = false;
      hideTaskPreviewSoon();
      window.wmClose(win);
    }
  });

  el.addEventListener('mouseenter', ()=> clearTimeout(_pvHideTo));
  el.addEventListener('mouseleave', hideTaskPreviewSoon);
  document.body.appendChild(el);
  _taskPreviewEl = el;
  return el;
}

async function showTaskPreviewFor(id, anchorBtn){
  const rec = window.__wm.get(id); if (!rec) return;
  const el = ensureTaskPreview();
  const win = rec.el;

  clearTimeout(_pvHideTo);
  
  if (_currentPreviewId === id && _taskPreviewEl?.style.display === 'block') {
    _previewLock = true;
    return;
  }
  
  _currentPreviewId = id;
  _previewLock = true;
  el._currentWindow = win;
  
  el.style.display = 'block';
  const taskbarRect = anchorBtn.getBoundingClientRect();
  const previewWidth = el.offsetWidth;
  const spacing = 8;

  let left = Math.max(spacing, Math.min(taskbarRect.left, window.innerWidth - previewWidth - spacing));
  el.style.left = left + 'px';
  el.style.bottom = (window.innerHeight - taskbarRect.top + spacing) + 'px';

  const titleNode = win.querySelector('.title');
  const title = (titleNode && titleNode.textContent || '').trim() || 'Pencere';

  const titleEl = el.querySelector('.pv-title');
  if (titleEl) titleEl.textContent = title;

  const previewEl = el.querySelector('.pv-preview');
  if (previewEl) {
    previewEl.innerHTML = '';
    
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-wrapper';
    Object.assign(wrapper.style, {
      position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', overflow: 'hidden'
    });

    const originalDisplay = win.style.display;
    if (win.style.display === 'none') {
      win.style.display = 'block';
      win.style.visibility = 'hidden';
    }

    const bounds = win.getBoundingClientRect();
    const scale = Math.min(previewEl.offsetWidth / bounds.width, previewEl.offsetHeight / bounds.height) * 0.95;

    const clone = win.cloneNode(true);
    Object.assign(clone.style, {
      position: 'absolute', top: '50%', left: '50%',
      width: bounds.width + 'px', height: bounds.height + 'px',
      transform: `translate(-50%, -50%) scale(${scale})`,
      transformOrigin: 'center', pointerEvents: 'none',
      background: win.style.background || '#1a1d23',
      display: 'block', visibility: 'visible'
    });

    clone.querySelectorAll('.window-controls, .resize-handle').forEach(el => el.remove());
    
    if (originalDisplay === 'none') {
      win.style.display = 'none';
      win.style.visibility = '';
    }

    wrapper.appendChild(clone);
    previewEl.appendChild(wrapper);

    previewEl.onclick = () => {
      hideTaskPreviewSoon();
      if (rec.minimized) window.wmRestore(win);
      else window.wmBringToFront(win);
    };
  }

  el.style.display = 'block';
  const r = anchorBtn.getBoundingClientRect();
  const maxLeft = Math.max(8, Math.min(innerWidth - 380, r.left));
  const top = Math.max(8, r.top - 10 - el.offsetHeight);
  el.style.left = maxLeft + 'px';
  el.style.top  = top + 'px';
}

function hideTaskPreviewSoon(){
  if (_previewLock) return;
  clearTimeout(_pvHideTo);
  _pvHideTo = setTimeout(() => {
    if (!_previewLock && _taskPreviewEl) {
      _taskPreviewEl.style.display = 'none';
      _currentPreviewId = null;
    }
  }, 300);
}

function enhanceTaskButton(btn, id){
  let previewTimeout = null;
  
  btn.addEventListener('mouseenter', () => {
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(() => { showTaskPreviewFor(id, btn); }, 200);
  });
  
  btn.addEventListener('mouseleave', () => {
    clearTimeout(previewTimeout);
    _previewLock = false;
    hideTaskPreviewSoon();
  });
  btn.addEventListener('auxclick', (e)=>{ if (e.button===1){ const r=window.__wm.get(id); r && window.wmClose(r.el); }});
  btn.addEventListener('dblclick', ()=>{ const r=window.__wm.get(id); if(!r) return; window.wmToggleMaximize(r.el); });
  btn.addEventListener('contextmenu', (e)=>{
    e.preventDefault();
    const r = window.__wm.get(id); if (!r) return;
    const isMax = r.el.dataset.maximized === '1';
    const items = [
      { label: r.minimized ? 'Geri Getir' : 'Öne Getir', action: ()=> r.minimized ? window.wmRestore(r.el) : window.wmBringToFront(r.el) },
      { label: 'Simge Durumuna Küçült', action: ()=> window.wmMinimize(r.el) },
      { label: isMax ? 'Eski Boyut' : 'Ekranı Kapla', action: ()=> window.wmToggleMaximize(r.el) },
      null,
      { label: 'Kapat', danger:true, action: ()=> window.wmClose(r.el) },
    ];
    showMenu(items, e.clientX, e.clientY);
  });
}

})();


let _recentOpen = [];
function pushRecent(path){
  if (!path) return;
  const name = path.split('/').pop();
  _recentOpen = [{name, path}, ..._recentOpen.filter(r=>r.path!==path)].slice(0,50);
}

let _startSearchIndex = null;
async function buildStartIndex(){
  const apps = await window.apps.list().catch(()=>[]);
  const out = [];
  async function walk(path, depth=0){
    const rows = await window.vfs.list(path).catch(()=>[]);
    for (const it of rows){
      const full = (path==='/'? '' : path) + '/' + it.name;
      out.push({ name: it.name, path: full, type: it.type, ext: it.ext||'' });
      if (it.type==='dir' && depth<2) await walk(full, depth+1);
    }
  }
  await walk('/Desktop',0);
  await walk('/Documents',0);
  _startSearchIndex = { apps, files: out };
  return _startSearchIndex;
}

function renderStartApps(sm, apps){
  const host = sm.querySelector('.pane-apps');
  host.innerHTML = `
    <div class="section-title">Uygulamalar</div>
    <div class="grid cards"></div>`;
  const grid = host.querySelector('.grid.cards');
  apps.forEach(m=>{
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="emoji">🧩</div><div class="title">${m.name||m.id}</div><div class="desc">${m.id}</div>`;
    card.addEventListener('click', async ()=>{ sm.classList.remove('visible'); await launchApp(m.id, {}); });
    grid.appendChild(card);
  });
}
function renderStartPlaces(sm){
  const host = sm.querySelector('.pane-places');
  host.innerHTML = `
    <div class="section-title">Hızlı Erişim</div>
    <div class="quick">
      <div class="link" data-path="/Desktop">📺 Desktop</div>
      <div class="link" data-path="/Documents">📁 Documents</div>
      <div class="link" data-path="/Recycle">🗑️ Recycle</div>
      <div class="link" data-path="/Apps">🧩 Apps</div>
    </div>`;
  host.querySelectorAll('.link').forEach(a=>{
    a.addEventListener('click', ()=>{ sm.classList.remove('visible'); createExplorer(a.dataset.path); });
  });
}
function renderStartRecent(sm, recents){
  const host = sm.querySelector('.pane-recent');
  host.innerHTML = `<div class="section-title">Son Açılanlar</div>`;
  (recents && recents.length ? recents : [{name:'(boş)', path:''}]).slice(0, 20).forEach(r=>{
    const row = document.createElement('div');
    row.className = 'result';
    row.innerHTML = `<div class="emoji">🕘</div><div class="title">${r.name}</div><div class="path">${r.path||''}</div>`;
    if (r.path) row.addEventListener('click', ()=>{ sm.classList.remove('visible'); window.dispatchEvent(new CustomEvent('open-file', { detail: { path: r.path } })); });
    host.appendChild(row);
  });
}
function renderStartSearch(sm, idx, q){
  const host = sm.querySelector('.pane-apps');
  const term = (q||'').trim().toLowerCase();
  if (!term) { renderStartApps(sm, idx.apps); return; }

  const hitsApp  = idx.apps.filter(a => (a.name||a.id||'').toLowerCase().includes(term));
  const hitsFile = idx.files.filter(f => (f.name||'').toLowerCase().includes(term));

  host.innerHTML = `
    <div class="section-title">Arama Sonuçları</div>
    <div class="grid"></div>
    <div class="section-title" style="margin-top:10px;">Dosyalar & Klasörler</div>
    <div class="results"></div>`;
  const grid = host.querySelector('.grid');
  hitsApp.forEach(m=>{
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="emoji">🧩</div><div class="title">${m.name||m.id}</div><div class="desc">${m.id}</div>`;
    card.addEventListener('click', ()=>{ sm.classList.remove('visible'); launchApp(m.id, {}); });
    grid.appendChild(card);
  });

  const results = host.querySelector('.results');
  hitsFile.slice(0,50).forEach(f=>{
    const row = document.createElement('div');
    row.className = 'result';
    row.innerHTML = `<div class="emoji">${f.type==='dir'?'📁':'📄'}</div><div class="title">${f.name}</div><div class="path">${f.path}</div>`;
    row.addEventListener('click', async ()=>{
      sm.classList.remove('visible');
      const t = await window.vfs.statType(f.path).catch(()=>null);
      if (t==='dir') createExplorer(f.path); else openWithDefaultApp(f.path);
    });
    results.appendChild(row);
  });
}

function toggleStart(force){
  const sm = ensureStartMenuDOM();
  const want = (typeof force==='boolean') ? force : !sm.classList.contains('visible');
  if (!want) { sm.classList.remove('visible'); return; }
  sm.classList.add('visible');

  buildStartIndex().then(idx=>{
    renderStartApps(sm, idx.apps);
    renderStartPlaces(sm);
    renderStartRecent(sm, _recentOpen);
  });

  const input = sm.querySelector('.filter');
  input.value = '';
  input.oninput = async ()=>{
    const idx = _startSearchIndex || await buildStartIndex();
    renderStartSearch(sm, idx, input.value);
  };
  setTimeout(()=> input.focus(), 0);
}

/* ===========================================================
   Desktop
   =========================================================== */
const DESKTOP_POS_FILE = '/System/.desktop-pos.json';
const DESK_GRID = { w: 96, h: 100, marginX: 16, marginY: 16 };

async function loadDesktopLayout() {
  try { return (JSON.parse(await window.vfs.readFile(DESKTOP_POS_FILE))?.positions)||{}; }
  catch { return {}; }
}
async function saveDesktopLayout(map) {
  try { await window.vfs.mkdir('/System'); } catch {}
  const payload = JSON.stringify({ version:1, positions: map }, null, 2);
  await window.vfs.writeFile(DESKTOP_POS_FILE, payload);
}

function snapToGrid(x, y, deskRect) {
  const minX = deskRect.left + DESK_GRID.marginX;
  const minY = deskRect.top  + DESK_GRID.marginY;
  const relX = Math.max(0, x - minX);
  const relY = Math.max(0, y - minY);
  const sx = Math.round(relX / DESK_GRID.w) * DESK_GRID.w + minX;
  const sy = Math.round(relY / DESK_GRID.h) * DESK_GRID.h + minY;
  return { x: sx, y: sy };
}
function applyIconPos(el, x, y) {
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  el.style.position = 'absolute';
}

function glyph(it) {
  if (it.type==='dir') return '📁';
  if (it.ext==='.lnk') return '🔗';
  if (it.ext==='.txt' || it.ext==='.md') return '📝';
  if (/\.app\.json$/i.test(it.name)) return '🧩';
  if (/\.(png|jpg|jpeg)$/i.test(it.name)) return '🖼️';
  return '📄';
}

async function renderDesktop() {
  const desk = $('#desktop');
  if (!desk) return;

  desk.oncontextmenu = null;
  desk.onkeydown = null;
  desk.onmousedown = null;

  desk.innerHTML = '';

  const layout = await loadDesktopLayout();
  const items = await window.vfs.list('/Desktop').catch(()=>[]);

  const namesSet = new Set(items.map(i=>i.name));
  for (const k of Object.keys(layout)) if (!namesSet.has(k)) delete layout[k];
  await saveDesktopLayout(layout).catch(()=>{});

  const icons = [];
  let lastIndex = null;
  const getSelected = ()=> icons.filter(x=>x.el.classList.contains('sel'));
  const clearSelection = ()=> icons.forEach(x=>x.el.classList.remove('sel'));
  const selectOne = (idx)=>{ clearSelection(); icons[idx]?.el.classList.add('sel'); lastIndex = idx; };
  const toggleOne = (idx)=>{ const el=icons[idx]?.el; if(!el) return; el.classList.toggle('sel'); lastIndex = idx; };
  const rangeSelect = (toIdx)=> { if (lastIndex==null) return selectOne(toIdx); const [a,b] = [Math.min(lastIndex,toIdx), Math.max(lastIndex,toIdx)]; clearSelection(); for (let i=a;i<=b;i++) icons[i].el.classList.add('sel'); };

  function ensureFocus(){ if (!desk.hasAttribute('tabindex')) desk.tabIndex = 0; desk.focus(); }

  function nextFreeSlot(used, deskRect){
    const startX = deskRect.left + DESK_GRID.marginX;
    const startY = deskRect.top  + DESK_GRID.marginY;
    for (let col=0; col<200; col++){
      for (let row=0; row<200; row++){
        const x = startX + col * DESK_GRID.w;
        const y = startY + row * DESK_GRID.h;
        const key = `${x},${y}`;
        if (!used.has(key)) { used.add(key); return {x,y}; }
      }
    }
    return { x:startX, y:startY };
  }

  const deskRect = desk.getBoundingClientRect();
  const occupied = new Set();

  items.forEach((it, idx)=>{
    const icon = document.createElement('div');
    icon.className = 'icon';
    icon.tabIndex = 0;
    icon.dataset.name = it.name;
    icon.dataset.type = it.type;
    icon.innerHTML = `<div class="glyph">${glyph(it)}</div><div class="label">${it.name}</div>`;

    let pos = layout[it.name];
    if (!pos){ pos = nextFreeSlot(occupied, deskRect); layout[it.name] = pos; }
    else { pos = snapToGrid(pos.x, pos.y, deskRect); layout[it.name] = pos; }
    occupied.add(`${pos.x},${pos.y}`);
    applyIconPos(icon, pos.x, pos.y);

    icon.addEventListener('dblclick', ()=> activateItem('/Desktop', it));

    icon.addEventListener('mousedown', (e)=>{
      if (e.button!==0) return;
      ensureFocus();
      const i = idx;
      if (e.shiftKey) rangeSelect(i);
      else if (e.ctrlKey || e.metaKey) toggleOne(i);
      else selectOne(i);
      startIconDrag(e, icon);
    });

    icon.addEventListener('contextmenu', (e)=>{
      e.preventDefault();
      if (!icon.classList.contains('sel')) { selectOne(idx); }
      const selectedNames = $$('.icon.sel', desk).map(x=> $('.label', x).textContent);
      showMenu(
        ctxForItem('/Desktop', it, { refresh: async()=>{ await renderDesktop(); }, el: icon, selectedNames }),
        e.clientX, e.clientY
      );
    });

    desk.appendChild(icon);
    icons.push({ el: icon, name: it.name, type: it.type });
  });

  await saveDesktopLayout(layout).catch(()=>{});

  desk.oncontextmenu = (e)=>{
    if (e.target.closest('.icon')) return;
    e.preventDefault();
    showMenu(ctxForBackground('/Desktop', {}), e.clientX, e.clientY);
  };

  desk.onkeydown = async (e)=>{
    const t = e.target; const tag=(t?.tagName||'').toLowerCase();
    if (tag==='input' || tag==='textarea' || t?.isContentEditable) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const sel = getSelected();
    const selNames = sel.map(x=> $('.label', x.el).textContent);

    if (e.key==='F2') { if (sel.length!==1) return; e.preventDefault(); return beginInlineRenameDesktop(sel[0].el, '/Desktop', selNames[0]); }
    if (e.key==='Delete'){ if (!selNames.length) return; e.preventDefault(); for (const n of selNames){ await window.vfs.delete('/Desktop', n, { toRecycle:true }).catch(err=>window.ui.showAlert({title:'Hata', message:err.message})); delete layout[n]; } await saveDesktopLayout(layout).catch(()=>{}); return renderDesktop(); }
    if (ctrl && e.key.toLowerCase()==='a'){ e.preventDefault(); icons.forEach(x=>x.el.classList.add('sel')); lastIndex = icons.length?0:null; return; }
    if (ctrl && e.key.toLowerCase()==='c'){ if (!selNames.length) return; e.preventDefault(); setClipboard('copy','/Desktop',selNames); return; }
    if (ctrl && e.key.toLowerCase()==='x'){ if (!selNames.length) return; e.preventDefault(); setClipboard('cut','/Desktop',selNames); return; }
    if (ctrl && e.key.toLowerCase()==='v'){ e.preventDefault(); await pasteTo('/Desktop', async()=>renderDesktop()); return; }
  };

  desk.onmousedown = (e)=>{
    if (e.button!==0) return;
    if (e.target.closest('.icon')) return;
    ensureFocus();

    let marquee = null, startX=e.pageX, startY=e.pageY;
    const baseSelected = e.ctrlKey||e.metaKey ? new Set($$('.icon.sel', desk)) : new Set();

    marquee = document.createElement('div');
    marquee.className='marquee';
    document.body.appendChild(marquee);

    const onMove = (ev)=>{
      const x1 = Math.min(startX, ev.pageX), y1 = Math.min(startY, ev.pageY);
      const x2 = Math.max(startX, ev.pageX), y2 = Math.max(startY, ev.pageY);
      marquee.style.left = x1 + 'px'; marquee.style.top = y1 + 'px';
      marquee.style.width = (x2-x1)+'px'; marquee.style.height=(y2-y1)+'px';

      const rect = { left:x1, top:y1, right:x2, bottom:y2 };
      const newly = new Set();
      for (const it of icons) {
        const r = it.el.getBoundingClientRect();
        const l = r.left + scrollX, t = r.top + scrollY, rr = r.right + scrollX, bb = r.bottom + scrollY;
        const hit = !(rr < rect.left || l > rect.right || bb < rect.top || t > rect.bottom);
        if (hit) newly.add(it.el);
      }
      const targetSet = new Set(baseSelected);
      if (ev.ctrlKey || ev.metaKey) newly.forEach(el=> targetSet.add(el));
      else { targetSet.clear(); newly.forEach(el=> targetSet.add(el)); }
      for (const it of icons) it.el.classList.toggle('sel', targetSet.has(it.el));
    };

    const onUp = ()=>{
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      marquee?.remove(); marquee=null;
      const selIdx = icons.findIndex(x=>x.el.classList.contains('sel'));
      if (selIdx>=0) lastIndex = selIdx;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once:true });
  };

  function startIconDrag(downEvent, anchorIconEl){
    let dragging=false, sx=downEvent.clientX, sy=downEvent.clientY;
    const group = $$('.icon.sel', desk).length ? $$('.icon.sel', desk) : [anchorIconEl];
    const starts = group.map(el=>{
      const name = el.dataset.name || $('.label', el).textContent;
      const r = el.getBoundingClientRect();
      return { el, name, type: el.dataset.type, x: r.left + scrollX, y: r.top + scrollY };
    });
    let dropFolderEl = null;
    let dropPath = null;

    const ghost = document.createElement('div');
    ghost.className='drag-ghost'; ghost.style.display='none';
    document.body.appendChild(ghost);

    const onMove = async (e)=>{
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragging && (Math.abs(dx)>4 || Math.abs(dy)>4)){
        dragging = true;
        ghost.style.display='';
        ghost.textContent = starts.length>1 ? `${starts.length} öğe` : starts[0].name;
      }
      if (!dragging) return;
      ghost.style.left=(e.pageX+12)+'px'; ghost.style.top=(e.pageY+10)+'px';

      for (const s of starts) s.el.style.transform = `translate(${dx}px, ${dy}px)`;

      dropFolderEl?.classList.remove('droptarget'); dropFolderEl=null; dropPath=null;

      const targetEl = document.elementFromPoint(e.clientX, e.clientY);
      const overIcon = targetEl?.closest('.icon');
      if (overIcon && overIcon !== anchorIconEl && !overIcon.classList.contains('sel')) {
        if (overIcon.dataset.type === 'dir') {
          dropFolderEl = overIcon; dropFolderEl.classList.add('droptarget');
          const folderName = overIcon.dataset.name || $('.label', overIcon).textContent;
          dropPath = jn('/Desktop', folderName);
          return;
        }
      }

      const maybeRow = targetEl?.closest('.explorer .list .item');
      if (maybeRow){
        const exRoot = targetEl.closest('.explorer');
        const pbox = $('.pathbox', exRoot); const exPath = pbox?.value || '/';
        const nm = maybeRow.dataset.name;
        const rows = await window.vfs.list(exPath).catch(()=>[]);
        const tgt = rows.find(r=>r.name===nm);
        if (tgt?.type==='dir'){ maybeRow.classList.add('droptarget'); dropFolderEl=maybeRow; dropPath = jn(exPath, nm); return; }
      } else {
        const exList = targetEl?.closest('.explorer .list');
        if (exList){
          const exRoot = exList.closest('.explorer');
          const pbox = $('.pathbox', exRoot); dropPath = pbox?.value || '/';
          return;
        }
      }
    };

    const onUp = async (e)=>{
      document.removeEventListener('mousemove', onMove);
      ghost.remove();
      for (const s of starts) s.el.style.transform = '';

      if (!dragging) return;

      if (dropPath){
        const copyMode = e.ctrlKey;
        try{
          if (copyMode){
            for (const s of starts) await copyEntry('/Desktop', s.name, dropPath);
          } else {
            for (const s of starts) await moveEntry('/Desktop', s.name, dropPath);
          }
          if (!copyMode && !dropPath.startsWith('/Desktop')) {
            const map = await loadDesktopLayout(); for (const s of starts){ delete map[s.name]; } await saveDesktopLayout(map).catch(()=>{});
          }
          await renderDesktop();
          return;
        } catch(err){ window.ui.showAlert({ title: 'Hata', message: err?.message||'Taşı/Kopyala başarısız' }); }
        dropFolderEl?.classList.remove('droptarget');
        return;
      }

      const deskR = desk.getBoundingClientRect();
      const map = await loadDesktopLayout();
      const baseDX = e.clientX - sx, baseDY = e.clientY - sy;
      for (const s of starts) {
        const newX = s.x + baseDX;
        const newY = s.y + baseDY;
        const snapped = snapToGrid(newX, newY, deskR);
        map[s.name] = snapped;
        applyIconPos(s.el, snapped.x, snapped.y);
      }
      await saveDesktopLayout(map).catch(()=>{});
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once:true });
  }
}

/* ===========================================================
   Explorer
   =========================================================== */
function openWindow(title, w=760, h=560, left=96, top=96) {
  const win = document.createElement('div');
  win.className = 'window';
  win.innerHTML = `
    <div class="titlebar">
      <div class="title"></div>
      <div class="actions">
        <button data-act="min" title="Simge Durumuna Küçült">—</button>
        <button data-act="max" title="Ekranı Kapla">▢</button>
        <button data-act="close" title="Kapat">×</button>
      </div>
    </div>
    <div class="content"></div>

    <div class="resize-handle n"  data-dir="n"></div>
    <div class="resize-handle s"  data-dir="s"></div>
    <div class="resize-handle e"  data-dir="e"></div>
    <div class="resize-handle w"  data-dir="w"></div>
    <div class="resize-handle ne" data-dir="ne"></div>
    <div class="resize-handle nw" data-dir="nw"></div>
    <div class="resize-handle se" data-dir="se"></div>
    <div class="resize-handle sw" data-dir="sw"></div>
  `;
  $('.title', win).textContent = title || 'Pencere';
  const content = $('.content', win);

  ensureWindowsLayer().appendChild(win);
  Object.assign(win.style, { width: w+'px', height: h+'px', left: left+'px', top: top+'px' });
  win.tabIndex = 0; setTimeout(()=> win.focus(), 0);

 $('[data-act=close]', win)?.addEventListener('click', ()=> window.wmClose(win));
 $('[data-act=min]',   win)?.addEventListener('click', ()=> window.wmMinimize(win));
 $('[data-act=max]',   win)?.addEventListener('click', ()=> window.wmToggleMaximize(win));
 win.addEventListener('mousedown', ()=> window.wmBringToFront(win));
  $('.titlebar', win)?.addEventListener('dblclick', ()=> window.wmToggleMaximize(win));

  makeDraggable(win);
  makeResizable(win);

  window.wmRegister(win, { title: title || 'Pencere' });

  return { winEl: win, content };
}


function makeDraggable(win){
  const bar = $('.titlebar', win);
  let sx=0, sy=0, ox=0, oy=0, dragging=false;

  const onDown = (e)=>{
    if (e.button!==0) return;
    if (win.dataset.maximized === '1') return;
    dragging=true; sx=e.clientX; sy=e.clientY;
    const r=win.getBoundingClientRect(); ox=r.left; oy=r.top; e.preventDefault();
  };
  const onMove = (e)=>{ if (!dragging) return; win.style.left = (ox + e.clientX - sx) + 'px'; win.style.top = (oy + e.clientY - sy) + 'px'; };
  const onUp   = ()=>{ dragging=false; };

  bar?.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function makeResizable(win){
  const minW = 420, minH = 260;
  const handles = $$('.resize-handle', win);
  handles.forEach(h=>{
    h.addEventListener('mousedown', (e)=>{
      e.preventDefault();
      if (win.dataset.maximized === '1') return;
      const dir = h.dataset.dir;
      const r0 = win.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY;
      const start = { left: r0.left, top: r0.top, width: r0.width, height: r0.height };

      const onMove = (ev)=>{
        let dx = ev.clientX - sx;
        let dy = ev.clientY - sy;
        let L = start.left, T = start.top, W = start.width, H = start.height;

        if (dir.includes('e')) W = Math.max(minW, start.width + dx);
        if (dir.includes('s')) H = Math.max(minH, start.height + dy);
        if (dir.includes('w')) { W = Math.max(minW, start.width - dx); L = start.left + (start.width - W); }
        if (dir.includes('n')) { H = Math.max(minH, start.height - dy); T = start.top  + (start.height - H); }

        Object.assign(win.style, { left: L+'px', top: T+'px', width: W+'px', height: H+'px' });
      };
      const onUp = ()=>{
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });
}
function toggleMaximize(win){
  const layer = ensureWindowsLayer();
  const th = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--taskbar-h')) || 48;
  if (win.dataset.maximized === '1') {
    win.dataset.maximized = '';
    win.style.left   = win.dataset.prevLeft  || '96px';
    win.style.top    = win.dataset.prevTop   || '96px';
    win.style.width  = win.dataset.prevWidth || '760px';
    win.style.height = win.dataset.prevHeight|| '560px';
  } else {
    const r = win.getBoundingClientRect();
    win.dataset.prevLeft   = r.left + 'px';
    win.dataset.prevTop    = r.top  + 'px';
    win.dataset.prevWidth  = r.width + 'px';
    win.dataset.prevHeight = r.height + 'px';
    const lr = layer.getBoundingClientRect();
    win.dataset.maximized = '1';
    win.style.left = '0px';
    win.style.top  = '0px';
    win.style.width  = lr.width + 'px';
    win.style.height = (lr.height) + 'px';
  }
}
function ensureWindowsLayer() {
  let layer = document.getElementById('windows');
  if (!layer) { layer = document.createElement('div'); layer.id = 'windows'; document.body.appendChild(layer); }
  return layer;
}
function dragWindow(win) {
  const bar = $('.titlebar', win); let sx=0, sy=0, ox=0, oy=0, dragging=false;
  const onDown = (e)=>{ if (e.button!==0) return; dragging=true; sx=e.clientX; sy=e.clientY; const r=win.getBoundingClientRect(); ox=r.left; oy=r.top; e.preventDefault(); };
  const onMove = (e)=>{ if (!dragging) return; win.style.left = (ox + e.clientX - sx) + 'px'; win.style.top = (oy + e.clientY - sy) + 'px'; };
  const onUp   = ()=>{ dragging=false; };
  bar?.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function humanSize(bytes) {
  if (bytes == null || isNaN(bytes)) return '';
  const u = ['B','KB','MB','GB','TB']; let i=0; let n = bytes;
  while (n >= 1024 && i < u.length-1) { n/=1024; i++; }
  return (i===0 ? n : n.toFixed(1)) + ' ' + u[i];
}
async function fileSizeOf(path) {
  const data = await window.vfs.readFile(path).catch(()=> '');
  if (typeof data === 'string' && data.startsWith('data:')) {
    const b64 = data.split(',')[1] || '';
    return Math.floor(b64.length * 3 / 4);
  }
  try { return new TextEncoder().encode(String(data)).length; }
  catch { return String(data).length; }
}

let _ctxMenuEl = null, _ctxCleanup = null;
function closeMenu(){ if (_ctxCleanup) { _ctxCleanup(); _ctxCleanup = null; } if (_ctxMenuEl){ _ctxMenuEl.remove(); _ctxMenuEl = null; } }
function showMenu(items, x, y){
  closeMenu();
  const m = document.createElement('div'); m.className = 'ctxmenu'; _ctxMenuEl = m;
  items.forEach(it=>{
    if (it === null) { const sep = document.createElement('div'); sep.className='mi sep'; m.appendChild(sep); return; }
    const el = document.createElement('div');
    el.className = 'mi' + (it.danger?' danger':'') + (it.disabled?' dis':'');
    el.textContent = it.label;
    if (!it.disabled && it.action) el.addEventListener('click', (e)=>{ e.stopPropagation(); closeMenu(); it.action(); });
    m.appendChild(el);
  });
  document.body.appendChild(m);
  const vw = innerWidth, vh = innerHeight, r = m.getBoundingClientRect();
  m.style.left = Math.min(x, vw - r.width - 4) + 'px';
  m.style.top  = Math.min(y, vh - r.height - 4) + 'px';

  const onPointerDown = (e)=>{ if (_ctxMenuEl && !_ctxMenuEl.contains(e.target)) closeMenu(); };
  const onKey = (e)=>{ if (e.key === 'Escape') closeMenu(); };
  const onScroll = ()=> closeMenu();
  const onResize = ()=> closeMenu();
  const onContextOther = (e)=>{ if (_ctxMenuEl && !_ctxMenuEl.contains(e.target)) closeMenu(); };
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize, true);
  window.addEventListener('contextmenu', onContextOther, true);
  _ctxCleanup = ()=> {
    document.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize, true);
    window.removeEventListener('contextmenu', onContextOther, true);
  };
}

function askConfirm({ title='Onay', message='Emin misiniz?', okText='Evet', cancelText='Vazgeç' }={}){
  return new Promise((resolve)=>{
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="hd">${title}</div>
        <div class="bd"><div style="line-height:1.4">${message}</div></div>
        <div class="ft">
          <button class="btn cancel">${cancelText}</button>
          <button class="btn primary ok">${okText}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const done = (v)=>{ ov.remove(); resolve(v); };
    ov.querySelector('.cancel').onclick = ()=> done(false);
    ov.querySelector('.ok').onclick     = ()=> done(true);
    ov.addEventListener('pointerdown', (e)=>{ if (e.target===ov) done(false); });
    ov.tabIndex = -1; ov.focus();
  });
}

function showAlert({ title='Uyarı', message='Bir sorun oluştu.', okText='Tamam' }={}){
  return new Promise((resolve)=>{
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `
      <div class="modal" role="alertdialog" aria-modal="true">
        <div class="hd">${title}</div>
        <div class="bd"><div style="line-height:1.4">${message}</div></div>
        <div class="ft">
          <button class="btn primary ok">${okText}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const done = ()=>{ ov.remove(); resolve(true); };
    ov.querySelector('.ok').onclick = done;
    ov.addEventListener('pointerdown', (e)=>{ if (e.target===ov) done(); });
    const btn = ov.querySelector('.ok');
    setTimeout(()=> btn.focus(), 0);
    ov.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key==='Escape') done(); });
  });
}

function pickVfsFile({ title='VFS Dosya Seç', startPath='/Documents', acceptExts=null }={}){
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
    function extOf(name){ const m = name.match(/\.[^.]+$/); return (m?m[0]:'').toLowerCase(); }
    const accept = (item)=> !acceptExts || (item.type==='dir') || acceptExts.includes((item.ext||extOf(item.name)||'').toLowerCase());

    async function render(){
      crumbs.textContent = cwd;
      listEl.innerHTML = '';
      if (cwd!=='/') {
        const up = document.createElement('div');
        up.className = 'item';
        up.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 10px;cursor:pointer;';
        up.innerHTML = '<div>⬆️</div><div class="name">..</div>';
        up.onclick = ()=>{ cwd = cwd.split('/').slice(0,-1).join('/') || '/'; sel=null; btnOk.disabled=true; render(); };
        listEl.appendChild(up);
      }
      const rows = await window.vfs.list(cwd).catch(()=>[]);
      const dirs = rows.filter(r=>r.type==='dir').sort((a,b)=> a.name.localeCompare(b.name,'tr'));
      const files = rows.filter(r=>r.type==='file').sort((a,b)=> a.name.localeCompare(b.name,'tr'));

      for (const d of dirs) {
        const el = document.createElement('div');
        el.className = 'item';
        el.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 10px;cursor:pointer;';
        el.innerHTML = '<div>📁</div><div class="name"></div>';
        el.querySelector('.name').textContent = d.name;
        el.onclick = ()=>{ cwd = full(cwd, d.name); sel=null; btnOk.disabled=true; render(); };
        listEl.appendChild(el);
      }
      for (const f of files) {
        if (!accept(f)) continue;
        const el = document.createElement('div');
        el.className = 'item';
        el.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 10px;cursor:pointer;';
        el.innerHTML = '<div>🖼️</div><div class="name"></div>';
        el.querySelector('.name').textContent = f.name;
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

window.ui = { ...(window.ui||{}), askConfirm, pickVfsFile, showAlert };

function askString({ title='Girdi', label='Ad', placeholder='', initial='', okText='Tamam', cancelText='İptal', validate }={}) {
  return new Promise((resolve)=>{
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="hd">${title}</div>
        <div class="bd">
          <label>${label}</label>
          <input type="text" class="inp" placeholder="${placeholder}" />
          <div class="err" style="display:none;color:#ff6b6b;font-size:12px;"></div>
        </div>
        <div class="ft">
          <button class="btn cancel">${cancelText}</button>
          <button class="btn primary ok">${okText}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const inp = ov.querySelector('.inp');
    const ok  = ov.querySelector('.ok');
    const cancel = ov.querySelector('.cancel');
    const err = ov.querySelector('.err');
    inp.value = initial || '';
    setTimeout(()=> inp.select(), 0);
    function close(v){ ov.remove(); resolve(v); }
    function doOk(){
      let v = inp.value.trim();
      if (validate) {
        const msg = validate(v);
        if (msg) { err.textContent = msg; err.style.display='block'; return; }
      }
      close(v || '');
    }
    ok.addEventListener('click', doOk);
    cancel.addEventListener('click', ()=> close(null));
    ov.addEventListener('pointerdown', (e)=>{ if (e.target===ov) close(null); });
    ov.addEventListener('keydown', (e)=>{ if (e.key==='Enter') { e.preventDefault(); doOk(); } if (e.key==='Escape') { e.preventDefault(); close(null); } });
    ov.tabIndex = -1; ov.focus();
  });
}

let _activeRename = null;
function endActiveRename(commit=false){
  if (_activeRename) {
    const { input, onCommit, onCancel } = _activeRename;
    _activeRename = null;
    if (commit) onCommit?.(); else onCancel?.();
    input?.remove();
  }
}
function beginInlineRenameList(listEl, itemEl, parentPath, oldName, refresh) {
  if (isRoot(parentPath)) return;
  const nameEl = itemEl.querySelector('.name');
  if (!nameEl) return;
  endActiveRename(false);
  const input = document.createElement('input');
  input.className = 'rename-edit';
  input.value = oldName;
  nameEl.style.display = 'none';
  nameEl.insertAdjacentElement('afterend', input);
  const dot = oldName.lastIndexOf('.');
  const baseLen = (dot>0) ? dot : oldName.length;
  setTimeout(()=>{ input.focus(); input.setSelectionRange(0, baseLen); },0);
  async function commit(){
    const nn = input.value.trim();
    if (!nn || /[\\/]/.test(nn) || /^[.]+$/.test(nn)) { cancel(); return; }
    if (nn !== oldName) {
      try { await window.vfs.rename(parentPath, oldName, nn); } catch(e){ window.ui.showAlert({ title: 'Hata', message: e.message }); }
    }
    nameEl.style.display = '';
    input.remove();
    await refresh?.(parentPath);
  }
  function cancel(){ nameEl.style.display = ''; input.remove(); }
  input.addEventListener('keydown', (e)=>{ if (e.key==='Enter') { e.preventDefault(); commit(); } else if (e.key==='Escape') { e.preventDefault(); cancel(); } });
  input.addEventListener('blur', ()=> commit());
  _activeRename = { input, onCommit: commit, onCancel: cancel };
}
function beginInlineRenameDesktop(iconEl, parentPath='/Desktop', oldName) {
  if (isRoot(parentPath)) return;
  endActiveRename(false);
  const label = iconEl.querySelector('.label');
  if (!label) return;
  const input = document.createElement('input');
  input.className = 'rename-edit desktop';
  input.value = oldName;
  label.style.display = 'none';
  label.insertAdjacentElement('afterend', input);
  const dot = oldName.lastIndexOf('.');
  const baseLen = (dot>0) ? dot : oldName.length;
  setTimeout(()=>{ input.focus(); input.setSelectionRange(0, baseLen); },0);
  async function commit(){
    const nn = input.value.trim();
    if (!nn || /[\\/]/.test(nn) || /^[.]+$/.test(nn)) { cancel(); return; }
    if (nn !== oldName) {
      try {
        await window.vfs.rename(parentPath, oldName, nn);
        const map = await loadDesktopLayout();
        if (map[oldName]) { map[nn] = map[oldName]; delete map[oldName]; await saveDesktopLayout(map); }
      } catch(e){ window.ui.showAlert({ title: 'Hata', message: e.message }); }
    }
    label.style.display = '';
    input.remove();
    await renderDesktop();
  }
  function cancel(){ label.style.display = ''; input.remove(); }
  input.addEventListener('keydown', (e)=>{ if (e.key==='Enter') { e.preventDefault(); commit(); } else if (e.key==='Escape') { e.preventDefault(); cancel(); } });
  input.addEventListener('blur', ()=> commit());
  _activeRename = { input, onCommit: commit, onCancel: cancel };
}

/* ===========================================================
   Explorer oluşturucu
   =========================================================== */
function createExplorer(path='/Desktop') {
  const hist = { stack: [path], idx: 0 };
  const { content, winEl } = openWindow('Explorer');
  const state = { showSidebar: true, viewMode: (window.runtimeSettings?.defaultExplorerView || 'medium'), selectedName: null, currentPath: path, lastSelIndex: null };

  content.innerHTML = `
    <div class="explorer view-medium">
      <div class="sidebar">
        <div class="nav">
          <div class="navitem" data-nav="/Desktop">Desktop</div>
          <div class="navitem" data-nav="/Documents">Documents</div>
          <div class="navitem" data-nav="/Recycle">Recycle</div>
          <div class="navitem" data-nav="/Apps">Apps</div>
        </div>
      </div>
      <div class="main">
        <div class="navbar">
          <button class="btn nav toggleside" title="Sol paneli gizle/göster (Ctrl+B)">☰</button>
          <button class="btn nav back"    title="Geri (Alt+Sol)">←</button>
          <button class="btn nav forward" title="İleri (Alt+Sağ)">→</button>
          <button class="btn nav up"      title="Üst Dizin (Alt+Yukarı)">↑</button>
          <input class="pathbox" value="${path}" spellcheck="false"/>
          <select class="viewmode" title="Görünüm">
            <option value="small">Küçük</option>
            <option value="medium" selected>Orta</option>
            <option value="large">Büyük</option>
            <option value="list">Liste</option>
            <option value="details">Ayrıntılar</option>
          </select>
        </div>
        <div class="listheader" style="display:none"></div>
        <div class="list"></div>
        <div class="statusbar"></div>
      </div>
    </div>`;
  content.addEventListener('mousedown', ()=> winEl.focus());

  const expl    = $('.explorer', content);
  const listEl  = $('.list', content);
  const headEl  = $('.listheader', content);
  const status  = $('.statusbar', content);
  const pathBox = $('.pathbox', content);
  const btnSide = $('.btn.nav.toggleside', content);
  const btnBack = $('.btn.nav.back', content);
  const btnFwd  = $('.btn.nav.forward', content);
  const btnUp   = $('.btn.nav.up', content);
  const viewSel = $('.viewmode', content);
  viewSel.value = state.viewMode;

  const setNavButtons = ()=>{ btnBack.disabled = (hist.idx <= 0); btnFwd.disabled  = (hist.idx >= hist.stack.length - 1); btnUp.disabled = isRoot(pathBox.value); };
  const setSidebar = ()=>{ expl.classList.toggle('sidebar-collapsed', !state.showSidebar); };
  const setViewMode = ()=>{ expl.classList.remove('view-small','view-medium','view-large','view-list','view-details'); expl.classList.add('view-' + state.viewMode); headEl.style.display = (state.viewMode==='details') ? '' : 'none'; };

  const replacePath = async (p)=>{ if (hist.stack[hist.idx] !== p) { hist.stack = hist.stack.slice(0, hist.idx+1); hist.stack.push(p); hist.idx++; } await refresh(p); };
  const goBack = async ()=>{ if (hist.idx>0){ hist.idx--; await refresh(hist.stack[hist.idx]); } };
  const goFwd  = async ()=>{ if (hist.idx<hist.stack.length-1){ hist.idx++; await refresh(hist.stack[hist.idx]); } };
  const goUp   = async ()=>{ const up = dn(pathBox.value); await replacePath(up); };
  const setStatus = (t)=> status.textContent = t;

  function getSelection(){ return $$('.item.sel', listEl).map(x=>x.dataset.name); }
  function setSingleSelection(el){ $$('.item',listEl).forEach(x=>x.classList.remove('sel')); el.classList.add('sel'); state.selectedName=el.dataset.name; state.lastSelIndex=+el.dataset.index; }
  function toggleSelection(el){ el.classList.toggle('sel'); state.selectedName = el.classList.contains('sel')? el.dataset.name : null; state.lastSelIndex=+el.dataset.index; }
  function rangeSelect(toIndex){ if (state.lastSelIndex==null) return; const [a,b]=[Math.min(state.lastSelIndex,toIndex), Math.max(state.lastSelIndex,toIndex)]; $$('.item',listEl).forEach((x,i)=>{ if(i>=a && i<=b) x.classList.add('sel'); else x.classList.remove('sel'); }); }

  async function refresh(p) {
    endActiveRename(true);
    state.currentPath = p;
    state.selectedName = null;
    pathBox.value = p;
    setNavButtons();

    const rows = await window.vfs.list(p);
    listEl.innerHTML = '';
    headEl.innerHTML = (state.viewMode==='details')
      ? `<div class="hdr">
           <div class="h-ico"></div>
           <div class="h-name">Ad</div>
           <div class="h-type">Tür</div>
           <div class="h-size">Boyut</div>
           <div class="h-items">Öğeler</div>
         </div>`
      : '';

    rows.forEach((it, idx)=>{
      const el = document.createElement('div');
      el.className='item';
      el.dataset.name = it.name;
      el.dataset.index = idx;
      el.innerHTML = `
        <div class="glyph">${glyph(it)}</div>
        <div class="name">${it.name}</div>
        <div class="meta">
          <span class="type">${it.type==='dir' ? 'Klasör' : (it.ext || 'Dosya')}</span>
          <span class="size"></span>
          <span class="items"></span>
        </div>`;

      el.addEventListener('click', async (e)=>{
        const all = $$('.item', listEl);
        const myIdx = all.indexOf(el);
        if (e.shiftKey) rangeSelect(myIdx);
        else if (e.ctrlKey || e.metaKey) toggleSelection(el);
        else setSingleSelection(el);

        const names = getSelection();
        if (names.length===1){
          if (it.type==='dir') {
            const cnt = (await window.vfs.list(jn(p, it.name)).catch(()=>[])).length;
            setStatus(`${it.name} — Klasör • ${cnt} öğe`);
          } else {
            const size = await fileSizeOf(jn(p, it.name));
            setStatus(`${it.name} — Dosya • ${humanSize(size)}`);
          }
        } else if (names.length>1) setStatus(`${names.length} öğe seçili`);
      });

      el.addEventListener('dblclick', ()=> activateItem(p, it, { fromExplorer:true, goto: replacePath }));

      el.addEventListener('contextmenu', (e)=>{
        e.preventDefault();
        if (!el.classList.contains('sel')) setSingleSelection(el);
        const selectedNames = getSelection();
        showMenu(
          ctxForItem(p, it, { refresh: (np)=>replacePath(np||p), el, listEl, selectedNames }),
          e.clientX, e.clientY
        );
      });

      if (state.viewMode==='details') {
        if (it.type==='dir') {
          window.vfs.list(jn(p, it.name)).then(xs=>{ $('.items', el).textContent = xs.length; }).catch(()=>{});
        } else {
          fileSizeOf(jn(p, it.name)).then(sz=>{ $('.size', el).textContent = humanSize(sz); });
        }
      }

      attachDragHandlers(el, it, p, refresh);
      listEl.appendChild(el);
    });

    setStatus(`${rows.length} öğe`);
    listEl.oncontextmenu = (e)=>{
      if (e.target.closest('.item')) return;
      e.preventDefault();
      showMenu(ctxForBackground(p, { refresh: (np)=>replacePath(np||p) }), e.clientX, e.clientY);
    };
  }

  content.addEventListener('click', (e)=>{
    const n = e.target.closest('.navitem'); if (!n) return;
    e.preventDefault();
    replacePath(n.getAttribute('data-nav'));
  });

  btnBack.addEventListener('click', goBack);
  btnFwd .addEventListener('click', goFwd);
  btnUp  .addEventListener('click', goUp);

  btnSide.addEventListener('click', ()=>{ state.showSidebar = !state.showSidebar; setSidebar(); });
  winEl.addEventListener('keydown', (e)=>{ if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='b'){ e.preventDefault(); state.showSidebar=!state.showSidebar; setSidebar(); } });

  viewSel.addEventListener('change', ()=>{ state.viewMode = viewSel.value; setViewMode(); refresh(state.currentPath); });

  winEl.addEventListener('keydown', async (e)=>{
    const t = e.target; const tag = (t?.tagName||'').toLowerCase();
    if (tag==='input' || tag==='textarea' || t?.isContentEditable) return;

    if (e.altKey) {
      if (e.key==='ArrowLeft')  { e.preventDefault(); return goBack(); }
      if (e.key==='ArrowRight') { e.preventDefault(); return goFwd(); }
      if (e.key==='ArrowUp')    { e.preventDefault(); return goUp(); }
      return;
    }

    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key==='F2') {
      const firstSel = $('.item.sel', listEl); if (!firstSel) return;
      e.preventDefault();
      const name = firstSel.dataset.name || firstSel.querySelector('.name')?.textContent || '';
      return beginInlineRenameList(listEl, firstSel, pathBox.value, name, refresh);
    }
    if (e.key==='Delete') {
      if (isRoot(pathBox.value)) return;
      const names = getSelection(); if (!names.length) return;
      e.preventDefault();
      for (const n of names) await window.vfs.delete(pathBox.value, n, { toRecycle:true }).catch(err=>window.ui.showAlert({title:'Hata', message:err.message}));
      return await refresh(pathBox.value);
    }
    if (ctrl && e.key.toLowerCase()==='c') {
      const names = getSelection(); if (!names.length) return;
      e.preventDefault(); setClipboard('copy', pathBox.value, names); return;
    }
    if (ctrl && e.key.toLowerCase()==='x') {
      if (isRoot(pathBox.value)) return;
      const names = getSelection(); if (!names.length) return;
      e.preventDefault(); setClipboard('cut', pathBox.value, names); return;
    }
    if (ctrl && e.key.toLowerCase()==='v') {
      e.preventDefault(); return await pasteTo(pathBox.value, refresh);
    }
  });

  pathBox.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ replacePath(pathBox.value); } });

  setSidebar();
  setViewMode();
  refresh(path);

  function attachDragHandlers(itemEl, it, parentPath, refreshFn){
    let dragging=false, sx=0, sy=0, ghost=null, dragNames=null, overTarget=null, overPath=null, overNav=null;

    const onDown=(e)=>{
      if (e.button!==0) return;
      sx=e.clientX; sy=e.clientY; dragging=false;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp, { once:true });
    };

    const onMove=async (e)=>{
      const dx=Math.abs(e.clientX-sx), dy=Math.abs(e.clientY-sy);
      if (!dragging && (dx>4 || dy>4)){
        dragging=true;
        const selected = $$('.item.sel', listEl).map(x=>x.dataset.name);
        dragNames = (selected.length && itemEl.classList.contains('sel')) ? selected : [it.name];
        ghost = document.createElement('div'); ghost.className='drag-ghost';
        ghost.textContent = dragNames.length>1 ? `${dragNames.length} öğe` : it.name;
        document.body.appendChild(ghost);
      }
      if (!dragging) return;
      ghost.style.left = (e.pageX+12)+'px'; ghost.style.top=(e.pageY+10)+'px';

      overTarget?.classList.remove('droptarget'); overTarget=null; overPath=null;
      overNav?.classList.remove('droptarget'); overNav=null;

      const el = document.elementFromPoint(e.clientX, e.clientY);

      const nav = el?.closest('.navitem');
      if (nav){
        overNav = nav; nav.classList.add('droptarget'); overPath = nav.getAttribute('data-nav'); return;
      }

      const row = el?.closest('.item');
      if (row){
        const name = row.dataset.name;
        const rows = await window.vfs.list(parentPath).catch(()=>[]);
        const tgt = rows.find(r=>r.name===name);
        if (tgt?.type==='dir'){ row.classList.add('droptarget'); overTarget=row; overPath=jn(parentPath,name); return; }
      }

      if (el?.closest('.list')) { overPath = parentPath; return; }

      const desk = document.getElementById('desktop');
      if (desk && desk.contains(el)) { overPath = '/Desktop'; return; }
    };

    const onUp= async (e)=>{
      document.removeEventListener('mousemove', onMove);
      overTarget?.classList.remove('droptarget'); overTarget=null;
      overNav?.classList.remove('droptarget'); overNav=null;
      if (!dragging){ return; }
      ghost?.remove(); ghost=null;

      const copyMode = e.ctrlKey;
      if (!overPath){ return; }

      try {
        if (copyMode){
          for (const nm of dragNames) await copyEntry(parentPath, nm, overPath);
        } else {
          for (const nm of dragNames) await moveEntry(parentPath, nm, overPath);
        }
        await refreshFn(parentPath);
        if (overPath!==parentPath) {
          await refreshFn(overPath).catch(()=>{});
          if (overPath==='/Desktop') await renderDesktop();
        }
      } catch (err){ window.ui.showAlert({title:'Hata', message: err?.message||'İşlem başarısız'}); }
    };

    itemEl.addEventListener('mousedown', onDown);
  }
}

/* ===========================================================
   Clipboard / Kopyala-Kes-Yapıştır
   =========================================================== */
const clip = { mode:null, items:[] };
function setClipboard(mode, parent, names){ if (!names?.length) return; clip.mode=mode; clip.items=names.map(n=>({parent, name:n})); }
function clearClipboard(){ clip.mode=null; clip.items=[]; }
function hasClipboard(){ return !!(clip.mode && clip.items.length); }
async function existsName(dir, name){ return (await window.vfs.list(dir).catch(()=>[])).some(x=>x.name===name); }
function splitName(name){ const i=name.lastIndexOf('.'); return (i>0? { base:name.slice(0,i), ext:name.slice(i) } : { base:name, ext:'' }); }
async function uniqueCopyName(dir, name){ const {base,ext}=splitName(name); let cand=`${base} - Kopya${ext}`, i=2; while (await existsName(dir,cand)) cand = `${base} - Kopya (${i++})${ext}`; return cand; }
async function copyEntry(srcParent, name, destDir){
  const srcPath = jn(srcParent, name);
  const t = await window.vfs.statType(srcPath);
  if (t==='file'){
    const data = await window.vfs.readFile(srcPath);
    const outName = (await existsName(destDir, name)) ? await uniqueCopyName(destDir, name) : name;
    await window.vfs.writeFile(jn(destDir, outName), data);
    return outName;
  } else if (t==='dir'){
    const outName = (await existsName(destDir, name)) ? await uniqueCopyName(destDir, name) : name;
    const destPath = jn(destDir, outName);
    await window.vfs.mkdir(destPath);
    const children = await window.vfs.list(srcPath).catch(()=>[]);
    for (const ch of children) await copyEntry(srcPath, ch.name, destPath);
    return outName;
  }
}
async function moveEntry(srcParent, name, destDir){
  if (srcParent===destDir) return name;
  try { await window.vfs.move(srcParent, name, destDir); return name; }
  catch { const nn=await copyEntry(srcParent, name, destDir); await window.vfs.delete(srcParent, name, { toRecycle:false }).catch(()=>{}); return nn; }
}
async function pasteTo(targetDir, refreshFn){
  if (!hasClipboard()) return;
  if (isRecycle(targetDir)) { window.ui.showAlert({title:'Uyarı', message:'Recycle içine yapıştırılamaz.'}); return; }
  try {
    if (clip.mode==='copy'){
      for (const it of clip.items) await copyEntry(it.parent, it.name, targetDir);
    } else if (clip.mode==='cut'){
      for (const it of clip.items){ if (it.parent===targetDir) continue; await moveEntry(it.parent, it.name, targetDir); }
      clearClipboard();
    }
    await refreshFn?.(targetDir);
    if (targetDir==='/Desktop') await renderDesktop();
  } catch(e){ window.ui.showAlert({title:'Hata', message: e?.message || 'Yapıştırılamadı'}); }
}

/* ===========================================================
   .lnk & App
   =========================================================== */
async function resolveLink(path) {
  const raw = await window.vfs.readFile(path);
  let data; try { data = JSON.parse(raw); } catch { throw new Error('Bozuk .lnk'); }
  if (data?.type !== 'link') throw new Error('Geçersiz .lnk');

  const t = data.target || {};
  if (t.kind === 'app') return { action:'launch-app', appId: t.appId, args: t.args || {} };

  let node = null;
  if (t.targetId) node = await window.vfs.lookupById(t.targetId);
  if (!node && t.targetPath) {
    const ex = await window.vfs.exists(t.targetPath);
    if (ex) node = { path: t.targetPath, type: await window.vfs.statType(t.targetPath) };
  }
  if (!node) throw new Error('Hedef bulunamadı');
  return node.type === 'dir'
    ? { action:'open-folder', path: node.path }
    : { action:'open-file',   path: node.path };
}
async function createShortcut(currentDir, targetItem, targetPathGuess) {
  const base = targetItem.name || 'Kısayol';
  let name = `${base} - Kısayol.lnk`, i=2;
  const exists = async (n)=> (await window.vfs.list(currentDir)).some(x=>x.name===n);
  while (await exists(name)) name = `${base} - Kısayol (${i++}).lnk`;
  const link = {
    type:'link', version:1, createdAt:Date.now()/1000, name,
    target: (targetItem.type==='dir' || targetItem.type==='file')
      ? { kind: targetItem.type, targetId: targetItem.id || null, targetPath: targetPathGuess || jn(currentDir, targetItem.name), appId:null, args:{} }
      : { kind:'app', appId: targetItem.appId, targetId:null, targetPath:null, args:{} },
    icon:{ source:'auto' }, run:{ startIn: currentDir, arguments:'' }
  };
  await window.vfs.writeFile(jn(currentDir, name), JSON.stringify(link,null,2));
}
async function launchFromAppJson(path) {
  const raw = await window.vfs.readFile(path).catch(()=>null);
  if (!raw) return false;
  try { const data = JSON.parse(raw); const id = data?.id; if (!id) return false; await launchApp(id, {}); return true; }
  catch { return false; }
}

/* ===========================================================
   Eylemler
   =========================================================== */
async function activateItem(parentPath, it, { fromExplorer=false, goto } = {}) {
  if (it.ext === '.lnk' && it.type==='file') {
    try {
      const act = await resolveLink(jn(parentPath, it.name));
      if (act.action==='launch-app') return launchApp(act.appId, act.args);
      if (act.action==='open-folder') { if (fromExplorer && goto) return goto(act.path); return createExplorer(act.path); }
      if (act.action==='open-file') return openWithDefaultApp(act.path);
    } catch (e) { window.ui.showAlert({title:'Hata', message: 'Kısayol açılamadı: '+e.message}); }
    return;
  }
  if (/\.app\.json$/i.test(it.name) && it.type==='file') {
    const full = jn(parentPath, it.name);
    const ok = await launchFromAppJson(full);
    if (!ok) window.ui.showAlert({title:'Hata', message:'Geçersiz uygulama kaydı.'});
    return;
  }
  if (it.type === 'dir') {
    const target = jn(parentPath, it.name);
    pushRecent(target);
    if (fromExplorer && goto) return goto(target);
    else return createExplorer(target);
  }
  const full = jn(parentPath, it.name);
  openWithDefaultApp(full);
}

function openWithDefaultApp(path) {
  const ext = (path.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  const mapped = CURRENT_SETTINGS?.assoc?.[ext];
  if (mapped) return launchApp(mapped, { path });

  if (/\.app\.json$/i.test(path)) { launchFromAppJson(path).then(ok=>{ if(!ok) window.ui.showAlert({title:'Hata', message:'Geçersiz uygulama kaydı.'}); }); return; }
  if (/\.(png|jpg|jpeg)$/i.test(path)) return launchApp('app.paint',   { path });
  if (/\.(txt|md)$/i.test(path))      return launchApp('app.notepad', { path });
  return launchApp('app.notepad', { path });
}

/* ===========================================================
   Sağ tık menüleri
   =========================================================== */
function ctxForBackground(path, { refresh } = {}) {
  const items = [
    { label:'Yeni Klasör', disabled: isRoot(path), action: async ()=>{
      try {
        const list = await window.vfs.list(path).catch(()=>[]);
        const exist = new Set(list.map(x=>x.name));
        const suggestedBase = 'Yeni Klasör';
        let sug = suggestedBase, c=2; while (exist.has(sug)) sug = `${suggestedBase} (${c++})`;
        const name = await askString({
          title: 'Yeni Klasör', label: 'Klasör adı', initial: sug,
          validate: (v)=>{ if (!v) return 'İsim boş olamaz.'; if (/^[.]+$/.test(v)) return 'Geçersiz isim.'; if (/[\\/]/.test(v)) return 'İsim "/" veya "\\" içeremez.'; return ''; }
        });
        if (!name) return;
        let finalName = name.trim();
        if (exist.has(finalName)) { let i=2; while (exist.has(`${finalName} (${i})`)) i++; finalName = `${finalName} (${i})`; }
        await window.vfs.mkdir(jn(path, finalName));
        await refresh?.(path);
        if (path==='/Desktop') await renderDesktop();
      } catch(e){ window.ui.showAlert({title:'Hata', message: e?.message || 'Klasör oluşturulamadı.'}); }
    }} ,
    null,
    { label:'Yapıştır (Ctrl+V)', disabled: !hasClipboard() || isRecycle(path), action: async ()=>{ await pasteTo(path, refresh); } },
    ...(isRecycle(path) ? [ null, { label:'Çöpü Boşalt', danger:true, action: async ()=>{
  const ok = await (window.ui?.askConfirm?.({
    title:'Çöpü Boşalt', message:'Çöp kutusundaki tüm öğeler kalıcı olarak silinecek. Devam edilsin mi?',
    okText:'Boşalt', cancelText:'Vazgeç'
  }) ?? Promise.resolve(true));
  if (ok) { await emptyRecycle(); await refresh?.(path); }
}}
 ] : []),
    null,
    { label:'Yenile', action: ()=> refresh?.(path) || renderDesktop() }
  ];
  return items;
}

function ctxForItem(parentPath, it, { refresh, el, listEl, selectedNames } = {}) {
  const atRoot = isRoot(parentPath);
  const isLnk = (it.ext === '.lnk' && it.type==='file');
  const full = jn(parentPath, it.name);
  const group = Array.isArray(selectedNames) ? selectedNames
              : (listEl ? $$('.item.sel', listEl).map(x=>x.dataset.name)
                : (parentPath==='/Desktop' ? $$('.icon.sel', $('#desktop')).map(x=> $('.label', x).textContent) : []));
  const namesForAction = () => (group.length && group.includes(it.name)) ? group : [it.name];

  const items = [
    { label: (isLnk ? 'Kısayolu Aç' : 'Aç'), action: async ()=> activateItem(parentPath, it, { fromExplorer:true, goto: refresh }) },
    ...(/\.app\.json$/i.test(it.name) ? [{
      label: 'Uygulamayı Başlat', action: async ()=> {
        const ok = await launchFromAppJson(full);
        if (!ok) window.ui.showAlert({title:'Hata', message:'Geçersiz uygulama kaydı.'});
      }
    }] : []),
    ...(isLnk ? [{
      label: 'Hedefi Aç', action: async ()=>{
        try {
          const act = await resolveLink(full);
          if (act.action==='open-folder') createExplorer(act.path);
          else if (act.action==='open-file') openWithDefaultApp(act.path);
          else if (act.action==='launch-app') launchApp(act.appId, act.args);
        } catch(e) { window.ui.showAlert({title:'Hata', message:'Hedef açılamadı: ' + e.message}); }
      }
    }] : []),
    null,
    { label:'Kopyala (Ctrl+C)', action: ()=>{ const names = namesForAction(); setClipboard('copy', parentPath, names); } },
    { label:'Kes (Ctrl+X)',    disabled: atRoot, action: ()=>{ const names = namesForAction(); setClipboard('cut', parentPath, names); } },
    ...(it.type==='dir' ? [{ label:'Bu klasöre Yapıştır (Ctrl+V)', disabled: !hasClipboard() || isRecycle(full), action: async ()=>{ await pasteTo(full, refresh); } }] : []),
    null,
    { label:'Kısayol Oluştur', disabled: atRoot, action: async ()=>{
      const names = namesForAction();
      const rows = await window.vfs.list(parentPath).catch(()=>[]);
      for (const nm of names) {
        const tgt = rows.find(r=>r.name===nm);
        if (tgt) { await createShortcut(parentPath, tgt, jn(parentPath, nm)); }
      }
      await refresh?.(parentPath);
      if (parentPath==='/Desktop') await renderDesktop();
    }},
    { label:'Yeniden Adlandır', disabled: atRoot, action: ()=>{
      if (parentPath==='/Desktop' && el) return beginInlineRenameDesktop(el, '/Desktop', it.name);
      if (listEl) {
        const itemEl = [...listEl.children].find(x => x.dataset.name === it.name);
        if (itemEl) beginInlineRenameList(listEl, itemEl, parentPath, it.name, refresh);
      }
    }},
    ...(isRecycle(parentPath) ? [
      { label:'Geri Yükle', action: async ()=>{ await restoreFromRecycle(it); await refresh?.(parentPath); } },
      { label:'Kalıcı Sil', danger:true, action: async ()=>{
  const ok = await window.ui.askConfirm({
    title:'Kalıcı Sil', message:`${it.name} kalıcı olarak silinsin mi?`,
    okText:'Sil', cancelText:'Vazgeç'
  });
  if (ok) { await permanentDeleteFromRecycle(it); await refresh?.(parentPath); }
}},
    ] : [
      { label:'Sil', danger:true, disabled: atRoot, action: async ()=>{
        const names = namesForAction();
        for (const n of names) await window.vfs.delete(parentPath, n, { toRecycle:true }).catch(e=>window.ui.showAlert({title:'Hata', message:e.message}));
        await refresh?.(parentPath);
        if (parentPath==='/Desktop') await renderDesktop();
      }}
    ]),
    null,
    { label:'Özellikler', action: ()=> window.ui.showAlert({title:'Özellikler', message:`${it.name}\nTür: ${it.type}${it.ext?`\nUzantı: ${it.ext}`:''}`}) }
  ];
  return items;
}

/* ===========================================================
   Recycle
   =========================================================== */
async function emptyRecycle(){
  const list = await window.vfs.list('/Recycle').catch(()=>[]);
  for (const it of list) { if (it.name === '.meta') continue; await window.vfs.delete('/Recycle', it.name, { toRecycle:false }); }
  const metas = await window.vfs.list('/Recycle/.meta').catch(()=>[]);
  for (const m of metas) await window.vfs.delete('/Recycle/.meta', m.name, { toRecycle:false });
}
async function restoreFromRecycle(it){
  const metaPath = `/Recycle/.meta/${it.id}.json`;
  const raw = await window.vfs.readFile(metaPath).catch(()=>null);
  if (!raw) { window.ui.showAlert({title:'Hata', message:'Meta bulunamadı.'}); return; }
  let meta; try { meta = JSON.parse(raw); } catch { window.ui.showAlert({title:'Hata', message:'Meta bozuk.'}); return; }
  const originalPath = meta.originalPath || `/Documents/${it.name}`;
  const destParent = dn(originalPath);
  const origName = meta.name || it.name;
  if (it.name !== origName) { await window.vfs.rename('/Recycle', it.name, origName).catch(()=>{}); }
  await window.vfs.move('/Recycle', origName, destParent).catch(e=>window.ui.showAlert({title:'Hata', message:e.message}));
  await window.vfs.delete('/Recycle/.meta', `${it.id}.json`, { toRecycle:false }).catch(()=>{});
}
async function permanentDeleteFromRecycle(it){
  await window.vfs.delete('/Recycle', it.name, { toRecycle:false });
  await window.vfs.delete('/Recycle/.meta', `${it.id}.json`, { toRecycle:false }).catch(()=>{});
}

/* ===========================================================
   App host
   =========================================================== */
let appManifests = [];
async function launchApp(appId, args={}) {
  if (!appManifests.length) appManifests = await window.apps.list();
  const m = appManifests.find(x=>x.id===appId);
  if (!m) return window.ui.showAlert({title:'Hata', message:'Uygulama bulunamadı: '+appId});

  const styleCandidates = (m.styleUrls && m.styleUrls.length ? m.styleUrls : m.styles || []);
  for (let href of styleCandidates) {
    const abs = new URL(href, location.href).href;
 const exists = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
   .some(l => l.href === abs);
    if (!exists) {
      const ln = document.createElement('link');
      ln.rel = 'stylesheet';
      ln.href = abs;
      document.head.appendChild(ln);
    }
  }

  const mod = await import(m.entryUrl);
  const { content } = openWindow(m.name || appId);
  if (typeof mod.mount === 'function') {
    // DÜZELTİLDİ: 'ui' objesini buradan uygulamaya aktarıyoruz.
    await mod.mount(content, { vfs: window.vfs, apps: window.apps, ui: window.ui, launchApp, args });
  } else {
    content.innerHTML = '<div style="padding:12px;">Uygulama modülü geçersiz (mount yok).</div>';
  }
}


/* ===========================================================
   Boot
   =========================================================== */
async function boot() {
  await loadSettingsIntoRenderer();
  await loadRuntimeSettings();
  await ensureStartUI();
  appManifests = await window.apps.list();
  await renderDesktop();

  window.addEventListener('open-folder', (e)=>{
    const p = e.detail?.path; if (!p) return; createExplorer(p);
  });
  window.addEventListener('open-file', async (e)=>{
    const p = e.detail?.path; if (!p) return;
    const t = await window.vfs.statType(p).catch(()=>null);
    if (t === 'dir') createExplorer(p);
    else openWithDefaultApp(p);
  });
}
function setStartAppearance(){
  const btn = document.getElementById('btn-start');
  if (!btn) return;
  const iconOnly = (window.runtimeSettings?.taskbarStartStyle === 'icon');
  btn.innerHTML = iconOnly ? '<span class="logo">⊞</span>' : '<span class="logo">⊞</span> Başlat';
  btn.title = iconOnly ? 'Başlat' : '';
}
async function writeLink(parent, name, targetPath){
  const t = await window.vfs.statType(targetPath).catch(()=>null);
  if (!t) return;
  const link = {
    type:'link', version:1, createdAt:Date.now()/1000, name,
    target:{ kind: t, targetId:null, targetPath, appId:null, args:{} },
    icon:{ source:'auto' }, run:{ startIn: parent, arguments:'' }
  };
  await window.vfs.writeFile(jn(parent, name), JSON.stringify(link,null,2));
}

async function syncDesktopItemsFromSettings(){
  const cfg = window.runtimeSettings?.desktopItems || {};
  const desk = '/Desktop';
  const wants = [
    { key:'documents', name:'Documents.lnk', target:'/Documents' },
    { key:'recycle',   name:'Recycle.lnk',   target:'/Recycle'   },
    { key:'apps',      name:'Apps.lnk',      target:'/Apps'      },
  ];
  const list = await window.vfs.list(desk).catch(()=>[]);
  const has = new Set(list.map(i=>i.name));

  for (const w of wants){
    const want = !!cfg[w.key];
    const exists = has.has(w.name);
    if (want && !exists)      await writeLink(desk, w.name, w.target).catch(()=>{});
    if (!want && exists)      await window.vfs.delete(desk, w.name, { toRecycle:false }).catch(()=>{});
  }
  await renderDesktop();
}

document.addEventListener('DOMContentLoaded', boot);