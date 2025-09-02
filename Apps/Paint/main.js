export async function mount(rootEl, { vfs, args }) {
  rootEl.className = 'paint';
  rootEl.innerHTML = `
    <div class="toolbar">
      <button data-act="new" title="Yeni (Ctrl+N)">Yeni</button>
      <button data-act="open" title="Aç (Ctrl+O)">Aç</button>
      <button data-act="save" title="Kaydet (Ctrl+S)">Kaydet</button>
      <button data-act="saveas" title="Farklı Kaydet">Farklı Kaydet</button>
      <input class="path" type="text" placeholder="/Documents/Gallery/cizim.png" style="min-width:280px"/>
      <span style="margin-left:auto;display:flex;gap:8px;align-items:center">
        <button data-act="undo" title="Geri Al (Ctrl+Z)">Geri</button>
        <button data-act="redo" title="İleri Al (Ctrl+Y)">İleri</button>
        <select data-id="tool" title="Araç (B/S)">
          <option value="brush">Fırça</option>
          <option value="eraser">Silgi</option>
        </select>
        <input data-id="color" type="color" value="#5ad1ff" title="Renk"/>
        <select data-id="size" title="Boyut">
          <option>2</option><option>4</option><option selected>6</option><option>12</option><option>24</option><option>36</option>
        </select>
        <button data-act="clear" title="Temizle">Temizle</button>
        <button data-act="fill" title="Doldur">Doldur</button>
      </span>
    </div>
    <div class="canvas-wrap"><canvas></canvas></div>
    <div class="status" data-id="status">Hazır</div>
  `;

  const pathInp = rootEl.querySelector('.path');
  const toolSel = rootEl.querySelector('[data-id=tool]');
  const colorInp = rootEl.querySelector('[data-id=color]');
  const sizeSel = rootEl.querySelector('[data-id=size]');
  const statusEl = rootEl.querySelector('[data-id=status]');
  const canvas = rootEl.querySelector('canvas');
  const ctx = canvas.getContext('2d');

  let dirty = false;
  let drawing = false;
  let last = null;
  let undo = [], redo = [];
  const MAX_UNDO = 25;

  function setStatus(s){ statusEl.textContent = s; }
  function setDirty(v){ dirty = !!v; }

  function deviceScale() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width  * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      // eski içeriği ölçekli kopyala
      const old = document.createElement('canvas');
      old.width = canvas.width; old.height = canvas.height;
      old.getContext('2d').drawImage(canvas, 0, 0);
      canvas.width = w; canvas.height = h;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(old, 0, 0, old.width, old.height, 0, 0, w, h);
    }
  }
  function snapshot() {
    try {
      const url = canvas.toDataURL('image/png');
      undo.push(url); if (undo.length > MAX_UNDO) undo.shift();
      redo.length = 0;
    } catch {}
  }
  function restore(url) {
    return new Promise((res)=>{
      const img = new Image();
      img.onload = ()=>{ ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height); res(); };
      img.src = url;
    });
  }

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x:(e.clientX-rect.left)*dpr, y:(e.clientY-rect.top)*dpr };
  }

  function beginDraw(e){
    drawing = true; last = pointerPos(e);
    snapshot();
    drawPoint(last.x, last.y);
  }
  function endDraw(){ drawing = false; last = null; }
  function drawPoint(x, y) {
    const t = toolSel.value;
    const sz = parseInt(sizeSel.value,10) || 6;
    ctx.globalCompositeOperation = (t === 'eraser') ? 'destination-out' : 'source-over';
    ctx.strokeStyle = colorInp.value;
    ctx.lineWidth = sz; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last?.x ?? x, last?.y ?? y);
    ctx.lineTo(x, y);
    ctx.stroke();
    last = { x, y };
    setDirty(true);
  }

  canvas.addEventListener('pointerdown', (e)=>{ canvas.setPointerCapture(e.pointerId); beginDraw(e); });
  canvas.addEventListener('pointermove', (e)=>{ if (drawing) drawPoint(...Object.values(pointerPos(e))); });
  canvas.addEventListener('pointerup', ()=> endDraw());
  canvas.addEventListener('pointercancel', ()=> endDraw());
  window.addEventListener('resize', ()=> deviceScale());

  // Dosya işlemleri
  function suggestPath() {
    return '/Documents/Gallery/cizim.png';
  }
  async function doNew() {
    if (dirty && !confirm('Kaydedilmemiş değişiklikler var. Devam edilsin mi?')) return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    pathInp.value = suggestPath();
    setDirty(false); setStatus('Yeni tuval');
    undo = []; redo = []; snapshot();
  }
  async function doOpen(pth) {
    const p = pth || await (window.askString ? window.askString({
   title:'Aç', label:'Yol', initial: pathInp.value || suggestPath()
 }) : null); if (!p) return;
    const data = await vfs.readFile(p).catch(()=>null);
    if (!data) return alert('Dosya okunamadı');
    let url = null;
    if (typeof data === 'string' && data.startsWith('data:image/')) url = data;
    else if (typeof data === 'string' && (p.endsWith('.png')||p.endsWith('.jpg')||p.endsWith('.jpeg'))) url = data; // biz zaten dataURL yazıyoruz
    else return alert('Desteklenmeyen resim formatı (Paint kendi kaydettiği PNG data URL\'i açar)');
    await restore(url);
    pathInp.value = p; setDirty(false); setStatus('Açıldı: '+p);
    undo = []; redo = []; snapshot();
  }
  async function doSave(toPath) {
    const p = toPath || pathInp.value || suggestPath();
    const url = canvas.toDataURL('image/png');
    await vfs.writeFile(p, url);
    pathInp.value = p; setDirty(false); setStatus('Kaydedildi: '+p);
  }

  // Toolbar
  rootEl.querySelector('[data-act=new]').addEventListener('click', doNew);
  rootEl.querySelector('[data-act=open]').addEventListener('click', ()=>doOpen());
  rootEl.querySelector('[data-act=save]').addEventListener('click', ()=>doSave());
  rootEl.querySelector('[data-act=saveas]').addEventListener('click', async ()=>{
     const p = await (window.askString ? window.askString({
   title:'Farklı Kaydet', label:'Yol', initial: pathInp.value || suggestPath()
 }) : null); if (!p) return;
    await doSave(p);
  });
  rootEl.querySelector('[data-act=clear]').addEventListener('click', ()=>{
    if (!confirm('Tuvali temizle?')) return;
    snapshot(); ctx.clearRect(0,0,canvas.width,canvas.height); setDirty(true);
  });
  rootEl.querySelector('[data-act=fill]').addEventListener('click', ()=>{
    snapshot(); ctx.globalCompositeOperation='source-over';
    ctx.fillStyle = colorInp.value; ctx.fillRect(0,0,canvas.width,canvas.height); setDirty(true);
  });
  rootEl.querySelector('[data-act=undo]').addEventListener('click', async ()=>{
    if (undo.length<=1) return;
    const cur = undo.pop(); redo.push(cur);
    await restore(undo[undo.length-1]); setDirty(true);
  });
  rootEl.querySelector('[data-act=redo]').addEventListener('click', async ()=>{
    if (!redo.length) return;
    const u = redo.pop(); undo.push(u);
    await restore(u); setDirty(true);
  });

  // Kısayollar
  rootEl.addEventListener('keydown', (e)=>{
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k==='s'){ e.preventDefault(); doSave(); }
    else if (mod && k==='o'){ e.preventDefault(); doOpen(); }
    else if (mod && k==='n'){ e.preventDefault(); doNew(); }
    else if (mod && k==='z'){ e.preventDefault(); rootEl.querySelector('[data-act=undo]').click(); }
    else if (mod && k==='y'){ e.preventDefault(); rootEl.querySelector('[data-act=redo]').click(); }
    else if (k==='b'){ toolSel.value='brush'; }
    else if (k==='s'){ if(!mod) toolSel.value='eraser'; }
  });

  // Başlat
  deviceScale();
  pathInp.value = (args?.path && (args.path.endsWith('.png')||args.path.endsWith('.jpg')||args.path.endsWith('.jpeg'))) ? args.path : suggestPath();
  if (args?.path) await doOpen(args.path).catch(()=>{});
  snapshot(); setStatus('Hazır');
}
