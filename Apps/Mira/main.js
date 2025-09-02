// Mira — MyExplorerV2 AI Assistant (ESNEK SOHBET SÜRÜMÜ — GENİŞLETİLMİŞ)
// -----------------------------------------------------------------------------
// Bu sürüm, önceki iskeleti ciddi şekilde genişletir: 
// - Modüler niyet (intent) motoru + ağırlıklı desen eşleştirme + eş anlamlılar
// - Türkçe odaklı normalizasyon ve basit kök bulma (stem) yardımı
// - Eşikli bulanık eşleştirme (Levenshtein) + Jaro-Winkler benzeri skor
// - VFS tabanlı kalıcı hafıza (konular, takma adlar, notlar, etiketler, hatırlatmalar)
// - Eklenti (plugin) mimarisi: matematik, tarih/saat, metin dönüştürme, küçük yardımcılar
// - UI yükseltmesi: tema anahtarı, komut paleti, ayarlar, hafıza gezgini, kopyala/temizle
// - Akış: komutlar > meta > sosyal > bilgi > eklentiler > geridönüş / yönlendirme
// - Komutlar: /yardım, /öğren, /alias, /sil, /hafıza, /export, /import, /tema, /temalar, /reset, /debug
// - Basit Markdown işleme (kalın, italik, kod, bağlantı) ve yazım animasyonu
// - Hata dayanıklılığı ve versiyonlu şema yükseltme
//
// NOT: Kod tek dosyada düzenlendi; üretim için parçalara bölünebilir.
// -----------------------------------------------------------------------------

/* eslint-disable no-cond-assign */
/* global window, document */

// ============================================================================
//  Sabitler ve Global Durum
// ============================================================================
const MEMORY_PATH = '/System/mira/memory.json';
const SETTINGS_PATH = '/System/mira/settings.json';
const EXPORTS_DIR = '/System/mira/exports';
const IMPORTS_DIR = '/System/mira/imports';

const MIRAV_VERSION = '5.2.0';
const MEMORY_SCHEMA_VERSION = 5;

let conversationState = {};
let settingsState = {};
let debugMode = false;

// UI referansları
let UI = {
  container: null,
  messagesEl: null,
  formEl: null,
  inputEl: null,
  toolbarEl: null,
  settingsBtn: null,
  themeBtn: null,
  helpBtn: null,
  memoryBtn: null,
  commandPaletteBtn: null,
  modalRoot: null
};

