import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, LIVE } from './config.js';
import { complete, resolveAI } from './llm.js';
import { classify, planFor, routeGuide } from './routing.js';
import { stripData } from './report.js';
import { webSearch, webFetch } from './web.js';
import { scanTrends } from './trends.js';
import { transcribeVideo } from './transcribe.js';
import { learnedText, digestFor } from './learn.js';
import { skillsText, contextSkillsText, searchSkills } from './skills.js';
import { searchKb, loadKb, loadLedger } from './insight/store.js';

// Danh sách agent đọc từ agents.json. Quản Lí (#manager) là agent điều phối; người dùng là CEO.
const ROOM_CAPACITY = 3;
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'agents.json');
// Tên 4 phòng đọc từ "rooms" trong agents.json (giao diện có đúng 4 khu vực, mỗi khu 3 chỗ).
const DEFAULT_ROOMS = ['Ban điều hành', 'Phòng nghiên cứu', 'Phòng sáng tạo', 'Phòng kỹ thuật'];
function readRooms() {
  try {
    const r = JSON.parse(fs.readFileSync(FILE, 'utf8')).rooms;
    if (Array.isArray(r) && r.length === 4 && r.every((x) => typeof x === 'string' && x.trim())) return r.map((x) => x.trim());
  } catch { /* dùng mặc định */ }
  return DEFAULT_ROOMS;
}
export const ROOMS = readRooms();

const SKILL_EXT = /\.(md|markdown|txt)$/i;
const SKILL_MAX = 12000;
const skillPath = (f) => path.resolve(path.dirname(FILE), f.replace(/^~(?=$|[\\/])/, os.homedir()));
const skillCache = new Map();

// Skill của agent = skill dùng chung trong thư mục skills/ (theo khai báo trong từng file) + "file-skill" riêng nếu có.
export const skillDoc = (agent, max) => skillsText(agent, max) + fileSkillDoc(agent);
// Bản dùng khi làm việc: skill đã nén (nếu có, tạo một lần rồi dùng lại) + kinh nghiệm riêng agent đã tự học.
const workDoc = (agent, command) => (digestFor(agent) ?? skillsText(agent)) + fileSkillDoc(agent) + contextSkillsText(agent, command) + learnedText(agent, command);

// Nội dung "skill file" riêng của agent ("file-skill" trong agents.json): bỏ phần YAML đầu file, cắt tối đa SKILL_MAX ký tự, đọc lại khi file đổi.
function fileSkillDoc(agent) {
  if (!agent.fileSkill) return '';
  const f = skillPath(agent.fileSkill);
  try {
    const mt = fs.statSync(f).mtimeMs, c = skillCache.get(f);
    if (c && c.mt === mt) return c.text;
    let t = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
    if (t.length > SKILL_MAX) t = t.slice(0, SKILL_MAX) + '\n…(đã cắt bớt)';
    const text = `\n\n--- Skill file (${path.basename(f)}) ---\n${t}\n--- Hết skill file ---\n`;
    skillCache.set(f, { mt, text });
    return text;
  } catch (e) {
    if (!skillCache.has('!' + f)) { skillCache.set('!' + f, 1); console.warn(`[skill] #${agent.id}: không đọc được ${f}: ${e.code || e.message}`); }
    return '';
  }
}

function normalize(list, strict = false) {
  const fail = (m) => { throw new Error(m); };
  if (!Array.isArray(list) || !list.length) fail('"agents" phải là mảng có ít nhất 1 agent.');
  const ids = new Set(), perRoom = {};
  const agents = list.map((a, i) => {
    const id = String(a?.id ?? '');
    if (!/^[a-z][a-z0-9_]{0,19}$/.test(id)) fail(`agent #${i + 1}: id "${id}" không hợp lệ (chữ thường/số/_, bắt đầu bằng chữ, tối đa 20 ký tự).`);
    if (ids.has(id)) fail(`id "${id}" bị trùng.`);
    ids.add(id);
    const name = String(a.name ?? '').trim(), basePrompt = String(a.prompt ?? '').trim();
    if (!name || !basePrompt) fail(`agent "${id}" thiếu name hoặc prompt.`);
    const room = a.room || ROOMS[0];
    if (!ROOMS.includes(room)) fail(`agent "${id}": room "${room}" không có (chọn: ${ROOMS.join(', ')}).`);
    perRoom[room] = (perRoom[room] || 0) + 1;
    if (perRoom[room] > ROOM_CAPACITY) fail(`"${room}" tối đa ${ROOM_CAPACITY} agent.`);
    // canAsk: danh sách id đồng nghiệp được phép hỏi; [] = không được hỏi ai; bỏ trống = không giới hạn.
    const canAsk = Array.isArray(a.canAsk) ? [...new Set(a.canAsk.map(String).filter((x) => x && x !== id))] : undefined;
    const fileSkill = String(a['file-skill'] ?? a.fileSkill ?? '').trim();
    if (fileSkill) {
      if (!SKILL_EXT.test(fileSkill)) fail(`agent "${id}": file-skill phải là file .md, .markdown hoặc .txt.`);
      if (strict) {
        let st; try { st = fs.statSync(skillPath(fileSkill)); } catch { fail(`agent "${id}": không tìm thấy file-skill "${fileSkill}".`); }
        if (!st.isFile()) fail(`agent "${id}": file-skill "${fileSkill}" không phải là file.`);
      }
    }
    const skills = Array.isArray(a.skills) ? a.skills.map((x) => String(x).trim()).filter(Boolean) : [];
    // gate: agent duyệt; kết luận "YÊU CẦU SỬA" sẽ trả việc về agent trước đó (tối đa 1 vòng).
    return {
      id, name, role: String(a.role ?? '').trim(), room, skills, basePrompt, canAsk, fileSkill: fileSkill || undefined, gate: a.gate === true || undefined,
      // lean: agent hỏi đáp gọn (prompt ngắn, ít công cụ, tra cứu web sẵn bằng code) để tiết kiệm token; tools: danh sách công cụ được dùng (bỏ trống = tất cả).
      lean: a.lean === true || undefined, research: a.research === true || undefined, memory: a.memory === false ? false : undefined,
      tools: Array.isArray(a.tools) ? [...new Set(a.tools.map((x) => String(x).trim()).filter(Boolean))] : undefined,
      color: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : '#8a8f98',
      prompt: basePrompt + (skills.length ? ` Kỹ năng của bạn: ${skills.join(', ')}.` : ''),
      provider: a.provider ? String(a.provider) : undefined, model: a.model ? String(a.model) : undefined,
    };
  });
  if (agents[0].id !== 'manager') fail('agent đầu tiên phải có id "manager" (agent điều phối).');
  return agents;
}

