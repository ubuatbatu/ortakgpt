// Apps/DevStudio/main.js
// Dev Studio: HTML/JS/CSS/JSON destekli IDE + paketleyici (.vexe).
// Sıfır eval/new Function. Önizleme: iframe srcdoc + meta-CSP.
// Build: /dist/index.html + Program Files altına .vexe manifesti.
// Ekstralar: hiyerarşik dosya ağacı, sağ tık menüsü, sürükle-bırak ile taşıma, yeniden adlandırma.

export async function mount(root, ctx){
  const { vfs } = ctx;

  // ---------- UI köprüleri ----------
  const UI = window.ui || {};
  const askString  = UI.askString  || localAskString;
  const askConfirm = UI.askConfirm || localAskConfirm;
  const notify     = UI.notify     || ((m)=>log(m));
  const showError  = UI.showError  || ((m)=>log("HATA: " + m));

  // ---------- sabitler ----------
  const BASE_DIR = "/System/Program Files";
  const SRC_DIR  = "src";
  const DIST_DIR = "dist";

  // ---------- helpers ----------
  function h(tag, attrs={}, ...children){
    const el = document.createElement(tag);
    const at = attrs || {};
    for (const [k,v] of Object.entries(at)){
      if (k === "class") el.className = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v);
    }
    for (const ch of children){
      if (ch == null) continue;
      if (typeof ch === "string") el.appendChild(document.createTextNode(ch));
      else el.appendChild(ch);
    }
    return el;
  }
  const join = (...parts)=> {
    const path = parts.join("/").replace(/\/+/g,'/');
    const seg = [];
    for (const p of path.split('/')){
      if (p==='' || p==='.') continue;
      if (p==='..') seg.pop();
      else seg.push(p);
    }
    return '/' + seg.join('/');
  };
  const dirname  = (p)=> p.replace(/\/[^/]*$/, '') || '/';
  const basename = (p)=> p.split('/').pop() || '';
  const extname  = (p)=> (p.match(/\.([a-z0-9]+)$/i)||['',''])[1].toLowerCase();
  const slugify  = (s)=> String(s||"").toLowerCase().replace(/[^a-z0-9\-_.]+/gi,"-").replace(/^-+|-+$/g,"") || "proj";
  const escapeHtml = (s)=> String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const escScript  = (s)=> String(s).replace(/<\/script>/gi, '<\\/script>');

  async function ensureBase(){ try{ await vfs.mkdir("/System"); }catch{} try{ await vfs.mkdir(BASE_DIR); }catch{} }
  const read   = async p => { try{ return await vfs.readFile(p); }catch{ return ""; } };
  const write  = async (p,d)=> vfs.writeFile(p,d);
  const exists = async p => {
    try{ const dir = dirname(p); const name = basename(p); const items = await vfs.list(dir); return items.some(it=>it.name===name); }catch{ return false; }
  };
  const existsDir = async (p) => {
    try{
      const dir = dirname(p);
      const name = basename(p);
      const items = await vfs.list(dir);
      return items.some(it => it.type === "dir" && it.name === name);
    }catch{ return false; }
  };

  // ---------- inline modal fallbacks ----------
  function localAskString({ title='Girdi', label='Ad', placeholder='', initial='', okText='Tamam', cancelText='İptal', validate }={}){
    return new Promise((resolve)=>{
      const ov = document.createElement('div');
      ov.className = 'modal-overlay';
      ov.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <div class="hd">${escapeHtml(title)}</div>
          <div class="bd">
            <label>${escapeHtml(label)}</label>
            <input type="text" class="inp" placeholder="${escapeHtml(placeholder)}" />
            <div class="err" style="display:none;"></div>
          </div>
          <div class="ft">
            <button class="btn cancel">${escapeHtml(cancelText)}</button>
            <button class="btn primary ok">${escapeHtml(okText)}</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      const inp = ov.querySelector('.inp'), ok = ov.querySelector('.ok'), cancel = ov.querySelector('.cancel'), err = ov.querySelector('.err');
      inp.value = initial || '';
      setTimeout(()=> inp.select(), 0);
      function close(v){ ov.remove(); resolve(v); }
      function doOk(){
        const v = inp.value.trim();
        if (validate){ const msg = validate(v); if (msg){ err.textContent = msg; err.style.display='block'; return; } }
        close(v || '');
      }
      ok.onclick = doOk; cancel.onclick = ()=> close(null);
      ov.addEventListener('pointerdown', e=>{ if (e.target===ov) close(null); });
      ov.addEventListener('keydown', e=>{ if (e.key==='Enter') doOk(); if (e.key==='Escape'){ e.preventDefault(); close(null); } });
      ov.tabIndex = -1; ov.focus();
    });
  }
  function localAskConfirm({ title='Onay', message='Emin misiniz?', okText='Evet', cancelText='Vazgeç' }={}){
    return new Promise((resolve)=>{
      const ov = document.createElement('div');
      ov.className = 'modal-overlay';
      ov.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <div class="hd">${escapeHtml(title)}</div>
          <div class="bd"><div style="line-height:1.4; white-space:pre-wrap">${escapeHtml(message)}</div></div>
          <div class="ft">
            <button class="btn cancel">${escapeHtml(cancelText)}</button>
            <button class="btn primary ok">${escapeHtml(okText)}</button>
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
  async function askTriConfirm({ title='Uyarı', message='Kaydedilmemiş değişiklikler var.', yesText='Evet, Kaydet', noText='Kaydetmeden Çık', cancelText='İptal' }={}){
    return new Promise((resolve)=>{
      const ov = document.createElement('div'); ov.className='modal-overlay';
      ov.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <div class="hd">${escapeHtml(title)}</div>
          <div class="bd"><div style="line-height:1.4; white-space:pre-wrap">${escapeHtml(message)}</div></div>
          <div class="ft" style="display:flex; gap:8px; justify-content:flex-end">
            <button class="btn cancel">${escapeHtml(cancelText)}</button>
            <button class="btn">${escapeHtml(noText)}</button>
            <button class="btn primary">${escapeHtml(yesText)}</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      const [btnCancel, btnNo, btnYes] = ov.querySelectorAll('.ft .btn');
      const done = (v)=>{ ov.remove(); resolve(v); };
      btnCancel.onclick = ()=> done('cancel');
      btnNo.onclick     = ()=> done('no');
      btnYes.onclick    = ()=> done('yes');
      ov.addEventListener('pointerdown', (e)=>{ if (e.target===ov) done('cancel'); });
      ov.tabIndex = -1; ov.focus();
    });
  }

  // ---------- UI skeleton ----------
  root.classList.add("devstudio");
  root.innerHTML = "";
  const layout = h("div", {class:"ds-layout"},
    h("div", {class:"ds-sidebar"},
      h("div", {class:"ds-head"},
        h("div", {class:"ds-title"}, "Dev Studio"),
        h("div", {class:"ds-actions-inline"},
          h("button", {class:"ds-btn primary", id:"btn-new"}, "Yeni Proje"),
          h("button", {class:"ds-btn", id:"btn-build"}, "Build"),
          h("button", {class:"ds-btn", id:"btn-install"}, "Install"),
          h("button", {class:"ds-btn", id:"btn-open-dist"}, "Dist Aç")
        )
      ),
      h("div", {class:"ds-list-wrap"},
        h("div", {class:"ds-list", id:"proj-list"}, "Yükleniyor...")
      )
    ),
    h("div", {class:"ds-main"},
      h("div", {class:"ds-toolbar"},
        h("div", {class:"ds-path", id:"cur-path"},"—"),
        h("div", {class:"ds-actions"},
          h("span", {class:"badge tag-warn", id:"badge-mode"}, "Preview sandbox"),
          h("button", {class:"ds-btn", id:"btn-save"}, "Kaydet"),
          h("button", {class:"ds-btn", id:"btn-run"}, "Önizleme"),
          h("button", {class:"ds-btn", id:"btn-rename"}, "Yeniden Adlandır"),
          h("button", {class:"ds-btn", id:"btn-move"}, "Taşı"),
          h("button", {class:"ds-btn danger", id:"btn-del"}, "Sil")
        )
      ),
      h("div", {class:"ds-editor-wrap"},
        h("div", {class:"ds-filetree"},
          h("div", {class:"ds-tree-head"},
            h("div", null, "Dosyalar"),
            h("div", null,
              h("button", {class:"ds-btn", id:"btn-add-file"}, "+ Dosya"),
              h("button", {class:"ds-btn", id:"btn-add-folder"}, "+ Klasör")
            )
          ),
          h("div", {class:"ds-tree", id:"file-tree"})
        ),
        h("textarea", {class:"ds-editor", id:"editor", spellcheck:"false"})
      ),
      h("div", {class:"ds-runner"},
        h("div", {class:"ds-runhead"}, "Çalışan Uygulama"),
        h("div", {class:"ds-runhost", id:"runhost"}),
        h("pre", {class:"ds-console", id:"console"})
      )
    )
  );
  root.appendChild(layout);

// ---------- syntax editor entegrasyonu ----------
let editorAPI = null;
let editorEl  = null;

async function bootSyntax(){
  if (editorAPI) return;
  if (!editorEl) editorEl = root.querySelector('#editor');
  if (!editorEl) return;

  // syntax.js global window.Syntax sağlar
  await import('./syntax.js');
  const Syntax = window.Syntax;
  if (!Syntax) { console.warn('syntax.js yüklenemedi veya window.Syntax yok'); return; }


window.addEventListener('keydown', (e)=>{
  // Ctrl+= / Ctrl++ : büyüt
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); applyZoom(zoomPx+1); }
  // Ctrl+- : küçült
  if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); applyZoom(zoomPx-1); }
  // Ctrl+Shift+L : tema değiştir (dark <-> light)
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase()==='l'){ e.preventDefault(); wrap.classList.toggle('light'); }
});

  ensureSyntaxTheme(); // token renkleri

  // textarea + overlay pre
  const wrap = document.createElement('div');
  // --- wrap oluşturulduktan sonra ekle ---
