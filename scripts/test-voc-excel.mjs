// Thử lấy Excel ý kiến khách hàng 1–20/10/2026 (cần tài khoản Enzy thật trong enzy.json hoặc ENZY_USER/ENZY_PASS): node scripts/test-voc-excel.mjs
import { loadConfig } from '../enzy/index.js';
import { fetchVocExcel, readVocWorkbook, vocToYaml, saveVocYaml } from '../insight/excel.js';
const c = loadConfig();
const t0 = Date.now();
try {
  const r = await fetchVocExcel({ url: c.URL, user: process.env.ENZY_USER || c.USER, pass: process.env.ENZY_PASS || c.PASS, brand: c.BRAND, system: 'Ý kiến khách hàng', from: '2026-10-01', to: '2026-10-20', mode: 'saved' });
  const w = readVocWorkbook(r.buf);
  console.log('sheet', w.sheet, 'rows', w.rows.length, r.shown, w.info, Object.keys(w.rows[0] || {}));
  const y = vocToYaml({ rows: w.rows, from: '2026-10-01', to: '2026-10-20', mode: 'saved', metrics: { ...r.metrics, ...w.info } });
  console.log('saved', saveVocYaml(y), y.items);
} catch (e) { console.log('ERR', e.message); }
console.log('s', (Date.now() - t0) / 1000);