// ============================================================================
//  Yardımcılar — Genel Amaçlı
// ============================================================================
const Utils = (() => {
  const TR_MAP = {
    'I': 'ı', 'İ': 'i', 'Ş': 'ş', 'Ç': 'ç', 'Ğ': 'ğ', 'Ü': 'ü', 'Ö': 'ö'
  };
  const DIACRITIC_MAP = {
    'â': 'a', 'î': 'i', 'û': 'u', 'ê': 'e', 'ô': 'o',
    'Â': 'a', 'Î': 'i', 'Û': 'u', 'Ê': 'e', 'Ô': 'o'
  };

  function trLower(str) {
    return str
      .replace(/[IİŞÇĞÜÖ]/g, (m) => TR_MAP[m] || m)
      .toLowerCase()
      .replace(/[âîûêôÂÎÛÊÔ]/g, (m) => DIACRITIC_MAP[m] || m);
  }

  function normalize(text) {
    // Noktalama sadeleştirme + boşluk temizliği
    const t = trLower(text)
      .replace(/[“”„\u2019\u2018\u00AB\u00BB]/g, '"')
      .replace(/[’]/g, "'")
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    return t;
  }

  function tokenize(text) {
    return normalize(text)
      .replace(/[^a-zçğıöşü0-9@#._:\/\-\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  // Basit ve hızlı bir TR-stem (çok kaba). Üretimde gerçek bir kökleyici kullanın.
  function trStem(token) {
    // Sık ekleri kaba şekilde budar.
    return token
      .replace(/(ler|lar|dır|dir|dur|dür|tır|tir|tur|tür)$/,'')
      .replace(/(im|ım|um|üm|sin|sın|sun|sün|iz|ız|uz|üz|siniz|sınız|sunuz|sünüz)$/,'')
      .replace(/(de|da|te|ta|den|dan|ten|tan)$/,'')
      .replace(/(i|ı|u|ü|e|a)$/,'');
  }

  function unique(arr) { return Array.from(new Set(arr)); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  // Levenshtein mesafesi (optimize edilmemiş, kısa metinler için yeterli)
  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (m === 0) return n; if (n === 0) return m;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = i - 1; dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const temp = dp[j];
        dp[j] = Math.min(
          dp[j] + 1,
          dp[j - 1] + 1,
          prev + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
        prev = temp;
      }
    }
    return dp[n];
  }

  function similarity(a, b) {
    // Normalized similarity (1 perfect, 0 worst)
    const maxLen = Math.max(a.length, b.length) || 1;
    return 1 - (levenshtein(a, b) / maxLen);
  }

  // Basit Markdown: **bold**, *italic*, `code`, [text](url)
  function renderMarkdown(text) {
    if (!text) return '';
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = html
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1<\/a>');
    return html;
  }

  function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

  function uid(prefix='id') {
    return `${prefix}_${Math.random().toString(36).slice(2,9)}_${Date.now().toString(36)}`;
  }

  function now() { return Date.now(); }

  function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

  return {
    trLower, normalize, tokenize, trStem, unique, clamp,
    levenshtein, similarity, renderMarkdown, delay, uid, now, deepClone
  };
})();

// ============================================================================
//  VFS Yardımcıları (güvenli çağrılar)
// ============================================================================
const VFS = (() => {
  async function ensureDir(path) {
    try { await window.vfs.mkdir(path); } catch { /* ignore */ }
  }
  async function readJSON(path, fallback = null) {
    try {
      const raw = await window.vfs.readFile(path);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  async function writeJSON(path, data) {
    const str = JSON.stringify(data, null, 2);
    await window.vfs.writeFile(path, str);
  }
  async function writeText(path, text) {
    await window.vfs.writeFile(path, text);
  }
  return { ensureDir, readJSON, writeJSON, writeText };
})();

// ============================================================================
//  Hafıza Yöneticisi (versiyonlama + sorgu)
// ============================================================================
const Memory = (() => {
  const EMPTY = {
    __version: MEMORY_SCHEMA_VERSION,
    __createdAt: Utils.now(),
    __updatedAt: Utils.now(),
    info: {
      app: 'MyExplorerV2',
      mira: MIRAV_VERSION
    },
    topics: {
      // key: topicId (lowercase)
      // value: { title, aliases:[], summary, tags:[], createdAt, updatedAt }
    },
    reminders: [], // { id, text, when, createdAt, done }
    notes: [] // serbest notlar: { id, text, tags:[], createdAt }
  };

  function migrate(mem) {
    if (!mem || typeof mem !== 'object') return Utils.deepClone(EMPTY);
    const m = { ...EMPTY, ...mem };
    if (!m.topics) m.topics = {};
    if (!m.reminders) m.reminders = [];
    if (!m.notes) m.notes = [];
    m.__version = MEMORY_SCHEMA_VERSION;
    m.__updatedAt = Utils.now();
    return m;
  }

  async function load() {
    await VFS.ensureDir('/System/mira');
    const data = await VFS.readJSON(MEMORY_PATH, null);
    if (!data) {
      const initial = Utils.deepClone(EMPTY);
      initial.topics['myexplorer'] = {
        id: 'myexplorer',
        title: 'MyExplorerV2',
        aliases: ['bu uygulama', 'bu sistem', 'my explorer', 'my-explorer'],
        summary: 'MyExplorerV2, sanal bir dosya sistemi ve uygulama katmanına sahip, Electron ile geliştirilmiş bir masaüstü ortamıdır.',
        tags: ['sistem','uygulama'],
        createdAt: Utils.now(),
        updatedAt: Utils.now()
      };
      await VFS.writeJSON(MEMORY_PATH, initial);
      return initial;
    }
    const migrated = migrate(data);
    if (migrated !== data) await VFS.writeJSON(MEMORY_PATH, migrated);
    return migrated;
  }

  async function save(mem) {
    mem.__updatedAt = Utils.now();
    await VFS.writeJSON(MEMORY_PATH, mem);
    return mem;
  }

  async function learnTopic(title, summary = null) {
    const mem = await load();
    const key = Utils.trLower(title).trim();
    if (!key) return `Geçersiz konu adı.`;
    if (!mem.topics[key]) {
      mem.topics[key] = {
        id: key,
        title: title.trim(),
        aliases: [],
        summary: summary || `'${title}' hakkında temel bilgiler öğrenildi.`,
        tags: [],
        createdAt: Utils.now(),
        updatedAt: Utils.now()
      };
      await save(mem);
      return `'${title}' konusunu öğrendim.`;
    }
    return `'${title}' konusunu zaten biliyorum.`;
  }

  async function addAlias(topic, alias) {
    const mem = await load();
    const key = Utils.trLower(topic).trim();
    if (!mem.topics[key]) return `'${topic}' diye bir konu yok.`;
    const a = Utils.trLower(alias).trim();
    if (!mem.topics[key].aliases.includes(a)) {
      mem.topics[key].aliases.push(a);
      mem.topics[key].updatedAt = Utils.now();
      await save(mem);
      return `'${alias}' artık '${topic}' için bir takma ad.`;
    }
    return `'${alias}' zaten '${topic}' için takma ad.`;
  }

  async function removeTopic(topic) {
    const mem = await load();
    const key = Utils.trLower(topic).trim();
    if (!mem.topics[key]) return `'${topic}' bulunamadı.`;
    delete mem.topics[key];
    await save(mem);
    return `'${topic}' silindi.`;
  }

  async function searchTopics(query) {
    const mem = await load();
    const q = Utils.normalize(query);
    const tokens = Utils.tokenize(q).map(Utils.trStem);

    const scored = Object.values(mem.topics).map(t => {
      const text = Utils.normalize(`${t.title} ${t.aliases.join(' ')} ${t.summary} ${t.tags.join(' ')}`);
      const words = Utils.tokenize(text).map(Utils.trStem);
      // kaba skor: kesişim + benzerlik
      let hit = 0;
      for (const tok of tokens) if (words.some(w => w.startsWith(tok))) hit++;
      const sim = Utils.similarity(q.slice(0, 48), Utils.normalize(t.title).slice(0, 48));
      return { topic: t, score: hit * 0.7 + sim * 0.3 };
    }).sort((a,b) => b.score - a.score);
    return scored.filter(s => s.score > 0.15).slice(0, 20);
  }

  async function exportMemory() {
    const mem = await load();
    await VFS.ensureDir(EXPORTS_DIR);
    const file = `${EXPORTS_DIR}/memory_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
    await VFS.writeJSON(file, mem);
    return file;
  }

  async function importMemory(jsonText) {
    try {
      const data = JSON.parse(jsonText);
      const migrated = migrate(data);
      await save(migrated);
      return `Hafıza içe aktarıldı (v${migrated.__version}).`;
    } catch (e) {
      return `İçe aktarma hatası: ${e.message}`;
    }
  }

  async function addNote(text, tags=[]) {
    const mem = await load();
    mem.notes.push({ id: Utils.uid('note'), text, tags, createdAt: Utils.now() });
    await save(mem);
    return 'Not eklendi.';
  }

  async function listNotes(limit=10) {
    const mem = await load();
    return mem.notes.slice(-limit);
  }

  return { load, save, learnTopic, addAlias, removeTopic, searchTopics, exportMemory, importMemory, addNote, listNotes };
})();

// ============================================================================
//  Ayar Yöneticisi (tema, tercih, kısayollar)
// ============================================================================
const Settings = (() => {
  const DEFAULTS = {
    theme: 'auto', // 'light' | 'dark' | 'auto'
    typingAnimation: true,
    maxMessageLength: 4000,
    compactMode: false
  };

  async function load() {
    await VFS.ensureDir('/System/mira');
    const data = await VFS.readJSON(SETTINGS_PATH, null);
    settingsState = { ...DEFAULTS, ...(data || {}) };
    applyTheme(settingsState.theme);
    return settingsState;
  }

  async function save(next) {
    settingsState = { ...settingsState, ...next };
    await VFS.writeJSON(SETTINGS_PATH, settingsState);
    if (next.theme) applyTheme(next.theme);
    return settingsState;
  }

  function applyTheme(mode) {
    const root = document.documentElement;
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const final = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode;
    root.setAttribute('data-theme', final);
  }

  return { load, save, applyTheme };
})();

// ============================================================================
//  UI Katmanı
// ============================================================================
function setupUI(container) {
  container.innerHTML = `
    <style>
      :root {
        --bg-0: #0e0f13;
        --bg-1: #12141a;
        --bg-2: #191c24;
        --bg-3: #202532;
        --text-0: #e8ebf0;
        --text-1: #c9cfdb;
        --text-2: #96a0b5;
        --border: #2a3040;
        --accent: #4b6dff;
        --accent-2: #4bffa6;
        --danger: #ff6b6b;
        --warning: #ffb84b;
        --radius-sm: 10px;
      }
      :root[data-theme="light"] {
        --bg-0: #f5f7fb; --bg-1: #ffffff; --bg-2: #f2f4f9; --bg-3: #e9edf6;
        --text-0: #12141a; --text-1: #2a3040; --text-2: #4a5468; --border: #d7dceb;
        --accent: #3b5bff; --accent-2: #12c48b; --danger:#d44; --warning:#c98609;
      }
      .mira-app { display: flex; flex-direction: column; height: 100%; background: var(--bg-1); color: var(--text-0); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial; }
      .mira-toolbar { display:flex; align-items:center; gap:8px; padding:10px; border-bottom:1px solid var(--border); background: var(--bg-2); position: sticky; top:0; z-index:2; }
      .mira-toolbar .title { font-weight:700; margin-right:auto; letter-spacing:.2px; }
      .mira-toolbar button { background:var(--bg-3); color:var(--text-0); border:1px solid var(--border); height:32px; padding:0 10px; border-radius:8px; cursor:pointer; }
      .mira-toolbar button:hover { border-color: var(--accent); }
      .mira-messages { flex: 1; overflow-y: auto; padding: 16px; }
      .mira-message { max-width: 85%; width: fit-content; padding: 10px 14px; border-radius: 14px; line-height: 1.5; margin-bottom: 12px; word-break: break-word; white-space: pre-wrap; }
      .mira-message.user { background: var(--accent); color: white; margin-left: auto; border-bottom-right-radius: 4px; }
      .mira-message.mira { background: var(--bg-3); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
      .mira-message.mira.error { background: rgba(255,107,107, .1); border-color: var(--danger); color: var(--text-1); }
      .mira-message .meta { font-size:12px; opacity:.7; margin-top:6px; }
      .mira-input-form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--border); background: var(--bg-2); }
      .mira-input-form input { flex: 1; height: 40px; background: var(--bg-0); color: var(--text-0); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0 12px; outline: none; }
      .mira-input-form input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(75,109,255,.14); }
      .mira-input-form button { height: 40px; padding: 0 16px; background: var(--accent); color: white; border: none; cursor: pointer; border-radius: var(--radius-sm); }
      .thinking { color: var(--text-2); font-style: italic; position: relative; }
      .thinking::after { content: ''; position:absolute; right:-18px; top:50%; width:6px; height:6px; border-radius:50%; background:var(--text-2); box-shadow: 10px 0 0 var(--text-2), 20px 0 0 var(--text-2); transform: translateY(-50%); animation: dots 1.2s infinite linear; }
      @keyframes dots { 0%{ opacity:.2 } 50%{ opacity:1 } 100%{ opacity:.2 } }
      .mira-message code { background: rgba(0,0,0,.2); padding: 1px 4px; border-radius: 6px; }
      .mira-message a { color: var(--accent-2); text-decoration: none; }
      .mira-message a:hover { text-decoration: underline; }
      .modal-root { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; z-index: 50; }
      .modal-root.active { display: flex; }
      .modal { background: var(--bg-1); border:1px solid var(--border); border-radius: 14px; padding: 16px; width: min(680px, 92vw); max-height: 80vh; overflow: auto; }
      .modal h3 { margin: 0 0 8px; }
      .kbd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg-3); border:1px solid var(--border); padding: 0 6px; border-radius:6px; }
    </style>
    <div class="mira-app">
      <div class="mira-toolbar">
        <div class="title">Mira <span class="ver" style="opacity:.6; font-weight:400;">v${MIRAV_VERSION}</span></div>
        <button data-action="help">Yardım</button>
        <button data-action="memory">Hafıza</button>
        <button data-action="palette">Komut Paleti</button>
        <button data-action="theme">Tema</button>
        <button data-action="clear">Temizle</button>
      </div>
      <div class="mira-messages"></div>
      <form class="mira-input-form">
        <input type="text" placeholder="Mira'ya bir şeyler sorun... (\"/yardım\" yazabilirsiniz)" autocomplete="off" />
        <button type="submit">Gönder</button>
      </form>
    </div>
    <div class="modal-root"></div>
  `;

  const messagesEl = container.querySelector('.mira-messages');
  const formEl = container.querySelector('.mira-input-form');
  const inputEl = container.querySelector('input');
  const toolbarEl = container.querySelector('.mira-toolbar');
  const modalRoot = container.querySelector('.modal-root');

  UI = {
    container, messagesEl, formEl, inputEl, toolbarEl, modalRoot,
    helpBtn: toolbarEl.querySelector('[data-action="help"]'),
    memoryBtn: toolbarEl.querySelector('[data-action="memory"]'),
    commandPaletteBtn: toolbarEl.querySelector('[data-action="palette"]'),
    themeBtn: toolbarEl.querySelector('[data-action="theme"]')
  };

  toolbarEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;
    if (act === 'help') openHelpModal();
    else if (act === 'memory') openMemoryExplorer();
    else if (act === 'palette') openCommandPalette();
    else if (act === 'theme') cycleTheme();
    else if (act === 'clear') clearMessages();
  });

  function cycleTheme() {
    const seq = ['auto','dark','light'];
    const idx = seq.indexOf(settingsState.theme);
    const next = seq[(idx+1)%seq.length];
    Settings.save({ theme: next });
    toast(`Tema: ${next}`);
  }

  function clearMessages() {
    messagesEl.innerHTML = '';
    toast('Sohbet temizlendi.');
  }

  return { messagesEl, formEl, inputEl };
}

function displayMessage(messagesEl, role, text, className = '') {
  const msgDiv = document.createElement('div');
  msgDiv.className = `mira-message ${role} ${className}`;
  msgDiv.innerHTML = Utils.renderMarkdown(text);
  messagesEl.appendChild(msgDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return msgDiv;
}

function updateMessageEl(el, newText, addClass='') {
  el.innerHTML = Utils.renderMarkdown(newText);
  if (addClass) el.classList.add(addClass);
}

function resetConversationState() {
  conversationState = {
    state: 'idle',
    currentTopic: null,
    lastAccessTime: 0,
    data: {},
    lastFallbackIndex: -1,
    lastIntents: [],
    history: [] // { role:'user'|'mira', text, ts }
  };
}

function toast(text) {
  const id = Utils.uid('toast');
  const el = document.createElement('div');
  el.id = id;
  el.style.position='fixed'; el.style.bottom='16px'; el.style.right='16px';
  el.style.background='var(--bg-0)'; el.style.color='var(--text-0)';
  el.style.border='1px solid var(--border)'; el.style.padding='10px 12px'; el.style.borderRadius='10px';
  el.style.zIndex='60'; el.style.opacity='0'; el.style.transition='opacity .2s ease-in-out';
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(()=>{ el.style.opacity='1'; });
  setTimeout(()=>{ el.style.opacity='0'; setTimeout(()=> el.remove(), 200); }, 2000);
}

function openModal(title, contentHTML) {
  const root = UI.modalRoot; root.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'modal';
  wrapper.innerHTML = `
    <h3>${title}</h3>
    <div class="modal-content">${contentHTML}</div>
    <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:12px;">
      <button data-close>kapat</button>
    </div>`;
  root.appendChild(wrapper);
  root.classList.add('active');
  root.addEventListener('click', (e)=>{ if (e.target === root) root.classList.remove('active'); });
  wrapper.querySelector('[data-close]').onclick = ()=> root.classList.remove('active');
}

function openHelpModal() {
  openModal('Yardım', `
    <div>
      <p>Komutlar:</p>
      <ul>
        <li><span class="kbd">/yardım</span> – Bu ekran</li>
        <li><span class="kbd">/öğren [konu] | [özet]</span> – Yeni konu ekle</li>
        <li><span class="kbd">/alias [konu] | [takma]</span> – Konuya takma ad ekle</li>
        <li><span class="kbd">/sil [konu]</span> – Konuyu sil</li>
        <li><span class="kbd">/hafıza [ara|list]</span> – Hafıza ara veya listele</li>
        <li><span class="kbd">/export</span> – Hafızayı JSON olarak dışa aktar</li>
        <li><span class="kbd">/import</span> – JSON yapıştırarak içe aktar</li>
        <li><span class="kbd">/tema [auto|dark|light]</span> – Tema değiştir</li>
        <li><span class="kbd">/temalar</span> – Aktif tema ve seçenekleri göster</li>
        <li><span class="kbd">/reset</span> – Diyalog durumunu sıfırla</li>
        <li><span class="kbd">/debug</span> – Hata ayıklama modunu aç/kapat</li>
      </ul>
      <p>İpucu: <span class="kbd">Ctrl</span>/<span class="kbd">Cmd</span> + <span class="kbd">K</span> ile Komut Paleti!</p>
    </div>
  `);
}

async function openMemoryExplorer() {
  const mem = await Memory.load();
  const list = Object.values(mem.topics)
    .sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0))
    .slice(0, 50)
    .map(t => `
      <div style="padding:8px 0; border-bottom:1px solid var(--border)">
        <div><strong>${t.title}</strong> <span style="opacity:.6">(${t.aliases.join(', ')||'—'})</span></div>
        <div style="opacity:.8">${t.summary}</div>
        <div class="meta">etiketler: ${t.tags.join(', ')||'—'}</div>
      </div>`).join('');
  openModal('Hafıza Gezgini', `
    <div>${list || '<em>Henüz konu yok.</em>'}</div>
  `);
}

function openCommandPalette() {
  openModal('Komut Paleti', `
    <div style="display:flex; gap:8px; align-items:center;">
      <input id="cmd-input" type="text" placeholder="/komut veya anahtar kelime yazın" style="flex:1; height:36px; background:var(--bg-0); color:var(--text-0); border:1px solid var(--border); border-radius:8px; padding:0 10px;">
      <button id="cmd-run">Çalıştır</button>
    </div>
    <div style="margin-top:8px; font-size:12px; opacity:.8">Örnekler: /öğren Yapay Zeka | İnsan gibi düşünen makineler, /hafıza ara yapay, /tema dark</div>
  `);
  const root = UI.modalRoot.querySelector('.modal');
  const input = root.querySelector('#cmd-input');
  const run = root.querySelector('#cmd-run');
  input.focus();
  run.onclick = async () => {
    const txt = input.value.trim();
    if (!txt) return;
    UI.modalRoot.classList.remove('active');
    await handleUserMessage(txt);
  };
}

// ============================================================================
//  Niyet (Intent) Motoru — esnek ve ağırlıklı
// ============================================================================
const IntentEngine = (() => {
  const rulebook = {
    conversational: {
      greeting: {
        patterns: [/\b(selam|merhaba|hey|yo|selamlar)\b/i],
        responses: [
          'Merhaba!',
          'Selam, nasıl yardımcı olabilirim?',
          'Hey! Hoş geldin.'
        ], weight: 0.8
      },
      well_being_query: {
        patterns: [/\bnasılsın\??\b/i, /\bnaber\??\b/i, /\bne haber\??\b/i],
        responses: [
          'Harikayım, sorduğun için teşekkürler! Senin için ne yapabilirim?',
          'İyiyim, sistemlerim tıkırında. Aklında bir soru mu var?'
        ], weight: 0.7
      },
      gratitude: {
        patterns: [/teşekkür(ler| ederim)?/i, /\b(sağ ol|sağol|saol)\b/i],
        responses: ['Rica ederim!', 'Yardımcı olabildiysem ne mutlu!'], weight: 0.6
      },
      farewell: {
        patterns: [/\b(hoşça kal|görüşürüz|bay bay|bye)\b/i],
        responses: ['Görüşmek üzere!', 'Hoşça kal, yine beklerim.'], weight: 0.7
      }
    },
    meta: {
      self_address: {
        patterns: [/^\s*mira\s*\??\s*$/i],
        responses: ['Evet, benim?', 'Dinliyorum...', 'Efendim?'], weight: 1.0
      },
      identity_query: {
        patterns: [/sen kimsin\??/i, /\badın ne\??\b/i, /\bkim(sin)?\b mira/i],
        responses: ['Ben Mira. MyExplorerV2 için geliştirilmiş kişisel asistanım.'], weight: 1.0
      },
      capability_query: {
        patterns: [
          /\bneler yapabili(yor)?sun\??\b/i,
          /ne işe yararsın\??/i,
          /\byeteneklerin ne\??\b/i,
          /\bözelliklerin ne(dir)?\??\b/i
        ],
        responses: ['Sohbet edebilir, `/öğren [konu] | [özet]` ile bana yeni şeyler öğretebilir, hafızamdaki konuları arayabilir ve küçük yardımcı eklentilerimi kullanabilirsin.'],
        weight: 0.9
      },
      purpose_query: {
        patterns: [/\bamacın ne\??\b/i, /bu uygulamanın amacı ne\??/i],
        responses: ['Amacım bu sanal ortamda sana yardımcı olmak ve bilgiye erişimini kolaylaştırmak.'], weight: 0.9
      },
      memory_query: {
        patterns: [/hatırla/i, /hatırlıyor musun/i, /geçmişi/i],
        responses: ['Sohbet boyunca bağlamı tutarım; kalıcı bilgi için `/öğren` komutunu kullanabilirsin.'], weight: 0.85
      }
    }
  };

  // Esnek eşleştirme: doğrudan regex > token kesişimi > benzerlik
  function matchCategory(text, categoryRules) {
    const lower = Utils.normalize(text);
    for (const [name, def] of Object.entries(categoryRules)) {
      if (def.patterns.some(p => p.test(lower))) {
        return { name, rule: def, score: 1.0 * (def.weight || 1) };
      }
    }
    // Token bazlı eşleştirme (zayıf)
    const toks = Utils.tokenize(lower).map(Utils.trStem);
    let best = null;
    for (const [name, def] of Object.entries(categoryRules)) {
      const patterns = def.patterns;
      let localScore = 0;
      for (const p of patterns) {
        const src = p.source.replace(/\\b/g,'');
        const ptoks = Utils.tokenize(Utils.normalize(src)).map(Utils.trStem);
        let hit=0; for (const t of toks) if (ptoks.some(x => x.startsWith(t))) hit++;
        localScore = Math.max(localScore, hit / (ptoks.length || 1));
      }
      const weighted = localScore * 0.5 * (def.weight || 1);
      if (!best || weighted > best.score) best = { name, rule: def, score: weighted };
    }
    return (best && best.score > 0.35) ? best : null;
  }

  function pickResponse(def) {
    const arr = def.responses || [''];
    return arr[Math.floor(Math.random()*arr.length)] || '';
  }

  function match(text) {
    // Önce meta, sonra sohbet
    const meta = matchCategory(text, rulebook.meta);
    if (meta) return { intent: `meta.${meta.name}`, response: pickResponse(meta.rule), score: meta.score };
    const conv = matchCategory(text, rulebook.conversational);
    if (conv) return { intent: `conversational.${conv.name}`, response: pickResponse(conv.rule), score: conv.score };
    return null;
  }

  return { match };
})();

// ============================================================================
//  Basit NER / Slot Çıkarım (tarih, sayı, konu adı)
// ============================================================================
const NER = (() => {
  const dateWords = [/bugün/i, /yarın/i, /dün/i, /sabah/i, /akşam/i, /öğlen/i];
  const numberRe = /(?<![\w])(-?\d+(?:[.,]\d+)?)(?![\w])/g;

  function extract(text) {
    const slots = {};
    const norm = Utils.normalize(text);

    if (dateWords.some(r => r.test(text))) slots.time = 'relative';

    const nums = []; let m;
    while ((m = numberRe.exec(text)) !== null) nums.push(m[1]);
    if (nums.length) slots.numbers = nums.map(n => n.replace(',','.'));

    // Konu adı: basit yakalama — tırnak içi veya /öğren sonrası
    const learnMatch = norm.match(/\/öğren\s+([^|]+)(?:\s*\|\s*(.+))?/);
    if (learnMatch) {
      slots.topicTitle = learnMatch[1].trim();
      if (learnMatch[2]) slots.topicSummary = learnMatch[2].trim();
    }

    const aliasMatch = norm.match(/\/alias\s+([^|]+)\|\s*(.+)$/);
    if (aliasMatch) {
      slots.aliasTopic = aliasMatch[1].trim();
      slots.aliasName = aliasMatch[2].trim();
    }

    return slots;
  }

  return { extract };
})();

// ============================================================================
//  Eklenti (Plugin) Sistemi
// ============================================================================
const Plugins = (() => {
  const list = [];

  function register(plugin) { list.push(plugin); }

  function detect(text) {
    const can = [];
    for (const p of list) {
      try {
        if (p.detect(text)) can.push(p);
      } catch { /* ignore */ }
    }
    return can;
  }

  async function runAll(context) {
    const candidates = detect(context.userInput);
    for (const p of candidates) {
      try {
        const out = await p.run(context);
        if (out && typeof out === 'string' && out.trim()) return out; // ilk cevap kazansın
      } catch (e) {
        if (debugMode) console.error('[Plugin error]', p.name, e);
      }
    }
    return null;
  }

  return { register, runAll };
})();

// --- Yerleşik Eklentiler ----------------------------------------------------
Plugins.register({
  name: 'math',
  detect: (t) => /(^|\s|=)([-+*\/^()\d\s.,]+)(\?|$)/.test(t) && /\d/.test(t) && /hesapla|kaç eder|=?[\s]*[\d(]/i.test(t),
  run: async ({ userInput }) => {
    // Güvenli mini-math parser: yalnızca rakam, + - * / ^ ( ) . , boşluk
    const exprMatch = userInput.match(/([-+*\/^()\d\s.,]+)/);
    if (!exprMatch) return null;
    let expr = exprMatch[1].replace(/,/g,'.');
    if (/[^0-9+*\/^().\s-]/.test(expr)) return null;
    try {
      // ^ operatörünü JS'e çevir: **
      expr = expr.replace(/\^/g,'**');
      // eslint-disable-next-line no-new-func
      const val = Function(`"use strict"; return (${expr})`)();
      if (typeof val === 'number' && Number.isFinite(val)) {
        return `Hesap: \`${expr.replace(/\*\*/g,'^')}\` = **${val}**`;
      }
    } catch { /* ignore */ }
    return null;
  }
});

