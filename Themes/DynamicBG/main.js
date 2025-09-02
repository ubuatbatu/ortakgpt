// Themes/DynamicBG/main.js
// Public API: start(config?), stop()
// Not: start() içindeki cfg.intro ile açılış efektini özelleştirebilirsiniz.

(function ensureCss(){
  const cssUrl = new URL('./style.css', import.meta.url).href;
  if (![...document.querySelectorAll('link[rel=stylesheet]')].some(l => l.href === cssUrl)){
    const ln = document.createElement('link'); ln.rel='stylesheet'; ln.href=cssUrl;
    document.head.appendChild(ln);
  }
})();

class SphereFX {
  constructor(){
    this.canvas = null; this.ctx = null;
    this.w = 0; this.h = 0; this.dpr = Math.max(1, window.devicePixelRatio||1);
    this.running = false; this.t = 0; this.raf = 0;

    this.points = [];     // serbest nokta bulutu
    this.outerRings = []; // dış halkalar
    this.innerRings = []; // iç halkalar

    // Konfig
    this.cfg = {
      points: 3200, rings: 6, innerRings: 3,
      radius: 220,
      speed: 0.28, innerSpeed: 0.7, orbitSpeed: 0.22,

      // dış halkalar dağılım
      outerTiltRange: 0.6, outerTwistRange: 0.6,
      outerPrecession: 0.18, outerPrecessionAmp: 0.28,
      ringPointJitter: 0.02, ringThick: 0.012, ringSpeedVar: 0.4,

      // iç halkalar
      innerPrecession: 0.5,

      // noktalar
      dotSize: 0.9, noise: 0.06,

      // --- Açılış (intro) varsayılanları ---
      intro: {
        delayMs: 1000,      // görünmeden bekleme
        durationMs: 900,    // fade + scale süresi
        scaleFrom: 0.72,    // ilk ölçek
        alphaFrom: 0.0      // ilk opaklık
      }
    };

    // intro durumu
    this.intro = { active:false, startTs: 0, delayMs: 1000, durationMs: 900, scaleFrom: 0.72, alphaFrom: 0.0 };

    this.onResize = this.resize.bind(this);
  }

  taskbarH(){
    const v = getComputedStyle(document.documentElement).getPropertyValue('--taskbar-h').trim();
    return parseInt(v)||48;
  }

  ensureCanvas(){
    let c = document.getElementById('bgfx');
    if (!c){ c = document.createElement('canvas'); c.id='bgfx'; document.body.appendChild(c); }
    this.canvas = c; this.ctx = c.getContext('2d', { alpha:true, desynchronized:true });
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  resize(){
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight - this.taskbarH());
    this.w = w; this.h = h;
    this.canvas.width  = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
  }

  // düzgün dağılmış küre noktaları
  fibonacciSphere(n){
    const pts = []; if (n<1) return pts;
    const phi = Math.PI * (3 - Math.sqrt(5));
    for (let i=0;i<n;i++){
      const y = 1 - (i / Math.max(1,(n - 1))) * 2; // 1..-1
      const r = Math.sqrt(1 - y*y);
      const theta = phi * i;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      pts.push({x,y,z, seed: Math.random()*10});
    }
    return pts;
  }

  build(cfg){
    // merge + intro ayarları
    this.cfg = { ...this.cfg, ...(cfg||{}) };
    this.intro = {
      active: true,
      startTs: performance.now(),
      delayMs: (cfg?.intro?.delayMs ?? this.cfg.intro.delayMs),
      durationMs: (cfg?.intro?.durationMs ?? this.cfg.intro.durationMs),
      scaleFrom: (cfg?.intro?.scaleFrom ?? this.cfg.intro.scaleFrom),
      alphaFrom: (cfg?.intro?.alphaFrom ?? this.cfg.intro.alphaFrom)
    };

    const maxR = Math.min(this.w, this.h) * 0.28;
    this.R = Math.min(this.cfg.radius, maxR);

    // serbest nokta bulutu
    this.points = this.fibonacciSphere(this.cfg.points);

    // DIŞ HALKALAR
    this.outerRings = [];
    for (let k=0;k<this.cfg.rings;k++){
      const count = 200;
      const baseTilt  = (Math.random()*2-1) * this.cfg.outerTiltRange;   // X
      const baseTwist = (Math.random()*2-1) * this.cfg.outerTwistRange;  // Z
      const phase     = Math.random() * Math.PI*2;
      const yawOffset = Math.random() * Math.PI*2;
      const speedMul  = 1 + (Math.random()*2-1) * this.cfg.ringSpeedVar; // 0.6..1.4
      const ampX = this.cfg.outerPrecessionAmp * (0.6 + Math.random()*0.8);
      const ampZ = this.cfg.outerPrecessionAmp * (0.6 + Math.random()*0.8);

      const baseR = this.R * (1.05 + k*0.045);
      const radius = baseR * (1 + (Math.random()*2-1)*0.02);

      const pts = [];
      for (let i=0;i<count;i++){
        const a = (i/count) * Math.PI*2;
        const jr = radius * (1 + (Math.random()*2-1) * this.cfg.ringPointJitter);
        const thick = radius * this.cfg.ringThick * (Math.random()*2-1);
        const x = Math.cos(a) * jr;
        const y = Math.sin(a) * jr + thick; // hafif kalınlık
        const z = 0;
        pts.push({ x,y,z, seed: Math.random()*10 });
      }

      this.outerRings.push({ pts, baseTilt, baseTwist, phase, yawOffset, speedMul, ampX, ampZ });
    }

    // İÇ HALKALAR
    this.innerRings = [];
    for (let k=0;k<this.cfg.innerRings;k++){
      const count = 140;
      const r = this.R * (0.26 + k*0.09);
      const baseTilt  = (Math.random()*0.7 - 0.35);
      const baseTwist = (Math.random()*0.7 - 0.35);
      const phase = Math.random()*Math.PI*2;
      const pts = [];
      for (let i=0;i<count;i++){
        const a = (i/count) * Math.PI*2;
        pts.push({ x: Math.cos(a)*r, y: 0, z: Math.sin(a)*r, seed: Math.random()*10 });
      }
      this.innerRings.push({ r, pts, baseTilt, baseTwist, phase });
    }
  }