function readFileAgents() {
  try {
    return normalize(JSON.parse(fs.readFileSync(FILE, 'utf8')).agents);
  } catch (e) {
    throw new Error(`agents.json: ${e.message}`);
  }
}

// AGENTS và IDS được cập nhật tại chỗ để mọi module thấy thay đổi ngay, không cần khởi động lại.
export const AGENTS = readFileAgents();
export const IDS = AGENTS.map((a) => a.id);

const toRaw = ({ id, name, role, room, color, skills, basePrompt, canAsk, fileSkill, gate, lean, research, memory, tools, provider, model }) =>
  ({ id, name, role, room, color, skills, canAsk, gate, lean, research, memory, tools, 'file-skill': fileSkill, prompt: basePrompt, provider, model });
export const rawAgents = () => AGENTS.map(toRaw);

// Kiểm tra danh sách mới, ghi agents.json rồi áp dụng ngay. Sai thì ném lỗi và giữ nguyên danh sách cũ.
export function setAgents(list) {
  const next = normalize(list, true);
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ rooms: ROOMS, agents: next.map(toRaw) }, null, 2) + '\n');
  fs.renameSync(tmp, FILE);
  AGENTS.splice(0, AGENTS.length, ...next);
  IDS.splice(0, IDS.length, ...next.map((a) => a.id));
}

