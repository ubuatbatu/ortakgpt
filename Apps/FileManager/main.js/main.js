// File Manager main.js

document.addEventListener('DOMContentLoaded', () => {
  let currentPath = '/';
  const container = document.createElement('div');
  container.id = 'file-manager';
  container.style.padding = '10px';

  const pathBar = document.createElement('div');
  pathBar.id = 'fm-path';
  pathBar.style.marginBottom = '10px';
  container.appendChild(pathBar);

  const listElem = document.createElement('ul');
  listElem.id = 'fm-list';
  listElem.style.listStyle = 'none';
  listElem.style.padding = '0';
  container.appendChild(listElem);

  document.body.appendChild(container);

  async function render() {
    pathBar.textContent = currentPath;
    listElem.innerHTML = '';
    const entries = await window.vfs.list(currentPath);
    for (const entry of entries) {
      const li = document.createElement('li');
      li.textContent = entry.name + (entry.type === 'dir' ? '/' : '');
      li.style.cursor = 'pointer';
      li.addEventListener('dblclick', async () => {
        if (entry.type === 'dir') {
          currentPath = entry.path;
          await render();
        } else {
          if (window.apps && window.apps.launch) {
            window.apps.launch('app.notepad', { path: entry.path });
          }
        }
      });
      listElem.appendChild(li);
    }
  }

  render();
});