let zoomPx = parseFloat(getComputedStyle(wrap).fontSize) || 13;
function applyZoom(px){
  zoomPx = Math.max(10, Math.min(24, px));
  wrap.style.fontSize = zoomPx + 'px';
  editorAPI?.refresh?.();
  updateGutter();
  updateCurrentLine();
}

window.addEventListener('keydown', (e)=>{
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); applyZoom(zoomPx+1); }
  if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); applyZoom(zoomPx-1); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase()==='l'){ e.preventDefault(); wrap.classList.toggle('light'); }
});

  wrap.className = 'ds-editor-stack';
  wrap.style.position = 'relative';
  wrap.style.height = '100%';

  const pre = document.createElement('pre');
  pre.className = 'code';
  pre.setAttribute('aria-hidden','true');
// wrap: flex item gibi alanı kaplasın
Object.assign(wrap.style, {
  position: 'relative',
  width: '100%',
  height: '100%',
  flex: '1 1 auto',
  minHeight: '0',
  minWidth: '0'
});

// pre: tam alan + kutu boyutlaması
Object.assign(pre.style, {
  position: 'absolute',
  inset: '0',
  margin: '0',
  overflow: 'auto',
  pointerEvents: 'none',
  whiteSpace: 'pre',
  width: '100%',
  height: '100%',
  boxSizing: 'border-box'
});

// textarea: tam alan + kutu boyutlaması
Object.assign(editorEl.style, {
  position: 'absolute',
  inset: '0',
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  margin: '0',
  overflow: 'auto',
  resize: 'none',         // kullanıcı sürükleyip boyut bozmasın
  background: 'transparent',
  zIndex: '1',
  color: 'transparent',
  caretColor: getComputedStyle(editorEl).color || '#fff',
  whiteSpace: 'pre',
  tabSize: getComputedStyle(editorEl).tabSize || '2'
});

// (İsteğe bağlı) ebeveyn kap biraz katıysa:
const host = wrap.parentElement;
if (host) {
  host.style.minHeight = '0';
  host.style.minWidth  = '0';
}

  const parent = editorEl.parentNode;
  parent.replaceChild(wrap, editorEl);
  wrap.appendChild(pre);
  wrap.appendChild(editorEl);

  // textarea metriklerini birebir kopyala → kayma olmasın
  const cs = getComputedStyle(editorEl);
  const mirror = [
    'fontFamily','fontSize','fontWeight','fontStyle',
    'lineHeight','letterSpacing','textIndent','textRendering',
    'wordSpacing','tabSize','textTransform'
  ];
  for (const k of mirror) pre.style[k] = cs[k];
  pre.style.paddingTop = cs.paddingTop;
  pre.style.paddingRight = cs.paddingRight;
  pre.style.paddingBottom = cs.paddingBottom;
  pre.style.paddingLeft = cs.paddingLeft;
pre.style.zIndex = '0';      

  // textarea görünümü
  editorEl.style.background = 'transparent';
  editorEl.style.color = 'transparent';        // metin gizli → renklendirilmiş pre görünecek
  editorEl.style.whiteSpace = 'pre';
  editorEl.style.tabSize = cs.tabSize || '2';
  // --- katmanlar: decor (aktif satır), gutter (satır numaraları) ---
const decor = document.createElement('div');
decor.className = 'decor';
const curLine = document.createElement('div');
curLine.className = 'cur-line';
decor.appendChild(curLine);

const gutter = document.createElement('div');
gutter.className = 'gutter';
const gutterInner = document.createElement('div');
gutter.appendChild(gutterInner);

// katman sırası: decor(0) < pre(1) < textarea(2) < gutter(3)
decor.style.zIndex = '0';
pre.style.zIndex   = '1';
editorEl.style.zIndex = '2';
gutter.style.zIndex = '3';

wrap.appendChild(decor);
wrap.appendChild(gutter);

// padding solunu gutter genişliği kadar arttır
const gutterW = 48;
const padL0 = parseFloat(getComputedStyle(editorEl).paddingLeft) || 12;
pre.style.paddingLeft    = (padL0 + gutterW) + 'px';
editorEl.style.paddingLeft = (padL0 + gutterW) + 'px';

// tema sınıfı: (dark varsayılan)  wrap.classList.add('light') // istersen aç


  // scroll senkron
  // mevcut scroll senkronuna ek olarak:
editorEl.addEventListener('scroll', ()=>{ updateGutter(); updateCurrentLine(); });

// caret hareketlerini yakalayalım
for (const ev of ['input','keyup','click']) {
  editorEl.addEventListener(ev, ()=>{ updateGutter(); updateCurrentLine(); });
}