// Hiển thị AI thực tế của từng agent (không chứa khoá API).
export const aiLabel = (agent) => { const r = resolveAI(agent); return `${r.provider}${r.via === 'cli' ? ' (CLI)' : ''}/${r.model || 'mặc định'}`; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const short = (s, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Kế hoạch theo quy trình trong workflows.json (không tốn token). Không khớp quy trình nào thì dùng chuỗi tra cứu tối thiểu rag → reviewer.
const FALLBACK = { id: 'general', name: 'Tổng quát', steps: ['signal', 'planner'] };
export function templatePlan(command) {
  const w = classify(command) || FALLBACK;
  const tasks = planFor(w, command, IDS);
  tasks.route = w.name;
  if (w.noSummary) tasks.noSummary = true; // hỏi đáp một agent: dùng thẳng câu trả lời, bỏ lượt Quản Lí tổng hợp (tiết kiệm token)
  return tasks;
}

const MOCK = {
  signal: () => '| Tín hiệu | Loại | Nguồn | Ngày | Gợi ý chủ đề |\n|---|---|---|---|---|\n| Nhiều comment hỏi cách dùng sản phẩm | câu hỏi | inbox (mẫu) | hôm nay | Video hướng dẫn 30s |\n| Trend "a day in my life" tăng | xu hướng | TikTok (mẫu) | tuần này | Hậu trường team |\n| Video review tuần trước giữ chân 45% | kết quả cũ | báo cáo (mẫu) | tuần trước | Review series |',
  planner: () => '| Chủ đề | Mục tiêu | Độ phù hợp | Nguồn | Ưu tiên |\n|---|---|---|---|---|\n| Video hướng dẫn 30s | Bán hàng | 5 | câu hỏi KH | P1 |\n| Hậu trường team | Nhận biết | 4 | xu hướng | P2 |\n\nBrief P1: mục tiêu tăng tin nhắn · đối tượng khách mới · kênh TikTok · thông điệp "dùng dễ trong 3 bước" · format video 30s 9:16 · CTA "nhắn tin để được tư vấn" · hạn: thứ 6.',
  analyst: () => 'Nhịp tuần: lượt xem đạt 80% mục tiêu, giữ chân tốt ở video hướng dẫn.\n\n| Video | Lượt xem | Giữ chân | Tin nhắn |\n|---|---|---|---|\n| Hướng dẫn | 12000 | 48% | 35 |\n| Hậu trường | 8000 | 31% | 6 |\n| Review | 10000 | 40% | 18 |\n\n```chart\n{"type":"bar","title":"Lượt xem theo video (dữ liệu mẫu)","labels":["Hướng dẫn","Hậu trường","Review"],"series":[{"name":"Lượt xem","data":[12000,8000,10000]}]}\n```\n\nGiả thuyết: hook nêu lợi ích cụ thể giữ chân tốt hơn. Idea mới cho backlog: series "3 lỗi thường gặp".',
  writer: (c, t, ctx) => (ctx.feedback ? 'Đã sửa: hook ngắn lại còn 2 giây, CTA rõ hơn. ' : '') + '| Thời lượng | Hình ảnh | Lời thoại |\n|---|---|---|\n| 0-3s | Cận sản phẩm | "Bạn đang dùng sai cách?" |\n| 3-20s | 3 bước sử dụng | Hướng dẫn từng bước |\n| 20-30s | Logo + CTA | "Nhắn tin để được tư vấn" |\n\n#huongdan #tips #reviewthat',
  video: (c, t, ctx) => (ctx.feedback ? 'Đã sửa: thêm logo cuối video. ' : '') + 'Shot list 5 cảnh, khung 9:16, phụ đề trắng viền đen, nhạc nền nhẹ; checklist nhận diện đạt.',
  designer: () => 'Thumbnail 1080x1920: tiêu đề lớn "3 bước dùng đúng", nền màu thương hiệu.',
  script_review: () => 'KẾT LUẬN: DUYỆT\nHook rõ lợi ích, CTA khớp mục tiêu tin nhắn.',
  video_review: () => 'KẾT LUẬN: DUYỆT\nĐúng nhận diện. Phân phối: TikTok 19h-21h, theo dõi giữ chân và tin nhắn.',
  manager: () => 'Đã xử lý xong yêu cầu.',
};
// MOCK: thêm "#sua" vào yêu cầu để agent duyệt trả YÊU CẦU SỬA ở vòng đầu (thử vòng sửa).
// Việc lên idea: chỉ dùng thông tin CEO đã xác nhận + insight khách thật.
const IDEA_RULE = ' QUY TẮC LÊN IDEA: chỉ dựa trên "THÔNG TIN CEO ĐÃ XÁC NHẬN" trong yêu cầu và insight khách hàng ở trên (tra thêm bằng insight_search). Mục nào CEO chưa cung cấp thì nêu rõ "chưa có", KHÔNG tự giả định hay bịa số liệu/trích dẫn khách. Mỗi idea phải chỉ ra insight gốc (chủ đề + số khách), điểm chạm, hook, định dạng/kênh và CTA phù hợp giai đoạn phễu CEO đã chọn.';
const MOCK_INSIGHT = {
  signal: () => { const t = searchKb(loadKb(), loadLedger(), '', 4); return t.length ? `Insight khách hàng (từ kho ý kiến thật): ${t.map((x) => `${x.label} (${x.customers} khách)`).join('; ')}.` : 'Chưa có dữ liệu ý kiến khách hàng trong kho.'; },
  planner: () => { const t = searchKb(loadKb(), loadLedger(), '', 3); return t.length ? `| Idea | Insight gốc | Điểm chạm |\n|---|---|---|\n${t.map((x, i) => `| Idea ${i + 1}: giải đáp "${x.label}" | ${x.label} (${x.customers} khách) | ${x.touchpoint || '—'} |`).join('\n')}` : 'Chưa đủ insight khách hàng để lên idea; cần cào ý kiến khách hàng trước.'; },
};
const MOCK_REVISE = 'KẾT LUẬN: YÊU CẦU SỬA\n1. Hook quá dài, cần gọn trong 3 giây.\n2. CTA chưa khớp mục tiêu.';

// Ở chế độ mock, một số agent giả lập việc cần truy cập file hoặc hỏi đồng nghiệp.
const MOCK_ACCESS = {};
const MOCK_CONSULT = {
  writer: { to: 'planner', q: 'Brief này ưu tiên kênh nào?', a: 'TikTok trước, Facebook dùng lại bản cắt ngắn.' },
};
const MOCK_ANSWER = (agent, q) => {
  for (const c of Object.values(MOCK_CONSULT)) if (c.to === agent.id && c.q === q) return c.a;
  return 'Đã nhận câu hỏi, tôi sẽ phản hồi chi tiết sau.';
};

const toolDefs = (agent, names) => TOOL_DEFS.filter((t) => !names || names.includes(t.name)).filter((t) => t.name !== 'ask_colleague' || agent.canAsk?.length !== 0)
  .map((t) => (t.name === 'ask_colleague' && agent.canAsk
    ? { ...t, description: `Hỏi nhanh một đồng nghiệp (chỉ khi thật cần). Được hỏi: ${agent.canAsk.join(', ')}.`, parameters: { ...t.parameters, properties: { ...t.parameters.properties, to: { type: 'string', enum: agent.canAsk } } } }
    : t));

const TOOL_DEFS = [
  { name: 'read_file', description: 'Đọc một file văn bản. Có thể cần người dùng cho phép.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'list_dir', description: 'Liệt kê một thư mục. Có thể cần người dùng cho phép.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: 'Tạo file mới hoặc ghi đè file văn bản (cần người dùng cho phép từng file; file cũ được sao lưu .bak). Chỉ dùng khi task yêu cầu tạo/sửa file; để sửa file, đọc nội dung bằng read_file rồi ghi lại toàn bộ nội dung mới.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Đường dẫn file (tuyệt đối hoặc tương đối SOURCE_DIR)' }, content: { type: 'string', description: 'Toàn bộ nội dung mới của file' } }, required: ['path', 'content'] } },
  { name: 'make_image', description: 'Tạo ảnh PNG/JPG/WEBP (banner, poster...) bằng cách ghép ảnh gốc + các lớp chữ/hình/ảnh phụ. Ảnh gốc được cắt vừa khung (cover). Cần người dùng cho phép đọc từng ảnh nguồn và ghi file đầu ra. Bạn không nhìn thấy nội dung ảnh, nên hãy bố cục theo kích thước khung và dùng lớp rect/gradient làm nền cho chữ dễ đọc. Toạ độ tính bằng pixel, gốc ở góc trên trái.',
    parameters: { type: 'object', properties: {
      output: { type: 'string', description: 'File đầu ra, đuôi .png/.jpg/.webp (tuyệt đối hoặc tương đối SOURCE_DIR)' },
      base: { type: 'string', description: 'Ảnh gốc làm nền (tuỳ chọn)' },
      width: { type: 'integer', description: 'Chiều rộng px (64-4096). Bỏ trống = theo ảnh gốc, hoặc 1080 nếu không có ảnh gốc' },
      height: { type: 'integer', description: 'Chiều cao px (64-4096)' },
      background: { type: 'string', description: 'Màu nền khi không có ảnh gốc, vd #1a1033' },
      layers: { type: 'array', description: 'Các lớp vẽ lần lượt từ dưới lên trên (tối đa 30)', items: { type: 'object', properties: {
        type: { type: 'string', enum: ['text', 'rect', 'circle', 'image'] },
        text: { type: 'string', description: 'text: nội dung, xuống dòng bằng \n' },
        x: { type: 'number' }, y: { type: 'number', description: 'text: y là đường chân chữ dòng đầu; circle: x,y là tâm' },
        size: { type: 'number', description: 'text: cỡ chữ px' }, fill: { type: 'string', description: 'màu, vd #ff7a00' },
        weight: { type: 'string', description: 'text: normal|bold' }, anchor: { type: 'string', enum: ['start', 'middle', 'end'], description: 'text: căn lề quanh x' },
        stroke: { type: 'string' }, strokeWidth: { type: 'number' }, opacity: { type: 'number', description: '0-1' }, rotate: { type: 'number' },
        w: { type: 'number' }, h: { type: 'number' }, r: { type: 'number', description: 'circle: bán kính' }, radius: { type: 'number', description: 'rect: bo góc' },
        fillTo: { type: 'string', description: 'rect: màu cuối của gradient dọc (từ fill xuống fillTo)' }, opacityTo: { type: 'number', description: 'rect: độ mờ cuối gradient' },
        path: { type: 'string', description: 'image: đường dẫn ảnh chèn (logo, sản phẩm)' },
      }, required: ['type'] } },
    }, required: ['output'] } },
  { name: 'make_docx', description: 'Tạo file Word .docx từ nội dung markdown: tiêu đề (#, ##, ###), đoạn văn, **đậm**/*nghiêng*, danh sách, bảng markdown (| a | b |), biểu đồ bằng khối ```chart {...}``` (tự vẽ thành hình) và ảnh bằng dòng ![chú thích](đường dẫn ảnh). Dùng khi người dùng yêu cầu file Word/.docx; nội dung phải là bản đầy đủ, không để trống. Cần người dùng cho phép ghi file (và đọc từng ảnh chèn vào).',
    parameters: { type: 'object', properties: {
      output: { type: 'string', description: 'File đầu ra, đuôi .docx (không chỉ định nơi lưu thì dùng reports/ten-file.docx)' },
      title: { type: 'string', description: 'Tiêu đề lớn đầu tài liệu (tuỳ chọn)' },
      content: { type: 'string', description: 'Toàn bộ nội dung tài liệu dạng markdown' },
    }, required: ['output', 'content'] } },
  { name: 'run_command', description: 'Chạy lệnh shell trong thư mục dự án để đọc/tìm file, kiểm tra và chẩn đoán lỗi (ls, cat, grep, find, git status/diff, node --check…) hoặc tạo file/thư mục MỚI (mkdir, touch, cp sang đường dẫn chưa có). Lệnh chỉ đọc/tạo mới chạy ngay; lệnh có thể sửa/xoá file có sẵn, cài gói… cần người dùng cho phép. Kết quả: exitCode, stdout, stderr và hints (chẩn đoán lỗi + gợi ý sửa).',
    parameters: { type: 'object', properties: { command: { type: 'string', description: 'Một lệnh, hoặc nhiều lệnh nối bằng |' }, cwd: { type: 'string', description: 'Thư mục chạy trong dự án (mặc định: thư mục dự án)' }, timeout_s: { type: 'number', description: 'Giới hạn giây (mặc định 15, tối đa 60)' } }, required: ['command'] } },
  { name: 'skill_search', description: 'Tra cứu nhanh kho kỹ năng của team (skills dạng YAML): trả về tối đa 3 mục khớp từ khoá (tên skill, mục, nội dung). Dùng khi cần quy tắc/số liệu cụ thể (giá sản phẩm, hook thắng, checklist duyệt, quy chuẩn kênh, quy trình trend…) mà không nằm sẵn trong prompt.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Từ khoá cần tra, vd "giá hạt nêm chay", "hook video thắng"' }, limit: { type: 'number', description: 'Số mục tối đa (1-5, mặc định 3)' } }, required: ['query'] } },
  { name: 'insight_search', description: 'Tra kho INSIGHT KHÁCH HÀNG đã chắt lọc từ ý kiến thật (Inbox + Comment): trả về chủ đề khớp (số khách nhắc, giai đoạn phễu, xu hướng theo tuần, điểm chạm gợi ý, trích dẫn ẩn danh). Dùng khi lên idea/viết nội dung cần biết khách đang hỏi, lo ngại, mong muốn gì. Bỏ trống query để lấy chủ đề nổi bật nhất.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Từ khoá, vd "hạn dùng", "hàng giả", "bé ăn dặm"' }, limit: { type: 'number', description: 'Số chủ đề tối đa (1-8, mặc định 5)' } } } },
  { name: 'trend_scan', description: 'Quét xu hướng THỜI GIAN THỰC tại Việt Nam: từ khoá đang tăng trên Google Trends (kèm lượt tìm và tin liên quan, có "mới nổi so với lần quét trước"), tin mới theo chủ đề (Google News), tiêu đề mới của VnExpress/Tuổi Trẻ/Dân Trí. Gọi ĐẦU TIÊN cho mọi việc về trend, ý tưởng, kế hoạch content; kết quả có giờ đăng và nguồn.',
    parameters: { type: 'object', properties: { topics: { type: 'array', items: { type: 'string' }, description: 'Tối đa 6 chủ đề cần tìm tin (mặc định: ăn chay, thực phẩm sạch, gia vị nấu ăn, eat clean, bột ngọt, ăn dặm cho bé)' }, days: { type: 'number', description: 'Chỉ lấy tin trong N ngày gần nhất (mặc định 14)' } } } },
  { name: 'web_search', description: 'Tìm trên Internet để lấy thông tin/số liệu MỚI NHẤT (giá, tỷ giá, tin tức, sự kiện, thống kê...). Bắt buộc dùng cho mọi số liệu thay đổi theo thời gian; trả về tiêu đề, URL, đoạn trích.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Từ khoá, nên kèm năm/tháng hiện tại' } }, required: ['query'] } },
  { name: 'web_fetch', description: 'Tải một trang web: trả về tiêu đề, mô tả, giá/thông tin sản phẩm có cấu trúc và phần nội dung chính (khoảng 6000 ký tự đầu, có totalChars). Website chậm thì tự thử lại; nên tải từng trang sản phẩm thay vì trang chủ.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'video_transcribe', description: 'Xem video và chép lời thoại thành chữ (transcript): nhận link video (Facebook, YouTube, TikTok…) hoặc tên file video CEO đính kèm. Chỉ tải âm thanh, chạy nhận dạng giọng nói trên máy (có thể mất 1–5 phút lần đầu); video tối đa 15 phút; kết quả được nhớ theo link. Chỉ có lời thoại, KHÔNG mô tả hình ảnh — nói rõ giới hạn này khi báo cáo.',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'Link http(s) của video hoặc tên file đã đính kèm' } }, required: ['url'] } },
  { name: 'ask_colleague', description: 'Hỏi nhanh một đồng nghiệp và nhận câu trả lời.',
    parameters: { type: 'object', properties: { to: { type: 'string', enum: IDS }, question: { type: 'string' } }, required: ['to', 'question'] } },
];

