/* -------------------------------------------------------
 * DevStudio Syntax Highlighter (HTML, JSON, JS, CSS)
 * - Tokenizer tabanlı, hızlı ve bloklamayan
 * - Basit diagnostics (hata/uyarı) üretir
 * - Çıktı: <span class="tok-..."> ile vurgulama
 * - Global: window.Syntax
 * ----------------------------------------------------- */

(function () {
  "use strict";

  // ---------- Yardımcılar ----------
  const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
  const esc = (s) => s.replace(/[&<>]/g, (m) => ESC_MAP[m]);

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function posFromIndex(text, idx) {
    let line = 1, col = 1;
    for (let i = 0; i < idx; i++) {
      if (text.charCodeAt(i) === 10) { line++; col = 1; }
      else col++;
    }
    return { line, col };
  }

  function wrap(tokClass, text) {
    if (!text) return "";
    return `<span class="${tokClass}">${esc(text)}</span>`;
  }

  function injectBaseStylesOnce() {
    // Gerekirse minimal fallback stil (senin styles.css'in varsa uyum sağlar)
    if (document.getElementById("ds-syntax-fallback-style")) return;
    const css = `
      .ds-highlight { white-space: pre; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .ds-squiggle { text-decoration: underline wavy currentColor; text-underline-position: under; }
      .tok-comment { opacity: .75; }
      .tok-keyword { font-weight: 600; }
      .tok-string  { }
      .tok-number  { }
      .tok-bool, .tok-null { font-style: italic; }
      .tok-op, .tok-punc { }
      .tok-tag, .tok-attr { font-weight: 500; }
      .tok-regex { }
      .tok-error { background: rgba(255,0,0,.08); border-bottom: 1px wavy rgba(255,0,0,.8); }
    `.trim();
    const style = document.createElement("style");
    style.id = "ds-syntax-fallback-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------- Dil algılama ----------
  const LANG_EXT = {
    html: [".html", ".htm", ".xhtml", ".xml"],
    json: [".json"],
    js:   [".js", ".mjs", ".cjs", ".ts", ".tsx"], // TS'yi JS kurallarıyla boyar
    css:  [".css", ".scss", ".sass", ".less"]     // hepsi CSS kurallarıyla boyanır
  };

  function detectLang(hint) {
    if (!hint) return "js";
    const h = String(hint).toLowerCase();

    // filename veya path ise uzantıya bak
    for (const [lang, exts] of Object.entries(LANG_EXT)) {
      if (exts.some(ext => h.endsWith(ext))) return lang;
    }

    // MIME
    if (h.includes("html")) return "html";
    if (h.includes("json")) return "json";
    if (h.includes("css"))  return "css";
    if (h.includes("javascript") || h.includes("ecmascript")) return "js";

    // İçerik sezgisi
    if (h.trim().startsWith("<")) return "html";
    if (/^\s*[\{\[]/.test(h)) return "json";
    return "js";
  }

  // ---------- JSON ----------
  const jsonTokenRE = /"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[\{\}\[\]:,]/gy;
  function highlightJSON(code) {
    let out = "";
    jsonTokenRE.lastIndex = 0;
    let m; let last = 0;
    while ((m = jsonTokenRE.exec(code))) {
      const i = m.index;
      out += esc(code.slice(last, i));
      const t = m[0];
      if (t[0] === '"') {
        // anahtar mı değer mi? (öncesine bak)
        const prev = code.slice(0, i).match(/[:\{\[,]\s*$/);
        out += wrap(prev ? "tok-string" : "tok-string", t); // ikisi de string, stil farkı istemezsen aynı kalsın
      } else if (t === "true" || t === "false") {
        out += wrap("tok-bool", t);
      } else if (t === "null") {
        out += wrap("tok-null", t);
      } else if (/^[\{\}\[\]:,]$/.test(t)) {
        out += wrap("tok-punc", t);
      } else {
        out += wrap("tok-number", t);
      }
      last = jsonTokenRE.lastIndex;
    }
    out += esc(code.slice(last));
    return out;
  }

  function lintJSON(code) {
    try { JSON.parse(code); return []; }
    catch (e) {
      // Satır/sütun yakalamaya çalış
      const msg = String(e.message || "JSON parse error");
      // Chrome/Node genelde position verir, manual hesaplayalım:
      // basit strateji: hatalı index'i regex’ten çekmeye çalışma → parse önceki kısma kadar scan ederek en son geçerli konumu bulamayız
      // pratik: \n sayarak hata satırını kaba bulalım
      let line = 1, col = 1;
      // bazı motorlarda message "Unexpected token } in JSON at position 42"
      const m = msg.match(/position\s+(\d+)/i);
      if (m) {
        const pos = clamp(parseInt(m[1], 10) || 0, 0, code.length);
        const p = posFromIndex(code, pos);
        line = p.line; col = p.col;
      }
      return [{ message: msg, line, col, endLine: line, endCol: col + 1, severity: "error" }];
    }
  }

  // ---------- JS ----------
  const JS_KEYWORDS = new Set((
    "break,case,catch,class,const,continue,debugger,default,delete,do,else,export,extends," +
    "finally,for,function,if,import,in,instanceof,let,new,return,super,switch,this,throw," +
    "try,typeof,var,void,while,with,yield,of,as,enum,await,implements,interface,package,private,protected,public,static"
  ).split(","));

  function highlightJS(code) {
    let i = 0, out = "", len = code.length;
    let couldBeRegex = true; // satır başında veya operator sonra true olur
    const push = (cls, s) => { out += wrap(cls, s); };

    function peek(n=0){ return code[i + n] || ""; }
    function take(n){ const s = code.slice(i, i+n); i += n; return s; }

    while (i < len) {
      const ch = peek();

      // whitespace
      if (/\s/.test(ch)) { out += esc(ch); i++; continue; }

      // comments
      if (ch === "/") {
        const n1 = peek(1);
        if (n1 === "/") { // line comment
          let j = i + 2;
          while (j < len && code[j] !== "\n") j++;
          push("tok-comment", code.slice(i, j));
          i = j;
          couldBeRegex = true;
          continue;
        }
        if (n1 === "*") { // block comment
          let j = i + 2, closed = false;
          while (j < len) {
            if (code[j] === "*" && code[j+1] === "/") { j += 2; closed = true; break; }
            j++;
          }
          const s = code.slice(i, j);
          push("tok-comment", s);
          i = j;
          couldBeRegex = true;
          continue;
        }
        // regex literal?
        if (couldBeRegex) {
          // kaba regex literal okuyucu
          let j = i + 1, inClass = false, ok = false;
          while (j < len) {
            const c = code[j];
            if (c === "\\" && j+1 < len) { j += 2; continue; }
            if (!inClass && c === "/") { j++; ok = true; break; }
            if (c === "[" && !inClass) { inClass = true; j++; continue; }
            if (c === "]" && inClass) { inClass = false; j++; continue; }
            if (c === "\n") break;
            j++;
          }
          if (ok) {
            // flags
            while (/[a-z]/i.test(code[j])) j++;
            push("tok-regex", code.slice(i, j));
            i = j;
            couldBeRegex = false;
            continue;
          }
        }
      }

      // strings / template
      if (ch === "'" || ch === '"') {
        const quote = ch; let j = i + 1;
        while (j < len) {
          const c = code[j];
          if (c === "\\" && j+1 < len) { j += 2; continue; }
          if (c === quote) { j++; break; }
          if (c === "\n") break;
          j++;
        }
        push("tok-string", code.slice(i, j));
        i = j;
        couldBeRegex = false;
        continue;
      }
      if (ch === "`") {
        let j = i + 1; let depth = 0;
        while (j < len) {
          const c = code[j];
          if (c === "\\" && j+1 < len) { j += 2; continue; }
          if (c === "`" && depth === 0) { j++; break; }
          if (c === "$" && code[j+1] === "{") { depth++; j += 2; continue; }
          if (c === "}" && depth > 0) { depth--; j++; continue; }
          j++;
        }
        push("tok-string", code.slice(i, j));
        i = j;
        couldBeRegex = false;
        continue;
      }

      // numbers
      if (/\d/.test(ch) || (ch === "." && /\d/.test(peek(1)))) {
        let j = i;
        if (ch === "0" && /[xob]/i.test(peek(1))) { // 0x, 0o, 0b
          j += 2;
          while (/[0-9a-f]/i.test(code[j])) j++;
        } else {
          while (/\d/.test(code[j])) j++;
          if (code[j] === ".") { j++; while (/\d/.test(code[j])) j++; }
          if (/[eE]/.test(code[j])) { j++; if (/[+-]/.test(code[j])) j++; while (/\d/.test(code[j])) j++; }
        }
        push("tok-number", code.slice(i, j));
        i = j;
        couldBeRegex = false;
        continue;
      }

      // identifiers / keywords
      if (/[A-Za-z_$]/.test(ch)) {
        let j = i + 1;
        while (/[A-Za-z0-9_$]/.test(code[j])) j++;
        const ident = code.slice(i, j);
        if (JS_KEYWORDS.has(ident)) push("tok-keyword", ident);
        else if (ident === "true" || ident === "false") push("tok-bool", ident);
        else if (ident === "null" || ident === "undefined") push("tok-null", ident);
        else push("tok-ident", ident);
        i = j;
        couldBeRegex = false;
        continue;
      }

      // operators / punctuation
      if (/[{}()\[\];,.?:]/.test(ch)) {
        push("tok-punc", ch);
        i++;
        // bazı durumlarda regex başlayabilir
        couldBeRegex = /[({\[;,?:]/.test(ch);
        continue;
      }
      if (/[+\-*%=&|^!<>~]/.test(ch)) {
        // en uzun eşleşeni yakala
        let j = i + 1;
        while (/[+\-*%=&|^!<>~]/.test(code[j])) j++;
        push("tok-op", code.slice(i, j));
        i = j;
        couldBeRegex = true;
        continue;
      }

      // fallback
      out += esc(ch); i++;
    }
    return out;
  }

  function lintJS(code) {
    const diags = [];
    const stack = [];
    let i = 0, len = code.length;
    let line = 1, col = 1;
    let inSL = false, inML = false, inStr = null, inTpl = false, tplDepth = 0;

    function pushDiag(msg, idxFrom, idxTo) {
      const p1 = posFromIndex(code, idxFrom);
      const p2 = posFromIndex(code, idxTo);
      diags.push({ message: msg, line: p1.line, col: p1.col, endLine: p2.line, endCol: p2.col, severity: "error" });
    }

    while (i < len) {
      const ch = code[i], n1 = code[i+1];
      // newline
      if (ch === "\n") { line++; col = 1; i++; inSL = false; continue; }
      col++;

      // comments
      if (!inStr && !inTpl && ch === "/" && n1 === "/" && !inML) { inSL = true; i += 2; continue; }
      if (!inStr && !inTpl && ch === "/" && n1 === "*" && !inSL) { inML = true; i += 2; continue; }
      if (inSL) { i++; continue; }
      if (inML) {
        if (ch === "*" && n1 === "/") { inML = false; i += 2; continue; }
        i++; continue;
      }

      // strings
      if (!inTpl && !inStr && (ch === "'" || ch === '"')) { inStr = ch; i++; continue; }
      if (inStr) {
        if (ch === "\\" && i+1 < len) { i += 2; continue; }
        if (ch === inStr) { inStr = null; i++; continue; }
        if (ch === "\n") { pushDiag("Satır sonu öncesi kapanmayan string", i, i+1); inStr = null; }
        i++; continue;
      }

      // template
      if (!inTpl && ch === "`") { inTpl = true; tplDepth = 0; i++; continue; }
      if (inTpl) {
        if (ch === "\\" && i+1 < len) { i += 2; continue; }
        if (ch === "`" && tplDepth === 0) { inTpl = false; i++; continue; }
        if (ch === "$" && n1 === "{") { tplDepth++; i += 2; continue; }
        if (ch === "}" && tplDepth > 0) { tplDepth--; i++; continue; }
        i++; continue;
      }

      // brackets
      if ("({[".includes(ch)) stack.push({ ch, idx: i });
      else if (")}]".includes(ch)) {
        const want = ch === ")" ? "(" : ch === "}" ? "{" : "[";
        const top = stack.pop();
        if (!top || top.ch !== want) pushDiag(`Eşleşmeyen kapanış '${ch}'`, i, i+1);
      }

      i++;
    }

    if (inML) pushDiag("Kapanmayan blok yorum '/* ... */'", len-1, len);
    if (inStr) pushDiag("Kapanmayan string", len-1, len);
    if (inTpl) pushDiag("Kapanmayan template string", len-1, len);
    if (stack.length) {
      for (const s of stack) pushDiag(`Kapanmayan '${s.ch}'`, s.idx, s.idx + 1);
    }
    return diags;
  }

  // ---------- HTML ----------
  const VOID_TAGS = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);
  function highlightHTML(code) {
    let out = "", i = 0, len = code.length;

    while (i < len) {
      const lt = code.indexOf("<", i);
      if (lt < 0) { out += esc(code.slice(i)); break; }
      out += esc(code.slice(i, lt));
      // comment?
      if (code.startsWith("<!--", lt)) {
        const end = code.indexOf("-->", lt + 4);
        const j = end >= 0 ? end + 3 : len;
        out += wrap("tok-comment", code.slice(lt, j));
        i = j; continue;
      }
      // doctype or conditional
      if (code.startsWith("<!", lt)) {
        const j = code.indexOf(">", lt+2);
        const end = j >= 0 ? j+1 : len;
        out += wrap("tok-punc", code.slice(lt, end));
        i = end; continue;
      }
      // tag
      const gt = code.indexOf(">", lt + 1);
      const end = gt >= 0 ? gt + 1 : len;
      const tagInner = code.slice(lt + 1, gt >= 0 ? gt : len);
      const isClose = tagInner.startsWith("/");
      const parts = tagInner.trim().split(/\s+/);
      const tagName = (isClose ? parts[0].slice(1) : parts[0]).toLowerCase();

      let tagHTML = "&lt;" + (isClose ? "/" : "");
      if (parts[0]) tagHTML += wrap("tok-tag", esc(parts[0].replace(/^\//, "")));

      // attributes
      if (!isClose && parts.length > 1) {
        const attrs = tagInner.slice(parts[0].length);
        // kaba ayrıştırma: name="value" | name='value' | name=value | name
        let j = 0;
        while (j < attrs.length) {
          if (/\s/.test(attrs[j])) { tagHTML += esc(attrs[j]); j++; continue; }
          const nameMatch = attrs.slice(j).match(/^[^\s=/>]+/);
          if (!nameMatch) { tagHTML += esc(attrs[j]); j++; continue; }
          const name = nameMatch[0];
          tagHTML += wrap("tok-attr", name);
          j += name.length;
          if (attrs[j] === "=") {
            tagHTML += wrap("tok-op", "=");
            j++;
            // value
            if (attrs[j] === '"' || attrs[j] === "'") {
              const q = attrs[j]; let k = j+1;
              while (k < attrs.length) {
                if (attrs[k] === "\\" && k+1 < attrs.length) { k += 2; continue; }
                if (attrs[k] === q) { k++; break; }
                k++;
              }
              tagHTML += wrap("tok-string", esc(attrs.slice(j, k)));
              j = k;
            } else {
              const vm = attrs.slice(j).match(/^[^\s>]+/);
              if (vm) { tagHTML += wrap("tok-string", esc(vm[0])); j += vm[0].length; }
            }
          }
        }
      }
      tagHTML += "&gt;";
      out += tagHTML;
      i = end;
    }
    return out;
  }

  function lintHTML(code) {
    const diags = [];
    const stack = [];
    let i = 0, len = code.length;
    while (i < len) {
      const lt = code.indexOf("<", i);
      if (lt < 0) break;
      if (code.startsWith("<!--", lt)) {
        const end = code.indexOf("-->", lt + 4);
        if (end < 0) {
          const p = posFromIndex(code, lt);
          diags.push({ message: "Kapanmayan HTML yorum", line: p.line, col: p.col, endLine: p.line, endCol: p.col+4, severity: "error" });
          break;
        }
        i = end + 3; continue;
      }
      const gt = code.indexOf(">", lt + 1);
      if (gt < 0) {
        const p = posFromIndex(code, lt);
        diags.push({ message: "Kapanmayan tag '>'", line: p.line, col: p.col, endLine: p.line, endCol: p.col+1, severity: "error" });
        break;
      }
      const inner = code.slice(lt + 1, gt).trim();
      if (inner[0] === "!") { i = gt + 1; continue; }
      const close = inner.startsWith("/");
      const name = (close ? inner.slice(1) : inner).split(/\s+/)[0].toLowerCase();
      if (!close && !VOID_TAGS.has(name) && !inner.endsWith("/")) {
        stack.push({ name, idx: lt });
      } else if (close) {
        const top = stack.pop();
        if (!top || top.name !== name) {
          const p = posFromIndex(code, lt);
          diags.push({ message: `Eşleşmeyen kapanış </${name}>`, line: p.line, col: p.col, endLine: p.line, endCol: p.col+name.length+3, severity: "error" });
        }
      }
      i = gt + 1;
    }
    for (const t of stack) {
      const p = posFromIndex(code, t.idx);
      diags.push({ message: `Kapanmayan <${t.name}>`, line: p.line, col: p.col, endLine: p.line, endCol: p.col+t.name.length+1, severity: "error" });
    }
    return diags;
  }

  // ---------- CSS ----------
  function highlightCSS(code) {
    // Çok kaba: yorum, @rule, selector, property, value, braces
    let out = "", i = 0, len = code.length;
    while (i < len) {
      const ch = code[i], n1 = code[i+1];
      if (ch === "/" && n1 === "*") {
        let j = i + 2;
        while (j < len && !(code[j] === "*" && code[j+1] === "/")) j++;
        j = Math.min(j + 2, len);
        out += wrap("tok-comment", code.slice(i, j)); i = j; continue;
      }
      if (ch === "@" ) {
        // @media, @import ...
        let j = i+1;
        while (j < len && /[a-z-]/i.test(code[j])) j++;
        out += wrap("tok-keyword", code.slice(i, j));
        i = j; continue;
      }
      if (ch === "{" || ch === "}" || ch === ":" || ch === ";" || ch === "," ) {
        out += wrap("tok-punc", ch); i++; continue;
      }
      if (ch === "'" || ch === '"') {
        const q = ch; let j = i + 1;
        while (j < len) {
          if (code[j] === "\\" && j+1 < len) { j += 2; continue; }
          if (code[j] === q) { j++; break; }
          j++;
        }
        out += wrap("tok-string", code.slice(i, j)); i = j; continue;
      }
      if (/[0-9]/.test(ch)) {
        let j = i;
        while (/[0-9.]/.test(code[j])) j++;
        // unit
        while (/[a-z%]/i.test(code[j])) j++;
        out += wrap("tok-number", code.slice(i, j)); i = j; continue;
      }
      // fallback: kelimeleri attr/selector gibi boya
      let j = i;
      while (j < len && !/[\s{}:;,'"]/ .test(code[j])) j++;
      const word = code.slice(i, j);
      out += wrap(/^[a-z-]+$/i.test(word) ? "tok-ident" : "tok-op", word);
      i = j;
      // whitespace’i normal kaçır
      if (/\s/.test(code[i])) { out += esc(code[i]); i++; }
    }
    return out;
  }

  function lintCSS(code) {
    const diags = [];
    let depth = 0, i = 0, len = code.length, inC = false;
    while (i < len) {
      const ch = code[i], n1 = code[i+1];
      if (!inC && ch === "/" && n1 === "*") { inC = true; i += 2; continue; }
      if (inC) { if (ch === "*" && n1 === "/") { inC = false; i += 2; continue; } i++; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") { if (depth === 0) {
        const p = posFromIndex(code, i);
        diags.push({ message: "Beklenmedik '}'", line: p.line, col: p.col, endLine: p.line, endCol: p.col+1, severity: "error" });
      } else depth--; }
      i++;
    }
    if (inC) {
      const p = posFromIndex(code, len-1);
      diags.push({ message: "Kapanmayan CSS yorum", line: p.line, col: p.col, endLine: p.line, endCol: p.col+1, severity: "error" });
    }
    if (depth > 0) {
      const p = posFromIndex(code, len-1);
      diags.push({ message: "Kapanmayan '{'", line: p.line, col: p.col, endLine: p.line, endCol: p.col+1, severity: "error" });
    }
    // Basit uyarı: iki nokta/virgül eksikliği
    const noColon = code.match(/^[\t ]*[a-z-]+\s+[^\s{:;]+$/m);
    if (noColon) {
      const idx = noColon.index || 0;
      const p = posFromIndex(code, idx);
      diags.push({ message: "Olası eksik ':'", line: p.line, col: p.col, endLine: p.line, endCol: p.col+1, severity: "warning" });
    }
    return diags;
  }

  // ---------- Birleştirici ----------
  function highlightToHTML(code, lang) {
    const L = lang || "js";
    switch (L) {
      case "json": return highlightJSON(code);
      case "html": return highlightHTML(code);
      case "css":  return highlightCSS(code);
      case "js":
      default:     return highlightJS(code);
    }
  }

  function lint(code, lang) {
    const L = lang || "js";
    switch (L) {
      case "json": return lintJSON(code);
      case "html": return lintHTML(code);
      case "css":  return lintCSS(code);
      case "js":
      default:     return lintJS(code);
    }
  }

  // ---------- DOM entegrasyonu ----------
  function apply(el, lang, code) {
    injectBaseStylesOnce();
    const L = lang || detectLang(el?.dataset?.lang || "");
    const src = code != null ? String(code) : (el.textContent || "");
    el.classList.add("ds-highlight");
    el.setAttribute("data-lang", L);
    el.innerHTML = highlightToHTML(src, L);

    // diagnostics göster (altı dalgalı)
    const diags = lint(src, L);
    if (diags.length) {
      // basit yaklaşım: sonuna küçük bir özet ekle
      const box = document.createElement("div");
      box.className = "ds-diags";
      box.style.cssText = "margin-top:8px;font:12px/1.4 ui-monospace,monospace;opacity:.9;";
      for (const d of diags) {
        const lineInfo = `L${d.line}:${d.col}`;
        const row = document.createElement("div");
        row.textContent = `• (${lineInfo}) ${d.severity || "error"}: ${d.message}`;
        box.appendChild(row);
      }
      el.appendChild(box);
    }
  }

  function rehighlight(root=document) {
    const nodes = root.querySelectorAll('pre.code, code.code, .code[data-lang], pre[data-lang], code[data-lang]');
    nodes.forEach((n) => apply(n, n.getAttribute("data-lang")));
  }

  // ---------- Global API ----------
  const Syntax = { detectLang, highlightToHTML, apply, rehighlight, lint };
  if (typeof window !== "undefined") window.Syntax = Syntax;
  if (typeof module !== "undefined" && module.exports) module.exports = Syntax;
})();
