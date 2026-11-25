// Content Idea Agent — app độc lập lên idea kịch bản content (TikTok, Reels, Shorts, Facebook).
// Gọi Claude API (Opus 5.5) + web search để bắt trend; dùng kiến thức Enzy trong ../skills làm bối cảnh.
// Chạy: npm start → mở http://localhost:3100
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { createDaily, loadConfig as loadDailyConfig, saveConfig as saveDailyConfig, listDays, getDay } from './daily.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3100;
// cli = dùng lệnh `claude` đã đăng nhập (mặc định) · api = gọi Claude API bằng khoá (tốn credit)
const BACKEND = (process.env.IDEA_BACKEND || 'cli').toLowerCase() === 'api' ? 'api' : 'cli';
const MODEL = process.env.IDEA_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.IDEA_EFFORT || 'high';
const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || path.join(HERE, '..', 'skills');
const KNOWLEDGE_FILES = [
  '01-brand-voice.yaml', '02-compliance.yaml', '03-san-pham-enzy.yaml', '05-content-win-enzy.yaml',
  '06-khach-hang-muc-tieu.yaml', '12-tiktok-viet-nam.yaml', '30-script-writing.yaml', '88-enzy-idea-bank.yaml',
];
const MAX_CONTINUATIONS = 5; // số lần nối tiếp khi web search tạm dừng (pause_turn)

// ---------- Khoá API: biến môi trường, hoặc dùng chung config.json của Agent Office ----------
function resolveApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, from: 'biến môi trường' };
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config.json'), 'utf8'));
    if (cfg.ANTHROPIC_API_KEY) return { key: cfg.ANTHROPIC_API_KEY, from: '../config.json' };
  } catch { /* không có config.json */ }
  return { key: undefined, from: 'mặc định của SDK (ANTHROPIC_AUTH_TOKEN / ant auth login)' };
}
const auth = resolveApiKey();
const client = new Anthropic(auth.key ? { apiKey: auth.key } : {});

// ---------- Kiến thức thương hiệu (đọc 1 lần khi khởi động → nằm trong phần system được cache) ----------
function loadKnowledge() {
  const parts = [], loaded = [];
  const files = [[path.join(HERE, 'knowledge', 'bai-hoc-duyet.md'), 'bai-hoc-duyet.md'], [path.join(HERE, 'knowledge', 'idea-mau.md'), 'idea-mau.md'], [path.join(HERE, 'knowledge', 'ngay-le.md'), 'ngay-le.md'], [path.join(HERE, 'knowledge', 'cach-spy-video.md'), 'cach-spy-video.md'], ...KNOWLEDGE_FILES.map((f) => [path.join(KNOWLEDGE_DIR, f), f])];
  for (const [file, name] of files) {
    try {
      parts.push(`<tai_lieu ten="${name}">\n${fs.readFileSync(file, 'utf8').trim()}\n</tai_lieu>`);
      loaded.push(name);
    } catch { /* thiếu file thì bỏ qua */ }
  }
  return { text: parts.join('\n\n'), loaded };
}
const knowledge = loadKnowledge();

