// Apps/UzakDestek/main.js — WebRTC ekran paylaşımı + tam kontrol + sağlam WS/ICE

export async function mount(container, { ui }) {
  // ---------- Durum ----------
  let ws = null;
  let isHost = false;
  let sessionId = null;
  let pc = null;
  let wsPingTO = null;
  let reconnectTO = null;

  // Kontrol kanalı
  let ctrlDC = null;       // RTCDataChannel
  let screenSize = null;   // Host ekran ölçüsü (inputAgent'tan)

  // LAN relay adresin
  let serverAddress = 'ws://192.168.16.170:8081';

  // ---------- UI ----------
  container.innerHTML = `
    <div class="uzak-destek-app">
      <div class="connection-ui">
        <div class="card">
          <h3>Bağlantı</h3>
          <label>Relay Sunucu</label>
          <input id="server" type="text" placeholder="ws://192.168.1.x:8081"/>
          <button id="save">Adresi Kaydet</button>
        </div>
        <div class="card">
          <h3>Masaüstünü Paylaş (Host)</h3>
          <button id="host">Yeni Oturum Başlat</button>
        </div>
        <div class="card">
          <h3>Bir Oturuma Katıl (Guest)</h3>
          <label>Oturum ID</label>
          <input id="sid" type="text" placeholder="session-xxxxxxx"/>
          <button id="join">Bağlan</button>
        </div>
      </div>

      <div class="session-ui" style="display:none"></div>
    </div>
  `;

  const $ = (s, el = container) => el.querySelector(s);
  const connectionUI = $('.connection-ui');
  const sessionUI    = $('.session-ui');
  const inputServer  = $('#server');
  const btnSave      = $('#save');
  const btnHost      = $('#host');
  const btnJoin      = $('#join');
  const inputSID     = $('#sid');

  inputServer.value = serverAddress;
  btnSave.onclick = () => {
    serverAddress = inputServer.value.trim();
    ui.showAlert({ title: 'Bilgi', message: 'Sunucu adresi kaydedildi.' });
  };

  function setStatus(t) {
    const el = $('.status', sessionUI);
    if (el) el.textContent = t;
  }

  function showHostUI() {
    sessionUI.innerHTML = `
      <div class="session-controls">
        <div class="status">Oturum oluşturuluyor...</div>
        <button id="btn-disconnect">Bağlantıyı Kes</button>
      </div>
      <div class="screen-view">
        <div class="host-notice">
          Oturum ID: <code id="sid-display" title="Kopyala">bekleniyor...</code>
        </div>
      </div>`;
    sessionUI.style.display = 'flex';
    sessionUI.classList.add('active-session');
    connectionUI.style.display = 'none';
    $('#btn-disconnect').onclick = cleanupAll;
    $('#sid-display').onclick = () => {
      const sid = $('#sid-display').textContent.trim();
      navigator.clipboard?.writeText(sid);
      ui.showAlert({ title: 'Bilgi', message: 'Oturum ID panoya kopyalandı.' });
    };
  }

  function showGuestUI() {
    sessionUI.innerHTML = `
      <div class="session-controls">
        <div class="status">Bağlantı bekleniyor...</div>
        <button id="btn-disconnect">Bağlantıyı Kes</button>
      </div>
      <div class="screen-view">
        <video id="remoteVideo" autoplay playsinline style="width:100%;height:100%;background:#000"></video>
      </div>`;
    sessionUI.style.display = 'flex';
    sessionUI.classList.add('active-session');
    connectionUI.style.display = 'none';
    $('#btn-disconnect').onclick = cleanupAll;
  }

  // ---------- WS (heartbeat + reconnect) ----------
  function connectWS() {
    return new Promise((resolve, reject) => {
      try {
        ws = new WebSocket(serverAddress);
      } catch (e) { return reject(e); }

      let opened = false;

      ws.onopen = () => {
        opened = true;
        startHeartbeat();
        resolve();
      };
      ws.onerror = (e) => { if (!opened) reject(e); };
      ws.onclose = () => { stopHeartbeat(); scheduleReconnect(); };
      ws.onmessage = onWSMessage;
    });
  }

  function startHeartbeat() {
    stopHeartbeat();
    wsPingTO = setInterval(() => {
      try { ws?.send(JSON.stringify({ type: 'ping' })); } catch {}
    }, 15000);
  }
  function stopHeartbeat() {
    if (wsPingTO) clearInterval(wsPingTO), wsPingTO = null;
  }

  function scheduleReconnect() {
    if (reconnectTO) return;
    reconnectTO = setTimeout(async () => {
      reconnectTO = null;
      try {
        await connectWS();
        if (sessionId) {
          // Önce mevcut odaya tekrar katıl
          sendWS('join-session', { sessionId });
        } else if (isHost) {
          // Oturum yoksa host yeni oluşturur
          sendWS('create-session');
        }
      } catch {}
    }, 1500);
  }

  function sendWS(type, payload = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, sessionId, ...payload }));
    }
  }

  // ---------- WebRTC yardımcıları ----------
