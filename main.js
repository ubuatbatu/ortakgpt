// MyExplorerV2 — main process (Apps kaydı VFS:/Apps içine düşer; otomatik kısayol yok)

const { app, BrowserWindow, ipcMain, Menu } = require('electron'); // ← Menu eklendi
const path = require('path');
const fs = require('fs');

const posix = path.posix;
const norm = (p) => {
  if (!p) return '/';
  p = String(p).replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  p = posix.normalize(p);
  return p === '' ? '/' : p;
};
const join = (a, b) => posix.join(a, b);
const parentOf = (p) => posix.dirname(norm(p)) || '/';
const isRoot = (p) => norm(p) === '/';

const CORE_DIRS = new Set(['Desktop', 'System', 'Documents', 'Recycle', 'Apps']); // ← kökte izinli

const STATE_FILE = () => path.join(app.getPath('userData'), 'vfs.json');
const newId = () => 'vfs:' + Math.random().toString(16).slice(2) + Date.now().toString(16);
const node = (name, type) => ({ id: newId(), name, type, children: type === 'dir' ? [] : undefined });
const { registerInputIPC } = require('./input-ipc');

const VFS = {
  state: { tree: null, files: {} },

  load() {
    try {
      const raw = fs.readFileSync(STATE_FILE(), 'utf-8');
      this.state = JSON.parse(raw);
    } catch {
      this.seed();
      this.save();
    }
    // garanti klasörler (eski kayıtlarda eksik olabilir)
    this._ensureDir('/Desktop');
    this._ensureDir('/System');
    this._ensureDir('/Documents');
    this._ensureDir('/Recycle');
    this._ensureDir('/Recycle/.meta');
    this._ensureDir('/Apps');
  },
  save() {
    fs.writeFileSync(STATE_FILE(), JSON.stringify(this.state, null, 2), 'utf-8');
  },

  seed() {
    const root = node('/', 'dir');
    root.name = '/';
    const Desktop = node('Desktop', 'dir');
    const System = node('System', 'dir');
    const Documents = node('Documents', 'dir');
    const Gallery = node('Gallery', 'dir');
    const Notes = node('Notes', 'dir');
    const Recycle = node('Recycle', 'dir');
    const Meta = node('.meta', 'dir');
    const AppsDir = node('Apps', 'dir');

    Documents.children.push(Gallery, Notes);
    Recycle.children.push(Meta);
    root.children = [Desktop, System, Documents, Recycle, AppsDir];

    this.state.tree = root;
    this.state.files = Object.create(null);

    // örnek içerik (masaüstüne hiçbir şey düşmüyor)
    this._ensureDir('/Documents/Notes');
    this.filesWrite('/Documents/Notes/hosgeldin.txt', 'MyExplorerV2’ye hoş geldin!');
  },

  ensureRecycle() {
    this._ensureDir('/Recycle');
    this._ensureDir('/Recycle/.meta');
    return true;
  },

  // ---- ağaç yardımcıları
  _findNode(pathStr) {
    const p = norm(pathStr);
    if (p === '/') return this.state.tree;
    const parts = p.split('/').filter(Boolean);
    let cur = this.state.tree;
    for (const seg of parts) {
      if (!cur || cur.type !== 'dir') return null;
      cur = (cur.children || []).find((c) => c.name === seg) || null;
    }
    return cur;
  },
  _ensureDir(dir) {
    const p = norm(dir);
    if (p === '/') return this.state.tree;
    const parts = p.split('/').filter(Boolean);
    let cur = this.state.tree;
    for (const seg of parts) {
      let next = (cur.children || []).find((c) => c.name === seg);
      if (!next) {
        next = node(seg, 'dir');
        cur.children.push(next);
      }
      cur = next;
    }
    return cur;
  },
  _parentAndName(pth) {
    const p = norm(pth);
    return { parent: posix.dirname(p) === '' ? '/' : posix.dirname(p), name: posix.basename(p) };
  },

  // ---- API
  list(dirPath) {
    const n = this._findNode(dirPath);
    if (!n || n.type !== 'dir') throw new Error('Dizin yok: ' + dirPath);
    return (n.children || []).map((c) => ({
      name: c.name,
      type: c.type,
      id: c.id,
      ext: c.type === 'file' ? c.name.match(/\.[^.]+$/)?.[0] || '' : ''
    }));
  },
  readFile(filePath) {
    const n = this._findNode(filePath);
    if (!n || n.type !== 'file') throw new Error('Dosya yok: ' + filePath);
    return this.state.files[norm(filePath)] ?? '';
  },

  filesWrite(filePath, content) {
    const { parent, name } = this._parentAndName(filePath);
    // kökün bir altı serbest; kural dosyaya değil dizine bakar
    const dir = this._ensureDir(parent);
    let f = (dir.children || []).find((c) => c.name === name);
    if (!f) {
      f = node(name, 'file');
      dir.children.push(f);
    }
    this.state.files[norm(filePath)] = String(content ?? '');
    return true;
  },
  writeFile(filePath, content) {
    return this.filesWrite(filePath, content);
  },

  mkdir(dirPath) {
    const p = norm(dirPath);
    if (p === '/') return true;
    const par = parentOf(p);
    // kökün bir altı: sadece CORE_DIRS izinli
    if (isRoot(par)) {
      const base = posix.basename(p);
      if (!CORE_DIRS.has(base)) throw new Error('Kökte klasör oluşturulamaz.');
    }
    this._ensureDir(p);
    return true;
  },

  rename(parentPath, oldName, newName) {
    if (isRoot(parentPath)) throw new Error('Kökteki öğeler yeniden adlandırılamaz.');
    const dir = this._findNode(parentPath);
    if (!dir || dir.type !== 'dir') throw new Error('Dizin yok: ' + parentPath);
    const n = (dir.children || []).find((c) => c.name === oldName);
    if (!n) throw new Error('Öğe yok: ' + oldName);
    let target = newName,
      c = 2;
    while ((dir.children || []).some((x) => x !== n && x.name === target)) target = `${newName} (${c++})`;
    if (n.type === 'file') {
      const oldFull = norm(join(parentPath, oldName));
      const newFull = norm(join(parentPath, target));
      this.state.files[newFull] = this.state.files[oldFull];
      delete this.state.files[oldFull];
    }
    n.name = target;
    return true;
  },

  delete(parentPath, name, { toRecycle = true } = {}) {
    if (isRoot(parentPath)) throw new Error('Kökteki öğeler silinemez.');
    const dir = this._findNode(parentPath);
    if (!dir || dir.type !== 'dir') throw new Error('Dizin yok: ' + parentPath);
    const idx = (dir.children || []).findIndex((c) => c.name === name);
    if (idx < 0) return true;

    const item = dir.children[idx];
    const full = norm(join(parentPath, name));

    const doRemove = () => {
      if (item.type === 'file') delete this.state.files[full];
      dir.children.splice(idx, 1);
    };

    if (!toRecycle || parentPath.startsWith('/Recycle')) {
      doRemove();
      return true;
    }

    this.ensureRecycle();
    const rec = this._ensureDir('/Recycle');

    // benzersiz Recycle adı
    let stored = item.name,
      c = 2;
    while ((rec.children || []).some((x) => x.name === stored)) stored = `${item.name} (${c++})`;

    // taşı
    dir.children.splice(idx, 1);
    item.name = stored;
    rec.children.push(item);

    // meta
    const id = item.id;
    const meta = { id, name, storedName: stored, originalPath: full, deletedAt: Date.now() };
    this.state.files['/Recycle/.meta/' + id + '.json'] = JSON.stringify(meta, null, 2);
    return true;
  },

  move(srcParent, name, destParent) {
    if (isRoot(destParent)) throw new Error('Öğeler köke taşınamaz.');
    const sdir = this._findNode(srcParent);
    const ddir = this._ensureDir(destParent);
    if (!sdir || sdir.type !== 'dir' || !ddir || ddir.type !== 'dir') throw new Error('Dizin hata');

    const idx = (sdir.children || []).findIndex((c) => c.name === name);
    if (idx < 0) throw new Error('Öğe yok: ' + name);
    const item = sdir.children[idx];

    let targetName = item.name,
      c = 2;
    while ((ddir.children || []).some((x) => x.name === targetName)) targetName = `${item.name} (${c++})`;

    sdir.children.splice(idx, 1);
    const oldFull = norm(join(srcParent, item.name));
    item.name = targetName;
    ddir.children.push(item);
    const newFull = norm(join(destParent, targetName));

    if (item.type === 'file') {
      this.state.files[newFull] = this.state.files[oldFull];
      delete this.state.files[oldFull];
    }
    return true;
  },

  copy(srcParent, name, destParent) {
    if (isRoot(destParent)) throw new Error('Öğeler köke kopyalanamaz.');
    const sdir = this._findNode(srcParent);
    const ddir = this._ensureDir(destParent);
    const item = (sdir.children || []).find((c) => c.name === name);
    if (!item) throw new Error('Öğe yok: ' + name);

    const cloneTree = (n, basePath) => {
      const out = node(n.name, n.type);
      if (n.type === 'file') {
        const sp = norm(join(basePath, n.name));
        out.__content = this.state.files[sp] ?? '';
      } else {
        out.children = (n.children || []).map((ch) => cloneTree(ch, join(basePath, n.name)));
      }
      return out;
    };

    let newName = item.name,
      c = 2;
    while ((ddir.children || []).some((x) => x.name === newName)) newName = `${item.name} (${c++})`;
    const cloned = cloneTree(item, srcParent);
    cloned.name = newName;

    const writeTree = (n, base) => {
      if (n.type === 'file') {
        const p = norm(join(base, n.name));
        this.filesWrite(p, n.__content ?? '');
      } else {
        this._ensureDir(norm(join(base, n.name)));
        (n.children || []).forEach((ch) => writeTree(ch, norm(join(base, n.name))));
      }
    };
    writeTree(cloned, destParent);
    return true;
  },

  exists(pathStr) {
    return !!this._findNode(pathStr);
  },
  statType(pathStr) {
    const n = this._findNode(pathStr);
    return n?.type || null;
  },
  lookupById(id) {
    let found = null;
    const walk = (n, base) => {
      if (!n) return;
      const curPath = base === '/' ? '/' + (n.name === '/' ? '' : n.name) : (n.name === '/' ? base : join(base, n.name));
      if (n.id === id) {
        found = { path: curPath === '//' ? '/' : norm(curPath), type: n.type };
        return;
      }
      if (n.type === 'dir') (n.children || []).forEach((ch) => walk(ch, curPath === '/' ? '/' : curPath));
    };
    walk(this.state.tree, '/');
    return found;
  },

  // ---- Uygulama kayıtlarını VFS:/Apps içine yaz
  syncAppsRegistry(manifests) {
    this._ensureDir('/Apps');
    // mevcut .app.json kayıtlarını temizle
    const items = this.list('/Apps');
    for (const it of items) {
      if (it.type === 'file' && /\.app\.json$/i.test(it.name)) {
        this.delete('/Apps', it.name, { toRecycle: false });
      }
    }
    // yeni kayıtları yaz
    for (const m of manifests) {
      const record = {
        id: m.id,
        name: m.name,
        description: m.description || '',
        entryUrl: m.entryUrl,
        styleUrls: m.styleUrls || [],
        fileAssociations: m.fileAssociations || []
      };
      const fname = `${m.id}.app.json`;
      this.filesWrite(`/Apps/${fname}`, JSON.stringify(record, null, 2));
    }
    this.save();
  }
};