// Báo cáo tự nhúng bảng/biểu đồ/ảnh từ câu trả lời của agent (xem report.js).
const words = (t) => Math.round((t * 0.45) / 10) * 10;
const style = () => CONFIG.detail === 'brief'
  ? { work: 'phần văn bản tối đa 3 câu, không lặp lại đề bài.', sum: 'tối đa 5 câu.' }
  : {
      work: 'có cấu trúc bằng markdown (### tiêu đề, danh sách), không lặp lại đề bài: đưa kết quả/sản phẩm chính trước; sau đó chỉ nêu căn cứ, giả định, rủi ro bằng gạch đầu dòng ngắn và bước tiếp theo nếu có, không giải thích dài dòng cách làm. Việc đơn giản thì chỉ đủ ý, không độn chữ.',
      sum: 'mở đầu bằng "### Kết luận" (2-3 câu trả lời thẳng vào yêu cầu), sau đó "### Diễn giải" giải thích đầy đủ lý do, căn cứ và cách các agent đi đến kết quả (có thể dùng danh sách), rồi "### Lưu ý & bước tiếp theo". Với yêu cầu đơn giản thì viết ngắn hơn.',
    };
const DATA_RULES = 'Báo cáo tự dựng từ câu trả lời của bạn: số liệu từ 2 mục trở lên → bảng markdown; từ 3 giá trị cần so sánh/xu hướng/tỷ trọng → thêm biểu đồ bằng khối ```chart {"type":"bar|line|pie","title":"…","labels":["…"],"series":[{"name":"…","data":[số]}],"unit":"…"} ```. Bảng/biểu đồ không tính vào giới hạn số câu. Chỉ dùng số liệu thật (từ yêu cầu, đồng nghiệp, công cụ); không có thì không bịa để vẽ.';