const SYSTEM = `Bạn là "Content Idea Agent" của Enzy (hạt nêm chay, gia vị chay không bột ngọt; người đại diện là anh Tiến). Việc của bạn: LÊN IDEA content để nhân viên content viết lại thành kịch bản — đúng cách CEO đang làm trong tài liệu "idea-mau.md" bên dưới.

PHẠM VI SẢN PHẨM (CEO dặn, tạm thời): CHỈ lên idea cho (1) Hạt nêm chay Enzy (HNC, hộp 420g) và (2) Rắc cơm thuần chay Enzy (hũ 300g, 3 vị). Không làm idea cho hạt nêm rau củ, bột nêm ăn dặm, gia vị rắc cơm cho bé (không phải đồ chay), canh Jcare, SlowCarb, bánh rau củ; người dùng hỏi sản phẩm khác thì nhắc phạm vi này. Khi không nói rõ sản phẩm, chia idea cho cả hai (nghiêng về Hạt nêm chay) và ghi "Sản phẩm: …" ở dòng đầu ô IDEA. Giá/ưu đãi chỉ dùng đúng tài liệu sản phẩm và ghi "[đối chiếu enzy.vn trước khi đăng]". Hook chọn trong 6 kiểu đã thắng ở tài liệu content WIN.

TỆP KHÁCH CHÍNH (CEO xác nhận): ~95% là NỮ, TRÊN 40 TUỔI, khó tính, kỹ lưỡng chuyện ăn uống cho bản thân và gia đình, sợ hàng trôi nổi/hàng giả, khó tin quảng cáo, ngại giá đắt. Vì vậy mọi idea phải:
- Nói với "các cô, các chị" (xưng Tiến/tụi em), giọng chân thật, từ tốn, như người làm sản phẩm kể chuyện; không giọng quảng cáo, không hô hào, không cường điệu, không trend kiểu Gen Z.
- Lấy BẰNG CHỨNG thay lời khen: nhà máy, quy trình, nguyên liệu thật, bao bì/NSX-HSD, đồng kiểm khi nhận hàng, mua đúng kênh chính hãng, khách thật cùng độ tuổi.
- Trả lời thẳng nỗi ngại giá (vì sao giá vậy, dùng được bao lâu, chia ra mỗi bữa bao nhiêu nếu có số thật) thay vì né.
- Bối cảnh và người xuất hiện là phụ nữ trung niên: nấu cho chồng con, cháu, cha mẹ già, ăn chay ngày rằm/mùng 1 hoặc ăn chay trường, đi chùa; "Tệp khách" ghi cụ thể trong nhóm này.

NGUỒN IDEA (theo thứ tự ưu tiên):
1. Insight khách hàng thật: phần "INSIGHT KHÁCH HÀNG" trong tin nhắn (ý kiến Inbox + Comment, có số khách) và nỗi đau/vấn đề người dùng nêu. Mỗi idea phải xuất phát từ một nỗi đau, lo ngại, câu hỏi hoặc mong muốn có thật của khách.
2. Video mẫu: phần "VIDEO MẪU" (transcript tự động của link Facebook/TikTok/YouTube). Học cấu trúc hook, nhịp, cách dẫn, cách chốt rồi chuyển thể cho Enzy; không chép nguyên văn. Video không đọc được thì nói rõ, không đoán nội dung.
3. Bài học CEO duyệt idea (bai-hoc-duyet.md — tuân thủ tuyệt đối, ưu tiên hơn chỉ dẫn khác trừ tuân thủ quảng cáo) và idea mẫu đã WIN của team, kho idea Enzy: học công thức, không lặp lại idea cũ.
4. Trend mới (khi được yêu cầu bắt trend): tìm trên web, ghi nguồn + ngày.

ĐẦU RA CHUẨN (mỗi lượt lên idea):
A. Một bảng markdown đúng 10 cột theo thứ tự:
| THỜI GIAN | LOẠI CONTENT | MỤC TIÊU | IDEA | NGƯỜI PHÁT NGÔN | SỐ LƯỢNG | TÌNH TRẠNG | KẾT QUẢ | LINK MẪU (nếu có) | LINK FINAL |
- THỜI GIAN: theo người dùng (vd "Tuần 1"); chưa có thì để trống.
- LOẠI CONTENT: dùng đúng từ vựng của team, có thể ghép bằng dấu phẩy: LIVESTREAM, ẢNH, CÂU CHUYỆN, REP KHÁCH HÀNG, NHÀ MÁY, SALE, GIẢI TRÍ, THỜI SỰ, KOC, REVIEW, NẤU ĂN, GIỚI THIỆU SP, UNBOXING, TREND (khi bắt trend).
- MỤC TIÊU: Chuyển đổi / Tương tác / Xây lòng tin / CSKH / Nhận biết.
- IDEA: viết như CEO viết, đủ để nhân viên tự viết kịch bản. Xuống dòng trong ô bằng <br>. Với video gồm các dòng: "Intro: …" (hook, cảnh mở) · "Hiệu ứng: …" (nếu cần) · "Voice: …" (lời thoại mẫu tự nhiên, giọng anh Tiến: xưng Tiến/tụi em, gọi anh chị/cô chú; viết thành câu nói thật, có thể dùng "..." để nhân viên viết tiếp) · "Bối cảnh: …" · "Tệp khách: …" · "-> Dẫn vào …" (vd cảnh quay real liên quan voice 20s đầu + Nhà máy để tạo niềm tin, minh bạch). Với ẢNH: "Bố cục ảnh: …" + text trên ảnh. Không dùng ký tự | trong ô.
- NGƯỜI PHÁT NGÔN: chỉ dùng Enzy / KOC / KOL / Chuyên gia (có thể ghép bằng dấu phẩy).
- SỐ LƯỢNG: số video/ảnh đề xuất (thường 1-2).
- TÌNH TRẠNG: luôn "⏳ Chưa làm". KẾT QUẢ và LINK FINAL: để trống. LINK MẪU: link video mẫu đã dùng làm cảm hứng, nếu có.
- Mặc định 6 idea (người dùng nêu số khác thì theo), đa dạng loại content và mục tiêu, nghiêng về Chuyển đổi nếu không nói gì; mỗi idea một góc khác hẳn nhau.
B. Dưới bảng, mục "Vì sao chọn" — mỗi idea một dòng: "Idea N: nỗi đau/insight gốc (số khách nếu lấy từ kho insight, hoặc video mẫu nào) → cách idea xử lý nó". Thêm một dòng đề xuất 2 idea nên làm trước.
Không viết lời mở đầu dài trước bảng; nếu thiếu thông tin quan trọng thì ghi 1 dòng "Giả định: …" phía trên bảng.

KHI ĐƯỢC YÊU CẦU PHÁT TRIỂN MỘT IDEA thành kịch bản: viết bảng | Cảnh | Thời lượng | Hình ảnh | Lời thoại / text trên màn hình |, hook trong 3 giây đầu, kèm gợi ý âm thanh và 3-5 hashtag.

NGUYÊN TẮC: không bịa số liệu, giá, chương trình khuyến mãi, chứng nhận, lời khách hàng (chương trình sale chỉ dùng khi người dùng nêu; nếu idea cần thì ghi "[chương trình sale hiện tại]"). Tuân thủ tài liệu tuân thủ quảng cáo (không claim chữa bệnh, không nói xấu đối thủ đích danh, không cường điệu). Văn phong đời thường, gần gũi như người Việt nói trên Facebook/TikTok.`;

