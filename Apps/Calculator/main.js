(() => {
  const createCalculatorApp = () => {
    const container = document.createElement('div');
    container.className = 'calculator';

    const display = document.createElement('input');
    display.className = 'calc-display';
    display.value = '0';
    display.readOnly = true;
    container.appendChild(display);

    const buttons = [
      ['7','8','9','/'],
      ['4','5','6','*'],
      ['1','2','3','-'],
      ['0','.','=','+'],
      ['MC','MR','M+','M-'],
      ['C']
    ];

    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'calc-buttons';

    let memory = 0;

    buttons.forEach(row => {
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
      buttonsContainer.appendChild(rowDiv);
    });
    container.appendChild(buttonsContainer);

    return container;
  };

  window.addEventListener('DOMContentLoaded', () => {
    const appWindow = window.createWindow({
      title: 'Calculator',
      width: 300,
      height: 420,
    });

    const content = createCalculatorApp();
    appWindow.content.appendChild(content);
  });
})();
