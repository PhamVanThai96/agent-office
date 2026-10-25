import { LIVE } from './config.js';
import { complete } from './llm.js';
import { AGENTS } from './agents.js';
import { plain, loadSkills } from './skills.js';

// Làm rõ yêu cầu TRƯỚC khi lên idea: thiếu thông tin thì hỏi lại CEO (không tự giả định, không bịa), hỏi đến khi đủ các mục bắt buộc.
// Ví dụ "Lên idea cho chiến dịch marketing sắp tới" → hỏi: sản phẩm nào, mục tiêu, giai đoạn phễu, đối tượng, kênh/định dạng.
const MAX_ROUNDS = 3;
// Trả lời lảng ("không biết", "?") thì hỏi lại 1 lần; CEO chủ động giao ("để team đề xuất") thì ghi nhận ngay là ủy quyền, không coi là thông tin đã chốt.
const DODGE = /^(?:\?+|k|ko|khong biet|chua biet|khong ro|chua ro|sao cung duoc|gi cung duoc|tuy)$/;
const DELEGATE = /de team de xuat|team de xuat|tuy team|team tu de xuat|nhieu phuong an|team quyet/;
const DELEGATED = 'CEO để team đề xuất nhiều phương án — không coi là thông tin đã chốt';

export const FIELDS = [
  { key: 'san_pham', label: 'Sản phẩm', required: true, q: 'Cần idea cho sản phẩm / dòng sản phẩm nào (kèm điểm bán hàng chính nếu có)?', ph: 'vd: Hạt nêm chay Enzy hộp 420g' },
  { key: 'muc_tieu', label: 'Mục tiêu', required: true, q: 'Mục tiêu của chiến dịch là gì, và chỉ số kỳ vọng (nếu có)?', ph: 'vd: tăng tin nhắn mới 30%/tuần', options: ['Nhận biết thương hiệu', 'Tăng tương tác', 'Bán hàng / tin nhắn', 'Giữ chân khách cũ'] },
  { key: 'giai_doan', label: 'Giai đoạn phễu', required: true, q: 'Chiến dịch ở giai đoạn nào của phễu khách hàng?', ph: 'chọn hoặc tự mô tả', options: ['Nhận biết (TOFU)', 'Cân nhắc (MOFU)', 'Chuyển đổi (BOFU)', 'Sau mua / giữ chân'] },
  { key: 'doi_tuong', label: 'Đối tượng', required: true, q: 'Khách hàng mục tiêu của chiến dịch này là ai (tệp khách, độ tuổi, tình huống)?', ph: 'vd: mẹ có con nhỏ, ăn chay ngày rằm', options: ["Tệp khách mặc định của Enzy (theo skill 'Khách hàng mục tiêu')"] },
  { key: 'kenh_format', label: 'Kênh & định dạng', required: true, q: 'Chạy trên kênh và định dạng nào?', ph: 'chọn một hoặc nhiều', options: ['TikTok video ngắn', 'Facebook (bài đăng / Reels)', 'YouTube Shorts', 'Livestream', 'Bài viết / SEO website', 'Zalo / Inbox'], multi: true },
  { key: 'thoi_gian', label: 'Thời gian', required: false, q: 'Thời gian chạy chiến dịch hoặc hạn cần có idea? (bỏ trống nếu chưa có)', ph: 'vd: chạy từ 1/11, cần idea trước thứ 6' },
  { key: 'rang_buoc', label: 'Ràng buộc', required: false, q: 'Có ngân sách, thông điệp bắt buộc, điều cấm hoặc khuyến mãi cần lưu ý không? (bỏ trống nếu không)', ph: 'vd: không nhắc giá; có freeship đơn từ 2 hộp' },
];