const systemBlocks = [
  { type: 'text', text: SYSTEM },
  ...(knowledge.text
    ? [{ type: 'text', text: `Tài liệu nội bộ về thương hiệu, sản phẩm, khách hàng và quy tắc tuân thủ:\n\n${knowledge.text}`, cache_control: { type: 'ephemeral' } }]
    : []),
];

// Giữ nguyên danh sách tool trong cả cuộc hội thoại (đổi tool giữa chừng làm mất cache/thinking).
const TOOLS = [{
  type: 'web_search_20260209', name: 'web_search', max_uses: 6,
  user_location: { type: 'approximate', country: 'VN', timezone: 'Asia/Ho_Chi_Minh' },
}];

// ---------- Hội thoại lưu trong bộ nhớ (mất khi tắt app) ----------
const conversations = new Map(); // id -> { messages, updated }
setInterval(() => {
  const cutoff = Date.now() - 6 * 3600_000;
  for (const [id, c] of conversations) if (c.updated < cutoff) conversations.delete(id);
}, 600_000).unref();

const LABELS = {
  week: 'Thời gian', type: 'Loại content mong muốn', goal: 'Mục tiêu', speaker: 'Người phát ngôn',
  audience: 'Tệp khách', pain: 'Insight / nỗi đau khách hàng', product: 'Sản phẩm', sale: 'Chương trình sale đang chạy',
  count: 'Số idea', notes: 'Ghi chú thêm',
};
const INSIGHT_FILE = process.env.INSIGHT_FILE || path.join(HERE, '..', 'reports', 'insight', 'digest.md');
const readInsight = () => { try { return fs.readFileSync(INSIGHT_FILE, 'utf8').trim().slice(0, 12000); } catch { return ''; } };