function hookIce(peer){
  peer.oniceconnectionstatechange = async () => {
    const s = peer.iceConnectionState;
    console.log('[ICE]', s);
    if (s === 'failed' || s === 'disconnected') {
      clearTimeout(peer._iceTo);
      peer._iceTo = setTimeout(async ()=>{
        try {
          const offer = await peer.createOffer({ iceRestart: true });
          await peer.setLocalDescription(offer);
          sendWS('signal', { type:'offer', sdp: offer.sdp });
        } catch {}
      }, 1500);
    } else if (s === 'connected' || s === 'completed') {
      clearTimeout(peer._iceTo);
    }
  };
}


function createPeer() {
  pc = new RTCPeerConnection({
    iceServers: [{ urls: ['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302'] }],
  });

  pc.onicecandidate = (e) => {
    if (e.candidate) sendWS('signal', { type:'ice-candidate', candidate: e.candidate });
  };

  pc.ontrack = (ev) => {
    const v = $('#remoteVideo', sessionUI);
    if (v && !v.srcObject) {
      v.srcObject = ev.streams[0];
      // otomatik oynatmayı garanti altına al
      v.play?.().catch(()=>{});
    }
  };

  if (isHost) {
    const dc = pc.createDataChannel('control', { ordered: true });
    ctrlDC = dc;
    dc.onopen = async () => {
      try { screenSize = await window.inputAgent?.getScreenSize(); } catch {}
    };
    dc.onmessage = onControlMessageHost;
  } else {
    // *** YENİ: video alacağımızı açıkça söyle
    try { pc.addTransceiver('video', { direction: 'recvonly' }); } catch {}
    pc.ondatachannel = (ev) => {
      if (ev.channel.label === 'control') {
        ctrlDC = ev.channel;
        enableGuestControlOverlay();
      }
    };
  }

  hookIce(pc);
  return pc;
}


async function startHostStream() {
  console.log('[HOST] startHostStream() çağrıldı');
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: 60, max: 60 },
      width: { ideal: 1920 }, height: { ideal: 1080 },
      displaySurface: 'monitor'
    },
    audio: false
  });

  const vTrack = stream.getVideoTracks()[0];
  try { vTrack.contentHint = 'motion'; } catch {}
  // sendonly yönü zaten addTrack ile oluşur; yine de güvene alalım
  try { pc.addTransceiver(vTrack.kind, { direction: 'sendonly' }); } catch {}

  const sender = pc.addTrack(vTrack, stream);

  // Bitrate sınırı
  try {
    const params = sender.getParameters();
    params.encodings = [{ maxBitrate: 6_000_000 }];
    await sender.setParameters(params);
  } catch {}

  const offer = await pc.createOffer({
    offerToReceiveVideo: false,
    offerToReceiveAudio: false
  });
  await pc.setLocalDescription(offer);
  sendWS('signal', { type:'offer', sdp: offer.sdp });

  vTrack.addEventListener('ended', () => {
    console.log('[HOST] ekran paylaşımı durdu (track ended)');
    setStatus('Paylaşım durdu (kaynak kapandı).');
  });
}


  async function acceptOfferAndAnswer(sdp) {
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendWS('signal', { type: 'answer', sdp: answer.sdp });
  }
  async function acceptAnswer(sdp) {
    await pc.setRemoteDescription({ type: 'answer', sdp });
  }
  async function addIceCandidate(cand) {
    try { await pc.addIceCandidate(cand); } catch {}
  }

  // ---------- WS mesajları ----------
