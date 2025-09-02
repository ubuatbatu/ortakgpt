// Enhanced Terminal for VFS
// Features: persistent history, autocomplete, aliases, env vars, custom prompt, pipes & redirection,
// grep/find/head/tail/wc/sort/uniq/date/clear/history, watch/ps/kill, and existing file ops.
// Requires: vfs API, launchApp.
//
// Files used:
//   /System/terminal_history.json
//   /System/terminal_profile.json

const HISTORY_PATH = '/System/terminal_history.json';
const PROFILE_PATH = '/System/terminal_profile.json';

export async function mount(rootEl, { vfs, launchApp }) {
  rootEl.className = 'terminal';
  rootEl.innerHTML = `
    <div class="screen" data-id="screen"></div>
    <div class="input">
      <span class="prompt" data-id="prompt"></span>
      <input class="cmd" placeholder="help yaz veya Tab ile tamamla" autocomplete="off" />
      <button data-act="run">Çalıştır</button>
    </div>
  `;

  // UI refs
  const screen = rootEl.querySelector('[data-id=screen]');
  const promptEl = rootEl.querySelector('[data-id=prompt]');
  const cmdInp = rootEl.querySelector('.cmd');

  // State
  let CWD = '/Documents';
  let history = [];
  let hIndex = null; // null: yeni satır; number: seçili
  let aliases = {};
  let env = { USER: 'guest', LANG: 'tr-TR' };
  let promptTpl = '{user}@vfs:{cwd}$';
  const watchers = []; // {id, timer, spec}

  // Load history/profile (sessizce)
  try {
    const raw = await vfs.readFile(HISTORY_PATH);
    if (raw) history = JSON.parse(raw) || [];
  } catch {}
  try {
    const raw = await vfs.readFile(PROFILE_PATH);
    if (raw) {
      const profile = JSON.parse(raw) || {};
      aliases = profile.aliases || {};
      env = { ...env, ...(profile.env || {}) };
      promptTpl = profile.prompt || promptTpl;
    }
  } catch {}

  // ---------- LOGGER ----------
  const logText = (s, cls = '') => {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = String(s); // her zaman metin
    screen.appendChild(d);
    screen.scrollTop = screen.scrollHeight;
    return d;
  };
  const logHtml = (html, cls = '') => {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.innerHTML = html; // sadece bilinçli HTML
    screen.appendChild(d);
    screen.scrollTop = screen.scrollHeight;
    return d;
  };
  const log = (s) => logText(s, 'stdout');
  const err = (s) => logText(s, 'stderr');
  const ok = (s = 'ok') => logText(s, 'ok');

  const updatePrompt = () => {
    const render = (tpl) =>
      tpl
        .replace(/\{user\}/g, env.USER || 'guest')
        .replace(/\{cwd\}/g, CWD)
        .replace(/\{time\}/g, new Date().toLocaleTimeString(env.LANG || 'tr-TR'));
    promptEl.textContent = render(promptTpl) + ' ';
    cmdInp.setAttribute('aria-label', render(promptTpl));
  };
  updatePrompt();

  // ---------- PATH & FS HELPERS ----------
  const pnorm = (p, cwd = CWD) => {
    p = (p || '').replace(/\\/g, '/').trim();
    if (!p) return cwd;
    if (!p.startsWith('/')) p = (cwd === '/' ? '' : cwd) + '/' + p;
    const parts = p.split('/');
    const stack = [];
    for (const seg of parts) {
      if (!seg || seg === '.') continue;
      if (seg === '..') stack.pop();
      else stack.push(seg);
    }
    return '/' + stack.join('/');
  };
  const split = (p) => {
    const full = pnorm(p);
    return { parent: full.split('/').slice(0, -1).join('/') || '/', name: full.split('/').pop() };
  };
  const fileExt = (name) => (name.match(/\.[^.]+$/)?.[0] || '').toLowerCase();

  async function delRecursive(parent, name) {
    const full = (parent === '/' ? '' : parent) + '/' + name;
    const t = await vfs.statType(full);
    if (t === 'file') {
      await vfs.delete(parent, name, { toRecycle: true });
      return;
    }
    if (t === 'dir') {
      const children = await vfs.list(full);
      for (const ch of children) await delRecursive(full, ch.name);
      await vfs.delete(parent, name, { toRecycle: true });
    }
  }
  async function copyRecursive(src, dst) {
    const t = await vfs.statType(src);
    if (t === 'file') {
      const { parent: dp, name: dname } = split(dst);
      const { parent: sp, name: sname } = split(src);
      await vfs.copy(sp, sname, dp);
      if (sname !== dname) await vfs.rename(dp, sname, dname);
      return;
    }
    if (t === 'dir') {
      await vfs.mkdir(dst).catch(() => {});
      const kids = await vfs.list(src);
      for (const ch of kids) await copyRecursive(src + '/' + ch.name, dst + '/' + ch.name);
    }
  }

  // ---------- TOKENIZE & EXEC ----------
  function tokenize(line) {
    const out = [];
    let cur = '';
    let inQ = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === inQ) {
          inQ = null;
          continue;
        }
        cur += ch;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQ = ch;
        continue;
      }
      if (ch === ' ') {
        if (cur) out.push(cur), (cur = '');
        continue;
      }
      cur += ch;
    }
    if (cur) out.push(cur);

    // support multiple pipes
    const segments = [];
    let seg = [];
    for (const t of out) {
      if (t === '|') {
        segments.push(seg);
        seg = [];
      } else seg.push(t);
    }
    segments.push(seg);

    // redirection: > or >> in the last segment
    let redirect = null;
    const last = segments[segments.length - 1];
    const ridx = last.findIndex((x) => x === '>' || x === '>>');
    if (ridx >= 0 && last[ridx + 1]) {
      redirect = { op: last[ridx], path: last[ridx + 1] };
      last.splice(ridx, 2);
    }
    return { tokens: out, segments, redirect };
  }

  function expand(word) {
    // $VARS expansion
    return word.replace(/\$([A-Za-z_]\w*)/g, (_, k) => env[k] ?? '');
  }

  function parseTimeMs(spec) {
    const m = String(spec).trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/i);
    if (!m) return 1000;
    const n = Number(m[1]);
    const u = (m[2] || 'ms').toLowerCase();
    if (u === 'ms') return Math.round(n);
    if (u === 's') return Math.round(n * 1000);
    if (u === 'm') return Math.round(n * 60000);
    return Math.round(n);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  }

  // ---------- COMMANDS ----------
  const CMDS = {
    async help() {
      return `KOMUTLAR (özet)

  Dosyalar:
    pwd                          Çalışma dizinini yazdır
    cd <yol>                     Dizin değiştir
    ls [yol]                     Listele
    tree [yol]                   Ağaç görünümü
    cat <dosya>                  Dosya içeriğini yazdır
    echo <metin>                 Metni yazdır
    touch <dosya>                Dosya oluştur (varsa dokun)
    mkdir [-p] <yol>             Klasör oluştur
    rm [-r] <yol>                Sil (çöpe taşır)
    mv <kaynak> <hedef>          Taşı / yeniden adlandır
    cp [-r] <kaynak> <hedef>     Kopyala
    open <yol>                   Uygun uygulama ile aç
    edit <dosya>                 Notepad ile aç
    paint <dosya>                Paint ile aç

  Metin & filtreleme:
    grep [-i] <regex> [dosya]    Satırları filtrele
    find <yol> [-name PAT]       Dosya/klasör ara (PAT: *.png gibi)
    head [-n N] [dosya]          İlk N satır
    tail [-n N] [dosya]          Son N satır
    wc [-l|-w|-c] [dosya]        Satır / kelime / karakter
    sort [-r]                    Sırala (ters için -r)
    uniq                         Tekilleştir

  Oturum & profil:
    history                      Geçmişi göster
    alias NAME="komut ..."       Alias tanımla
    unalias NAME                 Alias sil
    set VAR=DEĞER                Ortam değişkeni ata
    get VAR                      Değeri yazdır
    env                          Tüm değişkenleri yazdır
    prompt "şablon"              {user}, {cwd}, {time} destekler
    profile save|load            Profili kaydet/yükle

  İzleme:
    watch <1s> <komut>           Periyodik çalıştır
    ps                           Aktif watch listesi
    kill <id>                    Watch kapat

  Borular & yönlendirme:
    ls | grep png | head -n 5
    komut >  /path/out.txt       (üzerine yaz)
    komut >> /path/out.txt       (sona ekle)
`;
    },

    // Dosyalar
    async pwd() {
      return CWD;
    },
    async cd(ctx, args) {
      const p = pnorm(args[0] || '/');
      const t = await vfs.statType(p);
      if (t !== 'dir') return 'dizin yok';
      CWD = p;
      updatePrompt();
      return '';
    },
    async ls(ctx, args) {
      const p = pnorm(args[0] || CWD);
      const a = await vfs.list(p);
      return a.map((x) => `${x.type === 'dir' ? '[D]' : '[F]'} ${x.name}`).join('\n');
    },
    async tree(ctx, args) {
      const root = pnorm(args[0] || CWD);
      let out = '';
      async function walk(p, depth = 0) {
        const a = await vfs.list(p);
        for (const x of a) {
          out += `${'  '.repeat(depth)}${x.type === 'dir' ? '📁' : '📄'} ${x.name}\n`;
          if (x.type === 'dir') await walk(p + '/' + x.name, depth + 1);
        }
      }
      await walk(root);
      return out.trim();
    },
    async cat(ctx, args) {
      const p = pnorm(args[0]);
      if (!p) return 'kullanım: cat <path>';
      return await vfs.readFile(p).catch(() => '');
    },
    async echo(ctx, args) {
      return args.join(' ');
    },
    async touch(ctx, args) {
      const p = pnorm(args[0]);
      if (!p) return 'kullanım: touch <path>';
      const cur = await vfs.readFile(p).catch(() => '');
      await vfs.writeFile(p, cur || '');
      return 'ok';
    },
    async mkdir(ctx, args) {
      const p = pnorm(args[args[0] === '-p' ? 1 : 0]);
      if (!p) return 'kullanım: mkdir [-p] <path>';
      await vfs.mkdir(p).catch(() => {});
      return 'ok';
    },
    async rm(ctx, args) {
      const recursive = args[0] === '-r';
      const target = pnorm(args[recursive ? 1 : 0]);
      if (!target) return 'kullanım: rm [-r] <path>';
      const tp = await vfs.statType(target);
      if (tp === 'file') {
        const { parent, name } = split(target);
        await vfs.delete(parent, name, { toRecycle: true });
      } else if (tp === 'dir') {
        if (!recursive) return 'dizin için -r gerekli';
        const { parent, name } = split(target);
        await delRecursive(parent, name);
      } else return 'bulunamadı';
      return 'ok';
    },
    async mv(ctx, args) {
      const src = pnorm(args[0]),
        dst = pnorm(args[1]);
      if (!src || !dst) return 'kullanım: mv <src> <dst>';
      const sp = split(src),
        dp = split(dst);
      if ((await vfs.statType(dst)) === 'dir') {
        await vfs.move(sp.parent, sp.name, dst);
      } else {
        await vfs.move(sp.parent, sp.name, dp.parent);
        await vfs.rename(dp.parent, sp.name, dp.name);
      }
      return 'ok';
    },
    async cp(ctx, args) {
      const recursive = args[0] === '-r';
      const s = pnorm(args[recursive ? 1 : 0]);
      const d = pnorm(args[recursive ? 2 : 1]);
      if (!s || !d) return 'kullanım: cp [-r] <src> <dst>';
      const st = await vfs.statType(s);
      if (st === 'file' && !recursive) {
        const sp = split(s),
          dp = split(d);
        if ((await vfs.statType(d)) === 'dir') {
          await vfs.copy(sp.parent, sp.name, d);
        } else {
          await vfs.copy(sp.parent, sp.name, dp.parent);
          if (sp.name !== dp.name) await vfs.rename(dp.parent, sp.name, dp.name);
        }
      } else if (st === 'dir' && recursive) {
        await copyRecursive(s, d);
      } else return 'dizin için -r gerekli';
      return 'ok';
    },

    // Uygulama entegrasyonları
    async open(ctx, args) {
      const p = pnorm(args[0] || CWD);
      const t = await vfs.statType(p);
      if (t === 'dir') {
        window.dispatchEvent(new CustomEvent('open-folder', { detail: { path: p } }));
        return '';
      }
      if (t === 'file') {
        if (p.endsWith('.txt') || p.endsWith('.md')) launchApp('app.notepad', { path: p });
        else if (/\.(png|jpg|jpeg)$/i.test(p)) launchApp('app.paint', { path: p });
        else launchApp('app.notepad', { path: p });
        return '';
      }
      return 'bulunamadı';
    },
    async edit(ctx, args) {
      const p = pnorm(args[0] || CWD);
      launchApp('app.notepad', { path: p });
      return '';
    },
    async paint(ctx, args) {
      const p = pnorm(args[0] || '/Documents/Gallery/cizim.png');
      launchApp('app.paint', { path: p });
      return '';
    },

    // Metin/filtreleme (stdin destekli)
    async grep(ctx, args, stdin) {
      const flags = { i: false };
      while (args[0] && args[0].startsWith('-')) {
        const f = args.shift();
        if (f === '-i') flags.i = true;
      }
      const pattern = args.shift();
      if (!pattern) return 'kullanım: grep [-i] <regex> [path]';
      const rx = new RegExp(pattern, flags.i ? 'i' : '');
      let text = stdin;
      if (!text && args[0]) text = await vfs.readFile(pnorm(args[0])).catch(() => '');
      if (!text) return '';
      return text
        .split(/\r?\n/)
        .filter((l) => rx.test(l))
        .join('\n');
    },
    async find(ctx, args) {
      const root = pnorm(args[0] || CWD);
      let pattern = null;
      const ix = args.indexOf('-name');
      if (ix >= 0 && args[ix + 1]) pattern = args[ix + 1];
      let rx = null;
      if (pattern) {
        const esc = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\\\*/g, '.*')
          .replace(/\\\?/g, '.');
        rx = new RegExp('^' + esc + '$', 'i');
      }
      let out = '';
      async function walk(p, rel = '') {
        const a = await vfs.list(p).catch(() => []);
        for (const x of a) {
          const full = (p === '/' ? '' : p) + '/' + x.name;
          const relPath = (rel ? rel + '/' : '') + x.name;
          if (!rx || rx.test(x.name)) out += (x.type === 'dir' ? '[D] ' : '[F] ') + relPath + '\n';
          if (x.type === 'dir') await walk(full, relPath);
        }
      }
      await walk(root, '');
      return out.trim();
    },
    async head(ctx, args, stdin) {
      let n = 10;
      if (args[0] === '-n' && args[1]) {
        n = Number(args[1]) || 10;
        args = args.slice(2);
      }
      let text = stdin;
      if (!text && args[0]) text = await vfs.readFile(pnorm(args[0])).catch(() => '');
      if (!text) return '';
      return text.split(/\r?\n/).slice(0, n).join('\n');
    },
    async tail(ctx, args, stdin) {
      let n = 10;
      if (args[0] === '-n' && args[1]) {
        n = Number(args[1]) || 10;
        args = args.slice(2);
      }
      let text = stdin;
      if (!text && args[0]) text = await vfs.readFile(pnorm(args[0])).catch(() => '');
      if (!text) return '';
      const arr = text.split(/\r?\n/);
      return arr.slice(Math.max(0, arr.length - n)).join('\n');
    },
    async wc(ctx, args, stdin) {
      let text = stdin;
      if (!text && args[0]) text = await vfs.readFile(pnorm(args[0])).catch(() => '');
      if (!text) return '0 0 0';
      const lines = text.split(/\r?\n/);
      const words = text.trim() ? text.trim().split(/\s+/) : [];
      const chars = text.length;
      const flag = args[0];
      if (flag === '-l') return String(lines.length);
      if (flag === '-w') return String(words.length);
      if (flag === '-c') return String(chars);
      return `${lines.length} ${words.length} ${chars}`;
    },
    async sort(ctx, args, stdin) {
      let text = stdin || '';
      const r = args[0] === '-r';
      const arr = text.split(/\r?\n/).sort((a, b) => a.localeCompare(b, 'tr'));
      if (r) arr.reverse();
      return arr.join('\n');
    },
    async uniq(ctx, args, stdin) {
      const seen = new Set();
      const out = [];
      for (const l of (stdin || '').split(/\r?\n/)) {
        if (seen.has(l)) continue;
        seen.add(l);
        out.push(l);
      }
      return out.join('\n');
    },

    // Oturum & profil
    async date() {
      return new Date().toLocaleString(env.LANG || 'tr-TR');
    },
    async clear() {
      screen.innerHTML = '';
      return '';
    },
    async history() {
      return history
        .map((l, i) => `${String(i + 1).padStart(4, ' ')}  ${l}`)
        .slice(-200)
        .join('\n');
    },
    async alias(ctx, args) {
      if (!args.length) return Object.entries(aliases).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n');
      for (const spec of args) {
        const m = spec.match(/^([A-Za-z_]\w*)=(.+)$/);
        if (!m) return 'kullanım: alias NAME="komut ..."';
        aliases[m[1]] = m[2].replace(/^"|"$/g, '');
      }
      return 'ok';
    },
    async unalias(ctx, args) {
      if (!args[0]) return 'kullanım: unalias <NAME>';
      delete aliases[args[0]];
      return 'ok';
    },
    async set(ctx, args) {
      const m = (args[0] || '').match(/^([A-Za-z_]\w*)=(.*)$/);
      if (!m) return 'kullanım: set VAR=DEĞER';
      env[m[1]] = m[2];
      updatePrompt();
      return 'ok';
    },
    async get(ctx, args) {
      const k = args[0];
      return k ? env[k] ?? '' : 'kullanım: get VAR';
    },
    async env() {
      return Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
    },
    async prompt(ctx, args) {
      if (!args[0]) return `şablon: ${promptTpl}`;
      promptTpl = args.join(' ');
      updatePrompt();
      return 'ok';
    },
    async profile(ctx, args) {
      const sub = args[0];
      if (sub === 'save') {
        await vfs.writeFile(PROFILE_PATH, JSON.stringify({ aliases, env, prompt: promptTpl }, null, 2));
        return 'profil kaydedildi';
        }
      if (sub === 'load') {
        try {
          const p = JSON.parse(await vfs.readFile(PROFILE_PATH));
          aliases = p.aliases || {};
          env = { ...env, ...(p.env || {}) };
          promptTpl = p.prompt || promptTpl;
          updatePrompt();
          return 'profil yüklendi';
        } catch {
          return 'profil bulunamadı';
        }
      }
      return 'kullanım: profile save | profile load';
    },

    // Zamanlama / izleme
    async sleep(ctx, args) {
      const spec = args[0] || '1s';
      const ms = parseTimeMs(spec);
      await new Promise((r) => setTimeout(r, ms));
      return '';
    },
    async watch(ctx, args) {
      const ivSpec = args.shift();
      if (!ivSpec) return 'kullanım: watch <interval> <komut...>';
      const ms = parseTimeMs(ivSpec);
      const cmdline = args.join(' ');
      const id = watchers.length ? Math.max(...watchers.map((w) => w.id)) + 1 : 1;
      const runOnce = async () => {
        const out = await execLine(cmdline);
        if (out != null && out !== '') {
          logHtml(
            `<div class="dim">[${new Date().toLocaleTimeString(env.LANG)}]</div>\n<pre>${escapeHtml(out)}</pre>`,
            'stdout'
          );
        }
      };
      const timer = setInterval(runOnce, ms);
      watchers.push({ id, timer, spec: { every: ms, cmd: cmdline } });
      ok(`watch #${id} başlatıldı (${ivSpec})`);
      await runOnce();
      return '';
    },
    async ps() {
      return watchers.map((w) => `#${w.id}  every=${w.spec.every}ms  ${w.spec.cmd}`).join('\n');
    },
    async kill(ctx, args) {
      const id = Number(args[0]);
      const w = watchers.find((x) => x.id === id);
      if (!w) return 'bulunamadı';
      clearInterval(w.timer);
      watchers.splice(watchers.indexOf(w), 1);
      return `kapatıldı #${id}`;
    }
  };

  // ---------- EXECUTION PIPELINE ----------
  const KNOWN_CMDS = new Set([
    'help',
    'pwd',
    'cd',
    'ls',
    'tree',
    'cat',
    'echo',
    'touch',
    'mkdir',
    'rm',
    'mv',
    'cp',
    'open',
    'edit',
    'paint',
    'grep',
    'find',
    'head',
    'tail',
    'wc',
    'sort',
    'uniq',
    'date',
    'clear',
    'history',
    'alias',
    'unalias',
    'set',
    'get',
    'env',
    'prompt',
    'profile',
    'sleep',
    'watch',
    'ps',
    'kill'
  ]);

  async function autoComplete() {
    const val = cmdInp.value;
    const pos = cmdInp.selectionStart ?? val.length;
    const left = val.slice(0, pos);
    const right = val.slice(pos);
    const m = left.match(/(?:^|\s)([^|\s]+)$/);
    if (!m) return;
    const token = m[1];

    // first token → command/alias
    const tokens = tokenize(val).tokens;
    const isFirst = tokens.length <= 1 || (tokens.length > 0 && left.trim().split(/\s+/).length === 1);
    if (isFirst) {
      const pool = new Set([...KNOWN_CMDS, ...Object.keys(aliases)]);
      const cand = [...pool].filter((x) => x.startsWith(token));
      if (cand.length === 1) {
        cmdInp.value = left.slice(0, left.length - token.length) + cand[0] + right;
      } else if (cand.length > 1) {
        log(cand.join('  '));
      }
      return;
    }

    // path completion
    const pathPart = token;
    const { dir, base } = (() => {
      if (pathPart.includes('/')) {
        const idx = pathPart.lastIndexOf('/');
        return { dir: pnorm(pathPart.slice(0, idx) || CWD), base: pathPart.slice(idx + 1) };
      }
      return { dir: CWD, base: pathPart };
    })();
    try {
      const items = await vfs.list(dir);
      const cand = items.map((x) => x.name).filter((n) => n.startsWith(base));
      if (cand.length === 1) {
        const completed = pathPart.replace(/[^/]*$/, cand[0]);
        cmdInp.value = left.slice(0, left.length - pathPart.length) + completed + right;
      } else if (cand.length > 1) {
        log(cand.join('  '));
      }
    } catch {}
  }

  async function execLine(line) {
    let { segments, redirect } = tokenize(line);
    segments = segments.map((seg) => seg.map(expand));
    // expand alias only on first token of each segment
    segments = segments.map((seg) => {
      if (!seg.length) return seg;
      const [first, ...rest] = seg;
      if (aliases[first]) {
        const repl = tokenize(aliases[first]).segments[0];
        return [...repl, ...rest];
      }
      return seg;
    });

    let lastOut = '';
    for (const seg of segments) {
      if (!seg.length) continue;
      const [cmd, ...args] = seg;
      const fn = CMDS[cmd];
      if (!fn) {
        lastOut = `bilinmeyen komut: ${cmd}`;
        break;
      }
      try {
        lastOut = await fn({}, args, lastOut);
      } catch (e) {
        lastOut = 'Hata: ' + (e?.message || e);
      }
    }

    // redirection on final output
    if (redirect && lastOut != null) {
      const pth = pnorm(redirect.path);
      if (redirect.op === '>') await vfs.writeFile(pth, lastOut);
      else if (redirect.op === '>>') {
        const prev = await vfs.readFile(pth).catch(() => '');
        await vfs.writeFile(pth, (prev || '') + lastOut);
      }
      return ''; // nothing to echo
    }
    return lastOut;
  }

  // ---------- INPUT HANDLERS ----------
  async function runInput() {
    const line = cmdInp.value;
    if (!line.trim()) return;

    // echo command with prompt (HTML, ama içi escape'li)
    logHtml(
      `<span class="promptline">${escapeHtml(promptEl.textContent)}${escapeHtml(line)}</span>`,
      'cmdline'
    );

    // push to history
    history.push(line);
    if (history.length > 1000) history.shift();
    hIndex = null;
    cmdInp.value = '';
    try {
      await vfs.writeFile(HISTORY_PATH, JSON.stringify(history));
    } catch {}

    const out = await execLine(line);
    if (out != null && out !== '') log(out);
  }

  rootEl.querySelector('[data-act=run]').addEventListener('click', runInput);
  cmdInp.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await runInput();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      await autoComplete();
      return;
    }
    if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      CMDS.clear();
      return;
    }
    if (e.key === 'ArrowUp') {
      if (history.length === 0) return;
      if (hIndex === null) hIndex = history.length - 1;
      else hIndex = Math.max(0, hIndex - 1);
      cmdInp.value = history[hIndex];
      cmdInp.setSelectionRange(cmdInp.value.length, cmdInp.value.length);
      e.preventDefault();
    }
    if (e.key === 'ArrowDown') {
      if (history.length === 0) return;
      if (hIndex === null) return;
      hIndex = Math.min(history.length, hIndex + 1);
      if (hIndex >= history.length) {
        cmdInp.value = '';
        hIndex = null;
      } else {
        cmdInp.value = history[hIndex];
        cmdInp.setSelectionRange(cmdInp.value.length, cmdInp.value.length);
      }
      e.preventDefault();
    }
  });

  // Initial banner
  log('MyExplorerV2 Terminal — gelişmiş sürüm (help yaz)');
  log('CWD = ' + CWD);
}