const claude = ({ agent, system, user, handlers = {}, max = 400, tools }) => complete({ agent, system, user, tools: toolDefs(agent, tools ?? agent.tools), handlers, max });

// Quản Lí tạo kế hoạch. Yêu cầu khớp quy trình thì dùng luôn (không gọi AI); không khớp mới nhờ AI chia task theo hướng dẫn quy trình.
export async function makePlan(command) {
  const w = classify(command);
  if (w) { await sleep(LIVE ? 0 : 600); return templatePlan(command); }
  if (!LIVE) { await sleep(1200); return templatePlan(command); }
  try {
    const text = await claude({
      agent: AGENTS[0],
      system: `${AGENTS[0].prompt}\nChia yêu cầu thành 1-5 task, mỗi agent tối đa 1 task, chỉ dùng agent thật sự cần, ưu tiên chuỗi ngắn nhất. ` +
        `Quy trình mẫu:\n${routeGuide()}\n` +
        `Chỉ trả về JSON dạng {"tasks":[{"id":"t1","title":"...","assignee":"<id>","dependsOn":[]}]}. ` +
        `Agent: ${AGENTS.slice(1).map((a) => `${a.id} (${a.role})`).join('; ')}. dependsOn chỉ trỏ tới task đứng trước.`,
      user: command, max: 600,
    });
    const tasks = JSON.parse(text.match(/\{[\s\S]*\}/)[0]).tasks;
    const seen = new Set(), who = new Set();
    const ok = Array.isArray(tasks) && tasks.length > 0 && tasks.length <= 6 && tasks.every((t) => {
      const valid = t.id && t.title && IDS.includes(t.assignee) && t.assignee !== 'manager' && !who.has(t.assignee)
        && Array.isArray(t.dependsOn) && t.dependsOn.every((d) => seen.has(d));
      seen.add(t.id); who.add(t.assignee);
      return valid;
    });
    if (ok) {
      const out = tasks.map(({ id, title, assignee, dependsOn }) => ({ id, title, assignee, dependsOn }));
      out.route = 'Quản Lí tự lập kế hoạch';
      return out;
    }
  } catch { /* dùng kế hoạch mặc định */ }
  return templatePlan(command);
}