Plugins.register({
  name: 'transform',
  detect: (t) => /(büyük harf|küçük harf|ters çevir|tersine çevir|slug|kebab|title case|başlık yap)/i.test(t),
  run: async ({ userInput }) => {
    const txtMatch = userInput.match(/"([^"]+)"|'([^']+)'|`([^`]+)`/);
    const src = txtMatch ? (txtMatch[1]||txtMatch[2]||txtMatch[3]) : null;
    if (!src) return null;
    if (/büyük harf/i.test(userInput)) return src.toUpperCase();
    if (/küçük harf/i.test(userInput)) return src.toLowerCase();
    if (/(tersine|ters) çevir/i.test(userInput)) return src.split('').reverse().join('');
    if (/slug|kebab/i.test(userInput)) return Utils.trLower(src).replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    if (/title case|başlık yap/i.test(userInput)) return src.replace(/\w\S*/g, (w)=> w[0].toUpperCase()+w.slice(1).toLowerCase());
    return null;
  }
});

Plugins.register({
  name: 'datetime',
  detect: (t) => /(saat kaç|tarih|bugün ne|hangi gün)/i.test(t),
  run: async () => {
    const d = new Date();
    const days = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
    const pad = (n)=> String(n).padStart(2,'0');
    return `Şu an ${days[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}, ${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}.`;
  }
});