// Gợi ý nhanh cho ô "Sản phẩm": lấy tên sản phẩm trong skill Sản phẩm Enzy (bỏ giá), không có thì để trống.
function productChips() {
  try {
    const sk = loadSkills().find((s) => /san-pham/.test(s.id));
    const secs = sk?.sections || [];
    const a = secs.findIndex((x) => /thuan-chay/.test(x.id)), b = secs.findIndex((x) => /khong-phai/.test(x.id));
    if (a < 0 || b < 0) return [];
    return secs.slice(a + 1, b).map((x) => x.title.replace(/\s+[\d.]+(?:[–-][\d.]+)?\s*đ.*$/i, '').replace(/\s*-?\s*gói trộn.*$/i, '').replace(/\s*[–-]\s*$/, '').trim()).filter(Boolean).slice(0, 8);
  } catch { return []; }
}

// ---- Nhận diện mục đã nêu trong yêu cầu: AI (REAL) hoặc từ khoá (MOCK/dự phòng). Không bao giờ tự điền giá trị. ----
const HEUR = {
  san_pham: /hat nem|rac com|canh duong sinh|banh rau|bot nem|slowcarb|jcare|gia vi|san pham [a-z0-9]/,
  muc_tieu: /nhan biet|tuong tac|ban hang|chot don|doanh so|doanh thu|tin nhan|\blead\b|giu chan|chuyen doi|awareness|conversion|tang don/,
  giai_doan: /tofu|mofu|bofu|phieu|giai doan|can nhac|sau mua|nhan biet thuong hieu|chuyen doi/,
  doi_tuong: /doi tuong|tep khach|khach hang muc tieu|nguoi an chay|me bim|me co con|nguoi cao tuoi|\d{2}\s*-\s*\d{2}\s*tuoi|nu \d|dan van phong|\bnu\b.*tuoi/,
  kenh_format: /tiktok|facebook|\bfb\b|reels|shorts|youtube|livestream|\blive\b|zalo|website|\bseo\b|bai viet|fanpage|inbox/,
  thoi_gian: /\d+\s*(?:ngay|tuan|thang)|thang \d|tuan nay|tuan sau|ngay \d|truoc \w+|dip [a-z]+|tet|han chot/,
  rang_buoc: /ngan sach|khong nhac|cam |bat buoc|khuyen mai|freeship|\d+\s*(?:k|trieu|tr)\b/,
};
function heurKnown(text) {
  const t = plain(text), out = {};
  for (const [k, re] of Object.entries(HEUR)) if (re.test(t)) out[k] = true; // chỉ biết "đã nêu", không tự trích giá trị
  return out;
}

async function detect(command) {
  if (!LIVE) return heurKnown(command);
  try {
    const text = await complete({
      agent: AGENTS[0], tools: [], handlers: {}, max: 420,
      system: `Bạn kiểm tra yêu cầu "lên idea" của CEO xem đã NÊU RÕ các mục sau chưa. Mục nào yêu cầu nêu rõ thì trả giá trị ngắn (đúng ý CEO, không suy diễn); mục không nêu hoặc chỉ ám chỉ mơ hồ thì để chuỗi rỗng "". TUYỆT ĐỐI không tự điền giả định hay giá trị mặc định.
Các mục: san_pham (sản phẩm cụ thể; chỉ "marketing"/"chiến dịch" chung chung = rỗng), muc_tieu (nhận biết/tương tác/bán hàng/giữ chân), giai_doan (giai đoạn phễu: nhận biết/cân nhắc/chuyển đổi/sau mua), doi_tuong (tệp khách), kenh_format (kênh và định dạng), thoi_gian (thời gian/hạn), rang_buoc (ngân sách, điều cấm, khuyến mãi).
Chỉ trả JSON dạng {"san_pham":"","muc_tieu":"","giai_doan":"","doi_tuong":"","kenh_format":"","thoi_gian":"","rang_buoc":""}.`,
      user: command,
    });
    const j = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
    return Object.fromEntries(FIELDS.map((f) => [f.key, String(j[f.key] ?? '').trim()]).filter(([, v]) => v));
  } catch {
    return heurKnown(command);
  }
}

