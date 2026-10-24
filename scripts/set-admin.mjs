// Đặt hoặc đổi Admin ID + mật khẩu ngay trên máy chạy server (khi không tạo được trên giao diện, hoặc quên mật khẩu).
// Chạy:  node scripts/set-admin.mjs [admin-id]      (mật khẩu được hỏi, không hiện khi gõ)
import readline from 'node:readline';
import { setCredentials } from '../adminauth.js';

const ask = (q, hidden) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  if (hidden && process.stdin.isTTY) { rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); }; }
  rl.question(q, (a) => { rl.close(); if (hidden && process.stdin.isTTY) process.stdout.write('\n'); resolve(a); });
});

const id = process.argv[2] || (await ask('Admin ID: ', false)).trim();
const pw = await ask('Mật khẩu (tối thiểu 8 ký tự): ', true);
if (process.stdin.isTTY) {
  const pw2 = await ask('Nhập lại mật khẩu: ', true);
  if (pw !== pw2) { console.error('✖ Hai mật khẩu không khớp.'); process.exit(1); }
}
try { setCredentials(id, pw); console.log(`✔ Đã đặt Admin "${id}". Đăng nhập ở hộp thoại "Xác thực Admin" trên giao diện.`); }
catch (e) { console.error('✖ ' + e.message); process.exit(1); }