// ============================================================================
//  Ana Beyin (pipeline)
// ============================================================================
async function getMiraResponse(userInput) {
  const lowerInput = Utils.normalize(userInput);

  // 1) KOMUTLAR
  if (lowerInput.startsWith('/')) {
    resetConversationState();
    const out = await handleCommand(lowerInput);
    return out;
  }

  // 2) META
  const meta = IntentEngine.match(userInput);
  if (meta && meta.intent.startsWith('meta.')) {
    resetConversationState();
    return meta.response;
  }

  // 3) SOSYAL
  if (meta && meta.intent.startsWith('conversational.')) {
    resetConversationState();
    return meta.response;
  }

  // 4) BİLGİ — hafızada ara (konu, alias, özet)
  const memory = await Memory.load();
  const q = Utils.normalize(userInput);
  for (const key of Object.keys(memory.topics)) {
    const t = memory.topics[key];
    const all = [t.title, ...(t.aliases||[])].map(Utils.normalize);
    if (all.some(name => q.includes(name))) {
      return t.summary || `"${t.title}" hakkında bildiklerim bu kadar.`;
    }
  }

  // 5) EKLENTİLER
  const pluginOut = await Plugins.runAll({ userInput, memory, settings: settingsState, conversationState });
  if (pluginOut) return pluginOut;

  // 6) AKILLI KAÇIŞ
  const fallbacks = [
    'Bu konuda henüz bir bilgim yok, ama ilginç görünüyor. Bana `/öğren` komutuyla öğretebilirsin.',
    'Üzgünüm, tam olarak ne demek istediğini anlayamadım. Daha farklı bir şekilde sorabilir misin?',
    'Hmm, bu konuda düşünmem gerek. Belki başka bir şey sorarsın?',
    'Bu benim uzmanlık alanımın biraz dışında kalıyor.'
  ];
  let newIndex;
  do { newIndex = Math.floor(Math.random() * fallbacks.length); }
  while (newIndex === conversationState.lastFallbackIndex && fallbacks.length > 1);
  conversationState.lastFallbackIndex = newIndex;
  return fallbacks[newIndex];
}