// ilk render sonrası da çalıştır
requestAnimationFrame(()=>{ updateGutter(); updateCurrentLine(); });
  const syncScroll = ()=>{
    pre.scrollTop  = editorEl.scrollTop;
    pre.scrollLeft = editorEl.scrollLeft;
  };
  editorEl.addEventListener('scroll', syncScroll);

  let lang = 'js';
  let pendingTick = 0;
  function refreshHighlight(){
    const tick = ++pendingTick;
    requestAnimationFrame(()=>{
      if (tick !== pendingTick) return;
      pre.setAttribute('data-lang', lang);
      pre.innerHTML = Syntax.highlightToHTML(editorEl.value, lang);
      syncScroll();
          updateGutter();
    updateCurrentLine();
    });
  }

  function setLanguageByPath(path){ lang = Syntax.detectLang(path || ''); refreshHighlight(); }
  function setLanguage(l){ if (l) lang = l; refreshHighlight(); }
  function setValue(code){
    editorEl.value = code || '';
    refreshHighlight();
    editorEl.scrollTop = 0; editorEl.scrollLeft = 0; syncScroll();
  }
  function getValue(){ return editorEl.value; }

  editorEl.addEventListener('input', ()=>{ refreshHighlight(); setDirty(true); });
  editorEl.addEventListener('keydown', (e)=>{
    if (e.key === 'Tab'){
      e.preventDefault();
      const s = editorEl.selectionStart, epos = editorEl.selectionEnd;
      editorEl.setRangeText('  ', s, epos, 'end');
      refreshHighlight();
      setDirty(true);
    }
  });

  editorAPI = { setLanguageByPath, setLanguage, setValue, getValue, refresh: refreshHighlight };
  function lineHeightPx(){
  let lh = parseFloat(getComputedStyle(editorEl).lineHeight);
  if (!Number.isFinite(lh)) lh = Math.max(18, Math.round((parseFloat(getComputedStyle(editorEl).fontSize)||13) * 1.5));
  return lh;
}
function paddingTopPx(){
  // pre ve textarea aynı padding'i kullanıyor; birinden al
  return parseFloat(pre.style.paddingTop || getComputedStyle(editorEl).paddingTop) || 0;
}
function updateCurrentLine(){
  const lh = lineHeightPx();
  const padTop = paddingTopPx();
  const pos = editorEl.selectionStart || 0;
  let line = 0;
  const v = editorEl.value;
  for (let i=0; i<pos; i++) if (v.charCodeAt(i) === 10) line++;
  const y = padTop + line * lh - editorEl.scrollTop;
  curLine.style.top = Math.floor(y) + 'px';
  curLine.style.height = Math.ceil(lh) + 'px';
}
function updateGutter(){
  const lh = lineHeightPx();
  const padTop = paddingTopPx();
  const total = (editorEl.value.match(/\n/g)?.length || 0) + 1;
  const first = Math.max(0, Math.floor(editorEl.scrollTop / lh));
  const vis = Math.ceil(editorEl.clientHeight / lh) + 1;
  const start = first, end = Math.min(total, first + vis);

  gutterInner.innerHTML = '';
  for (let i = start; i < end; i++){
    const d = document.createElement('div');
    d.className = 'ln';
    d.textContent = String(i+1);
    d.style.top = (padTop + (i * lh) - editorEl.scrollTop) + 'px';
    gutterInner.appendChild(d);
  }
}

}

