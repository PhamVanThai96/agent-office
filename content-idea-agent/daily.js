// Idea hằng ngày: đến giờ hẹn, agent tự tìm trend + đọc insight khách hàng và lên tối thiểu N idea theo bảng của team.
// Kết quả lưu ở data/daily/YYYY-MM-DD.json (markdown + các dòng bảng). App cần đang chạy và máy không ngủ lúc đến giờ;
// lỡ giờ thì lần mở app kế tiếp trong ngày sẽ tự chạy bù.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, 'data', 'daily');
const CONFIG = path.join(HERE, 'data', 'daily-config.json');
const OFFICE_HISTORY = path.join(HERE, '..', 'data', 'daily', 'ideas.json'); // idea cũ của Agent Office, để tránh trùng
// Mặc định tắt: idea hằng ngày đã do lịch "Kho Idea Enzy" của Claude app đẩy lên trang web; bật ở đây chỉ khi muốn chạy thêm trên máy.
const DEFAULTS = { enabled: false, time: '07:30', count: 5, focus: '' };
const MAX_TOPUPS = 2;

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 1)); fs.renameSync(f + '.tmp', f); };
// Ngày/giờ theo giờ Việt Nam để lịch không lệch khi máy để múi giờ khác.
const vnNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
};

export function loadConfig() { return { ...DEFAULTS, ...readJson(CONFIG, {}) }; }
export function saveConfig(c) {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(c.time)) ? String(c.time) : DEFAULTS.time;
  const count = Math.min(20, Math.max(5, Number.parseInt(c.count, 10) || DEFAULTS.count)); // tối thiểu 5 idea
  const o = { enabled: c.enabled !== false, time, count, focus: String(c.focus || '').slice(0, 1000) };
  writeJson(CONFIG, o);
  return o;
}

/** Lấy các dòng của bảng idea (bảng có cột IDEA) trong markdown → mảng ô. */
export function parseIdeaRows(md) {
  const lines = String(md).split('\n');
  const h = lines.findIndex((l) => /^\s*\|/.test(l) && /\bIDEA\b/i.test(l));
  if (h < 0) return [];
  const rows = [];
  for (let i = h + 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
    const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.length >= 4 && cells[3]) rows.push(cells);
  }
  return rows;
}

export function listDays(limit = 60) {
  try {
    return fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(0, limit)
      .map((f) => { const j = readJson(path.join(DIR, f), {}); return { day: j.day, count: j.rows?.length || 0, status: j.status, at: j.at }; });
  } catch { return []; }
}
export const getDay = (day) => (/^\d{4}-\d{2}-\d{2}$/.test(day) ? readJson(path.join(DIR, `${day}.json`), null) : null);

// Tóm tắt idea đã đề xuất 21 ngày gần nhất (của app này + Agent Office) để agent không lặp lại.
function recentIdeas() {
  const out = [];
  for (const d of listDays(21)) {
    for (const r of getDay(d.day)?.rows || []) out.push(`- [${d.day}] ${r[1]} · ${r[3].replace(/<br\s*\/?>/gi, ' / ').slice(0, 140)}`);
  }
  const office = readJson(OFFICE_HISTORY, {}).ideas || [];
  for (const i of office.slice(-40)) out.push(`- [${i.day}] ${i.title}`);
  return out.slice(0, 120).join('\n');
}

/**
 * runner(convo, userText, send) chạy một lượt agent (CLI hoặc API) — do server.js truyền vào.
 * newConvo() tạo hội thoại mới; buildContext(first) trả phần insight khách hàng.
 */