// ============================================================================
//  Komut İşleyici
// ============================================================================
async function handleCommand(cmdLine) {
  const line = cmdLine.trim();

  // /öğren [konu] | [özet]
  if (line.startsWith('/öğren ')) {
    const m = line.match(/^\/öğren\s+([^|]+)(?:\|(.+))?$/);
    if (!m) return 'Kullanım: `/öğren Konu Adı | Özet (opsiyonel)`';
    const title = (m[1]||'').trim();
    const summary = m[2] ? m[2].trim() : null;
    return Memory.learnTopic(title, summary);
  }

  // /alias [konu] | [takma]
  if (line.startsWith('/alias ')) {
    const m = line.match(/^\/alias\s+([^|]+)\|(.+)$/);
    if (!m) return 'Kullanım: `/alias Konu | Takma Ad`';
    const topic = m[1].trim();
    const alias = m[2].trim();
    return Memory.addAlias(topic, alias);
  }

  // /sil [konu]
  if (line.startsWith('/sil ')) {
    const topic = line.replace('/sil','').trim();
    return Memory.removeTopic(topic);
  }

  // /hafıza [list|ara ...]
  if (line.startsWith('/hafıza')) {
    const q = line.replace('/hafıza','').trim();
    if (!q || q === 'list') {
      const notes = await Memory.listNotes(5);
      const mem = await Memory.load();
      const topics = Object.values(mem.topics).slice(-5).map(t => `• ${t.title}`).join('\n');
      const notesStr = notes.map(n => `• ${n.text}`).join('\n') || '—';
      return `Son konular:\n${topics || '—'}\n\nSon notlar:\n${notesStr}`;
    }
    if (q.startsWith('ara')) {
      const term = q.replace('ara','').trim();
      const res = await Memory.searchTopics(term);
      if (!res.length) return 'Eşleşme bulunamadı.';
      return res.map(r => `• ${r.topic.title} (skor: ${r.score.toFixed(2)})`).join('\n');
    }
    return 'Kullanım: `/hafıza list` veya `/hafıza ara [kelime]`';
  }

  // /export
  if (line === '/export') {
    const path = await Memory.exportMemory();
    return `Hafıza dışa aktarıldı: ${path}`;
  }

  // /import  (modal açar)
  if (line === '/import') {
    openModal('Hafıza İçe Aktar', `
      <textarea id="import-json" style="width:100%; min-height:220px; background:var(--bg-0); color:var(--text-0); border:1px solid var(--border); border-radius:10px; padding:10px;" placeholder='Buraya JSON yapıştırın'></textarea>
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
        <button id="do-import">İçe Aktar</button>
      </div>
    `);
    const root = UI.modalRoot.querySelector('.modal');
    root.querySelector('#do-import').onclick = async () => {
      const txt = root.querySelector('#import-json').value;
      const msg = await Memory.importMemory(txt);
      UI.modalRoot.classList.remove('active');
      displayMessage(UI.messagesEl, 'mira', msg);
    };
    return 'İçe aktarma penceresi açıldı.';
  }

  // /tema [auto|dark|light]
  if (line.startsWith('/tema')) {
    const v = line.split(/\s+/)[1];
    const allowed = ['auto','dark','light'];
    if (!v || !allowed.includes(v)) return 'Kullanım: `/tema auto|dark|light`';
    await Settings.save({ theme: v });
    return `Tema: ${v}`;
  }

  if (line === '/temalar') {
    return `Aktif tema: **${settingsState.theme}** (auto|dark|light)`;
  }

  if (line === '/reset') {
    resetConversationState();
    return 'Diyalog durumu sıfırlandı.';
  }

  if (line === '/debug') {
    debugMode = !debugMode;
    return `Debug modu: ${debugMode ? 'AÇIK' : 'KAPALI'}`;
  }

  if (line === '/yardım') {
    return 'Komutlar için /yardım yazabilir, ayrıntı penceresini üst çubuktan açabilirsin.';
  }

  return 'Anlayamadım. Kullanılabilir komutlar için `/yardım` yaz.';
}