  // easing: easeOutCubic
  ease(k){ return 1 - Math.pow(1 - Math.max(0, Math.min(1,k)), 3); }

  introState(){
    if (!this.intro.active) return { ready:true, scale:1, alpha:1, visible:true };
    const now = performance.now();
    const dt = now - this.intro.startTs;
    if (dt < this.intro.delayMs) return { ready:false, scale:this.intro.scaleFrom, alpha:0, visible:false };
    const k = (dt - this.intro.delayMs) / Math.max(1,this.intro.durationMs);
    const e = this.ease(k);
    const scale = this.intro.scaleFrom + (1 - this.intro.scaleFrom)*e;
    const alpha = this.intro.alphaFrom + (1 - this.intro.alphaFrom)*e;
    if (k >= 1){ this.intro.active = false; }
    return { ready:true, scale, alpha, visible:true };
  }

  project(x,y,z, R){
    const f = R * 2.4;
    const scale = f / (f + z + R);
    return { X: this.w/2 + x*scale, Y: this.h/2 + y*scale, S: scale };
  }

  clear(){ this.ctx.clearRect(0,0,this.w,this.h); }

  draw(){
    const g = this.ctx, cfg = this.cfg;
    const intro = this.introState();

    // intro gecikmesinde hiç çizme (tamamen boş)
    if (!intro.visible){ this.clear(); return; }

    // çizim parametreleri
    const s = intro.scale;        // ölçek (0.72..1)
    const R = this.R * s;         // efektif yarıçap
    const baseAlpha = intro.alpha; // global alpha çarpanı

    this.clear();
    g.save();
    g.globalAlpha *= baseAlpha;

    // enerji aureole
    const grd = g.createRadialGradient(this.w/2, this.h/2, R*0.3, this.w/2, this.h/2, R*1.35);
    grd.addColorStop(0, 'rgba(80,120,255,0.12)');
    grd.addColorStop(0.6, 'rgba(80,120,255,0.06)');
    grd.addColorStop(1, 'rgba(80,120,255,0.00)');
    g.fillStyle = grd; g.beginPath(); g.arc(this.w/2, this.h/2, R*1.35, 0, Math.PI*2); g.fill();

    const yaw   = this.t * cfg.speed;           // genel dönme (Y)
    const pitch = this.t * cfg.speed * 0.6;     // hafif X

    /* ---------- SERBEST NOKTA BULUTU ---------- */
    const pathFar = new Path2D(), pathMid = new Path2D(), pathNear = new Path2D();
    const sizeBase = cfg.dotSize;

    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cx = Math.cos(pitch), sx = Math.sin(pitch);

    for (const p of this.points){
      let x = p.x*R, y = p.y*R, z = p.z*R;
      const jitter = 1 + cfg.noise * Math.sin(this.t*0.9 + p.seed);
      x*=jitter; y*=jitter; z*=jitter;

      // Y + X rotasyon
      let nx =  x*cy + z*sy;
      let nz = -x*sy + z*cy;
      let ny =  y*cx - nz*sx;
      nz     =  y*sx + nz*cx;

      const q = this.project(nx, ny, nz, R);
      const r = (sizeBase * (0.55 + q.S*0.75)) * 0.5;
      const target = q.S < 0.72 ? pathFar : (q.S < 0.9 ? pathMid : pathNear);
      target.moveTo(q.X + r, q.Y);
      target.arc(q.X, q.Y, r, 0, Math.PI*2);
    }
    g.fillStyle = 'rgba(200,220,255,0.55)'; g.fill(pathFar);
    g.fillStyle = 'rgba(200,220,255,0.75)'; g.fill(pathMid);
    g.fillStyle = 'rgba(220,235,255,0.95)'; g.fill(pathNear);

    /* ---------- DIŞ HALKALAR ---------- */
    for (const ring of this.outerRings){
      const ringYaw = this.t * cfg.orbitSpeed * ring.speedMul + ring.yawOffset;
      const tiltX = ring.baseTilt  + Math.sin(this.t*cfg.outerPrecession + ring.phase) * ring.ampX;
      const tiltZ = ring.baseTwist + Math.cos(this.t*cfg.outerPrecession*0.9 + ring.phase) * ring.ampZ;

      const cz = Math.cos(ringYaw*0.9), sz = Math.sin(ringYaw*0.9); // yerel dönme
      const cY = Math.cos(ringYaw), sY = Math.sin(ringYaw);
      const cTx = Math.cos(tiltX), sTx = Math.sin(tiltX);
      const cTz = Math.cos(tiltZ), sTz = Math.sin(tiltZ);
      const cXp = Math.cos((this.t*cfg.speed*0.6)), sXp = Math.sin((this.t*cfg.speed*0.6));

      const path = new Path2D();
      for (const p of ring.pts){
        // p.x/y/z zaten R tabanlı — intro ölçeği uygulayalım
        let x0 = p.x * s, y0 = p.y * s, z0 = p.z * s;

        // 1) halka kendi Z ekseninde
        let x = x0*cz - y0*sz;
        let y = x0*sz + y0*cz;
        let z = z0;

        // 2) Z tilt → X tilt
        let rx =  x*cTz - y*sTz;
        let ry =  x*sTz + y*cTz;
        let rz =  z;
        x = rx; y = ry; z = rz;

        rx =  x;
        ry =  y*cTx - z*sTx;
        rz =  y*sTx + z*cTx;
        x = rx; y = ry; z = rz;

        // 3) sahne dönüşü Y + hafif X
        rx =  x*cY + z*sY;
        rz = -x*sY + z*cY;
        x = rx; z = rz;

        ry =  y*cXp - z*sXp;
        rz =  y*sXp + z*cXp;
        y = ry; z = rz;

        const q = this.project(x, y, z, R);
        const r = sizeBase * (0.42 + q.S*0.65) * 0.5;
        path.moveTo(q.X + r, q.Y);
        path.arc(q.X, q.Y, r, 0, Math.PI*2);
      }
      this.ctx.fillStyle = 'rgba(150,190,255,0.65)';
      this.ctx.fill(path);
    }

    /* ---------- İÇ HALKALAR ---------- */
    const inYaw = this.t * cfg.innerSpeed;
    for (const ring of this.innerRings){
      const tiltX = ring.baseTilt + Math.sin(this.t*cfg.innerPrecession + ring.phase) * 0.35;
      const tiltZ = ring.baseTwist+ Math.cos(this.t*cfg.innerPrecession*1.2 + ring.phase) * 0.35;
      const cTx = Math.cos(tiltX), sTx = Math.sin(tiltX);
      const cTz = Math.cos(tiltZ), sTz = Math.sin(tiltZ);
      const cY  = Math.cos(inYaw),  sY  = Math.sin(inYaw);

      const path = new Path2D();
      for (const p of ring.pts){
        // intro ölçeği
        let x0 = p.x * s, y0 = p.y * s, z0 = p.z * s;

        // Z eğimi
        let x =  x0*cTz - y0*sTz;
        let y =  x0*sTz + y0*cTz;
        let z =  z0;

        // X eğimi
        let rx = x;
        let ry = y*cTx - z*sTx;
        let rz = y*sTx + z*cTx;
        x = rx; y = ry; z = rz;

        // hızlı Y spin
        const nx =  x*cY + z*sY;
        const nz = -x*sY + z*cY;

        const q = this.project(nx, y, nz, R);
        const r = cfg.dotSize * (0.48 + q.S*0.8) * 0.45;
        path.moveTo(q.X + r, q.Y);
        path.arc(q.X, q.Y, r, 0, Math.PI*2);
      }
      this.ctx.fillStyle = 'rgba(220,235,255,0.9)';
      this.ctx.fill(path);
    }

    g.restore();
  }

  loop = () => {
    if (!this.running) return;
    this.t += 0.016; // ~60fps
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  }

  start(cfg){
    this.ensureCanvas();
    this.build(cfg);
    if (!this.running){ this.running = true; this.loop(); }
  }

  stop(){
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.canvas){ this.clear(); }
    window.removeEventListener('resize', this.onResize);
  }
}

let _fx = null;
export function start(cfg){ if (!_fx) _fx = new SphereFX(); _fx.start(cfg); }
export function stop(){ if (_fx){ _fx.stop(); } }
