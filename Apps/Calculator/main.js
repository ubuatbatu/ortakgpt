export async function mount(container, { vfs, apps, ui, launchApp, args }) {
  container.innerHTML = '';
  container.classList.add('calculator');
  const display = document.createElement('input');
  display.className = 'calc-display';
  display.value = '0';
  display.readOnly = true;
  container.appendChild(display);
  const buttonRows = [
    ['MC','MR','M+','M-'],
    ['7','8','9','/'],
    ['4','5','6','*'],
    ['1','2','3','-'],
    ['0','.','=','+'],
    ['C']
  ];
  let memory = 0;
  buttonRows.forEach(row => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'calc-row';
    row.forEach(key => {
      const btn = document.createElement('button');
      btn.textContent = key;
      btn.className = 'calc-btn';
      btn.addEventListener('click', () => {
        if (key === 'C') {
          display.value = '0';
        } else if (key === '=') {
          try {
            display.value = eval(display.value).toString();
          } catch (e) {
            display.value = 'Error';
          }
        } else if (key === 'MC') {
          memory = 0;
        } else if (key === 'MR') {
          display.value = memory.toString();
        } else if (key === 'M+') {
          memory += parseFloat(display.value) || 0;
        } else if (key === 'M-') {
          memory -= parseFloat(display.value) || 0;
        } else {
          if (display.value === '0' && '0123456789'.includes(key)) {
            display.value = key;
          } else {
            display.value += key;
          }
        }
      });
      rowDiv.appendChild(btn);
    });
    container.appendChild(rowDiv);
  });
}