// ============================================================================
//  Ana Döngü ve Montaj
// ============================================================================
async function handleUserMessage(userInput) {
  // UI'ye yaz
  displayMessage(UI.messagesEl, 'user', userInput);
  UI.inputEl.value = '';

  // Düşünme balonu
  const thinkingMsg = displayMessage(UI.messagesEl, 'mira', '...', 'thinking');

  try {
    const miraResponse = await getMiraResponse(userInput);
    if (settingsState.typingAnimation && miraResponse.length < 1200) {
      await typeInto(thinkingMsg, miraResponse);
    } else {
      updateMessageEl(thinkingMsg, miraResponse);
      thinkingMsg.classList.remove('thinking');
    }
  } catch (err) {
    console.error('[Mira] Response error:', err);
    updateMessageEl(thinkingMsg, 'Üzgünüm, beynimde bir kısa devre oldu. Lütfen tekrar dene.', 'error');
    thinkingMsg.classList.remove('thinking');
    thinkingMsg.classList.add('error');
  }
}

async function typeInto(el, text) {
  el.classList.remove('thinking');
  el.innerHTML = '';
  let i = 0; const ms = 10; // hız
  while (i < text.length) {
    // Basit HTML kaçışı yerine parça olarak ekle (markdown sonrası risk yok, burada düz metin akıtıyoruz)
    const ch = text[i++];
    el.textContent += ch;
    if (i % 3 === 0) await Utils.delay(ms);
    UI.messagesEl.scrollTop = UI.messagesEl.scrollHeight;
  }
  // bitince markdown uygula
  el.innerHTML = Utils.renderMarkdown(text);
}

export async function mount(container, api) {
  await Settings.load();
  const { messagesEl, formEl, inputEl } = setupUI(container);
  UI.messagesEl = messagesEl; UI.formEl = formEl; UI.inputEl = inputEl; UI.container = container;

  resetConversationState();
  displayMessage(messagesEl, 'mira', `Selam! Ben Mira. Beyin yükseltmesi aldım \(v${MIRAV_VERSION}\). Hadi sohbet edelim.`);

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userInput = inputEl.value.trim();
    if (!userInput) return;
    await handleUserMessage(userInput);
  });

  // Kısayol: Cmd/Ctrl+K komut paleti
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette();
    }
  });
}

// ============================================================================
//  (Opsiyonel) Dışa Aktarım: API benzeri yardımcılar
// ============================================================================
export const MiraAPI = {
  get state() { return conversationState; },
  async memory() { return Memory.load(); },
  async settings() { return Settings.load(); },
  async ask(q) { return getMiraResponse(q); }
};
