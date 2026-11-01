import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stringifyYaml } from '../yamlmini.js';

// Đẩy KHO INSIGHT lên GitHub: xuất ra thư mục vault/ (YAML + README) rồi commit/push CHỈ thư mục này (không đụng file khác đang sửa).
// Mặc định không kèm trích dẫn nguyên văn của khách; nội dung Brands Vietnam chỉ là bản tóm tắt + link nguồn.
export const REPO = process.env.VAULT_REPO || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); // VAULT_REPO: chỉ dùng để thử
export const VAULT = path.join(REPO, 'vault');

const git = (args, { cwd = REPO, timeout = 60000 } = {}) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
    if (err) reject(new Error(String(stderr || err.message).trim().split('\n').slice(-3).join(' ').slice(0, 300)));
    else resolve(String(stdout).trim());
  });
});
const gh = (args) => new Promise((resolve) => execFile('gh', args, { cwd: REPO, timeout: 15000 }, (e, o) => resolve(e ? '' : String(o).trim())));

/** Ghi vault/ từ dữ liệu `v` (daily.vault()). Trả về số mục từng loại. */
export function exportVault(v, { quotes = false, dir = VAULT } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const head = `# Kho insight Agent Office — xuất ${day}. File sinh tự động, sửa trong app rồi push lại.\n`;
  const write = (name, obj) => fs.writeFileSync(path.join(dir, name), head + stringifyYaml(obj));
  write('ideas.yaml', { ideas: v.ideas.map((i) => ({ day: i.day, title: i.title, status: i.status, detail: i.detail || '', note: i.note || '', report: i.report || '' })) });
  write('insight-khach-hang.yaml', { themes: v.themes.map((t) => ({ label: t.label, type: t.type, stage: t.stage, product: t.product || '', customers: t.count, first_seen: t.firstSeen, last_seen: t.lastSeen, touchpoint: t.touchpoint || '', ...(quotes ? { quotes: t.quotes } : {}) })) });
  write('case-studies.yaml', { source: 'Brands Vietnam (bản tóm tắt, bản quyền nội dung gốc thuộc nguồn)', articles: v.articles.map((a) => ({ title: a.title, brand: a.brand || '', category: a.category || '', saved: a.saved, tags: a.tags, insight: a.insight || a.summary || '', big_idea: a.big_idea || '', lessons_for_enzy: a.lessons, content_angles: a.angles, results: a.results, url: a.url })) });
  fs.writeFileSync(path.join(dir, 'README.md'), `# Kho insight\n\nXuất từ Agent Office ngày ${day}.\n\n- \`ideas.yaml\`: idea đã đề xuất (${v.ideas.length})\n- \`insight-khach-hang.yaml\`: chủ đề insight khách hàng đã chắt lọc (${v.themes.length})${quotes ? ' — có kèm trích dẫn' : ' — không kèm trích dẫn nguyên văn'}\n- \`case-studies.yaml\`: tóm tắt case-study/kiến thức marketing có link nguồn (${v.articles.length})\n`);
  return { ideas: v.ideas.length, themes: v.themes.length, articles: v.articles.length };
}

export async function info() {
  const out = { remote: '', branch: '', visibility: '', pending: false, last: '' };
  try {
    out.remote = (await git(['remote', 'get-url', 'origin'])).replace(/\/\/[^@/]*@/, '//');
    out.branch = await git(['branch', '--show-current']);
    out.last = await git(['log', '-1', '--format=%cd', '--date=format:%d/%m/%Y %H:%M', '--', 'vault']).catch(() => '');
    out.pending = Boolean(await git(['status', '--porcelain', '--', 'vault']).catch(() => ''));
    const m = out.remote.match(/github\.com[/:]([^/]+\/[^/.]+)/);
    if (m) out.visibility = (await gh(['repo', 'view', m[1], '--json', 'visibility', '-q', '.visibility'])).toLowerCase();
  } catch (e) { out.error = e.message; }
  return out;
}

export async function push(v, { quotes = false } = {}) {
  const counts = exportVault(v, { quotes });
  const branch = await git(['branch', '--show-current']);
  if (!branch) throw new Error('Đang ở trạng thái detached HEAD, không push được.');
  await git(['add', '--', 'vault']);
  const changed = Boolean(await git(['diff', '--cached', '--name-only', '--', 'vault']));
  if (changed) await git(['commit', '-m', `Cập nhật kho insight ${new Date().toISOString().slice(0, 10)} (${counts.ideas} idea, ${counts.themes} chủ đề, ${counts.articles} case-study)`, '--', 'vault']);
  else if (!(await git(['log', '@{u}..HEAD', '--oneline', '--', 'vault']).catch(() => ''))) return { ok: true, pushed: false, note: 'Kho không thay đổi so với lần push trước.', counts };
  await git(['push', 'origin', branch], { timeout: 120000 });
  return { ok: true, pushed: true, branch, counts, note: `Đã push kho insight lên nhánh ${branch}.` };
}