export function createDaily({ runner, newConvo, buildContext, log = console.log }) {
  let running = null;

  async function run({ force = false } = {}) {
    if (running) return running;
    const { day } = vnNow();
    const file = path.join(DIR, `${day}.json`);
    const prev = readJson(file, null);
    if (!force && prev?.status === 'done') return prev;
    running = (async () => {
      const cfg = loadConfig();
      const rec = { day, at: new Date().toISOString(), status: 'running', markdown: '', rows: [], error: '' };
      writeJson(file, rec);
      log(`[daily] Bắt đầu lên idea ngày ${day} (tối thiểu ${cfg.count})`);
      const convo = newConvo();
      let text = '', turn = '';
      const send = (ev, data) => { if (ev === 'text') { text += data.text; turn += data.text; } };
      const history = recentIdeas();
      try {
        const ask = [
          await buildContext(),
          `NHIỆM VỤ HẰNG NGÀY (${day}): tìm kiếm rồi lên TỐI THIỂU ${cfg.count} idea content mới cho Enzy để nhân viên viết kịch bản ngay trong tuần này.`,
          'Các bước: (1) dùng web search tìm trend/chủ đề đang nóng ở Việt Nam trong vài ngày gần đây (Facebook, TikTok, tin tức đời sống, ẩm thực, sức khoẻ, ngày lễ/sự kiện sắp tới, mùa vụ) — ghi nguồn + ngày; (2) đối chiếu với INSIGHT KHÁCH HÀNG ở trên để chọn nỗi đau/mong muốn đang nổi; (3) lên idea theo đúng bảng 10 cột, ít nhất 1 idea bắt trend (LOẠI CONTENT có TREND), ít nhất 2 idea đi thẳng từ nỗi đau khách trong kho insight; THỜI GIAN ghi ngày đề xuất đăng.',
          cfg.focus ? `TRỌNG TÂM CEO DẶN: ${cfg.focus}` : '',
          history ? `IDEA ĐÃ ĐỀ XUẤT GẦN ĐÂY (KHÔNG lặp lại góc/hook/câu voice):\n${history}` : '',
        ].filter(Boolean).join('\n\n');
        await runner(convo, ask, send);
        let rows = parseIdeaRows(turn), best = turn;
        for (let i = 0; i < MAX_TOPUPS && rows.length < cfg.count; i++) {
          log(`[daily] Mới có ${rows.length}/${cfg.count} idea → yêu cầu bổ sung`);
          turn = '';
          await runner(convo, `Bảng mới có ${rows.length} idea. Viết lại TOÀN BỘ bảng với tối thiểu ${cfg.count} idea (giữ các idea đã có, thêm idea mới khác góc), kèm mục "Vì sao chọn".`, send);
          const more = parseIdeaRows(turn);
          if (more.length > rows.length) { rows = more; best = turn; }
        }
        Object.assign(rec, { status: rows.length >= cfg.count ? 'done' : 'partial', markdown: best.trim(), rows, finishedAt: new Date().toISOString() });
        log(`[daily] Xong ${day}: ${rows.length} idea`);
      } catch (e) {
        Object.assign(rec, { status: 'error', markdown: text.trim(), error: e.message || String(e) });
        log(`[daily] Lỗi ${day}: ${rec.error}`);
      }
      writeJson(file, rec);
      return rec;
    })().finally(() => { running = null; });
    return running;
  }

  // Kiểm tra mỗi phút: đến/qua giờ hẹn mà hôm nay chưa xong (hoặc lần trước lỗi, thử lại tối đa sau 30 phút) thì chạy.
  function tick() {
    const cfg = loadConfig();
    if (!cfg.enabled || running) return;
    const { day, hm } = vnNow();
    if (hm < cfg.time) return;
    const rec = getDay(day);
    if (rec?.status === 'done' || rec?.status === 'partial') return;
    if (rec?.status === 'error' && Date.now() - Date.parse(rec.at) < 30 * 60000) return;
    if (rec?.status === 'running' && Date.now() - Date.parse(rec.at) < 60 * 60000) return; // đang chạy ở tiến trình trước
    run().catch(() => {});
  }
  const timer = setInterval(tick, 60_000);
  timer.unref();
  setTimeout(tick, 5_000); // mở app trễ giờ → chạy bù

  return { run, isRunning: () => Boolean(running), newId: () => crypto.randomUUID() };
}
