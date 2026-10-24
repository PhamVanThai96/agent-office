import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Định tuyến công việc theo loại yêu cầu (workflows.json): chọn đúng agent cần thiết, không tốn token cho agent thừa.
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'workflows.json');

const plain = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const has = (text, kw) => new RegExp(`(^|[^a-z0-9])${plain(kw).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(text);

export function loadWorkflows() {
  try {
    const list = JSON.parse(fs.readFileSync(FILE, 'utf8')).workflows;
    return Array.isArray(list) ? list : [];
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[workflows] ${e.message}`);
    return [];
  }
}

export function classify(command) {
  const text = plain(command);
  return loadWorkflows().find((w) => (w.keywords || []).some((k) => has(text, k))) || null;
}

const TITLES = {
  signal: '01 Thu thập tín hiệu: {c}',
  planner: '02-03 Backlog, ưu tiên và brief: {c}',
  writer: '04 Viết kịch bản: {c}',
  script_review: '05 Duyệt 1: Leader duyệt kịch bản',
  video: '06 Dựng video: {c}',
  designer: 'Thiết kế hình ảnh: {c}',
  video_review: '07 Duyệt 2: duyệt trước khi đăng',
  analyst: '08-09 Đo lường và rút insight: {c}',
};
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Dựng danh sách task cho một quy trình; bỏ agent không tồn tại, bước tuỳ chọn không khớp từ khoá, mỗi bước phụ thuộc bước trước.
export function planFor(workflow, command, ids) {
  const text = plain(command), c = short(command, 60);
  const tasks = [];
  let prev = [];
  for (const raw of workflow.steps || []) {
    const group = (Array.isArray(raw) ? raw : [raw]).map((s) => (typeof s === 'string' ? { agent: s } : s))
      .filter((s) => ids.includes(s.agent) && s.agent !== 'manager' && (!s.when || s.when.some((k) => has(text, k))));
    const cur = group.map((s, i) => ({
      id: `t${tasks.length + i + 1}`,
      title: (s.title || workflow.titles?.[s.agent] || TITLES[s.agent] || `Thực hiện phần việc của #${s.agent}: {c}`).replace('{c}', c),
      assignee: s.agent, dependsOn: prev,
    }));
    if (cur.length) { tasks.push(...cur); prev = cur.map((t) => t.id); }
  }
  return tasks;
}

// Tóm tắt các quy trình để đưa vào prompt khi Quản Lí phải tự lập kế hoạch.
const stepName = (s) => (typeof s === 'string' ? s : `${s.agent}?`);
export function routeGuide() {
  return loadWorkflows().map((w) => `- ${w.name} (${w.when}): ${w.steps.map((s) => (Array.isArray(s) ? s.map(stepName).join('+') : stepName(s))).join(' → ')}`).join('\n');
}

// Mẫu câu lệnh nhanh cho giao diện (nút chọn quy trình).
export const templates = () => loadWorkflows().filter((w) => w.template).map((w) => ({ id: w.id, name: w.name, text: w.template }));
