import { LIVE } from '../config.js';
import { complete } from '../llm.js';
import { AGENTS } from '../agents.js';
import { plain } from '../skills.js';
import { scrub, TYPE_LABEL } from './store.js';

// "Huấn luyện" sau mỗi lần cào: chưng cất tin nhắn/bình luận MỚI thành các chủ đề (câu hỏi, lo ngại, mong muốn, phản đối, tình huống, cách nói),
// rồi store.mergeObservations hợp nhất vào kho — không lưu lại từng tin nhắn. AI thật khi chạy REAL; MOCK hoặc AI lỗi thì dùng bộ quy tắc từ khoá.
const CHUNK_CHARS = 9000;
const MAX_CHUNKS = 6;

// Mỗi khách một dòng: "K3 [INBOX]: câu 1 | câu 2". Đã ẩn danh; khách có quá nhiều dòng thì chỉ lấy 8 dòng đầu.
function digestLines(entries) {
  return entries.map((e, i) => `K${i + 1} [${e.channel}]: ${e.lines.slice(0, 8).map((l) => scrub(l, 220)).filter(Boolean).join(' | ')}`).filter((l) => l.length > 12);
}

function chunk(lines) {
  const out = [];
  let cur = [], n = 0;
  for (const l of lines) {
    if (n + l.length > CHUNK_CHARS && cur.length) { out.push(cur); cur = []; n = 0; }
    cur.push(l); n += l.length + 1;
  }
  if (cur.length) out.push(cur);
  return out.slice(0, MAX_CHUNKS);
}

const SYSTEM = (existing) => `Bạn là chuyên gia insight khách hàng của thương hiệu thực phẩm/gia vị Enzy (bán hàng qua inbox/comment Facebook). Đọc tin nhắn và bình luận của KHÁCH HÀNG (đã ẩn danh) rồi chắt lọc thành các CHỦ ĐỀ, không tóm tắt từng người.
Quy tắc: chỉ dựa trên dữ liệu, không bịa; bỏ lời chào, spam, tin chỉ có số/emoji; gộp ý giống nhau; "count" = số KHÁCH KHÁC NHAU nhắc tới (không vượt số khách trong dữ liệu); "quotes" = trích nguyên văn ngắn (≤120 ký tự), KHÔNG chứa tên riêng/số điện thoại/địa chỉ; "touchpoint" = điều nên nói/làm để chạm đúng mối quan tâm đó (≤25 từ, chỉ dựa trên điều khách nói).
type: cau-hoi (hỏi thông tin) | lo-ngai (nghi ngại: hàng giả, an toàn, hạn dùng…) | mong-muon (muốn/cần gì) | phan-doi (chê/chưa mua vì…) | tinh-huong (dùng cho ai/khi nào) | ngon-ngu (cách khách gọi tên/diễn đạt).
stage: nhan-biet | can-nhac | quyet-dinh | sau-mua. product: sản phẩm khách nhắc tới ("" nếu không rõ).
${existing.length ? `Chủ đề đã có (dùng lại đúng "theme" id nếu cùng ý):\n${existing.map((t) => `- ${t.id}: ${t.label} (${TYPE_LABEL[t.type]})`).join('\n')}\n` : ''}Trả về DUY NHẤT một JSON: {"observations":[{"theme":"<id có sẵn hoặc rỗng>","label":"nhãn ngắn ≤8 từ","type":"…","stage":"…","product":"","count":N,"quotes":["…"],"touchpoint":"…"}],"vocab":["cụm từ khách hay dùng (≤8)"],"summary":"2 câu: tuần này khách quan tâm gì nhất"}. Tối đa 12 observations.`;

function parseJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI không trả JSON.');
  const j = JSON.parse(m[0]);
  if (!Array.isArray(j.observations)) throw new Error('JSON thiếu observations.');
  return j;
}

async function aiChunk(lines, win, existing) {
  const agent = AGENTS.find((a) => a.id === 'analyst') || AGENTS[0];
  const text = await complete({
    agent, system: SYSTEM(existing), tools: [], handlers: {}, max: 1800,
    user: `Khoảng ${win.from} → ${win.to}; ${lines.length} khách. Dữ liệu:\n${lines.join('\n')}`,
  });
  return parseJson(text);
}

