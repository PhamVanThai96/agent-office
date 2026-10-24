import { remember, recall } from './memory.js';
import { recordRun, recordTask, recordVerdict, addLesson, lessonFromReview } from './learn.js';
import { AGENTS, work, makePlan, summarize, answer } from './agents.js';
import { toolsFor } from './access.js';

const byId = new Proxy({}, { get: (_, id) => AGENTS.find((a) => a.id === id) });
const CEO = 'manager';
const short = (s, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
// Agent duyệt (gate) kết luận YÊU CẦU SỬA thì trả việc về bước trước, tối đa MAX_REVISE vòng.
const MAX_REVISE = 1;
const needsRevision = (text) => /K[ẾE]T LU[ẬA]N\s*:\s*Y[ÊE]U C[ẦA]U S[ỬU]A/i.test(text) || /^\s*Y[ÊE]U C[ẦA]U S[ỬU]A/i.test(text);

// Vòng lặp xã hội: CEO(user) → Quản Lí → (assign) → agent ⇄ agent (handoff/hỏi đáp) → (report) → Quản Lí → (final) → user
export function createOrchestrator({ emit, state }) {
  const locks = {};
  // Mỗi agent chỉ làm một task một lúc; các task khác của agent đó xếp hàng.
  const withAgent = (id, fn) => {
    const p = (locks[id] || Promise.resolve()).then(fn);
    locks[id] = p.catch(() => {});
    return p;
  };
  const msg = (from, to, kind, text) => emit({ type: 'msg', from, to, kind, text });
  const think = (id, text, detail) => emit({ type: 'think', id, text, detail: detail && detail !== text ? String(detail).slice(0, 1500) : undefined });
  const setStatus = (id, status, report) => emit({ type: 'status', id, status, report });

  async function consult(from, toId, question, command) {
    if (!byId[toId] || toId === from.id) return 'Không có đồng nghiệp này.';
    if (from.canAsk && !from.canAsk.includes(toId)) {
      think(from.id, `Không được hỏi #${toId}`);
      return from.canAsk.length ? `Không được hỏi #${toId}. Chỉ được hỏi: ${from.canAsk.map((x) => '#' + x).join(', ')}.` : 'Bạn không được hỏi đồng nghiệp, hãy tự hoàn thành phần việc của mình.';
    }
    if (state[toId].status === 'offline') return `${byId[toId].name} đang offline.`;
    msg(from.id, toId, 'question', question);
    think(from.id, `Hỏi ${byId[toId].name}: ${short(question, 80)}`, question);
    think(toId, `${from.name} hỏi: ${short(question, 80)}`, question);
    const a = await answer(byId[toId], question, command);
    msg(toId, from.id, 'answer', a);
    think(from.id, `Nhận trả lời từ ${byId[toId].name}`, a);
    return a;
  }

  // opts.label: dòng hiển thị thay cho lệnh dài (vd prompt báo cáo tự động); opts.appendix: phần chi tiết thêm vào báo cáo (số liệu do code tính).
  async function run(raw, attachments = [], opts = {}) {
    let command = raw;
    let direct = null;
    const m = raw.match(/^\/(\w+)\s+([\s\S]+)/);
    if (m && byId[m[1]]) {
      command = m[2];
      if (m[1] !== CEO) direct = m[1];
    }
    if (state[CEO].status === 'offline') {
      emit({ type: 'log', from: 'Hệ thống', text: 'Quản Lí đang offline, không có ai nhận lệnh. Hãy bật Quản Lí online.' });
      return;
    }

    msg('user', CEO, 'command', opts.label || command + (attachments.length ? ` [📎 ${attachments.map((f) => f.name).join(', ')}]` : ''));
    setStatus(CEO, 'working', 'Đang lập kế hoạch…');
    think(CEO, `Nhận lệnh: ${short(command, 80)}`, command);
    think(CEO, 'Phân tích và chia task…');
    const tasks = direct
      ? [{ id: 't1', title: command, assignee: direct, dependsOn: [] }]
      : await makePlan(command);
    if (tasks.route) think(CEO, `Quy trình: ${tasks.route} (${tasks.map((t) => '#' + t.assignee).join(' → ')})`);
    emit({ type: 'plan', tasks: tasks.map((t) => ({ ...t, status: 'pending' })) });
    for (const t of tasks) msg(CEO, t.assignee, 'assign', t.title);
    think(CEO, `Đã giao ${tasks.length} task cho ${new Set(tasks.map((t) => t.assignee)).size} agent`);
    setStatus(CEO, 'working', `Đã tạo ${tasks.length} task, đang theo dõi tiến độ.`);

    const memory = recall(command);
    if (memory) think(CEO, 'Dùng lại bộ nhớ từ các lần làm việc trước');
    const results = {};
    const started = {};
    const artifacts = []; // file ảnh/csv agent tạo ra, tự chèn vào báo cáo
    const keep = (r, p) => { if (r && !r.error && r.path && /\.(png|jpe?g|webp|gif|svg|csv)$/i.test(p)) artifacts.push(r.path); return r; };
    const byTask = Object.fromEntries(tasks.map((t) => [t.id, t]));

    const inputsOf = {};

    // Chạy một task (đã có đầu vào). extra: { feedback, round } khi làm lại theo yêu cầu sửa.
    const runTask = (t, inputs, extra = {}) => {
      const a = byId[t.assignee];
      return withAgent(a.id, async () => {
        emit({ type: 'task', id: t.id, status: 'running', round: extra.round || 0 });
        setStatus(a.id, 'working');
        think(a.id, extra.feedback ? `Sửa lần ${extra.round} theo phản hồi của ${extra.feedback.from}` : `Nhận task: ${short(t.title, 80)}`, t.title);
        inputs.forEach((i) => think(a.id, `Đọc kết quả của ${i.from}`));
        if (attachments.length) think(a.id, `Có ${attachments.length} file đính kèm`);
        think(a.id, 'Đang phân tích…');
        const raw = toolsFor(a, emit);
        const tools = {
          readFile: async (p) => { think(a.id, `Đọc file ${p}`); const r = await raw.readFile(p); think(a.id, r.error ? `Không đọc được: ${r.error}` : `Đã đọc ${p}`); return r; },
          writeFile: async (p, c) => { think(a.id, `Ghi file ${p}`); const r = await raw.writeFile(p, c); think(a.id, r.error ? `Không ghi được: ${r.error}` : `Đã ${r.created ? 'tạo' : 'ghi đè'} ${r.path}`); return keep(r, String(p)); },
          makeImage: async (i) => { think(a.id, `Tạo ảnh ${i?.output}`); const r = await raw.makeImage(i); think(a.id, r.error ? `Không tạo được ảnh: ${r.error}` : `Đã ${r.created ? 'tạo' : 'ghi đè'} ảnh ${r.path} (${r.width}x${r.height})`); return keep(r, r.path || ''); },
          makeDocx: async (i) => { think(a.id, `Tạo file Word ${i?.output}`); const r = await raw.makeDocx(i); think(a.id, r.error ? `Không tạo được .docx: ${r.error}` : `Đã ${r.created ? 'tạo' : 'ghi đè'} ${r.path}`); return r; },
          runCommand: async (i) => {
            think(a.id, `Chạy lệnh: ${short(String(i?.command ?? ''), 80)}`, String(i?.command ?? ''));
            const r = await raw.runCommand(i);
            if (r.error) think(a.id, `Lệnh không chạy: ${short(r.error, 90)}`, r.error);
            else {
              think(a.id, r.ok ? `Lệnh xong (${r.ms}ms)` : `Lệnh lỗi, mã ${r.exitCode}`, short(`${r.stdout || ''}${r.stderr ? `\n[stderr] ${r.stderr}` : ''}`, 900));
              if (r.hints?.length) think(a.id, `Chẩn đoán: ${short(r.hints[0], 90)}`, r.hints.join('\n'));
            }
            return r;
          },
          listDir: async (p) => { think(a.id, `Xem thư mục ${p}`); const r = await raw.listDir(p); think(a.id, r.error ? `Không xem được: ${r.error}` : `Thấy ${r.entries.length} mục`); return r; },
        };
        try {
          const text = await work(a, {
            command, task: t, inputs, memory, attachments, feedback: extra.feedback, round: extra.round || 0,
            think: (x) => think(a.id, x), isLast: !tasks.some((o) => o.dependsOn?.includes(t.id)),
            tools,
            ask: (to, q) => consult(a, to, q, command),
          });
          think(a.id, 'Hoàn thành, gửi báo cáo cho Quản Lí ✓', text);
          setStatus(a.id, 'idle', text);
          msg(a.id, CEO, 'report', short(text, 140));
          emit({ type: 'task', id: t.id, status: 'done', round: extra.round || 0 });
          recordRun(a.id, { ok: true }); recordTask(a.id, { title: t.title, text });
          return { status: 'done', text };
        } catch (e) {
          const text = `Lỗi: ${e.message}`;
          think(a.id, short(text, 90), text);
          setStatus(a.id, 'error', text);
          msg(a.id, CEO, 'report', short(text, 140));
          emit({ type: 'task', id: t.id, status: 'failed' });
          recordRun(a.id, { ok: false });
          return { status: 'failed', text };
        }
      });
    };

    const exec = async (t) => {
      const deps = await Promise.all(t.dependsOn.map((d) => start(byTask[d])));
      const a = byId[t.assignee];
      const blocked = deps.find((d) => d.blocked);
      if (blocked) {
        emit({ type: 'task', id: t.id, status: 'skipped' });
        msg(a.id, CEO, 'report', `Bỏ qua: bước trước chưa được duyệt.`);
        return { status: 'skipped', text: 'Bỏ qua vì bước trước chưa qua duyệt.' };
      }
      if (state[a.id].status === 'offline') {
        emit({ type: 'task', id: t.id, status: 'skipped' });
        msg(a.id, CEO, 'report', `${a.name} đang offline, task bị bỏ qua.`);
        return { status: 'skipped', text: `${a.name} offline` };
      }
      const collect = (depIds) => {
        const inputs = [];
        for (const d of depIds) {
          const r = results[d] || {};
          if (r.status !== 'done') continue;
          const from = byTask[d].assignee;
          // Sau bước duyệt, bước tiếp theo cần cả bản đã được duyệt (không chỉ lời kết luận).
          if (r.reviewed) inputs.push(...r.reviewed);
          inputs.push({ from: byId[from].name, text: r.text });
          if (from !== a.id) msg(from, a.id, 'handoff', short(r.text));
        }
        return inputs;
      };
      let inputs = collect(t.dependsOn);
      inputsOf[t.id] = inputs;
      let r = await runTask(t, inputs);
      if (!a.gate || r.status !== 'done') return r;

      // Bước duyệt: YÊU CẦU SỬA → trả về các bước sản xuất ngay trước đó, làm lại rồi duyệt lại.
      let round = 0;
      const producers = t.dependsOn.filter((d) => results[d]?.status === 'done' && !byId[byTask[d].assignee].gate);
      while (needsRevision(r.text) && round < MAX_REVISE && producers.length) {
        round++;
        think(a.id, `Yêu cầu sửa (vòng ${round}/${MAX_REVISE})`);
        await Promise.all(producers.map(async (d) => {
          const p = byTask[d];
          // Bài học cho agent sản xuất: người duyệt đã yêu cầu sửa gì (tự động đưa vào sổ tay kinh nghiệm).
          addLesson(p.assignee, lessonFromReview(r.text), 'review'); recordVerdict(p.assignee, false);
          msg(a.id, p.assignee, 'revise', short(r.text));
          results[d] = await runTask(p, inputsOf[d] || [], { feedback: { from: a.name, text: r.text }, round });
        }));
        inputs = collect(t.dependsOn);
        r = await runTask(t, inputs, { round });
      }
      const still = needsRevision(r.text);
      if (!still) producers.forEach((d) => { if (!round) recordVerdict(byTask[d].assignee, true); });
      else producers.forEach((d) => addLesson(byTask[d].assignee, `Sau ${round} vòng sửa vẫn chưa đạt: ${lessonFromReview(r.text).replace(/^[^:]*:\s*/, '')}`, 'review'));
      if (still) think(a.id, `Chưa đạt sau ${round} vòng sửa, dừng các bước sau`);
      return { ...r, reviewed: inputs, blocked: still, rounds: round };
    };
    const start = (t) => (started[t.id] ||= exec(t).then((r) => (results[t.id] = r)));

    await Promise.all(tasks.map(start));

    setStatus(CEO, 'working', 'Đang tổng hợp báo cáo…');
    think(CEO, 'Tổng hợp báo cáo từ các agent…');
    const items = tasks.map((t) => {
      const { status, text, rounds, blocked } = results[t.id];
      const note = rounds ? ` (sau ${rounds} vòng sửa${blocked ? ', vẫn chưa đạt' : ''})` : '';
      return { agent: byId[t.assignee].name, title: t.title + note, status, text };
    });
    let text;
    try {
      text = direct || (tasks.noSummary && items.length === 1 && items[0].status === 'done') ? items[0].text : await summarize(command, items);
    } catch (e) {
      text = `Không tổng hợp được báo cáo: ${e.message}`;
    }
    msg(CEO, 'user', 'final', short(text, 140));
    await emit({ type: 'final', text, artifacts, links: opts.links, details: [...(opts.appendix || []), ...items], tasks: items.map((i) => ({ agent: i.agent, title: i.title, status: i.status })) });
    try { remember({ command, summary: text, items, artifacts }); } catch { /* không lưu được thì bỏ qua */ }
    think(CEO, 'Đã gửi báo cáo cho CEO ✓');
    setStatus(CEO, 'idle', text);
  }

  return run;
}
