export async function mount(rootEl, { vfs, args }) {
  rootEl.className = 'notepad';
  rootEl.innerHTML = `
    <div class="bar">
      <button data-act="new">Yeni</button>
      <button data-act="open">Aç</button>
      <button data-act="save">Kaydet</button>
      <input class="path" placeholder="/Documents/Notes/yeni.txt"/>
    </div>
    <textarea class="editor" spellcheck="false" placeholder="Yazmaya başlayın..."></textarea>
  `;
  const pathInp = rootEl.querySelector('.path');
  const editor  = rootEl.querySelector('.editor');
  const setPath = (p)=> pathInp.value = p;

  if (args?.path) { setPath(args.path); const txt = await vfs.readFile(args.path).catch(()=> ''); editor.value = txt; }
  else setPath('/Documents/Notes/yeni.txt');

  rootEl.querySelector('[data-act=new]').addEventListener('click', ()=>{ editor.value=''; setPath('/Documents/Notes/yeni.txt'); });
  rootEl.querySelector('[data-act=open]').addEventListener('click', async ()=>{
    const p = prompt('Açılacak yol:', pathInp.value || '/Documents/Notes/'); if (!p) return;
    const txt = await vfs.readFile(p).catch(()=> ''); editor.value = txt; setPath(p);
  });
  rootEl.querySelector('[data-act=save]').addEventListener('click', async ()=>{
    const p = pathInp.value || '/Documents/Notes/yeni.txt';
    await vfs.writeFile(p, editor.value); alert('Kaydedildi: '+p);
  });
}
