// input-ipc.js — OS mouse/klavye köprüsü (main process tarafı)
const { ipcMain, screen } = require('electron');
const { keyboard, mouse, Button, Key, Point, straightTo } = require('@nut-tree-fork/nut-js');

// İstersen hız ayarları:
// mouse.config.mouseSpeed = 2000;    // px/sn
// keyboard.config.autoDelayMs = 0;   // ms

function mapButton(btn) {
  const b = String(btn || 'left').toLowerCase();
  if (b === 'right') return Button.RIGHT;
  if (b === 'middle') return Button.MIDDLE;
  return Button.LEFT;
}

const KEYMAP = new Map(Object.entries({
  'Backspace': Key.Backspace,
  'Tab': Key.Tab, 'Enter': Key.Enter, 'Return': Key.Enter,
  'Escape': Key.Escape, 'Esc': Key.Escape,
  'Space': Key.Space,
  'Shift': Key.LeftShift, 'Control': Key.LeftControl, 'Ctrl': Key.LeftControl,
  'Alt': Key.LeftAlt, 'Meta': Key.LeftSuper, 'Win': Key.LeftSuper,
  'ArrowUp': Key.Up, 'ArrowDown': Key.Down, 'ArrowLeft': Key.Left, 'ArrowRight': Key.Right,
  'Delete': Key.Delete, 'Home': Key.Home, 'End': Key.End,
  'PageUp': Key.PageUp, 'PageDown': Key.PageDown, 'Insert': Key.Insert,
  'F1': Key.F1, 'F2': Key.F2, 'F3': Key.F3, 'F4': Key.F4, 'F5': Key.F5, 'F6': Key.F6,
  'F7': Key.F7, 'F8': Key.F8, 'F9': Key.F9, 'F10': Key.F10, 'F11': Key.F11, 'F12': Key.F12
}));

function mapKey(k) {
  if (!k) return null;
  if (KEYMAP.has(k)) return KEYMAP.get(k);
  if (k.length === 1) {
    const ch = k;
    if (/[a-zA-Z]/.test(ch)) return Key[ch.toUpperCase()];
    return null; // rakam/işaretleri typeText ile yollarız
  }
  return null;
}

// --- IPC köprüleri ---
function registerInputIPC() {
  ipcMain.handle('input:getScreenSize', () => {
    const { width, height } = screen.getPrimaryDisplay().size;
    return { width, height };
  });

  ipcMain.handle('input:move', async (_e, { x, y }) => {
    await mouse.setPosition(new Point(x, y));
    // Daha doğal istersen: await mouse.move(straightTo(new Point(x, y)));
  });

  ipcMain.handle('input:click', async (_e, { button }) => {
    await mouse.click(mapButton(button));
  });

  ipcMain.handle('input:down', async (_e, { button }) => {
    await mouse.pressButton(mapButton(button));
  });

  ipcMain.handle('input:up', async (_e, { button }) => {
    await mouse.releaseButton(mapButton(button));
  });

  ipcMain.handle('input:scroll', async (_e, { dx = 0, dy = 0 }) => {
    // ölçek: 50 px ≈ 1 birim (dilediğin gibi ayarla)
    const sx = Math.round(Math.min(10, Math.max(-10, dx / 50)));
    const sy = Math.round(Math.min(10, Math.max(-10, dy / 50)));
    if (sy > 0) await mouse.scrollDown(sy);
    if (sy < 0) await mouse.scrollUp(-sy);
    if (sx > 0) await mouse.scrollRight(sx);
    if (sx < 0) await mouse.scrollLeft(-sx);
  });

  ipcMain.handle('input:keyTap', async (_e, { key }) => {
    const K = mapKey(key);
    if (K) await keyboard.type(K);
    else if (key && key.length === 1) await keyboard.type(key);
  });

  ipcMain.handle('input:keyDown', async (_e, { key }) => {
    const K = mapKey(key);
    if (K) await keyboard.pressKey(K);
  });

  ipcMain.handle('input:keyUp', async (_e, { key }) => {
    const K = mapKey(key);
    if (K) await keyboard.releaseKey(K);
  });

  ipcMain.handle('input:typeText', async (_e, { text }) => {
    if (typeof text === 'string' && text.length) await keyboard.type(text);
  });
}

module.exports = { registerInputIPC };
