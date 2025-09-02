// Apps/VExecRunner/main.js
// .vexe (Virtual Executable) manifestlerini açar ve içindeki entryHtml'i çalıştırır (iframe sandbox).

export async function mount(root, ctx){
  const { vfs } = ctx || {};
  const UI = window.ui || {};
  const pickVfsFile = UI.pickVfsFile || (async()=>null);

  // FIX: attrs null gelebilir → guard
  function h(t,a={},...c){
    const e = document.createElement(t);
    const attrs = a || {};
    for (const [k,v] of Object.entries(attrs)){
      if (k === 'class') e.className = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v);
    }
    for (const x of c){ if (x==null) continue; e.appendChild(typeof x==='string' ? document.createTextNode(x) : x); }
    return e;
  }

  const log = (m)=>{ const el = root.querySelector('.r-log'); if(!el) return; el.textContent += `[${new Date().toLocaleTimeString()}] ${m}\n`; el.scrollTop = el.scrollHeight; };

  root.innerHTML = "";
  root.appendChild(
    h("div",{class:"runner"},
      h("div",{class:"r-head"},
        h("div",{class:"r-title"},"VExec Runner"),
        h("div",{class:"r-actions"},
          h("button",{class:"btn", id:"btn-open"},".vexe seç"),
          h("button",{class:"btn primary", id:"btn-reload"},"Yeniden Yükle")
        )
      ),
      h("div",{class:"r-actions", style:"padding:0 10px"},
        h("span", null, "Seçilen: "), h("code",{id:"sel-path"},"—")
      ),
      h("div",{class:"r-host"},
        // Not: sandbox'a sadece script izinli. same-origin gerekmez.
        h("iframe",{class:"frame", id:"frame", sandbox:"allow-scripts"})
      ),
      h("pre",{class:"r-log", id:"log"})
    )
  );

  let currentPath = null;

  async function openVexe(path){
    try{
      const txt = await vfs.readFile(path);
      const j = JSON.parse(txt);
      if (!j || !j.entryHtml) throw new Error(".vexe manifestinde 'entryHtml' yok.");
      currentPath = path;
      root.querySelector("#sel-path").textContent = path;
      // HTML'i oku ve yükle (bundler artık meta-CSP gömüyor; yine de burada guard var)
      let html = await vfs.readFile(j.entryHtml);
      if (!/http-equiv=["']Content-Security-Policy["']/i.test(html)){
        html = html.replace(
          /<head[^>]*>/i,
          m => `${m}\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none';">`
        );
      }
      const frame = root.querySelector("#frame");
      frame.srcdoc = html;
      log("Çalıştırıldı: " + j.entryHtml);
    }catch(e){
      log("Hata: " + (e?.message || e));
    }
  }

  document.getElementById("btn-open").addEventListener("click", async ()=>{
    const p = await pickVfsFile ? pickVfsFile({ startDir:"/System/Program Files", exts:[".vexe"] }) : null;
    if (p) openVexe(p);
  });

  document.getElementById("btn-reload").addEventListener("click", ()=>{
    if (!currentPath) return;
    openVexe(currentPath);
  });

  // (opsiyonel) Explorer parametresiyle açılabiliyorsa
  if (ctx && ctx.openFilePath){
    try{ await openVexe(ctx.openFilePath); }catch{}
  }
}
