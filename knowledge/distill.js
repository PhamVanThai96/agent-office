import { LIVE } from '../config.js';
import { complete } from '../llm.js';
import { AGENTS } from '../agents.js';

// Chưng cất một bài Brands Vietnam thành bản tóm tắt có cấu trúc cho team content Enzy. AI thật khi REAL; MOCK/AI lỗi → trích đoạn đầu bài.
const SYSTEM = `Bạn là chuyên gia chiến lược marketing, đọc case-study/tài liệu rồi ghi chép cho team content của Enzy (thương hiệu gia vị/thực phẩm thuần chay, bán qua Facebook).
Chỉ dựa trên văn bản được đưa, KHÔNG bịa số liệu; không chép nguyên văn quá 15 từ liền; viết bằng tiếng Việt, ngắn gọn.
Trả về DUY NHẤT một JSON: {"brand":"","category":"ngành","tags":["≤8 thẻ ngắn: insight, kênh, cơ chế, trend"],"summary":"≤3 câu","insight":"insight người tiêu dùng cốt lõi","big_idea":"ý tưởng lớn","execution":["cách triển khai chính"],"results":["kết quả/số liệu có trong bài"],"lessons_for_enzy":["≤3 bài học áp dụng được cho Enzy, cụ thể"],"content_angles":["≤3 góc content có thể làm"]}. Trường nào bài không nói thì để rỗng.`;

export function ruleDistill({ title, text }) {
  const paras = text.split(/\n+/).map((s) => s.trim()).filter((s) => s.length > 60);
  return { summary: paras.slice(0, 2).join(' ').slice(0, 500), tags: [], lessons_for_enzy: [] };
}

export async function distillArticle({ source, title, text }) {
  if (!LIVE) return { ...ruleDistill({ title, text }), via: 'rule' };
  try {
    const agent = AGENTS.find((a) => a.id === 'analyst') || AGENTS[0];
    const out = await complete({ agent, system: SYSTEM, tools: [], handlers: {}, max: 1400, user: `Nguồn: ${source}\nTiêu đề: ${title}\n\nNội dung:\n${text.slice(0, 9000)}` });
    const m = String(out || '').match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI không trả JSON.');
    return { ...JSON.parse(m[0]), via: 'ai' };
  } catch { return { ...ruleDistill({ title, text }), via: 'rule' }; }
}