// Chép lời video mẫu bằng công cụ transcript của Agent Office (yt-dlp + Whisper chạy trên máy), nếu đã cài.
let transcriber;
async function getTranscriber() {
  if (transcriber !== undefined) return transcriber;
  try {
    const m = await import(path.join(HERE, '..', 'transcribe.js'));
    transcriber = m.transcribeReady() ? m.transcribeVideo : null;
  } catch { transcriber = null; }
  return transcriber;
}
const VIDEO_RE = /https?:\/\/(?:[\w-]+\.)*(?:facebook\.com|fb\.watch|tiktok\.com|youtube\.com|youtu\.be|instagram\.com)\/[^\s"'<>)]+/gi;

async function buildUserText(message, brief = {}, first, send) {
  const lines = Object.entries(LABELS)
    .filter(([k]) => String(brief[k] ?? '').trim())
    .map(([k, label]) => `- ${label}: ${String(brief[k]).trim()}`);
  const today = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const blocks = [];
  if (first) blocks.push(`Hôm nay: ${today}.`);
  if (lines.length) blocks.push(`THÔNG TIN ĐÃ XÁC NHẬN:\n${lines.join('\n')}`);
  if (first) {
    const ins = readInsight();
    if (ins) blocks.push(`INSIGHT KHÁCH HÀNG (kho ý kiến khách thật, tự cập nhật):\n${ins}`);
  }
  const links = [...new Set(`${message}\n${brief.refs || ''}`.match(VIDEO_RE) || [])].slice(0, 3);
  if (links.length) {
    const tr = await getTranscriber();
    const vids = [];
    for (const [i, url] of links.entries()) {
      if (!tr) { vids.push(`Video ${i + 1}: ${url}\n(Máy chưa cài công cụ transcript nên không đọc được lời video — dựa vào mô tả của người dùng, không đoán nội dung.)`); continue; }
      send('status', { text: `Đang chép lời video mẫu ${i + 1}/${links.length}… (lần đầu có thể mất vài phút)` });
      const r = await tr(url, { maxChars: 5000, onStep: (t) => send('status', { text: `Video ${i + 1}: ${t}` }) });
      vids.push(r.error
        ? `Video ${i + 1}: ${url}\n(Không đọc được: ${r.error} — không đoán nội dung video này.)`
        : `Video ${i + 1}: ${url} (${Math.round(r.duration || 0)}s)\nTranscript: ${r.text}`);
    }
    blocks.push(`VIDEO MẪU:\n${vids.join('\n\n')}`);
  } else if (String(brief.refs || '').trim()) {
    blocks.push(`VIDEO MẪU / THAM KHẢO (mô tả của người dùng):\n${String(brief.refs).trim()}`);
  }
  if (brief.trends) blocks.push('Bắt trend: CÓ — tìm trend mới trên web trước khi lên idea, ghi nguồn + ngày.');
  blocks.push(`YÊU CẦU: ${message}`);
  return blocks.join('\n\n');
}

// ---------- Gọi Claude, đẩy từng đoạn chữ về trình duyệt qua SSE ----------
async function runTurn(convo, send) {
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // bị từ chối do bộ lọc an toàn → server tự chạy lại bằng model dự phòng
      thinking: { type: 'adaptive' },
      output_config: { effort: EFFORT },
      system: systemBlocks,
      tools: TOOLS,
      messages: convo.messages,
    });
    for await (const ev of stream) {
      if (ev.type === 'content_block_start') {
        const b = ev.content_block;
        if (b.type === 'thinking') send('status', { text: 'Đang suy nghĩ…' });
        else if (b.type === 'server_tool_use') send('status', { text: 'Đang tìm trend trên web…' });
        else if (b.type === 'web_search_tool_result') send('status', { text: 'Đang đọc kết quả tìm kiếm…' });
        else if (b.type === 'text') send('status', { text: '' });
      } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        send('text', { text: ev.delta.text });
      }
    }
    const msg = await stream.finalMessage();
    convo.messages.push({ role: 'assistant', content: msg.content });
    const u = msg.usage || {};
    send('usage', { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, model: msg.model });
    if (msg.stop_reason === 'pause_turn') continue; // server-side web search tạm dừng → gửi lại để chạy tiếp
    if (msg.stop_reason === 'refusal') send('text', { text: '\n\n> ⚠️ Yêu cầu này bị từ chối vì lý do an toàn. Hãy diễn đạt lại.' });
    if (msg.stop_reason === 'max_tokens') send('text', { text: '\n\n> ⚠️ Câu trả lời bị cắt vì quá dài. Gõ "tiếp tục" để viết tiếp.' });
    return;
  }
}

