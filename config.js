import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from './cli.js';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(APP_DIR, 'config.json');

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[config] Không đọc được config.json (${e.message}), dùng mặc định.`);
    return {};
  }
}

// Giá trị trong config.json được ưu tiên; để trống thì lấy từ biến môi trường.
const str = (v, env) => (typeof v === 'string' && v.trim() ? v.trim() : env || '');
const PROVIDERS = {
  claude: { keyName: 'ANTHROPIC_API_KEY', envKeys: ['ANTHROPIC_API_KEY'], model: 'claude-sonnet-4-5' },
  gpt: { keyName: 'OPENAI_API_KEY', envKeys: ['OPENAI_API_KEY'], model: 'gpt-4o' },
  gemini: { keyName: 'GEMINI_API_KEY', envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], model: 'gemini-2.0-flash' },
};
const ALIAS = { anthropic: 'claude', openai: 'gpt', google: 'gemini' };

function build(raw) {
const notes = [];
let provider = (str(raw.AI_PROVIDER, process.env.AI_PROVIDER) || 'claude').toLowerCase();
provider = ALIAS[provider] || provider;
if (!PROVIDERS[provider]) {
  notes.push(`AI_PROVIDER "${provider}" không hợp lệ (chọn claude, gpt hoặc gemini), dùng claude.`);
  provider = 'claude';
}
const P = PROVIDERS[provider];
const apiKey = str(raw[P.keyName], P.envKeys.map((k) => process.env[k]).find(Boolean));

// API: gọi trực tiếp bằng khoá. CLI: dùng claude/codex/gemini đã đăng nhập sẵn trên máy.
let connection = (str(raw.CONNECTION, process.env.CONNECTION) || 'API').toUpperCase();
if (connection !== 'API' && connection !== 'CLI') {
  notes.push(`CONNECTION "${connection}" không hợp lệ (chọn API hoặc CLI), dùng API.`);
  connection = 'API';
}
const CLI_DEFAULT = { claude: 'claude', gpt: 'codex', gemini: 'gemini' };
const cliCmd = {}, cliModels = {}, cliOk = {};
for (const name of Object.keys(PROVIDERS)) {
  cliCmd[name] = str(raw.CLI?.[name], '') || CLI_DEFAULT[name];
  cliModels[name] = str(raw.CLI_MODELS?.[name], '');
  // gpt-4o là model API mặc định cũ, không phải model mặc định của Codex CLI.
  // Để Codex chọn model được hỗ trợ bởi phiên bản CLI/tài khoản đang cài.
  if (name === 'gpt' && cliModels[name] === 'gpt-4o') cliModels[name] = '';
  cliOk[name] = connection === 'CLI' && detect(cliCmd[name]);
}
const model = connection === 'CLI' ? cliModels[provider] : (str(raw.MODELS?.[provider], '') || P.model);

let mode = (str(raw.MODE, process.env.MODE) || 'MOCK').toUpperCase();
if (mode !== 'MOCK' && mode !== 'REAL') {
  notes.push(`MODE "${mode}" không hợp lệ, dùng MOCK.`);
  mode = 'MOCK';
}
if (mode === 'REAL' && connection === 'API' && !apiKey) {
  notes.push(`MODE=REAL nhưng chưa có ${P.keyName} (provider ${provider}), dùng MOCK.`);
  mode = 'MOCK';
}
if (mode === 'REAL' && connection === 'CLI' && !cliOk[provider]) {
  notes.push(`MODE=REAL, CONNECTION=CLI nhưng không chạy được lệnh "${cliCmd[provider]}" (chưa cài hoặc chưa đăng nhập), dùng MOCK.`);
  mode = 'MOCK';
}

// Thư mục mã nguồn mà các agent làm việc; đường dẫn tương đối của agent được tính từ đây.
let sourceDir = str(raw.SOURCE_DIR, process.env.SOURCE_DIR);
if (sourceDir.startsWith('~')) sourceDir = path.join(os.homedir(), sourceDir.slice(1));
sourceDir = sourceDir ? path.resolve(sourceDir) : APP_DIR;
try {
  if (!fs.statSync(sourceDir).isDirectory()) throw new Error('không phải thư mục');
} catch {
  notes.push(`SOURCE_DIR "${sourceDir}" không tồn tại hoặc không phải thư mục, dùng thư mục của ứng dụng.`);
  sourceDir = APP_DIR;
}

const note = notes.join(' ');
if (note) console.warn(`[config] ${note}`);

// Khoá và model của từng provider, để agent có thể dùng AI khác mặc định.
const keys = {}, models = {};
for (const [name, p] of Object.entries(PROVIDERS)) {
  keys[name] = str(raw[p.keyName], p.envKeys.map((k) => process.env[k]).find(Boolean));
  models[name] = str(raw.MODELS?.[name], '') || p.model;
}

const detail = String(raw.REPORT_DETAIL || process.env.REPORT_DETAIL || 'detailed').toLowerCase() === 'brief' ? 'brief' : 'detailed';
const tok = (...v) => { const n = Math.round(Number(v.find((x) => x !== undefined && x !== '' && x !== null))); return n >= 200 && n <= 16000 ? n : 0; };
return {
  connection, cliCmd, cliModels, cliOk, keys, models, providers: Object.keys(PROVIDERS), aliases: ALIAS,
  mode, note, provider, apiKey, model, sourceDir, appDir: APP_DIR,
  port: Number(raw.PORT || process.env.PORT) || 3000,
  detail,
  workMax: tok(raw.MAX_WORK_TOKENS, process.env.MAX_WORK_TOKENS) || (detail === 'brief' ? 1500 : 4000),
  sumMax: tok(raw.MAX_SUMMARY_TOKENS, process.env.MAX_SUMMARY_TOKENS) || (detail === 'brief' ? 500 : 2500),
};
}

export const CONFIG = {};
export let LIVE = false;

// Đọc lại config.json và cập nhật CONFIG tại chỗ để các module khác dùng ngay.
export function reload() {
  Object.assign(CONFIG, build(readRaw()));
  LIVE = CONFIG.mode === 'REAL';
}
reload();

// Cài đặt AI mà CEO chỉnh trên giao diện; khoá API không bao giờ gửi ngược ra trình duyệt.
export function settings() {
  const hint = (k) => (k ? `…${k.slice(-4)}` : '');
  return {
    detail: CONFIG.detail, workMax: CONFIG.workMax, sumMax: CONFIG.sumMax,
    mode: CONFIG.mode, connection: CONFIG.connection, provider: CONFIG.provider, note: CONFIG.note,
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([name, p]) => [name, {
      hasKey: Boolean(CONFIG.keys[name]), keyHint: hint(CONFIG.keys[name]), keyName: p.keyName,
      model: CONFIG.models[name], cliModel: CONFIG.cliModels[name], cliOk: CONFIG.cliOk[name], cliCmd: CONFIG.cliCmd[name],
    }])),
  };
}

export function saveSettings(b) {
  const raw = readRaw();
  const want = (v) => (typeof v === 'string' ? v.trim() : '');
  const provider = ALIAS[want(b.provider).toLowerCase()] || want(b.provider).toLowerCase();
  if (!PROVIDERS[provider]) throw new Error('AI_PROVIDER phải là claude, gpt hoặc gemini.');
  const mode = want(b.mode).toUpperCase() || 'MOCK';
  const connection = want(b.connection).toUpperCase() || 'API';
  if (!['MOCK', 'REAL'].includes(mode)) throw new Error('MODE phải là MOCK hoặc REAL.');
  if (!['API', 'CLI'].includes(connection)) throw new Error('CONNECTION phải là API hoặc CLI.');
  const model = want(b.model);
  if (model && !/^[\w][\w.:\/-]{0,63}$/.test(model)) throw new Error('Tên model không hợp lệ.');
  const key = want(b.apiKey);
  if (/\s/.test(key) || key.length > 300) throw new Error('API key không hợp lệ.');

  const detail = want(b.detail).toLowerCase() || 'detailed';
  if (!['brief', 'detailed'].includes(detail)) throw new Error('Mức chi tiết phải là brief hoặc detailed.');
  const limit = (v, name) => {
    if (v === '' || v == null) return '';
    const n = Math.round(Number(v));
    if (!(n >= 200 && n <= 16000)) throw new Error(`${name} phải từ 200 đến 16000 token (để trống = mặc định).`);
    return n;
  };
  raw.REPORT_DETAIL = detail;
  raw.MAX_WORK_TOKENS = limit(b.workMax, 'Độ dài tối đa mỗi agent');
  raw.MAX_SUMMARY_TOKENS = limit(b.sumMax, 'Độ dài tối đa báo cáo cuối');
  raw.MODE = mode; raw.CONNECTION = connection; raw.AI_PROVIDER = provider;
  const keyName = PROVIDERS[provider].keyName;
  if (b.clearKey === true) raw[keyName] = '';
  else if (key) raw[keyName] = key;
  const bucket = connection === 'CLI' ? 'CLI_MODELS' : 'MODELS';
  raw[bucket] = { ...(raw[bucket] || {}), [provider]: connection === 'CLI' && provider === 'gpt' && model === 'gpt-4o' ? '' : model };

  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  reload();
}

// Chỉ bật CLI/REAL sau khi endpoint đã xác nhận CLI đang đăng nhập.
export function connectCLI(provider) {
  if (!['claude', 'gpt'].includes(provider)) throw new Error('Chỉ hỗ trợ đăng nhập Claude hoặc Codex.');
  const raw = readRaw();
  raw.MODE = 'REAL';
  raw.CONNECTION = 'CLI';
  raw.AI_PROVIDER = provider;
  if (provider === 'gpt' && raw.CLI_MODELS?.gpt === 'gpt-4o') raw.CLI_MODELS.gpt = '';
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  reload();
}