const toQuestion = (f) => ({ key: f.key, label: f.label, question: f.q, required: f.required, placeholder: f.ph, multi: Boolean(f.multi), options: f.key === 'san_pham' ? productChips() : (f.options || []) });

function block(known, answers, missing) {
  const rows = FIELDS.map((f) => {
    const v = answers[f.key] || (typeof known[f.key] === 'string' ? known[f.key] : known[f.key] === true ? '(đã nêu trong yêu cầu gốc ở trên)' : '');
    return v ? `- ${f.label}: ${v}` : null;
  }).filter(Boolean);
  const miss = FIELDS.filter((f) => missing.includes(f.key)).map((f) => f.label);
  return `\n\n[THÔNG TIN CEO ĐÃ XÁC NHẬN — dùng đúng như vậy, KHÔNG giả định thêm]\n${rows.join('\n') || '- (CEO chưa cung cấp chi tiết nào)'}${miss.length ? `\n- CHƯA CÓ (CEO không cung cấp): ${miss.join(', ')} — nêu rõ phần thiếu này trong kết quả, đừng tự đoán.` : ''}`;
}

/**
 * ask({ title, intro, round, questions }) → Promise<{ [key]: text } | null (CEO huỷ/hết hạn)>.
 * Trả về { ok, answers, block, asked } hoặc { cancelled: true }.
 */
export async function clarifyBrief({ command, ask, say = () => {} }) {
  const known = await detect(command);
  const answers = {};
  const asked = [];
  const dodged = new Set(); // mục đã trả lời lảng 1 lần
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const missReq = FIELDS.filter((f) => f.required && !known[f.key] && !answers[f.key]);
    // Mục tuỳ chọn chỉ hỏi kèm (một lần) khi đằng nào cũng phải hỏi mục bắt buộc, để không làm phiền khi yêu cầu đã đủ.
    const missOpt = round === 1 && missReq.length ? FIELDS.filter((f) => !f.required && !known[f.key] && !answers[f.key]) : [];
    if (!missReq.length && !missOpt.length) break;
    if (!missReq.length && round > 1) break;
    const qs = [...missReq, ...missOpt];
    say(`Cần làm rõ ${missReq.length} mục bắt buộc${missOpt.length ? ` (+${missOpt.length} mục tuỳ chọn)` : ''}: ${missReq.map((f) => f.label).join(', ')}`, qs.map((f) => f.q).join('\n'));
    const res = await ask({
      title: round === 1 ? 'Cần làm rõ trước khi lên idea' : 'Vẫn còn thiếu thông tin',
      intro: round === 1
        ? 'Để idea chạm đúng khách hàng, team không tự giả định. Bạn trả lời các mục dưới đây (mục tuỳ chọn có thể bỏ trống).'
        : 'Các mục bắt buộc sau chưa có câu trả lời rõ ràng. Nếu bạn chưa quyết, hãy ghi "để team đề xuất" để team đưa nhiều phương án (không tự chọn thay bạn).',
      round, questions: qs.map(toQuestion),
    });
    if (!res) return { cancelled: true };
    for (const f of qs) {
      const v = String(res[f.key] ?? '').trim().slice(0, 400);
      if (!v) continue;
      const pv = plain(v).replace(/[^a-z0-9? ]/g, '').trim();
      if (f.required && DODGE.test(pv)) {
        if (!dodged.has(f.key)) { dodged.add(f.key); continue; } // hỏi lại một lần nữa
        answers[f.key] = 'CEO chưa xác định — được đề xuất nhiều phương án, không coi là thông tin đã chốt';
      } else answers[f.key] = DELEGATE.test(pv) ? DELEGATED : v;
      asked.push(f.key);
    }
  }
  const missing = FIELDS.filter((f) => f.required && !known[f.key] && !answers[f.key]).map((f) => f.key);
  return { ok: true, answers, known, asked, missing, block: block(known, answers, missing) };
}
