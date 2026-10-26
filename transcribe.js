import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Công cụ video_transcribe: video (link Facebook/YouTube/TikTok… hoặc file đã đính kèm) → chữ.
// Nhẹ tài nguyên: chỉ tải ÂM THANH chất lượng thấp (vài trăm KB/phút, không tải hình), xử lý xong xoá ngay file tạm;
// nhận dạng giọng nói chạy trên máy bằng faster-whisper (int8, không gọi API, không tốn token); mỗi lúc chỉ chạy 1 video; kết quả lưu cache theo link.
// Cài đặt: tools/venv (yt-dlp + faster-whisper). Xem docs/CLAUDE.md.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const VENV = path.join(ROOT, 'tools', 'venv', 'bin');
const CACHE = path.join(ROOT, 'data', 'transcripts');
const MODEL = process.env.WHISPER_MODEL || 'small';   // base (~145MB, nhanh, kém tiếng Việt) | small (~480MB, khuyên dùng) | medium
const MAX_MIN = 15;                                    // video dài hơn bị từ chối để khỏi chiếm máy
const TIMEOUT_MS = 20 * 60000;

const log = (t) => console.log(`[transcript] ${t}`); // hiện trong cửa sổ terminal đang chạy server
// onLine: nhận từng dòng tiến trình (yt-dlp % tải, tqdm tải mô hình) để in ra CLI.
const run = (cmd, args, ms, onLine, env) => new Promise((resolve) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let last = 0;
  const feed = (d) => { if (!onLine) return; for (const l of String(d).split(/[\r\n]+/)) { const t = l.trim(); if (t && Date.now() - last > 1500) { last = Date.now(); onLine(t); } } };
  let out = '', err = '';
  const t = setTimeout(() => { p.kill('SIGKILL'); err += '\n(quá thời gian)'; }, ms);
  p.stdout.on('data', (d) => { out += d; if (!/^\s*\{/.test(String(d))) feed(d); });
  p.stderr.on('data', (d) => { err = (err + d).slice(-2000); feed(d); });
  p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
  p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
});

let chain = Promise.resolve();
export const transcribeReady = () => fs.existsSync(path.join(VENV, 'yt-dlp')) && fs.existsSync(path.join(ROOT, 'tools', 'transcribe.py'));

/** src: link http(s) hoặc đường dẫn file trong uploads/. Trả { text, duration, language, saved, cached } hoặc { error }. */
export function transcribeVideo(src, { uploadsDir = path.join(ROOT, 'uploads'), maxChars = 6000, onStep = () => {} } = {}) {
  const job = chain.then(() => doTranscribe(String(src || '').trim(), { uploadsDir, maxChars, onStep }));
  chain = job.catch(() => {});
  return job.catch((e) => ({ error: e.message }));
}

async function doTranscribe(src, { uploadsDir, maxChars, onStep }) {
  if (!transcribeReady()) return { error: 'Chưa cài công cụ transcript trên máy này. Chạy một lần: bash scripts/setup-media.sh (cài yt-dlp + faster-whisper vào tools/venv), rồi thử lại.' };
  const isUrl = /^https?:\/\//i.test(src);
  let local = '';
  if (!isUrl) {
    local = path.resolve(src.startsWith('/') ? src : path.join(uploadsDir, src));
    if (!local.startsWith(path.resolve(uploadsDir) + path.sep) || !fs.existsSync(local)) return { error: 'Chỉ đọc được link http(s) hoặc file video đã đính kèm (trong uploads/).' };
  }
  const id = crypto.createHash('sha1').update(isUrl ? src : `${local}:${fs.statSync(local).mtimeMs}`).digest('hex').slice(0, 16);
  fs.mkdirSync(CACHE, { recursive: true });
  const cf = path.join(CACHE, `${id}.json`);
  const finish = (j, cached) => ({ source: src, language: j.language, duration: j.duration, chars: j.text.length, text: j.text.length > maxChars ? j.text.slice(0, maxChars) + '…' : j.text, truncated: j.text.length > maxChars, saved: path.relative(ROOT, cf), cached });
  if (fs.existsSync(cf)) { try { return finish(JSON.parse(fs.readFileSync(cf, 'utf8')), true); } catch { /* cache hỏng: làm lại */ } }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-tr-'));
  try {
    let audio = local;
    if (isUrl) {
      onStep('Đang tải âm thanh video (không tải hình)…'); log(`Tải âm thanh: ${src}`);
      const r = await run(path.join(VENV, 'yt-dlp'), ['--progress', '--newline', '--no-playlist', '--no-warnings', '-f', 'worstaudio/worst', '--match-filter', `duration<=${MAX_MIN * 60}`, '--max-filesize', '80M', '-o', path.join(tmp, 'a.%(ext)s'), src], TIMEOUT_MS / 2, (l) => /\d+(\.\d+)?%/.test(l) && log(l.replace(/\s+/g, ' ')));
      audio = fs.readdirSync(tmp).map((f) => path.join(tmp, f))[0];
      if (!audio) return { error: `Không tải được âm thanh video${/does not pass filter|longer/i.test(r.err) ? ` (dài hơn ${MAX_MIN} phút)` : ''}: ${r.err.replace(/\s+/g, ' ').slice(0, 300) || 'link riêng tư/không hỗ trợ'}.` };
    }
    onStep('Đang chuyển giọng nói thành chữ (chạy trên máy)…'); log(`Chuyển giọng nói bằng Whisper ${MODEL} (lần đầu sẽ tải mô hình ~${MODEL === 'base' ? 145 : 480}MB về ~/.cache/huggingface)`);
    const t = await run(path.join(VENV, 'python'), [path.join(ROOT, 'tools', 'transcribe.py'), audio, MODEL, 'vi'], TIMEOUT_MS, (l) => log(l.replace(/\s+/g, ' ').slice(0, 200)), { HF_HUB_DISABLE_XET: '1' });
    let j;
    try { j = JSON.parse(t.out.trim().split('\n').at(-1)); } catch { return { error: `Chuyển giọng nói lỗi: ${t.err.replace(/\s+/g, ' ').slice(-300)}` }; }
    if (!j.text?.trim()) return { error: 'Video không có lời thoại nghe được (nhạc/không có tiếng).', duration: j.duration };
    fs.writeFileSync(cf, JSON.stringify({ source: src, at: new Date().toISOString(), model: MODEL, ...j }));
    log(`Xong: ${j.text.length} ký tự, video ${j.duration}s → data/transcripts/${id}.json`);
    return finish(j, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true }); // luôn xoá âm thanh tạm
  }
}