// ---- Apps manifest tarama (diskteki Apps/ klasöründen)
function scanApps() {
  const base = app?.getAppPath ? app.getAppPath() : __dirname;
  const appsDir = path.join(base, 'Apps');
  const entries = [];
  if (!fs.existsSync(appsDir)) return entries;

  const names = fs.readdirSync(appsDir);
  for (const name of names) {
    const dir = path.join(appsDir, name);
    try {
      const st = fs.statSync(dir);
      if (!st.isDirectory()) continue;

      const manifestPath = path.join(dir, 'app.json');
      if (!fs.existsSync(manifestPath)) continue;

      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      // id, name
      const id = typeof m.id === 'string' && m.id.trim() ? m.id.trim() : `app.${name.toLowerCase()}`;
      const appName = typeof m.name === 'string' && m.name.trim() ? m.name.trim() : name;

      // entry: zorunlu; yoksa 'main.js' varsayılanını dene
      const entryFile = typeof m.entry === 'string' && m.entry.trim() ? m.entry.trim() : 'main.js';
      const entryAbs = path.join(dir, entryFile);
      if (!fs.existsSync(entryAbs)) {
        console.warn(`[Apps] ${name}: entry '${entryFile}' bulunamadı, atlanıyor.`);
        continue;
      }
      const entryUrl = 'file://' + encodeURI(entryAbs.replace(/\\/g, '/'));

      // styles: isteğe bağlı
      const stylesArr = Array.isArray(m.styles) ? m.styles.filter((s) => typeof s === 'string' && s.trim()) : [];
      const styleUrls = stylesArr.map((s) => {
        const abs = path.join(dir, s);
        return 'file://' + encodeURI(abs.replace(/\\/g, '/'));
      });

      entries.push({
        ...m,
        id,
        name: appName,
        dir,
        entryUrl,
        styleUrls
      });
    } catch (e) {
      console.error('App manifest okunamadı', name, e);
    }
  }

  if (entries.length === 0) console.warn('[Apps] Hiç app bulunamadı:', appsDir);
  return entries;
}

