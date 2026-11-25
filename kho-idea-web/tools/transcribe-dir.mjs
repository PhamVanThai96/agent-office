// node tools/transcribe-dir.mjs <thư mục chứa ID.mp4> <file kết quả .json>
// Chép lời mọi file .mp4 bằng công cụ transcript của Agent Office (Whisper chạy trên máy).
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const { transcribeVideo } = await import(path.join(ROOT, 'transcribe.js'));
const [dir, outFile] = process.argv.slice(2);
const out = {};
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mp4'))) {
  const r = await transcribeVideo(path.resolve(dir, f), { uploadsDir: path.join(ROOT, 'uploads'), maxChars: 12000 });
  out[f.replace('.mp4', '')] = r.error ? { error: r.error } : { text: r.text, duration: r.duration };
  console.log(f, r.error || Math.round(r.duration) + 's');
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
