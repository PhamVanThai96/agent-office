// Khởi động văn phòng 3D: nạp cầu nối (thay kết nối my-office bằng /poll của Agent Office) rồi engine.
// ?debug=1 in thời gian từng bước ra console.
const T = window.__bootMarks = [['start', performance.now()]], mark = (k) => T.push([k, performance.now()]);
const FACES = ['400 16px "Be Vietnam Pro"', '600 16px "Be Vietnam Pro"', '700 16px "Be Vietnam Pro"', '800 16px "Be Vietnam Pro"', '400 16px "JetBrains Mono"'];
const fontsReady = () => Promise.race([
  Promise.all(FACES.map((f) => document.fonts.load(f, 'Office ờ'))).catch(() => {}),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]);
await import('./bridge.js');
const [m] = await Promise.all([import('./js/office/main.js'), fontsReady()]);
mark('modules+fonts');
await m.startOffice();
mark('startOffice');
document.getElementById('ao-loading')?.remove();
requestAnimationFrame(() => { mark('firstFrame'); if (/[?&]debug/.test(location.search)) console.info('office boot (ms):', T.map(([k, t], i) => `${k}=${Math.round(i ? t - T[i - 1][1] : t)}`).join(' ')); });
