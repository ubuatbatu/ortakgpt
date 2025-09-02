(function(){
  function showHelp() {
    let modal = document.getElementById('help-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'help-modal';
      Object.assign(modal.style, {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: '#1a1d23',
        color: '#fff',
        padding: '20px',
        borderRadius: '8px',
        maxWidth: '600px',
        maxHeight: '70%',
        overflowY: 'auto',
        zIndex: 100000,
        boxShadow: '0 0 10px rgba(0,0,0,0.5)'
      });
      modal.innerHTML = `
        <h2>Klavye Kısayolları</h2>
        <ul>
          <li><b>F1</b>: Yardım penceresi</li>
          <li><b>Alt+F4</b>: Pencereyi kapat</li>
          <li><b>F11</b>: Pencereyi büyüt/küçült</li>
          <li><b>Ctrl+N</b>: Yeni dosya (Not Defteri)</li>
          <li><b>Ctrl+O</b>: Dosya aç (Not Defteri)</li>
          <li><b>Ctrl+S</b>: Kaydet (Not Defteri)</li>
        </ul>
        <button id="help-close">Kapat</button>
      `;
      document.body.appendChild(modal);
      modal.querySelector('#help-close').addEventListener('click', () => modal.remove());
    } else {
      modal.remove();
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1') {
      e.preventDefault();
      showHelp();
    }
  });
})();
