// Apps/Browser/main.js
// Sekmeli Web Tarayıcı — Electron <webview> ile (webviewTag gerekir)

const HOMEPAGE = 'https://www.google.com';

export async function mount(rootEl, { args }) {
  const home = (args && args.home) || HOMEPAGE;

  rootEl.className = 'browser compact';
  rootEl.innerHTML = `
    <div class="browser-chrome">
      <div class="tabs" data-id="tabs">
        <button class="tab add" title="Yeni Sekme">＋</button>
      </div>
      <div class="toolbar">
        <button class="nav back"    title="Geri (Alt+Sol)">←</button>
        <button class="nav forward" title="İleri (Alt+Sağ)">→</button>
        <button class="nav reload"  title="Yenile (Ctrl+R)">⟳</button>
        <button class="nav home"    title="Ana sayfa">⌂</button>
        <input class="omnibox" placeholder="Adresi veya arama terimini yazın (Ctrl+L)" spellcheck="false"/>
        <button class="go" title="Git">Git</button>
      </div>
    </div>
    <div class="browser-content" data-id="content"></div>
  `;

  const tabsEl = rootEl.querySelector('[data-id=tabs]');
  const contentEl = rootEl.querySelector('[data-id=content]');
  const btnBack = rootEl.querySelector('.nav.back');
  const btnFwd  = rootEl.querySelector('.nav.forward');
  const btnRel  = rootEl.querySelector('.nav.reload');
  const btnHome = rootEl.querySelector('.nav.home');
  const btnGo   = rootEl.querySelector('.go');
  const omni    = rootEl.querySelector('.omnibox');
  const btnAdd  = rootEl.querySelector('.tab.add');

  /** @type {Array<{id:number, el:HTMLElement, webview:any, title:string, url:string, favicon?:string}>} */
  const tabs = [];
  let activeId = -1;
  let nextId = 1;

  // ---- helpers
  const isWebviewAvailable = !!document.createElement('webview').tagName; // var ama aktif olması için webviewTag gerekiyor
  function normalizeUrl(input){
    const v = String(input||'').trim();
    if (!v) return '';
    if (/^[a-zA-Z]+:\/\//.test(v)) return v;
    // çıplak domain gibi duruyorsa https ekle
    if (/^[^\s]+\.[^\s]{2,}$/.test(v) && !/\s/.test(v)) return 'https://' + v;
    // aksi halde Google araması
    const q = encodeURIComponent(v);
    return `https://www.google.com/search?q=${q}`;
  }
  function getActive(){ return tabs.find(t=>t.id===activeId); }
function setNavState(){
  const t = getActive();
  if (!t || !t.webview) { btnBack.disabled = btnFwd.disabled = btnRel.disabled = true; return; }
  try {
    const canBack = t.webview.canGoBack ? t.webview.canGoBack() : false;
    const canFwd  = t.webview.canGoForward ? t.webview.canGoForward() : false;
    btnBack.disabled = !canBack;
    btnFwd.disabled  = !canFwd;
    btnRel.disabled  = false;
  } catch {
    // hazır değilse: geri/ileri pasif
    btnBack.disabled = btnFwd.disabled = true;
    btnRel.disabled = false;
  }
}

  function selectTab(id){
    activeId = id;
    [...tabsEl.querySelectorAll('.tab')].forEach(el=> el.classList.remove('active'));
    const t = getActive(); if (!t) return;
    t.el.classList.add('active');
    [...contentEl.children].forEach(ch => ch.style.display='none');
    t.webview.style.display = '';
    omni.value = t.url || '';
    omni.placeholder = t.url || HOMEPAGE;
    setNavState();
    omni.focus();
  }
  function closeTab(id){
    const idx = tabs.findIndex(t=>t.id===id); if (idx<0) return;
    const t = tabs[idx];
    t.webview.remove();
    t.el.remove();
    tabs.splice(idx,1);
    if (!tabs.length) { addTab(home); return; }
    const next = tabs[Math.max(0, idx-1)] || tabs[0];
    selectTab(next.id);
  }
  function updateTabUI(t){
    const ico = t.favicon ? `<img class="fav" src="${t.favicon}"/>` : `<span class="fav">🌐</span>`;
    t.el.innerHTML = `${ico}<span class="title">${t.title||'Yeni Sekme'}</span><button class="x" title="Sekmeyi kapat">×</button>`;
    t.el.querySelector('.x').onclick = (e)=>{ e.stopPropagation(); closeTab(t.id); };
  }
function attachWebviewEvents(t){
  const wv = t.webview; if (!wv) return;
  const setTitle = (title)=>{ t.title = title || t.url || 'Sekme'; updateTabUI(t); };

  wv.addEventListener('dom-ready', ()=>{
    const titleNow = wv.getTitle?.() || t.url;
    setTitle(titleNow);
  });
  wv.addEventListener('page-title-updated', (e)=> setTitle(e.title));
  wv.addEventListener('page-favicon-updated', (e)=>{ t.favicon = (e.favicons||[])[0]; updateTabUI(t); });
  wv.addEventListener('did-navigate', (e)=>{ t.url = e.url; if (t.id===activeId) omni.value = t.url; });
  wv.addEventListener('did-navigate-in-page', (e)=>{ t.url = e.url; if (t.id===activeId) omni.value = t.url; });

  wv.addEventListener('did-start-loading', ()=> btnRel.textContent = '⟲');
  wv.addEventListener('did-stop-loading',  ()=> btnRel.textContent = '⟳');

  wv.addEventListener('new-window', (e)=>{ if (e.url) addTab(e.url); });
  wv.addEventListener('did-fail-load', (e)=>{
    if (e.errorCode === -3) return; // iptal → gürültüyü yut
    if (t.id!==activeId) return;
    showInfo(`Sayfa yüklenemedi (${e.errorDescription || e.errorCode}).`);
  });
}


  function showInfo(msg){
    const bar = document.createElement('div');
    bar.className = 'infobar';
    bar.textContent = msg;
    contentEl.appendChild(bar);
    setTimeout(()=> bar.remove(), 3000);
  }

  function createWebSurface(){
    // webviewTag etkinse <webview>, değilse <iframe> ile düşümlü
    if (isWebviewAvailable) {
      const wv = document.createElement('webview');
      wv.setAttribute('allowpopups', 'true');
      wv.setAttribute('webpreferences', 'contextIsolation=yes, nodeIntegration=no, sandbox=yes');
      wv.style.display = 'none';
      wv.style.width = '100%';
      wv.style.height = '100%';
      return wv;
    }
    const ifr = document.createElement('iframe');
    ifr.style.display = 'none';
    ifr.style.width = '100%';
    ifr.style.height = '100%';
    ifr.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups');
    return ifr;
  }

function navigate(t, urlLike){
  const url = normalizeUrl(urlLike || t.url || home);
  t.url = url;
  if (t.webview.tagName.toLowerCase() === 'webview') {
    t.webview.setAttribute('src', url);   // dom-ready beklemeden güvenli
  } else {
    t.webview.src = url;                  // iframe fallback
    if (/google\.com/i.test(url)) showInfo('Google iframe’e izin vermeyebilir. webviewTag etkin olsun.');
  }
  if (t.id===activeId) omni.value = url;
}



  function addTab(url) {
    const id = nextId++;
    const tabEl = document.createElement('button');
    tabEl.className = 'tab';
    tabEl.title = 'Sekme';
    tabsEl.insertBefore(tabEl, btnAdd);

    const surface = createWebSurface();
    contentEl.appendChild(surface);

    const t = { id, el: tabEl, webview: surface, title: 'Yeni Sekme', url: '' };
    tabs.push(t);

    tabEl.onclick = ()=> selectTab(id);
    updateTabUI(t);

    if (surface.tagName.toLowerCase() === 'webview') attachWebviewEvents(t);

    // İlk gösterim + gezinme
    selectTab(id);
    navigate(t, url || home);
  }

  // ---- events
  btnAdd.onclick   = ()=> addTab(home);
  btnBack.onclick  = ()=> { const t=getActive(); if (!t) return; try{ t.webview.goBack?.(); }catch{} };
  btnFwd.onclick   = ()=> { const t=getActive(); if (!t) return; try{ t.webview.goForward?.(); }catch{} };
  btnRel.onclick   = ()=> { const t=getActive(); if (!t) return; try{ t.webview.reload?.(); t.webview.reload?.(); }catch{} };
  btnHome.onclick  = ()=> { const t=getActive(); if (!t) return; navigate(t, home); };
  btnGo.onclick    = ()=> { const t=getActive(); if (!t) return; navigate(t, omni.value); };

  omni.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter') { e.preventDefault(); const t=getActive(); if (!t) return; navigate(t, omni.value); }
  });

  rootEl.addEventListener('keydown', (e)=>{
    if (e.key==='l' && (e.ctrlKey||e.metaKey)) { e.preventDefault(); omni.select(); omni.focus(); }
    if (e.altKey && e.key==='ArrowLeft')  { e.preventDefault(); btnBack.click(); }
    if (e.altKey && e.key==='ArrowRight') { e.preventDefault(); btnFwd.click(); }
    if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='t') { e.preventDefault(); btnAdd.click(); }
    if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='w') { e.preventDefault(); const t=getActive(); if (t) closeTab(t.id); }
    if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='r') { e.preventDefault(); btnRel.click(); }
  });

  // ilk sekme
  addTab(home);
}