// ctx: { command, task, inputs: [{from, text}], tools, ask }
const WORD_RE = /\b(docx|word)\b/i;
// Yêu cầu xuất Word: chỉ agent cuối chuỗi tạo file (đã có đủ kết quả của đồng nghiệp) để không tạo trùng.
const wantsWord = (ctx) => (!WORD_RE.test(ctx.command.normalize('NFD').replace(/[\u0300-\u036f]/g, '')) ? ''
  : ctx.isLast === false
    ? ' Yêu cầu có xuất file Word (.docx): đó là việc của agent cuối chuỗi, bạn chỉ cần hoàn thành phần nội dung của mình thật đầy đủ (bảng/biểu đồ dạng markdown) để agent sau đưa vào file.'
    : ' Yêu cầu có xuất file Word (.docx): bạn là agent cuối chuỗi nên hãy gọi make_docx với TOÀN BỘ nội dung báo cáo cuối (gộp kết quả đồng nghiệp, giữ nguyên bảng và khối ```chart, chèn ảnh đã tạo bằng ![chú thích](đường dẫn)), lưu vào reports/. Chỉ báo hoàn thành khi make_docx trả ok.');

// Mốc thời gian thật để AI không dùng số liệu cũ trong dữ liệu huấn luyện.
const nowText = (web = true) => {
  const d = new Date(), day = d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' });
  return web
    ? `Hôm nay là ${day}. Số liệu thay đổi theo thời gian (giá, tỷ giá, tin tức, thống kê...) PHẢI lấy bằng web_search/web_fetch, ghi nguồn + ngày; không tìm được thì nói rõ, không dùng số cũ coi là hiện tại.`
    : `Hôm nay là ${day}. Không khẳng định số liệu thời sự từ trí nhớ.`;
};

// File CEO kéo thả khi giao việc: liệt kê đường dẫn (agent đã được cấp quyền đọc), kèm trích đoạn file văn bản để khỏi tốn một lượt gọi công cụ.
function attachText(files) {
  if (!files?.length) return '';
  return '\n\nFile đính kèm của CEO (đã được phép đọc; dùng read_file để đọc thêm, ảnh có thể làm nền cho make_image):\n' + files.map((f) =>
    `- ${f.name} (${f.path}, ${Math.ceil(f.size / 1024)}KB)${f.preview ? `\n  Trích đoạn:\n${f.preview.replace(/^/gm, '  > ')}` : ''}`).join('\n');
}

// Agent hỏi đáp gọn: tra cứu web bằng code (không tốn lượt AI), rồi chỉ một lượt AI để trả lời. Không nạp bộ nhớ, skill team, luật file/biểu đồ.
async function leanWork(agent, ctx) {
  const d = new Date();
  let found = '';
  if (agent.research) {
    ctx.think?.(`Tra cứu web: ${short(ctx.command, 80)}`);
    try {
      const r = await webSearch(`${ctx.command} ${d.getMonth() + 1}/${d.getFullYear()}`);
      const list = (r.results || []).slice(0, 5);
      if (list.length) {
        found = '\n\nKết quả tìm kiếm (retrievedAt ' + r.retrievedAt + '):\n' + list.map((x, i) => `${i + 1}. ${x.title} — ${x.url}\n   ${short(x.snippet, 220)}`).join('\n');
        ctx.think?.(`Đọc trang: ${list[0].url}`);
        const pg = await webFetch(list[0].url, 3000);
        if (pg.content) found += `\n\nNội dung trang đầu (${pg.url}, rút gọn):\n${pg.content}`;
      } else found = `\n\n(Tra cứu web tự động không có kết quả: ${r.error || 'rỗng'}. Có thể thử web_search/web_fetch.)`;
    } catch (e) { found = `\n\n(Tra cứu web tự động lỗi: ${e.message})`; }
  }
  return claude({
    agent,
    system: `${agent.prompt}${learnedText(agent, ctx.command)} Hôm nay là ${d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' })}. Trả lời tiếng Việt, kết luận ngay dòng đầu, tối đa khoảng 200 từ (bảng ngắn nếu so sánh), ghi nguồn + ngày của số liệu. Dùng dữ liệu tra cứu bên dưới; chỉ gọi công cụ nếu còn thiếu số liệu quan trọng, tối đa 1 lần. Không bịa số liệu.`,
    user: `Câu hỏi của CEO: ${ctx.command}${attachText(ctx.attachments)}${found}`,
    max: Math.min(CONFIG.workMax, 900),
    handlers: {
      web_search: async (i) => { ctx.think?.(`Tìm web: ${i.query}`); const r = await webSearch(i.query); return r.results ? { ...r, results: r.results.slice(0, 5).map((x) => ({ ...x, snippet: short(x.snippet, 220) })) } : r; },
      web_fetch: async (i) => { ctx.think?.(`Đọc trang: ${i.url}`); return webFetch(i.url, 3000); },
      video_transcribe: async (i) => { ctx.think?.(`Transcript video: ${i?.url}`); return transcribeVideo(i?.url, { uploadsDir: ctx.uploadsDir, maxChars: 4000, onStep: (t) => ctx.think?.(t) }); },
      read_file: (i) => ctx.tools.readFile(String(i.path)),
      run_command: (i) => ctx.tools.runCommand(i),
    },
  });
}