// ---- Bộ quy tắc (MOCK / dự phòng khi AI lỗi): đếm số khách có nhắc từ khoá của từng chủ đề ----
const RULES = [
  { label: 'Hỏi hạn dùng & bảo quản', type: 'cau-hoi', stage: 'can-nhac', re: /han dung|het han|\bdate\b|bao lau|bao quan|de duoc/, tp: 'Nói rõ hạn dùng, cách bảo quản và ngày sản xuất gần nhất.' },
  // "giá" (price) và "giả" (fake) giống nhau khi bỏ dấu → dùng `raw` (giữ dấu, chữ thường) cho từ dễ nhầm.
  { label: 'Hỏi giá, combo và phí ship', type: 'cau-hoi', stage: 'quyet-dinh', raw: /(?<![\p{L}\p{N}])(?:giá|bao nhiêu tiền|nhiêu tiền|phí ship|ship|freeship|vận chuyển|combo|khuyến mãi|giảm giá|ưu đãi)(?![\p{L}\p{N}])/iu, tp: 'Nêu giá, combo và điều kiện freeship ngay trong nội dung.' },
  { label: 'Lo hàng giả / hỏi độ uy tín', type: 'lo-ngai', stage: 'can-nhac', re: /hang gia|hang nhai|that khong|uy tin|lua dao|chinh hang|kiem dinh|chung nhan/, tp: 'Cho khách thấy nhà máy, chứng nhận, đồng kiểm khi nhận hàng.' },
  { label: 'Lo về thành phần, bột ngọt, an toàn', type: 'lo-ngai', stage: 'can-nhac', re: /thanh phan|bot ngot|mi chinh|chat bao quan|huong lieu|phu gia|an toan|tu nhien/, tp: 'Giải thích thành phần rõ ràng bằng ngôn ngữ đời thường.' },
  { label: 'Hỏi cách dùng, liều lượng', type: 'cau-hoi', stage: 'sau-mua', re: /cach dung|cach nau|xao|uop|kho thit|nau canh|bao nhieu g|lieu luong|1 thia|muong/, tp: 'Làm video hướng dẫn dùng nhanh kèm liều lượng cụ thể.' },
  { label: 'Quan tâm ăn chay / thuần chay', type: 'mong-muon', stage: 'can-nhac', re: /an chay|thuan chay|\bchay\b|rau cu/, tp: 'Nhấn mạnh nhãn thuần chay đúng với từng sản phẩm.' },
  { label: 'Dùng cho bé / người nhà', type: 'tinh-huong', stage: 'can-nhac', re: /\bbe\b|tre em|an dam|6 thang|\bcon\b|ba me|nguoi gia|ong ba/, tp: 'Nói về đối tượng dùng (bé, người lớn tuổi) và độ phù hợp.' },
  { label: 'Hỏi cách đặt mua / mua ở đâu', type: 'cau-hoi', stage: 'quyet-dinh', re: /mua o dau|dia chi|cua hang|dat hang|dat mua|chot don|lay 1|lay 2|mua the nao|cod/, tp: 'CTA rõ một bước để đặt hàng (nhắn tin / link).' },
  { label: 'Quan tâm sức khoẻ, dinh dưỡng, bệnh lý', type: 'mong-muon', stage: 'can-nhac', re: /tieu duong|huyet ap|gut|benh|suc khoe|dinh duong|protein|it muoi|giam can/, tp: 'Nói về dinh dưỡng đúng sự thật, tránh hứa hẹn chữa bệnh.' },
  { label: 'Nhận xét vị, độ ngon', type: 'tinh-huong', stage: 'sau-mua', re: /\bngon\b|\bvi\b|man qua|nhat qua|thom|dam da/, tp: 'Dùng đúng cách khách mô tả vị trong lời thoại.' },
];

const test = (r, text) => (r.raw ? r.raw.test(String(text).toLowerCase()) : r.re.test(plain(text)));

export function ruleDistill(entries) {
  const obs = [];
  const prepared = entries.map((e) => ({ e, t: e.lines.join(' | ') }));
  for (const r of RULES) {
    const hit = prepared.filter((x) => test(r, x.t));
    if (!hit.length) continue;
    const quote = hit[0].e.lines.find((l) => test(r, l)) || '';
    obs.push({ label: r.label, type: r.type, stage: r.stage, product: '', count: hit.length, quotes: quote ? [scrub(quote, 120)] : [], touchpoint: r.tp });
  }
  obs.sort((a, b) => b.count - a.count);
  return { observations: obs.slice(0, 12), vocab: [], summary: obs.length ? `Khách quan tâm nhiều nhất: ${obs.slice(0, 3).map((o) => o.label.toLowerCase()).join('; ')}.` : '' };
}

/**
 * entries: [{ id, cust, channel, lines[] }] (chỉ phần MỚI). existing: danh sách chủ đề đã có [{id,label,type}].
 * Trả về { observations, vocab, summary, via: 'ai'|'rule', note? }.
 */
export async function distill(entries, win, existing = []) {
  if (!entries.length) return { observations: [], vocab: [], summary: '', via: 'none' };
  if (!LIVE) return { ...ruleDistill(entries), via: 'rule' };
  const lines = digestLines(entries);
  const parts = chunk(lines);
  const obs = [], vocab = [], sums = [];
  let failed = 0;
  for (const p of parts) {
    try {
      const j = await aiChunk(p, win, existing.slice(0, 40));
      obs.push(...j.observations.map((o) => ({ ...o, count: Math.min(Number(o.count) || 1, p.length) })));
      if (Array.isArray(j.vocab)) vocab.push(...j.vocab.map(String));
      if (j.summary) sums.push(String(j.summary));
    } catch { failed++; }
  }
  if (!obs.length) return { ...ruleDistill(entries), via: 'rule', note: 'AI không chưng cất được, đã dùng bộ quy tắc từ khoá.' };
  return { observations: obs, vocab, summary: sums.join(' ').slice(0, 400), via: 'ai', note: failed ? `${failed}/${parts.length} phần AI lỗi, bỏ qua.` : undefined };
}