// ---------- Chạy bằng Claude CLI đã đăng nhập (không tốn credit API) ----------
function findClaude() {
  const cands = [process.env.CLAUDE_BIN, 'claude', path.join(os.homedir(), '.local/bin/claude'), path.join(os.homedir(), '.claude/local/claude'),
    '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].filter(Boolean);
  for (const c of cands) {
    if (spawnSync(c, ['--version'], { stdio: 'ignore', timeout: 10000, env: cliEnv() }).status === 0) return c;
  }
  return null;
}
// Bỏ khoá API và biến của phiên Claude Code cha để CLI dùng đúng tài khoản đã đăng nhập.
function cliEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'].includes(k)) delete env[k];
  }
  return env;
}
const CLAUDE = BACKEND === 'cli' ? findClaude() : null;
const CLI_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'content-idea-agent-'));
const CLI_SYSTEM = systemBlocks.map((b) => b.text).join('\n\n');

function cliLoginStatus() {
  if (!CLAUDE) return Promise.resolve(false);
  return new Promise((resolve) => {
    const ch = spawn(CLAUDE, ['auth', 'status'], { env: cliEnv(), stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    ch.stdout.on('data', (d) => { out += d; });
    ch.on('close', () => { try { resolve(Boolean(JSON.parse(out).loggedIn)); } catch { resolve(false); } });
    ch.on('error', () => resolve(false));
  });
}

function runTurnCli(convo, prompt, send, onAbort) {
  if (!CLAUDE) return Promise.reject(new Error('Không tìm thấy lệnh "claude". Cài Claude Code hoặc đặt CLAUDE_BIN=/đường/dẫn/claude.'));
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', MODEL, '--effort', EFFORT, '--system-prompt', CLI_SYSTEM,
    '--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch', 'WebFetch',
    '--strict-mcp-config', '--setting-sources', '',
    ...(convo.started ? ['--resume', convo.sessionId] : ['--session-id', convo.sessionId])];
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, args, { cwd: CLI_DIR, env: cliEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    onAbort(() => child.kill('SIGTERM'));
    let buf = '', err = '', result = null, sawText = false;
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let o; try { o = JSON.parse(line); } catch { continue; }
        if (o.type === 'stream_event') {
          const ev = o.event;
          if (ev.type === 'content_block_start') {
            const t = ev.content_block?.type;
            if (t === 'thinking') send('status', { text: 'Đang suy nghĩ…' });
            else if (t === 'tool_use' || t === 'server_tool_use') send('status', { text: 'Đang tìm trend trên web…' });
            else if (t === 'text') { send('status', { text: '' }); if (sawText) send('text', { text: '\n\n' }); sawText = true; }
          } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            send('text', { text: ev.delta.text });
          }
        } else if (o.type === 'user') {
          send('status', { text: 'Đang đọc kết quả tìm kiếm…' });
        } else if (o.type === 'result') {
          result = o;
        }
      }
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (result && !result.is_error) {
        convo.started = true;
        const u = result.usage || {};
        send('usage', { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, model: `${MODEL} (CLI)` });
        return resolve();
      }
      const msg = result?.result || err.trim() || `claude thoát với mã ${code}`;
      if (/authenticat|log ?in|oauth/i.test(msg)) {
        return reject(new Error('Claude CLI chưa đăng nhập hoặc hết phiên. Mở Terminal chạy: claude auth login — rồi gửi lại.'));
      }
      if (!convo.started) convo.sessionId = crypto.randomUUID(); // lượt đầu lỗi → lần sau tạo phiên mới
      reject(new Error(msg));
    });
    child.stdin.end(prompt);
  });
}