export async function work(agent, ctx) {
  if (LIVE && agent.lean) return leanWork(agent, ctx);
  if (LIVE) {
    const inputs = ctx.inputs.map((i) => `[${i.from}] ${i.text}`).join('\n') || '(chưa có)';
    const feedback = ctx.feedback ? `\n\nPhản hồi YÊU CẦU SỬA từ ${ctx.feedback.from} (sửa đúng các điểm này, giữ phần đã đạt):\n${ctx.feedback.text}` : '';
    // Chỉ đưa công cụ agent thật sự dùng (mỗi công cụ tốn ~0,5k token ở MỌI lượt gọi): theo agent.tools, make_docx chỉ khi yêu cầu xuất Word và agent là bước cuối.
    const wordRule = wantsWord(ctx);
    const base = agent.tools || TOOL_DEFS.map((t) => t.name);
    const names = [...new Set([...base.filter((n) => n !== 'make_docx'), ...(wordRule && ctx.isLast !== false ? ['make_docx'] : [])])];
    const has = (n) => names.includes(n);
    const files = ['write_file', 'make_image', 'make_docx'].filter(has);
    const fileRule = files.length
      ? ` Chỉ dùng ${files.join('/')} khi task yêu cầu${has('make_docx') ? ' (make_docx: nội dung markdown đầy đủ, không tự ghi .docx bằng write_file)' : ''}; báo rõ đường dẫn tạo/sửa; không chỉ định nơi lưu thì lưu vào reports/. Công cụ lỗi/bị từ chối thì nói rõ chưa làm được, không báo đã xong.` : '';
    const cmdRule = has('run_command') ? ' run_command là công cụ chung: mọi việc đọc/tìm file, kiểm tra và chẩn đoán lỗi (kể cả lỗi mã/dữ liệu) bạn được tự làm bằng công cụ này, không coi là ngoài vai trò. Lệnh lỗi thì đọc hints/stderr, nêu nguyên nhân và gợi ý cách sửa ngắn gọn; muốn thay đổi file CÓ SẴN thì chỉ đề xuất hoặc gọi công cụ ghi/lệnh tương ứng (hệ thống sẽ xin quyền người dùng, đừng cố né); không đọc file bí mật.' : '';
    const budgetRule = has('web_search') || has('web_fetch') ? ' Ngân sách công cụ: tối đa 4 lượt gọi công cụ cho mỗi việc, ưu tiên dữ liệu đã có (skill, đồng nghiệp) rồi trả lời; không tìm lan man (review, xu hướng, video) khi task chỉ cần thông tin sản phẩm.' : '';
    const askRule = has('ask_colleague') ? ' Chỉ dùng ask_colleague khi thiếu thông tin không thể tự xử lý.' : '';
    return claude({
      agent,
      tools: names,
      system: `${agent.prompt}${workDoc(agent, `${ctx.command} ${ctx.task.title}`)}${ctx.insight || ''}${ctx.insight ? IDEA_RULE : ''}${ctx.video || ''}${ctx.scriptCode ? ` MÃ KỊCH BẢN của bản này: ${ctx.scriptCode} — ghi mã này ở dòng đầu bài viết (vd "${ctx.scriptCode} · Tên kịch bản") để người duyệt và nhật ký cùng gọi đúng bản.` : ''} ${nowText(has('web_search'))} Chỉ làm đúng phần việc của vai trò mình; việc ngoài vai trò thì nói ngắn gọn cần agent nào. Trả lời tiếng Việt, ${style().work} Giữ phần văn bản trong khoảng ${words(CONFIG.workMax)} từ. ${DATA_RULES}${wordRule}${fileRule}${cmdRule}${budgetRule}${askRule} Không bịa đã làm điều chưa làm.`,
      user: `Yêu cầu gốc của CEO: ${ctx.command}\nTask của bạn: ${ctx.task.title}${attachText(ctx.attachments)}\n\nKết quả từ đồng nghiệp:\n${inputs}${feedback}${agent.memory === false ? '' : ctx.memory || ''}`,
      max: CONFIG.workMax,
      handlers: {
        read_file: (i) => ctx.tools.readFile(String(i.path)),
        run_command: (i) => ctx.tools.runCommand(i),
        list_dir: (i) => ctx.tools.listDir(String(i.path)),
        write_file: (i) => ctx.tools.writeFile(String(i.path ?? ''), i.content),
        make_image: (i) => ctx.tools.makeImage(i),
        make_docx: (i) => ctx.tools.makeDocx(i),
        skill_search: async (i) => { ctx.think?.(`Tra kỹ năng: ${i?.query}`); const r = searchSkills(agent, i?.query, i?.limit); return r.length ? { results: r.map(({ score, ...x }) => x) } : { results: [], note: 'Không có mục khớp, thử từ khoá khác.' }; },
        insight_search: async (i) => { ctx.think?.(`Tra insight khách hàng${i?.query ? `: ${i.query}` : ''}`); const r = searchKb(loadKb(), loadLedger(), i?.query, i?.limit); return r.length ? { results: r } : { results: [], note: 'Kho insight chưa có dữ liệu hoặc không có chủ đề khớp: nói rõ với CEO, không bịa.' }; },
        trend_scan: async (i) => { ctx.think?.(`Quét trend thời gian thực${i?.topics?.length ? `: ${i.topics.join(', ')}` : ''}`); return scanTrends(i); },
        web_search: async (i) => { ctx.think?.(`Tìm web: ${i.query}`); return webSearch(i.query); },
        web_fetch: async (i) => { ctx.think?.(`Đọc trang: ${i.url}`); return webFetch(i.url); },
        video_transcribe: async (i) => { ctx.think?.(`Transcript video: ${i?.url}`); return transcribeVideo(i?.url, { uploadsDir: ctx.uploadsDir, onStep: (t) => ctx.think?.(t) }); },
        ask_colleague: async (i) => ({ answer: await ctx.ask(String(i.to), String(i.question)) }),
      },
    });
  }
  await sleep(1500 + Math.random() * 1500);
  let out = agent.gate && !ctx.round && /#sua\b/i.test(ctx.command) ? MOCK_REVISE
    : ctx.insight && MOCK_INSIGHT[agent.id] ? MOCK_INSIGHT[agent.id]()
    : (MOCK[agent.id] || ((c, t) => `Đã hoàn thành: ${short(t, 60)}`))(ctx.command, ctx.task.title, ctx);
  if (ctx.attachments?.length && !agent.gate) out = `Đã đọc ${ctx.attachments.length} file đính kèm (${ctx.attachments.map((f) => f.name).join(', ')}). ${out}`;
  const consult = IDS.includes(MOCK_CONSULT[agent.id]?.to) ? MOCK_CONSULT[agent.id] : null;
  if (consult) out = `Theo ${consult.to}: ${await ctx.ask(consult.to, consult.q)} ${out}`;
  // Giả lập: lệnh có dạng "tạo file <đường dẫn>" thì agent nhận việc ghi file đó (mọi agent đều có write_file).
  const wm = ctx.command.match(/(?:tạo|ghi|sửa)\s+file\s+(\S+)/i);
  if (wm) {
    const r = await ctx.tools.writeFile(wm[1], `Tạo bởi #${agent.id} (${agent.name})\nYêu cầu: ${ctx.command}\n`);
    out = r.error ? `${out} (Không ghi được ${wm[1]}: ${r.error})` : `Đã ${r.created ? 'tạo' : 'ghi đè'} ${r.path}. ${out}`;
  }
  const dm = ctx.command.match(/(?:tạo|xuất)\s+(?:file\s+)?(?:word|docx)\s+(\S+)/i);
  if (dm) {
    const r = await ctx.tools.makeDocx({ output: dm[1], title: 'Báo cáo mẫu', content: `### Kết luận\nĐây là tài liệu mẫu do #${agent.id} tạo.\n\n| Hạng mục | Giá trị |\n|---|---|\n| A | 10 |\n| B | 20 |\n\n\`\`\`chart\n{"type":"bar","title":"Mẫu","labels":["A","B"],"series":[{"name":"Giá trị","data":[10,20]}]}\n\`\`\`\n` });
    out = r.error ? `${out} (Không tạo được .docx: ${r.error})` : `Đã ${r.created ? 'tạo' : 'ghi đè'} tài liệu Word ${r.path}. ${out}`;
  }
  const im = ctx.command.match(/(?:tạo|vẽ)\s+ảnh\s+(\S+)/i);
  if (im) {
    const r = await ctx.tools.makeImage({ output: im[1], width: 1200, height: 628, background: '#241038', layers: [
      { type: 'rect', x: 0, y: 380, w: 1200, h: 248, fill: '#000000', fillTo: '#000000', opacity: 0, opacityTo: 0.7 },
      { type: 'circle', x: 1000, y: 180, r: 90, fill: '#ff7a00' },
      { type: 'text', text: 'Mùa Halloween\nƯu đãi ma mị', x: 60, y: 440, size: 72, fill: '#ffb347', stroke: '#2a0a3d', strokeWidth: 6 },
    ] });
    out = r.error ? `${out} (Không tạo được ảnh: ${r.error})` : `Đã ${r.created ? 'tạo' : 'ghi đè'} ảnh ${r.path} (${r.width}x${r.height}). ${out}`;
  }
  const acc = MOCK_ACCESS[agent.id];
  if (acc) {
    const r = await ctx.tools[acc.fn](acc.path);
    out = r.error ? `${out} (Không truy cập được ${acc.path}: ${r.error})` : `${acc.ok(r)}. ${out}`;
  }
  return out;
}