// ---- WS mesajları
async function onWSMessage(ev) {
  let msg;
  try {
    msg = JSON.parse(ev.data);
  } catch (e) {
    console.warn('[WS] kötü JSON', e);
    return;
  }

  console.log('[WS msg]', msg.type);

  switch (msg.type) {
    case 'session-created':
      sessionId = msg.sessionId;
      const sidEl = $('#sid-display', sessionUI);
      if (sidEl) sidEl.textContent = sessionId;
      setStatus('Misafir bekleniyor...');
      // DİKKAT: burada ekran paylaşımı başlatmıyoruz
      break;

    case 'session-joined':
      setStatus('Misafir katıldı. Akış başlatılıyor...');
      if (!pc) createPeer();
      try {
        await startHostStream();
      } catch (e) {
        ui.showAlert({ title: 'Ekran paylaşımı başlamadı', message: e?.message || String(e) });
        // WS’yi kapatma
      }
      break;

    case 'join-success':
      setStatus('Bağlandı. Akış bekleniyor...');
      if (!pc) createPeer();
      break;

    case 'signal': {
      const p = msg.payload;
      if (!pc) return;
      if (p.type === 'offer')       await acceptOfferAndAnswer(p.sdp);
      else if (p.type === 'answer') await acceptAnswer(p.sdp);
      else if (p.type === 'ice-candidate') await addIceCandidate(p.candidate);
      break;
    }

    case 'user-disconnected':
      setStatus('Diğer kullanıcı ayrıldı.');
      cleanupPeerOnly();
      break;

    case 'error':
      if (/Oturum bulunamadı/i.test(msg.message || '')) {
        if (isHost) {
          sendWS('create-session');
          setStatus('Oturum yenilendi. Yeni ID ekranda.');
        } else {
          setStatus('Oturum bulunamadı. Host’tan yeni ID isteyin.');
          ui.showAlert({ title: 'Bağlantı', message: 'Oturum sona ermiş. Host yeni ID oluşturmalı.' });
        }
      } else {
        ui.showAlert({ title: 'Hata', message: msg.message || 'Bilinmeyen hata' });
      }
      break;

    case 'pong':
      // heartbeat yanıtı
      break;
  }
}


  // ---------- Kontrol (Host tarafında OS input) ----------
  async function onControlMessageHost(ev) {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (!window.inputAgent) return;

    if (!screenSize) {
      try { screenSize = await window.inputAgent.getScreenSize(); } catch {}
    }

    const toAbs = (nx, ny) => {
      if (screenSize && typeof nx === 'number' && typeof ny === 'number') {
        const x = Math.max(0, Math.min(screenSize.width  - 1, Math.round(nx * screenSize.width)));
        const y = Math.max(0, Math.min(screenSize.height - 1, Math.round(ny * screenSize.height)));
        return { x, y };
      }
      return { x: m.x ?? 0, y: m.y ?? 0 };
    };

    switch (m.t) {
      case 'move': {
        const { x, y } = toAbs(m.nx, m.ny);
        await window.inputAgent.move(x, y);
        break;
      }
      case 'down': {
        await window.inputAgent.down(m.btn || 'left');
        break;
      }
      case 'up': {
        await window.inputAgent.up(m.btn || 'left');
        break;
      }
      case 'click': {
        const { x, y } = toAbs(m.nx, m.ny);
        await window.inputAgent.move(x, y);
        await window.inputAgent.click(m.btn || 'left');
        break;
      }
      case 'dblclick': {
        const { x, y } = toAbs(m.nx, m.ny);
        await window.inputAgent.move(x, y);
        await window.inputAgent.click(m.btn || 'left');
        await window.inputAgent.click(m.btn || 'left');
        break;
      }
      case 'wheel': {
        const stepY = Math.sign(m.dy) * Math.min(10, Math.ceil(Math.abs(m.dy) / 50));
        const stepX = Math.sign(m.dx) * Math.min(10, Math.ceil(Math.abs(m.dx) / 50));
        await window.inputAgent.scroll(stepX, stepY);
        break;
      }
      case 'keyDown': {
        await window.inputAgent.keyDown(m.key);
        break;
      }
      case 'keyUp': {
        await window.inputAgent.keyUp(m.key);
        break;
      }
      case 'type': {
        await window.inputAgent.typeText(m.text || '');
        break;
      }
    }
  }

  // ---------- Guest: video üstü görünmez overlay ----------
  function enableGuestControlOverlay() {
    const view = $('.screen-view', sessionUI);
    if (!view) return;

    let overlay = document.getElementById('remote-control-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'remote-control-overlay';
      Object.assign(overlay.style, {
        position: 'absolute', inset: 0, zIndex: 5,
        cursor: 'none', background: 'transparent'
      });
      view.appendChild(overlay);
    }

    const video = $('#remoteVideo', sessionUI);
    const getNorm = (e) => {
      const r = video.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top)  / r.height;
      return { nx: Math.max(0, Math.min(1, nx)), ny: Math.max(0, Math.min(1, ny)) };
    };

    const sendCtrl = (obj) => {
      if (ctrlDC && ctrlDC.readyState === 'open') ctrlDC.send(JSON.stringify(obj));
    };

    overlay.addEventListener('pointermove', (e) => {
      const { nx, ny } = getNorm(e); sendCtrl({ t: 'move', nx, ny });
    }, { passive: true });

    overlay.addEventListener('pointerdown', (e) => {
      const { nx, ny } = getNorm(e);
      const btn = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
      sendCtrl({ t: 'down', btn, nx, ny });
    });

    overlay.addEventListener('pointerup', (e) => {
      const { nx, ny } = getNorm(e);
      const btn = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
      sendCtrl({ t: 'up', btn, nx, ny });
    });

    overlay.addEventListener('click', (e) => {
      const { nx, ny } = getNorm(e);
      sendCtrl({ t: 'click', btn: 'left', nx, ny });
    });

    overlay.addEventListener('dblclick', (e) => {
      const { nx, ny } = getNorm(e);
      sendCtrl({ t: 'dblclick', btn: 'left', nx, ny });
    });

    overlay.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const { nx, ny } = getNorm(e);
      sendCtrl({ t: 'click', btn: 'right', nx, ny });
    });

    overlay.addEventListener('wheel', (e) => {
      sendCtrl({ t: 'wheel', dx: e.deltaX, dy: e.deltaY });
    }, { passive: true });

    // Klavye
    overlay.tabIndex = 0;
    overlay.focus();
    overlay.addEventListener('keydown', (e) => {
      sendCtrl({ t: 'keyDown', key: e.key });
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        sendCtrl({ t: 'type', text: e.key });
      }
      e.preventDefault();
    });
    overlay.addEventListener('keyup', (e) => {
      sendCtrl({ t: 'keyUp', key: e.key });
      e.preventDefault();
    });
  }

  // ---------- Temizlik ----------
  function cleanupPeerOnly() {
    try {
      if (pc) {
        pc.getSenders()?.forEach(s => { try { s.track?.stop(); } catch {} });
        pc.getReceivers()?.forEach(r => { try { r.track?.stop(); } catch {} });
        pc.close();
      }
    } catch {}
    pc = null;
    ctrlDC = null;
    const v = $('#remoteVideo', sessionUI); if (v) v.srcObject = null;
  }

  function cleanupAll() {
    cleanupPeerOnly();
    try { ws?.close(); } catch {}
    ws = null;
    if (wsPingTO) clearInterval(wsPingTO), wsPingTO = null;
    if (reconnectTO) clearTimeout(reconnectTO), reconnectTO = null;
    sessionId = null;

    sessionUI.classList.remove('active-session');
    sessionUI.innerHTML = '';
    sessionUI.style.display = 'none';
    connectionUI.style.display = '';
  }

  // ---------- Butonlar ----------
  btnHost.onclick = async () => {
    isHost = true;
    showHostUI();
    try {
      await connectWS();
      sendWS('create-session');
    } catch (e) {
      ui.showAlert({ title: 'Bağlantı Hatası', message: 'Relay sunucuya bağlanılamadı.' });
      cleanupAll();
    }
  };

  btnJoin.onclick = async () => {
    isHost = false;
    sessionId = inputSID.value.trim();
    if (!sessionId) return ui.showAlert({ title: 'Giriş Gerekli', message: 'Oturum ID girin.' });

    showGuestUI();
    try {
      await connectWS();
      sendWS('join-session', { sessionId });
    } catch (e) {
      ui.showAlert({ title: 'Bağlantı Hatası', message: 'Relay sunucuya bağlanılamadı.' });
      cleanupAll();
    }
  };
}