function apiErrorText(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Khoá API không hợp lệ. Đặt ANTHROPIC_API_KEY hoặc kiểm tra config.json.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Khoá API không có quyền dùng model này.';
  if (e instanceof Anthropic.RateLimitError) return 'Đang bị giới hạn tốc độ, thử lại sau ít phút.';
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) return 'Tài khoản Claude API đã hết credit. Nạp thêm tại platform.claude.com → Plans & Billing rồi thử lại.';
  if (e instanceof Anthropic.BadRequestError) return `Yêu cầu không hợp lệ: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Không kết nối được tới Claude API (kiểm tra mạng).';
  if (e instanceof Anthropic.APIError) return `Lỗi Claude API ${e.status ?? ''}: ${e.message}`;
  return `Lỗi: ${e?.message || e}`;
}

// ---------- Idea hằng ngày ----------
const newConvo = () => ({ messages: [], updated: Date.now(), busy: false, sessionId: crypto.randomUUID(), started: false });
const runOnce = (convo, text, send) => (BACKEND === 'cli'
  ? runTurnCli(convo, text, send, () => {})
  : (convo.messages.push({ role: 'user', content: text }), runTurn(convo, send)));
const daily = createDaily({
  runner: runOnce,
  newConvo,
  buildContext: async () => {
    const ins = readInsight();
    const today = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    return `Hôm nay: ${today}.${ins ? `\n\nINSIGHT KHÁCH HÀNG (kho ý kiến khách thật, tự cập nhật):\n${ins}` : ''}`;
  },
});
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

// ---------- HTTP server ----------
const readBody = (req) => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 200_000) { reject(new Error('Nội dung quá lớn')); req.destroy(); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('JSON không hợp lệ')); } });
  req.on('error', reject);
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(HERE, 'public', 'index.html')).pipe(res);
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    const cli = BACKEND === 'cli' ? { found: Boolean(CLAUDE), loggedIn: await cliLoginStatus() } : undefined;
    return res.end(JSON.stringify({ backend: BACKEND, model: MODEL, effort: EFFORT, keyFrom: BACKEND === 'api' ? auth.from : undefined, cli, knowledge: knowledge.loaded }));
  }

  if (url.pathname === '/api/daily' && req.method === 'GET') {
    return json(res, 200, { config: loadDailyConfig(), days: listDays(), running: daily.isRunning() });
  }
  if (url.pathname.startsWith('/api/daily/day/') && req.method === 'GET') {
    const rec = getDay(url.pathname.slice('/api/daily/day/'.length));
    return rec ? json(res, 200, rec) : json(res, 404, { error: 'Chưa có idea ngày này' });
  }
  if (url.pathname === '/api/daily/config' && req.method === 'POST') {
    try { return json(res, 200, saveDailyConfig(await readBody(req))); } catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (url.pathname === '/api/daily/run' && req.method === 'POST') {
    if (daily.isRunning()) return json(res, 409, { error: 'Đang lên idea hôm nay, đợi xong nhé.' });
    daily.run({ force: true }).catch(() => {});
    return json(res, 202, { started: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    let body;
    try { body = await readBody(req); } catch (e) { res.writeHead(400); return res.end(e.message); }
    const message = String(body.message || '').trim();
    if (!message) { res.writeHead(400); return res.end('Thiếu nội dung yêu cầu'); }

    let id = body.conversationId;
    let convo = id && conversations.get(id);
    const first = !convo;
    if (!convo) {
      id = crypto.randomUUID();
      convo = { messages: [], updated: Date.now(), busy: false, sessionId: crypto.randomUUID(), started: false };
      conversations.set(id, convo);
    }
    if (convo.busy) { res.writeHead(409); return res.end('Đang xử lý yêu cầu trước, đợi xong rồi gửi tiếp.'); }

    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('meta', { conversationId: id });

    const before = convo.messages.length;
    convo.busy = true;
    try {
      const userText = await buildUserText(message, body.brief, first, send);
      if (BACKEND === 'cli') {
        let abort = () => {};
        res.on('close', () => { if (!res.writableFinished) abort(); }); // người dùng đóng trang → dừng tiến trình claude
        await runTurnCli(convo, userText, send, (fn) => { abort = fn; });
      } else {
        convo.messages.push({ role: 'user', content: userText });
        await runTurn(convo, send);
      }
      send('done', {});
    } catch (e) {
      convo.messages.length = before; // bỏ lượt lỗi để lịch sử luôn hợp lệ
      console.error('[chat]', e?.status ?? '', e?.message ?? e);
      send('error', { text: BACKEND === 'cli' ? e.message : apiErrorText(e) });
    } finally {
      convo.busy = false;
      convo.updated = Date.now();
      res.end();
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Content Idea Agent: http://localhost:${PORT}`);
  console.log(BACKEND === 'cli'
    ? `  chạy bằng Claude CLI (${CLAUDE || 'KHÔNG TÌM THẤY lệnh claude'}) · model ${MODEL} (effort ${EFFORT})`
    : `  chạy bằng Claude API · model ${MODEL} (effort ${EFFORT}) · khoá API: ${auth.from}`);
  console.log(`  kiến thức: ${knowledge.loaded.length ? knowledge.loaded.join(', ') : 'không có (chạy chung chung)'}`);
});