export async function answer(agent, question, command) {
  if (!LIVE) { await sleep(800); return MOCK_ANSWER(agent, question); }
  return claude({
    agent,
    system: `${agent.prompt}${skillDoc(agent, 4000)} Hôm nay là ${new Date().toLocaleDateString('vi-VN')}; không khẳng định số liệu thời sự từ trí nhớ. Trả lời tiếng Việt, tối đa 2 câu.`,
    user: `Bối cảnh: ${command}\nĐồng nghiệp hỏi: ${question}`, max: 250,
  });
}

// items: [{ agent, title, status, text }]
export async function summarize(command, items) {
  const lines = items.map((i) => `- [${i.status}] ${i.agent}: ${i.title} → ${short(stripData(i.text), 1500)}`).join('\n');
  if (!LIVE) {
    await sleep(800);
    const done = items.filter((i) => i.status === 'done').length;
    return `Yêu cầu "${short(command, 50)}": hoàn thành ${done}/${items.length} task.\n${lines}`;
  }
  return claude({
    agent: AGENTS[0],
    system: `${AGENTS[0].prompt} Hôm nay là ${new Date().toLocaleDateString('vi-VN')}. Viết báo cáo cuối cho CEO bằng tiếng Việt: ${style().sum} Giữ trong khoảng ${words(CONFIG.sumMax)} từ. Nêu rõ task nào chưa xong. Kết quả chi tiết (bảng, biểu đồ, ảnh của từng agent) được hệ thống tự đính kèm vào file báo cáo, nên chỉ tóm tắt và không chép lại dữ liệu; chỗ có [bảng dữ liệu]/[biểu đồ] nghĩa là đã có trong báo cáo.`,
    user: `Yêu cầu: ${command}\nKết quả các task:\n${lines}`, max: CONFIG.sumMax,
  });
}