let manifests = [];

function createWindow() {
  const win = new BrowserWindow({
    // boyutları bırakabiliriz ama fullscreen zaten bunları ezer
    width: 1200,
    height: 800,

    // menü çubuğu zaten gizli
    autoHideMenuBar: true,

    // ⬇️ tam ekran aç
    fullscreen: true,            // başlangıçta tam ekran
    // kiosk: true,              // (opsiyonel) Tam ekranı kilitlemek istersen aç

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  // Menüleri tamamen kaldır (File/Edit/View vs.)
  win.setMenuBarVisibility(false);
  Menu.setApplicationMenu(null);

  // Bazı sistemlerde garanti olsun diye bir de programatik olarak set et
  win.setFullScreen(true);

  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.openDevTools({ mode: 'detach' }); // işi bitince kaldır
}


app.whenReady().then(() => {
  VFS.load();
  manifests = scanApps();
  VFS.syncAppsRegistry(manifests); // KAYITLARI /Apps içine düş
registerInputIPC();
  // --- İlk açılışta /System/settings.json ve diğer sistem dosyaları ---
  const SETTINGS_PATH = '/System/settings.json';
  const INITIAL_SETTINGS = {
    version: 1,
    theme: 'dark',
    taskbarCompact: false,
    startMenuHeight: 520,
    defaultExplorerView: 'medium',
    desktopGrid: { w: 96, h: 100, marginX: 16, marginY: 16 },
    assoc: { '.txt': 'app.notepad', '.md': 'app.notepad', '.png': 'app.paint', '.jpg': 'app.paint', '.jpeg': 'app.paint' }
  };
  try {
    if (!VFS.exists(SETTINGS_PATH)) {
      VFS.writeFile(SETTINGS_PATH, JSON.stringify(INITIAL_SETTINGS, null, 2));
      VFS.save();
    }

    // eksik olabilecek sistem dosyalarını oluştur
    const ensureFile = (pth, content) => {
      try {
        if (!VFS.exists(pth)) {
          const str = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
          VFS.writeFile(pth, str);
        }
      } catch {}
    };

    // Masaüstü ikon pozisyonları (renderer ilk açılışta okur)
    ensureFile('/System/.desktop-pos.json', { version: 1, positions: {} });

    // Terminal geçmiş/profil
    ensureFile('/System/terminal_history.json', []);
    ensureFile('/System/terminal_profile.json', { aliases: {}, env: {}, prompt: '{user}@vfs:{cwd}$' });

    VFS.save();
  } catch (e) {
    console.error('İlk ayar dosyaları oluşturulamadı:', e);
  }

  // VFS IPC
  ipcMain.handle('vfs:list', (e, { path }) => VFS.list(path));
  // vfs:read — yoksa sessizce boş string dön
  ipcMain.handle('vfs:read', (e, { path, opts }) => {
    try {
      return VFS.readFile(path);
    } catch (err) {
      const msg = String(err?.message || '');
      const notFound = msg.startsWith('Dosya yok:') || msg.includes('no such file');
      if (notFound && !(opts && opts.throwIfMissing)) return '';
      throw err;
    }
  });
  
// --- Ana süreçten HTTP(S) köprüsü — JSON da dönmeye çalışır
ipcMain.handle('net:fetch', async (e, { url, options }) => {
  // 1) Node/Electron 'fetch' varsa onu kullan
  if (typeof fetch === 'function') {
    try {
      const res = await fetch(url, options || {});
      const text = await res.text();
      const headers = Object.fromEntries(res.headers);
      let json = null; try { if ((headers['content-type'] || '').includes('json')) json = JSON.parse(text); } catch {}
      return { ok: res.ok, status: res.status, headers, text, json };
    } catch (err) {
      // fetch başarısızsa Electron net'e düş
    }
  }

  // 2) Electron'un ana süreç 'net' API'si (her Electron sürümünde var)
  const { net } = require('electron');
  return await new Promise((resolve) => {
    const method = (options && options.method) || 'GET';
    const req = net.request({ method, url });

    // headers
    if (options && options.headers) {
      for (const [k, v] of Object.entries(options.headers)) req.setHeader(k, v);
    }

    let bodyToSend = null;
    if (options && options.body != null) {
      bodyToSend = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      if (typeof options?.headers?.['Content-Type'] === 'undefined') {
        req.setHeader('Content-Type', 'application/json');
      }
    }

    req.on('response', (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const headers = {};
        for (const [k, v] of Object.entries(res.headers)) {
          headers[String(k).toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        let json = null;
        try { if ((headers['content-type'] || '').includes('json')) json = JSON.parse(data); } catch {}
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers,
          text: data,
          json
        });
      });
    });

    req.on('error', (err) => {
      resolve({ ok: false, status: 0, headers: {}, text: String(err), json: null });
    });

    if (bodyToSend) req.write(bodyToSend);
    req.end();
  });
});


  ipcMain.handle('vfs:write', (e, { path, data }) => {
    VFS.writeFile(path, data);
    VFS.save();
    return true;
  });
  ipcMain.handle('vfs:mkdir', (e, { path }) => {
    VFS.mkdir(path);
    VFS.save();
    return true;
  });
  ipcMain.handle('vfs:rename', (e, { parent, oldName, newName }) => {
    VFS.rename(parent, oldName, newName);
    VFS.save();
    return true;
  });
  ipcMain.handle('vfs:delete', (e, { parent, name, opts }) => {
    VFS.delete(parent, name, opts || {});
    VFS.save();
    return true;
  });
  ipcMain.handle('vfs:move', (e, { srcParent, name, destParent }) => {
    VFS.move(srcParent, name, destParent);
    VFS.save();
    return true;
  });
  ipcMain.handle('vfs:copy', (e, { srcParent, name, destParent }) => {
    VFS.copy(srcParent, name, destParent);
    VFS.save();
    return true;
  });
  ipcMain.handle('vfs:exists', (e, { path }) => VFS.exists(path));
  ipcMain.handle('vfs:statType', (e, { path }) => VFS.statType(path));
  ipcMain.handle('vfs:lookupById', (e, { id }) => VFS.lookupById(id));
  ipcMain.handle('vfs:ensureRecycle', () => {
    VFS.ensureRecycle();
    VFS.save();
    return true;
  });

  // Apps IPC
  ipcMain.handle('apps:list', () => {
    manifests = scanApps();
    VFS.syncAppsRegistry(manifests); // her listede VFS:/Apps güncel kalsın
    return manifests;
  });

  function seedAssocFromManifests() {
    // /System ayar dosyasını oku / oluştur
    let s = {};
    try {
      s = JSON.parse(VFS.readFile('/System/settings.json'));
    } catch {
      s = {};
    }
    s.assoc = s.assoc || {};
    // yalnızca eksik olan uzantıları ekle
    for (const m of manifests) {
      for (const ext of m.fileAssociations || []) {
        if (!s.assoc[ext]) s.assoc[ext] = m.id;
      }
    }
    VFS._ensureDir('/System'); // iç API, burada güvenli
    VFS.writeFile('/System/settings.json', JSON.stringify(s, null, 2));
    VFS.save();
  }
  // manifests senkronundan sonra çağır
  seedAssocFromManifests();

  ipcMain.handle('apps:launch', (e, { appId, args }) => ({ ok: true }));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});