function ensureSyntaxTheme(){
  if (document.getElementById('ds-syntax-theme')) return;
  const style = document.createElement('style');
  style.id = 'ds-syntax-theme';
  style.textContent = `
  /* ---- Tema değişkenleri ---- */
  .ds-editor-stack{
    --bg:#0d1117;        /* arka plan */
    --fg:#c9d1d9;        /* metin */
    --muted:#8b949e;     /* yorumlar */
    --cursor:#58a6ff;    /* caret */
    --sel:rgba(56,139,253,.25); /* seçim */
    --curline:rgba(110,118,129,.12); /* aktif satır */
    --guide:rgba(110,118,129,.15);   /* indent çizgileri */
    --gutter-bg:transparent;
    --gutter-fg:#6e7681;

    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 13px;
    line-height: 1.55;
    background: var(--bg);
  }
  .ds-editor-stack.light{
    --bg:#ffffff;
    --fg:#24292f;
    --muted:#57606a;
    --cursor:#0969da;
    --sel:rgba(9,105,218,.20);
    --curline:rgba(175,184,193,.25);
    --guide:rgba(175,184,193,.35);
    --gutter-bg:transparent;
    --gutter-fg:#8c959f;
  }

  /* textarea: caret görünür, metin şeffaf */
  .ds-editor-stack textarea.ds-editor{
    color: transparent;
    caret-color: var(--cursor);
  }
  .ds-editor-stack textarea.ds-editor::selection{ background: var(--sel); }

  /* overlay code */
  .ds-editor-stack .code{
    color: var(--fg);
    background: transparent;
    font-variant-ligatures: none;

    /* basit indent guide */
    background-image: repeating-linear-gradient(
      to right,
      transparent 0,
      transparent calc(2ch - 1px),
      var(--guide) calc(2ch - 1px),
      var(--guide) 2ch
    );
    background-attachment: local; /* içerikle birlikte scroll */
  }

  /* gutter / satır numaraları */
  .ds-editor-stack .gutter{
    position:absolute; left:0; top:0; bottom:0;
    width:48px; overflow:hidden;
    user-select:none; pointer-events:none;
    background: var(--gutter-bg); color: var(--gutter-fg);
    text-align:right;
  }
  .ds-editor-stack .gutter .ln{ position:absolute; right:8px; opacity:.85; }

  /* dekor katmanı (aktif satır vb.) */
  .ds-editor-stack .decor{ position:absolute; inset:0; pointer-events:none; }
  .ds-editor-stack .cur-line{ position:absolute; left:0; right:0; height:0; background:var(--curline); }

  /* token renkleri */
  .tok-comment{ color:var(--muted); font-style:italic; }
  .tok-string{ color:#a5d6ff; }
  .tok-number{ color:#b5cea8; }
  .tok-keyword{ color:#ff7b72; }
  .tok-operator{ color:#79c0ff; }
  .tok-punct{ color:var(--fg); }
  .tok-tag{ color:#7ee787; }
  .tok-attr,.tok-prop{ color:#e3b341; }
  .tok-func{ color:#d2a8ff; }
  .tok-class{ color:#ffa657; }
  .tok-bool,.tok-null{ color:#ffab70; }
  `;
  document.head.appendChild(style);
}



  // ---------- context menu container ----------
  const ctxMenu = h("div", {class:"ctxmenu", style:"display:none"});
  document.body.appendChild(ctxMenu);
  function hideCtx(ev){
    if (!ctxMenu) return;
    if (ev && (ev.target === ctxMenu || ctxMenu.contains(ev.target))) return;
    ctxMenu.style.display = "none";
  }
  window.addEventListener("pointerdown", hideCtx);
  ctxMenu.addEventListener("pointerdown", (e)=>{ e.stopPropagation(); });
  ctxMenu.addEventListener("contextmenu", (e)=>{ e.preventDefault(); e.stopPropagation(); });
  window.addEventListener("scroll", hideCtx);

  // ---------- state ----------
  const treeOpen = new Map(); // path -> bool (klasör açık/kapalı)
  let current = {
    name:"", path:"", mainPath:"", appJsonPath:"",
    files:[], dirs:[], activeFile:"", dirty:false
  };

  // ---------- path helper (göreli gösterim) ----------
  const projectRoot = () => current?.name ? join(BASE_DIR, current.name) : "";
  const relPath = (p) => {
    if (!p) return "";
    const rootPath = projectRoot();
    let r = p.startsWith(rootPath) ? p.slice(rootPath.length).replace(/^\/+/,'') : p;
    r = r.replace(/^src\//,''); // görünümde src/ gizle
    return r;
  };
  function setPathBar(){
    const el = root.querySelector("#cur-path");
    if (!current?.name) { el.textContent = "—"; return; }
    const r = relPath(current.activeFile);
    el.textContent = r ? `${current.name}/${r}` : current.name;
  }

  // ---------- log ----------
  function log(msg){
    const c = root.querySelector("#console");
    c.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
    c.scrollTop = c.scrollHeight;
  }

  // ---------- projects ----------
  async function listProjects(){
    try{
      const items = await vfs.list(BASE_DIR);
      return items.filter(x=>x.type==="dir").map(x=>x.name);
    }catch{ return []; }
  }
async function guardedOpenProject(name){
  if (current.dirty){
    const ans = await askTriConfirm({
      title:"Kaydedilmemiş Değişiklikler",
      message:"Geçerli dosyada kaydedilmemiş değişiklikler var.\nProjeyi değiştirmek istiyor musunuz?"
    });
    if (ans === 'cancel') return;
    if (ans === 'yes') await saveActive();
    setDirty(false);
  }
  await openProject(name);
}

  async function refreshList(selectName){
    const list = await listProjects();
    const box = root.querySelector("#proj-list"); box.innerHTML = "";
    if (!list.length){
      box.appendChild(h("div",{class:"ds-empty"},"Hiç proje yok. 'Yeni Proje' ile başlayın."));
    } else {
      for (const name of list){
        const row = h("div", {class:"ds-item" + (name===selectName ? " sel":""), onclick: ()=> guardedOpenProject(name)},
          h("span", {class:"ds-item-name"}, name)
        );
        box.appendChild(row);
      }
    }
  }



  // ---------- tree (hierarchical + DnD) ----------
  async function listAll(dir){
    try{
      const items = await vfs.list(dir);
      const files = [], dirs = [];
      for (const it of items){
        if (it.type === "file") files.push(join(dir, it.name));
        else if (it.type === "dir") dirs.push(join(dir, it.name));
      }
      for (const d of [...dirs]){
        const sub = await listAll(d);
        dirs.push(...sub.dirs);
        files.push(...sub.files);
      }
      return { dirs, files };
    }catch{
      return { dirs:[], files:[] };
    }
  }

  function buildTreeModel(rootDir, files, dirs){
    const tree = {
      name: basename(rootDir) || (current?.name || 'src'),
      path: rootDir,
      type: 'dir',
      open: (treeOpen.get(rootDir) ?? true),
      children: []
    };

    // klasörler
    for (const dp of dirs){
      const rel = dp.replace(rootDir + '/', '');
      if (!rel || rel === dp) continue;
      const parts = rel.split('/');
      let cur = tree, curPath = rootDir;
      for (let i = 0; i < parts.length; i++){
        const part = parts[i];
        curPath = join(curPath, part);
        let dirNode = cur.children.find(n => n.type === 'dir' && n.name === part);
        if (!dirNode){
          dirNode = { name: part, path: curPath, type:'dir', open:(treeOpen.get(curPath) ?? false), children:[] };
          cur.children.push(dirNode);
        }
        cur = dirNode;
      }
    }
    // dosyalar
    for (const fp of files){
      const rel = fp.replace(rootDir + '/', '');
      const parts = rel.split('/');
      let cur = tree, curPath = rootDir;
      for (let i=0;i<parts.length;i++){
        const part = parts[i];
        curPath = join(curPath, part);
        const isLast = (i === parts.length-1);
        if (isLast){
          if (!cur.children.some(n=>n.type==='file' && n.name===part)){
            cur.children.push({ name: part, path: curPath, type:'file' });
          }
        }else{
          let dirNode = cur.children.find(n=>n.type==='dir' && n.name===part);
          if (!dirNode){
            dirNode = { name: part, path: curPath, type:'dir', open:(treeOpen.get(curPath) ?? false), children:[] };
            cur.children.push(dirNode);
          }
          cur = dirNode;
        }
      }
    }
    // sıralama
    (function sortRec(n){
      if (!n.children) return;
      n.children.sort((a,b)=> (a.type===b.type ? a.name.localeCompare(b.name) : (a.type==='dir'?-1:1)));
      for (const ch of n.children) sortRec(ch);
    })(tree);

    return tree;
  }

  function displayNameWithStar(node){
    if (node.type === 'file' && node.path === current.activeFile && current.dirty) return node.name + ' *';
    return node.name;
  }
// renderTree tanımının üstüne yerleştir
// renderTree tanımının üstüne yerleştir
let _renderingTree = false;

async function renderTree() {
  if (_renderingTree) return;
  _renderingTree = true;
  try {
    const treeBox = root.querySelector("#file-tree");
    if (!current.path) { treeBox.innerHTML = ""; return; }

    treeBox.innerHTML = "";

    const srcRoot = join(current.path, SRC_DIR);
    const model = buildTreeModel(srcRoot, current.files, current.dirs);

    // 1) Fragment: DOM’u hafızada kur, sonda tek seferde ekle
    const frag = document.createDocumentFragment();

    // 2) Batch render: her N satırda bir frame’e nefes aldır
    const BATCH = 300;
    let painted = 0;

    const mk = async (node, depth = 0) => {
      const pad = 10 + depth * 14;

      if (node.type === 'dir') {
        const row = h(
          "div",
          { class: "row dir", style: `padding-left:${pad}px`, draggable: "true" },
          h("span", { class: "ico" }, node.open ? "📂" : "📁"),
          h("span", { class: "name" }, displayNameWithStar(node)),
          h("span", { class: "tag" }, "")
        );
        row.addEventListener("click", () => {
          const next = !node.open;
          treeOpen.set(node.path, next);
          node.open = next;
          requestAnimationFrame(renderTree);
        });
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showNodeMenu(e.clientX, e.clientY, node);
        });
        addDragHandlers(row, node);
        frag.appendChild(row);
        painted++;

        if (node.open) {
          for (const ch of node.children) {
            await mk(ch, depth + 1);
          }
        }
      } else {
        // file
        const sel = node.path === current.activeFile ? " sel" : "";
        const row = h(
          "div",
          { class: "row file" + sel, style: `padding-left:${pad}px`, draggable: "true" },
          h("span", { class: "ico" }, "📄"),
          h("span", { class: "name" }, displayNameWithStar(node))
        );
        row.addEventListener("click", () => openFile(node.path));
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showNodeMenu(e.clientX, e.clientY, node);
        });
        addDragHandlers(row, node);
        frag.appendChild(row);
        painted++;
      }

      // her BATCH elemanda bir frame ver → UI nefes alsın
      if (painted % BATCH === 0) {
        await new Promise(requestAnimationFrame);
      }
    };

    await mk(model, 0);

    // Tek seferde DOM’a ekle
    treeBox.appendChild(frag);
  } finally {
    _renderingTree = false;
  }
}



  function addDragHandlers(row, node){
    row.addEventListener("dragstart", (e)=>{
      e.dataTransfer.setData("text/path", node.path);
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragover", (e)=>{
      const isDir = node.type === 'dir';
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      row.classList.add(isDir ? "drag-into" : "drag-over");
    });
    row.addEventListener("dragleave", ()=>{
      row.classList.remove("drag-over","drag-into");
    });
    row.addEventListener("drop", async (e)=>{
      e.preventDefault();
      row.classList.remove("drag-over","drag-into");
      const srcPath = e.dataTransfer.getData("text/path");
      if (!srcPath || srcPath === node.path) return;
      const destIsDir = node.type === 'dir';
      const targetDir = destIsDir ? node.path : dirname(node.path);
      const newPath = join(targetDir, basename(srcPath));
      try{
        await movePath(srcPath, newPath);
        row.classList.add("drag-into");
        setTimeout(()=> row.classList.remove("drag-into"), 200);
        await reloadFiles();
        notify("Taşındı: " + basename(srcPath) + " → " + targetDir);
      }catch(err){
        showError("Taşıma hatası: " + (err?.message||err));
      }
    });
  }

  // ---------- node ops ----------
  async function renameNode(path){
    const nameOld = basename(path);
    const dir = dirname(path);
    const isFile = await isFilePath(path);
    const title = isFile ? "Dosyayı Yeniden Adlandır" : "Klasörü Yeniden Adlandır";
    const next = await askString({
      title, label:"Yeni ad", placeholder:nameOld, initial:nameOld,
      validate(v){
        if (!v) return "Ad girin";
        if (v===nameOld) return "Aynı ad";
        if (isFile && !/\./.test(v)) return "Dosya uzantısını yazın (örn. main.js)";
        if (/[\\:*?"<>|]/.test(v)) return "Geçersiz karakter";
        return "";
      }
    });
    if (!next) return;
    const newPath = join(dir, next);
    try{
      await movePath(path, newPath);
      if (current.activeFile === path) current.activeFile = newPath;
      await reloadFiles(); renderTree();
      notify("Yeniden adlandırıldı.");
    }catch(e){ showError("Yeniden adlandırma hatası: " + (e?.message||e)); }
  }

  async function moveNode(path){
    const srcRoot = join(current.path, SRC_DIR);
    const dirs = await listAll(srcRoot).then(r=> [srcRoot, ...r.dirs]);
    const picked = await pickDirModal("Taşı", "Hedef klasör", dirs, dirname(path));
    if (!picked) return;
    const newPath = join(picked, basename(path));
    try{
      await movePath(path, newPath);
      if (current.activeFile === path) current.activeFile = newPath;
      await reloadFiles(); renderTree();
      notify("Taşındı.");
    }catch(e){ showError("Taşıma hatası: " + (e?.message||e)); }
  }

  async function deleteNode(path){
    const ok = await askConfirm({ title:"Sil", message:`Silinsin mi?\n${path}`, okText:"Sil", cancelText:"Vazgeç" });
    if (!ok) return;
    try{
      const isFile = await isFilePath(path);
      if (isFile) await delPath(path, { toRecycle:false });
      else        await deleteFolder(path);
      if (current.activeFile === path) current.activeFile = "";
      await reloadFiles(); renderTree();
      notify("Silindi.");
    }catch(e){ showError("Silinemedi: " + (e?.message||e)); }
  }

  // ---------- VFS düşük seviye ----------
  async function tryRenameFile(src, dst){
    if (typeof vfs.renameFile === 'function'){ await vfs.renameFile(src, dst); return true; }
    if (typeof vfs.rename === 'function'){
      try { await vfs.rename(src, dst); return true; } catch{}
      try { await vfs.rename(dirname(src), basename(src), dirname(dst), basename(dst)); return true; } catch{}
    }
    if (typeof vfs.move === 'function'){
      try { await vfs.move(src, dst); return true; } catch{}
    }
    return false;
  }
  async function delPath(path, opts={}){
    const { toRecycle=false } = opts;
    const d = dirname(path), n = basename(path);
    if (typeof vfs.deleteFile === 'function'){ try { await vfs.deleteFile(path, { toRecycle }); return; } catch{} }
    if (typeof vfs.delete === 'function'){    try { await vfs.delete(d, n, { toRecycle }); return; } catch{} }
    if (typeof vfs.unlink === 'function'){    try { await vfs.unlink(path); return; } catch{} }
    if (typeof vfs.remove === 'function'){    try { await vfs.remove(path); return; } catch{} }
    throw new Error("VFS silme başarısız: " + path);
  }
  async function delEmptyDirIfPossible(dirPath){
    if (typeof vfs.rmdir === 'function'){     try { await vfs.rmdir(dirPath); return true; } catch{} }
    if (typeof vfs.deleteDir === 'function'){ try { await vfs.deleteDir(dirPath); return true; } catch{} }
    if (typeof vfs.removeDir === 'function'){ try { await vfs.removeDir(dirPath); return true; } catch{} }
    if (typeof vfs.unlinkDir === 'function'){ try { await vfs.unlinkDir(dirPath); return true; } catch{} }
    if (typeof vfs.remove === 'function'){    try { await vfs.remove(dirPath); return true; } catch{} }
    if (typeof vfs.delete === 'function'){    try { await vfs.delete(dirname(dirPath), basename(dirPath)); return true; } catch{} }
    return false;
  }
  async function isFilePath(path){
    try{
      const items = await vfs.list(dirname(path));
      return items.some(it => it.type === 'file' && it.name === basename(path));
    }catch{ return true; }
  }
  async function movePath(src, dst){
    if (src === dst) return;
    const srcIsFile = await isFilePath(src);
    if (srcIsFile){
      if (await tryRenameFile(src, dst)) return;
      await ensureDir(dirname(dst));
      const data = await read(src);
      await write(dst, data);
      await delPath(src, { toRecycle:false });
      return;
    }
    // klasör
    if (typeof vfs.rename === 'function'){
      try { await vfs.rename(src, dst); return; } catch{}
      try { await vfs.rename(dirname(src), basename(src), dirname(dst), basename(dst)); return; } catch{}
    }
    if (typeof vfs.move === 'function'){
      try { await vfs.move(src, dst); return; } catch{}
    }
    await ensureDir(dst);
    const { files, dirs } = await listAll(src);
    for (const d of [src, ...dirs]){
      const rel = d.replace(src, '').replace(/^\/+/,'');
      await ensureDir(join(dst, rel));
    }
    for (const f of files){
      const rel = f.replace(src, '').replace(/^\/+/,'');
      await write(join(dst, rel), await read(f));
    }
    for (const f of files){ await delPath(f, { toRecycle:false }); }
    const ordered = [...dirs].sort((a,b)=> b.length - a.length);
    for (const d of ordered){ await delEmptyDirIfPossible(d); }
    await delEmptyDirIfPossible(src);
  }
  async function deleteFolder(path){
    const { files, dirs } = await listAll(path).catch(()=>({files:[],dirs:[]}));
    for (const f of files){
      try { await delPath(f, { toRecycle:false }); }
      catch(e){ console.warn("dosya silinemedi:", f, e); }
    }
    const ordered = [...dirs].sort((a,b)=> b.length - a.length);
    for (const d of ordered){
      let ok = await delEmptyDirIfPossible(d);
      if (!ok && typeof vfs.delete === 'function'){
        try { await vfs.delete(dirname(d), basename(d)); ok = true; } catch{}
      }
      if (!ok){ console.warn("klasör silinemedi (boş değil ya da VFS desteklemiyor):", d); }
    }
    {
      let ok = await delEmptyDirIfPossible(path);
      if (!ok && typeof vfs.delete === 'function'){
        try { await vfs.delete(dirname(path), basename(path)); ok = true; } catch{}
      }
      if (!ok){ console.warn("klasör silinemedi (boş değil ya da VFS desteklemiyor):", path); }
    }
  }
  async function ensureDir(dir){
    const parts = dir.replace(/^\/+/, '').split('/');
    let cur = '/';
    for (const part of parts){
      if (!part) continue;
      cur = join(cur, part);
      try{ await vfs.mkdir(cur); }catch{}
    }
  }

  // ---------- bundler ----------
  function defaultIndexHtml(name){
    return `<!doctype html>
<html><head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}</title>
<link rel="stylesheet" href="./style.css">
</head>
<body>
<div id="app"></div>
<script src="./main.js"></script>
<script>
(async()=>{
  try{
    if (typeof mount === "function") { await mount(document.getElementById('app')||document.body); }
  }catch(e){ const pre=document.createElement('pre'); pre.textContent=String(e&&e.stack||e); document.body.appendChild(pre); }
})();
</script>
</body></html>`;
  }
  function defaultMainJs(name){
    return `// ${name} — başlangıç
function mount(host){
  host.innerHTML = \`
    <div style="padding:12px">
      <h2 style="margin:0 0 8px 0">Merhaba ${escapeHtml(name)}! 👋</h2>
      <button id="btn">Tıkla</button>
      <div id="log" style="margin-top:10px;opacity:.8;font:12px/1.4 monospace;"></div>
    </div>\`;
  const log = (m)=>{ const el = host.querySelector('#log'); el.innerText += (m+"\\n"); };
  host.querySelector('#btn').onclick = ()=> log('Çalışıyor! ' + new Date().toLocaleTimeString());
}`;
  }

  async function bundleProject(projectDir){
    const srcDir = join(projectDir, SRC_DIR);
    const entryHtmlPath = join(srcDir, "index.html");
    const entryJsPath   = join(srcDir, "main.js");

    const hasHtml = await exists(entryHtmlPath);
    const hasJs   = await exists(entryJsPath);
    const cssPaths = (await listAll(srcDir)).files.filter(p=>extname(p)==="css");

    let htmlOut = "";
    const report = { warnings:[], files:[] };

    if (hasHtml){
      let html = await read(entryHtmlPath);
      report.files.push(entryHtmlPath);
      html = await inlineLinks(html, srcDir, report);
      html = await inlineScripts(html, srcDir, report);
      if (!/http-equiv=["']Content-Security-Policy["']/i.test(html)){
        html = html.replace(
          /<head[^>]*>/i,
          m => `${m}\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none';">`
        );
      }
      const hasMount = /mount\s*\(/.test(html);
      if (!hasMount && hasJs){
        html = injectEnd(html, `<script>
(async()=>{
  try{
    if (typeof mount === "function") { await mount(document.getElementById('app')||document.body); }
  }catch(e){ const pre=document.createElement('pre'); pre.textContent=String(e&&e.stack||e); document.body.appendChild(pre); }
})();
</script>`);
      }
      htmlOut = html;
    } else if (hasJs){
      const bundled = await bundleJsModule(entryJsPath, report);
      const cssText = await concatCss(cssPaths, report);
      htmlOut = `<!doctype html>
<html><head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(projectDir.split('/').pop()||'App')}</title>
<style>${escapeHtml(cssText)}</style>
</head><body>
<div id="app"></div>
<script>
${escScript(bundled)}
(async()=>{
  try{
    if (typeof mount === "function"){ await mount(document.getElementById('app')); }
  }catch(e){ document.body.innerHTML = '<pre>'+String(e&&e.stack||e)+'</pre>'; }
})();
</script>
</body></html>`;
    } else {
      report.warnings.push("Ne index.html ne de main.js bulundu. Boş çıktı üretildi.");
      htmlOut = "<!doctype html><meta charset='utf-8'><body><h3>Boş proje</h3></body>";
    }

    return { html: htmlOut, report };
  }

  async function inlineLinks(html, baseDir, report){
    return await replaceAsync(html, /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi, async (m, href)=>{
      const p = join(baseDir, href);
      const css = await read(p);
      report.files.push(p);
      return `<style>\n${escapeHtml(css)}\n</style>`;
    });
  }
  async function inlineScripts(html, baseDir, report){
    return await replaceAsync(html, /<script\s+[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi, async (m, src)=>{
      const p = join(baseDir, src);
      const code = await read(p);
      report.files.push(p);
      const bundled = await (extname(p)==="js" ? bundleJsModule(p, report) : Promise.resolve(code));
      return `<script>\n${escScript(bundled)}\n</script>`;
    });
  }
  function injectEnd(html, snippet){
    if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${snippet}\n</body>`);
    return html + snippet;
  }
  async function concatCss(paths, report){
    let out = "";
    for (const p of paths){ out += `\n/* ${p} */\n` + await read(p); report.files.push(p); }
    return out;
  }
  async function bundleJsModule(entry, report, seen=new Set()){
    if (seen.has(entry)) return ""; seen.add(entry);
    let code = await read(entry); report.files.push(entry);
    const dir = dirname(entry);
    // import data from './x.json'
    code = await replaceAsync(code, /import\s+([A-Za-z0-9_$]+)\s+from\s+['"](.+?\.json)['"]\s*;?/g, async (m, varName, spec)=>{
      const p = join(dir, spec);
      const txt = await read(p); report.files.push(p);
      return `const ${varName} = JSON.parse(${JSON.stringify(txt)});`;
    });
    // import './styles.css'
    code = await replaceAsync(code, /import\s+['"](.+?\.css)['"]\s*;?/g, async (m, spec)=>{
      const p = join(dir, spec);
      const css = await read(p); report.files.push(p);
      return `__injectCss(${JSON.stringify(css)});`;
    });
    // import ... from './x.js'
    code = await replaceAsync(code, /import\s+([^'"]+)\s+from\s+['"](.+?\.js)['"]\s*;?/g, async (m, what, spec)=>{
      const p = join(dir, spec);
      const sub = await bundleJsModule(p, report, seen);
      return `\n/* inlined from ${spec} */\n${sub}\n/* end inlined */\n`;
    });
    // import './x.js'
    code = await replaceAsync(code, /import\s+['"](.+?\.js)['"]\s*;?/g, async (m, spec)=>{
      const p = join(dir, spec);
      const sub = await bundleJsModule(p, report, seen);
      return `\n/* inlined from ${spec} */\n${sub}\n/* end inlined */\n`;
    });
    // export ... dönüşümleri
    code = code.replace(/\bexport\s+async\s+function\s+([A-Za-z0-9_$]+)\s*\(/g, 'async function $1(');
    code = code.replace(/\bexport\s+function\s+([A-Za-z0-9_$]+)\s*\(/g, 'function $1(');
    code = code.replace(/\bexport\s+(const|let|var)\s+/g, '$1 ');
    code = code.replace(/\bexport\s+default\s+/g, '');

    const header = `
/* ---- DevStudio bundler runtime (minimal) ---- */
function __injectCss(txt){
  const s = document.createElement('style'); s.textContent = txt; document.head.appendChild(s);
}
`;
    return header + "\n" + code;
  }
  async function replaceAsync(str, regex, asyncFn){
    const parts = []; let lastIndex = 0; let m;
    while ((m = regex.exec(str))){
      parts.push(str.slice(lastIndex, m.index));
      parts.push(await asyncFn(...m));
      lastIndex = regex.lastIndex;
    }
    parts.push(str.slice(lastIndex));
    return parts.join('');
  }

  // ---------- preview / build / install ----------
  async function runPreview(){
    const { html } = await bundleProject(current.path);
    const host = root.querySelector("#runhost");
    host.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.className = "frame";
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.srcdoc = html;
    host.appendChild(iframe);
    log("Önizleme güncellendi (iframe sandbox)");
  }

  async function buildProject(){
    const distDir = join(current.path, DIST_DIR);
    const { html, report } = await bundleProject(current.path);
    await write(join(distDir, "index.html"), html);
    log(`Build tamamlandı. Dosyalar: ${report.files.length}`);
    return { html, report };
  }

  async function installProject(){
    const safe = slugify(current.name);
    const vexePath = join(current.path, `${safe}.vexe`);
    const distDir  = join(current.path, DIST_DIR);
    const entryHtml = join(distDir, "index.html");
    if (!await exists(entryHtml)){
      await buildProject();
    }
    const manifest = { id:`user.${safe}`, name: current.name || safe, type:"html", entryHtml };
    await write(vexePath, JSON.stringify(manifest, null, 2));
    await ensureFileAssociation();
    log(`Install hazır: ${vexePath}`);
    notify(".vexe manifesti oluşturuldu. Explorer'da çift tıklayarak VExecRunner ile açabilirsiniz.");
  }

  async function ensureFileAssociation(){
    const setPath = "/System/settings.json";
    let cfg = {};
    try{ cfg = JSON.parse(await read(setPath) || "{}"); }catch{ cfg = {}; }
    if (!cfg.fileAssociations) cfg.fileAssociations = {};
    if (cfg.fileAssociations[".vexe"] !== "app.vexec.runner"){
      cfg.fileAssociations[".vexe"] = "app.vexec.runner";
      await write(setPath, JSON.stringify(cfg, null, 2));
      log("'.vexe' dosyaları VExecRunner ile ilişkilendirildi.");
    }
  }

  async function openDist(){
    const p = join(current.path, DIST_DIR, "index.html");
    if (!await exists(p)){ showError("Önce Build alın."); return; }
    const html = await read(p);
    const host = root.querySelector("#runhost"); host.innerHTML = "";
    const iframe = document.createElement("iframe"); iframe.className = "frame"; iframe.setAttribute("sandbox","allow-scripts");
    iframe.srcdoc = html; host.appendChild(iframe);
    log("Dist/ önizlendi.");
  }

  // ---------- dir picker modal ----------
  async function pickDirModal(title, labelText, dirList, initial){
    return new Promise((resolve)=>{
      const ov = document.createElement('div'); ov.className='modal-overlay';
      const opts = dirList.map(d=>{
        const optionLabel = current?.name ? `${current.name}/${(relPath(d) || '')}`.replace(/\/$/,'') : relPath(d) || d;
        return `<option value="${d}" ${d===initial?'selected':''}>${optionLabel}</option>`;
      }).join('');
      ov.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <div class="hd">${escapeHtml(title)}</div>
          <div class="bd">
            <label>${escapeHtml(labelText)}</label>
            <select class="select">${opts}</select>
          </div>
          <div class="ft">
            <button class="btn cancel">Vazgeç</button>
            <button class="btn primary ok">Seç</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      const sel = ov.querySelector('.select');
      const done = (v)=>{ ov.remove(); resolve(v); };
      ov.querySelector('.cancel').onclick = ()=> done(null);
      ov.querySelector('.ok').onclick = ()=> done(sel.value);
      ov.addEventListener('pointerdown', (e)=>{ if (e.target===ov) done(null); });
      ov.tabIndex = -1; ov.focus();
    });
  }

  // ---------- dirty helpers ----------
  let _dirtyRaf = 0;
  function setDirty(v){
    current.dirty = !!v;
    if (_dirtyRaf) cancelAnimationFrame(_dirtyRaf);
    _dirtyRaf = requestAnimationFrame(()=>{
      renderTree();
      setPathBar();
      _dirtyRaf = 0;
    });
  }

  // ---------- dosya/proje yaşam döngüsü ----------
  async function createProject(){
    const name = await askString({
      title: "Yeni Proje", label: "Proje adı", placeholder: "MyApp", initial: "MyApp",
      validate(v){ if (!v) return "Bir ad girin"; if (v.length<2) return "En az 2 karakter"; return ""; }
    });
    if (!name) return;
    const safe = slugify(name);
    const dir  = join(BASE_DIR, safe);
    const src  = join(dir, SRC_DIR);
    const dist = join(dir, DIST_DIR);
    const appJsonPath = join(dir, "app.json");

    try{
      await vfs.mkdir(dir).catch(()=>{});
      await vfs.mkdir(src).catch(()=>{});
      await vfs.mkdir(dist).catch(()=>{});
      await write(join(src, "index.html"), defaultIndexHtml(safe));
      await write(join(src, "main.js"),  defaultMainJs(safe));
      await write(join(src, "style.css"), "/* styles */\nbody{font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif;}");
      await write(appJsonPath, JSON.stringify({ id:`user.${safe}`, name, version:1, entry:`${SRC_DIR}/index.html`, styles:[] }, null, 2));
      await refreshList(safe);
      await openProject(safe);
      notify("Proje oluşturuldu.");
    }catch(e){
      showError("Proje oluşturulamadı: " + (e?.message || e));
    }
  }

async function openProject(name){
  const dir = join(BASE_DIR, name);
  current = {
    name,
    path: dir,
    mainPath: join(dir, SRC_DIR, "main.js"),
    appJsonPath: join(dir, "app.json"),
    files: [],
    dirs: [],
    activeFile: "",
    dirty: false
  };



    await reloadFiles();
    await openPreferedFile();

    // Editörü proje açılırken başlat (ilk kez)
    if (!editorAPI) {
      try {
        await bootSyntax();
      } catch (e) {
        console.warn("syntax init fail:", e);
      }
      if (editorAPI && current.activeFile) {
        editorAPI.setLanguageByPath(current.activeFile);
        editorAPI.setValue(await read(current.activeFile));
      }
    }

    setPathBar();
  }

  async function reloadFiles(){
    const srcRoot = join(current.path, SRC_DIR);
    const { files, dirs } = await listAll(srcRoot);
    current.files = files;
    current.dirs  = [srcRoot, ...dirs];
    renderTree();
    setPathBar();
  }

  async function openPreferedFile(){
    const first = current.files.find(p=>/index\.html$/i.test(p)) || current.files.find(p=>/main\.js$/i.test(p)) || current.files[0];
    if (first) await openFile(first);
  }

async function openFile(fp){
  current.activeFile = fp;
  const code = await read(fp);

  if (editorAPI){
    editorAPI.setLanguageByPath(fp);
    editorAPI.setValue(code);
  } else {
    if (!editorEl) editorEl = root.querySelector("#editor");
    if (editorEl) editorEl.value = code;
  }

  setDirty(false);
  renderTree();
  setPathBar();
}


  async function saveActive(){
    if (!current.activeFile){ showError("Önce bir dosya seçin."); return; }
    const val = editorAPI ? editorAPI.getValue() : (root.querySelector("#editor")?.value || "");
    await write(current.activeFile, val);
    setDirty(false);
    log("Kaydedildi.");
  }

  async function deleteProject(){
    if (!current.path){ showError("Önce bir proje seçin."); return; }
    const ok = await askConfirm({ title:"Sil", message:`Silinsin mi?\n${current.path}`, okText:"Sil", cancelText:"Vazgeç" });
    if (!ok) return;
    try{
      const items = await vfs.list(current.path).catch(()=>[]);
      for (const it of items){
        const p = join(current.path, it.name);
        if (it.type === "file"){ await delPath(p, { toRecycle:false }); }
        if (it.type === "dir"){ await deleteFolder(p); }
      }
      log("Dosyalar çöp kutusuna taşındı.");
      current = { name:"", path:"", mainPath:"", appJsonPath:"", files:[], dirs:[], activeFile:"", dirty:false };
      if (editorAPI) editorAPI.setValue("");
      root.querySelector("#runhost").innerHTML = "";
      await refreshList(null);
      setPathBar();
    }catch(e){ showError("Silinemedi: " + (e?.message||e)); }
  }

  async function moveProject(){
    if (!current.path){ showError("Önce bir proje seçin."); return; }

    if (current.dirty){
      const ans = await askTriConfirm({
        title:"Kaydedilmemiş Değişiklikler",
        message:"Projeyi taşımadan önce mevcut dosyayı kaydetmek ister misiniz?"
      });
      if (ans === 'cancel') return;
      if (ans === 'yes') await saveActive();
      setDirty(false);
    }

    const nameOld = current.name;
    const input = await askString({
      title:"Projeyi Taşı / Yeniden Adlandır",
      label:"Yeni proje adı",
      placeholder:nameOld,
      initial:nameOld,
      validate(v){
        if (!v) return "Ad girin";
        if (/[\\:*?"<>|]/.test(v)) return "Geçersiz karakter";
        return "";
      }
    });
    if (!input) return;

    const safe = slugify(input);
    const dst = join(BASE_DIR, safe);
    try{
      await movePath(current.path, dst);
      current.name = safe;
      current.path = dst;
      current.mainPath = join(dst, SRC_DIR, "main.js");
      current.appJsonPath = join(dst, "app.json");
      await refreshList(safe);
      setPathBar();
      notify(`Proje taşındı: ${nameOld} → ${safe}`);
    }catch(e){
      showError("Proje taşınamadı: " + (e?.message || e));
    }
  }

  // ---------- toolbar binding (safe) ----------
  function safeBind(sel, fn, type="click"){
    const el = root.querySelector(sel);
    if (el) el.addEventListener(type, fn);
    else console.warn("buton bulunamadı:", sel);
  }
  safeBind("#btn-new", createProject);
  safeBind("#btn-save", saveActive);
  safeBind("#btn-run", runPreview);
  safeBind("#btn-build", buildProject);
  safeBind("#btn-install", installProject);
  safeBind("#btn-open-dist", openDist);
  safeBind("#btn-add-file", addFile);
  safeBind("#btn-add-folder", addFolder);
  safeBind("#btn-rename", ()=> current.activeFile && renameNode(current.activeFile));
  safeBind("#btn-del", deleteProject);
  safeBind("#btn-move", moveProject);

  // ---------- klavye kısayolu & çıkış uyarısı ----------
  function onKeydown(e){
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'){
      e.preventDefault();
      saveActive();
    }
  }
  function onBeforeUnload(e){
    if (!current.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  }
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('beforeunload', onBeforeUnload);

  // ---------- context menu ----------
  function showNodeMenu(x,y,node){
    ctxMenu.innerHTML = "";
    const add = (label, fn, klass="")=>{
      const it = h("div",{class:"mi "+klass});
      it.textContent = label;
      it.addEventListener("pointerdown", (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        hideCtx();
        Promise.resolve().then(fn).catch(err=> showError(err?.message || String(err)));
      });
      ctxMenu.appendChild(it);
    };
    if (node.type === 'file') add("Aç", ()=> openFile(node.path));
    add("Yeniden Adlandır", ()=> renameNode(node.path));
    add("Taşı…", ()=> moveNode(node.path));
    add("Sil", ()=> deleteNode(node.path), "danger");

    const vw = window.innerWidth, vh = window.innerHeight;
    const rect = { w: 200, h: 160 };
    const left = Math.min(x, vw - rect.w - 8);
    const top  = Math.min(y, vh - rect.h - 8);
    ctxMenu.style.left = left + "px";
    ctxMenu.style.top  = top + "px";
    requestAnimationFrame(()=>{ ctxMenu.style.display = "block"; });
  }

  // ---------- boot ----------
  await ensureBase();
  await refreshList();
  log("Dev Studio hazır. Sürükle-bırak ile taşıma, sağ tık menüsü ve yeniden adlandırma aktif.");

  // ---------- add / save / folder ----------
  async function addFile(){
    const name = await askString({ title:"Yeni Dosya", label:"Dosya adı (ör. index.html, main.js, style.css, data.json)", placeholder:"index.html", initial:"index.html",
      validate(v){ if (!v) return "Ad gir"; if (!/\.[a-z0-9]+$/i.test(v)) return "Uzantı ekleyin"; return ""; }
    });
    if (!name) return;
    const p = join(current.path, SRC_DIR, name);
    await ensureDir(dirname(p));
    if (await exists(p)){ showError("Dosya zaten var."); return; }
    let content = "";
    const ex = extname(p);
    if (ex==="html") content = defaultIndexHtml(current.name);
    else if (ex==="js") content = defaultMainJs(current.name);
    else if (ex==="css") content = "/* styles */\nbody{font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif;}";
    else if (ex==="json") content = "{\n  \"hello\": \"world\"\n}\n";
    await write(p, content);
    await reloadFiles();
    await openFile(p);
    notify("Dosya oluşturuldu.");
  }

  async function addFolder(){
    try{
      const baseDir = current.activeFile ? dirname(current.activeFile) : join(current.path, SRC_DIR);
      const name = await askString({
        title:"Yeni Klasör",
        label:"Klasör adı (alt klasör destekli: ör. utils/helpers)",
        placeholder:"utils",
        initial:"utils",
        validate(v){
          if (!v) return "Ad gir";
          if (v.endsWith('/')) return "Sonda / olmasın";
          if (/[\\:*?"<>|]/.test(v)) return "Geçersiz karakter";
          return "";
        }
      });
      if (!name) return;
      const rel = name.replace(/^\/+/, '').replace(/\/+/g,'/');
      const target = join(baseDir, rel);
      if (await existsDir(target)){ showError("Klasör zaten var: " + target); return; }
      await ensureDir(target);
      await reloadFiles();
      renderTree();
      notify("Klasör oluşturuldu: " + target);
    }catch(err){
      console.error("[addFolder] hata:", err);
      showError("Klasör oluşturulamadı: " + (err?.message || String(err)));
    }
  }
}