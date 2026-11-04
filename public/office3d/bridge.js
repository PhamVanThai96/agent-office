// Cầu nối Agent Office → văn phòng 3D. Backend không đổi: trang hỏi /poll (như index.html) rồi đổi mỗi agent thành một
// "nhân viên" và mỗi sự kiện (status / think / msg / plan / task) thành tin {k:'snap'|'ev'|'sess'} mà engine 3D hiểu.
// Mỗi phòng (rooms) là một "dự án" (= một khu làm việc có biển tên); agent làm việc gần nhau theo phòng.
const POLL_MS = 700;
const MAX_LABEL = 90;
const clip = (s, n = MAX_LABEL) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
// Phòng → nơi làm việc trong văn phòng 3D (không có = ngồi bàn trong khu làm việc của phòng đó)
const PLACE_OF_ROOM = { 'Phòng giám đốc': 'director', 'Ban điều hành': 'meeting', 'Phòng insight': 'lounge', 'Phòng kiểm duyệt': 'library' };
// Số bàn (đánh số như nhãn "Bàn n" trong văn phòng) cho agent không có nơi riêng, theo thứ tự trong phòng; thiếu thì rải đều
// Riêng từng agent (ưu tiên hơn phòng): signal (Thu thập tín hiệu) đứng cạnh bàn bida
const PLACE_OF_AGENT = { signal: 'billiards' };
const placeOf = (a) => PLACE_OF_AGENT[a.id] || PLACE_OF_ROOM[a.room] || '';
const DESKS_OF_ROOM = { 'Phòng sản xuất': [3, 12, 7] };
const ENGINE_STATUS = { working: 'work', waiting: 'wait' };   // còn lại (idle/offline/error) = 'rest'

export function startBridge({ applyMsg, setConn }) {
  const sessions = new Map();   // agent id -> session gửi cho engine
  const assignee = new Map();   // task id -> agent id (từ sự kiện 'plan')
  let since = 0, ver = 0, seq = 0, started = false, first = true, rooms = [];

  const sessionOf = (a, i) => {
    const room = a.room || 'Văn phòng';
    return { id: a.id, pid: 0, name: a.name || a.id, title: a.name || a.id, dir: `~/${room}`, link: null, desk: i, place: placeOf(a), status: 'rest', lastPrompt: '', taskStart: 0,
      counts: { read: 0, edit: 0, cmd: 0, web: 0 }, subs: [], doneSubs: [], last: null, lastAt: Date.now(), todos: [], role: a.role || '', agent: 'claude',
      usage: { cost: 0, ctx: 0, ctxMax: 200000, model: a.ai || '', out: 0 } };
  };
  const copy = (s) => ({ ...s, counts: { ...s.counts }, subs: [], doneSubs: [] });
  const emit = (s, type, label = '', extra = {}) => {
    const now = Date.now(), e = { id: ++seq, ts: now, sess: s.id, name: s.name, type, label: clip(label), ...extra };
    s.last = { type, label: e.label }; s.lastAt = now;
    const k = { read: 'read', edit: 'edit', write: 'edit', bash: 'cmd', web: 'web' }[type]; if (k) s.counts[k] = (s.counts[k] || 0) + 1;
    applyMsg({ k: 'ev', s: copy(s), e });
  };
  const setStatus = (s, status, label) => {
    const next = ENGINE_STATUS[status] || 'rest', prev = s.status;
    s.status = next;
    if (next === prev) return;
    if (next === 'work') { s.taskStart = Date.now(); applyMsg({ k: 'sess', s: copy(s) }); }
    else if (next === 'wait') emit(s, 'wait', label || 'Chờ CEO cấp quyền');
    else { s.taskStart = 0; if (prev === 'work' || prev === 'wait') emit(s, 'stop', ''); else applyMsg({ k: 'sess', s: copy(s) }); }
  };

  function handle(m) {
    const s = sessions.get(m.id);
    switch (m.type) {
      case 'status': if (s) setStatus(s, m.status, m.report ? 'Chờ duyệt' : ''); break;
      case 'think': if (s) { if (s.status !== 'work') setStatus(s, 'working'); emit(s, 'bash', m.text); } break;
      case 'msg': {
        const to = sessions.get(m.to), from = sessions.get(m.from);
        const id = (x) => (x === 'user' ? 'ceo' : x);
        window.__officeLink?.(id(m.from), id(m.to), m.kind);   // (đường nét đứt giữa hai agent)
        if (m.kind === 'command' && sessions.get('ceo')) { const c = sessions.get('ceo'); setStatus(c, 'working'); emit(c, 'prompt', m.text); }
        if (m.kind === 'assign' && to) { to.lastPrompt = m.text; if (to.status !== 'work') setStatus(to, 'working'); emit(to, 'prompt', m.text); }
        else if (m.kind === 'revise' && to) emit(to, 'fail', m.text);
        else if ((m.kind === 'question') && to) emit(to, 'ask', m.text);
        else if (m.kind === 'report' && from) emit(from, 'write', m.text);
        break;
      }
      case 'plan': assignee.clear(); for (const t of m.tasks || []) assignee.set(t.id, t.assignee); break;
      case 'task': { const w = sessions.get(assignee.get(m.id)); if (w && m.status === 'failed') emit(w, 'fail', 'Task lỗi'); break; }
      case 'final': for (const w of sessions.values()) if (w.id === 'manager') emit(w, 'deploy', m.title || 'Báo cáo cuối'); window.__officeLink?.('manager', 'ceo', 'final'); break;
      case 'done': { const c = sessions.get('ceo'); if (c) setStatus(c, 'idle'); break; }
    }
  }

  function snapshot(agents, info) {
    // CEO (người dùng) là một nhân vật ngồi trong phòng giám đốc; bấm vào sẽ mở các báo cáo
    const list = [{ id: 'ceo', name: 'CEO', role: 'Giám đốc: giao việc và nhận báo cáo', room: 'Phòng giám đốc' }, ...agents.filter((a) => a.id !== 'user')];
    const keep = new Set(list.map((a) => a.id));
    // mỗi nhóm (cùng một nơi: phòng họp / thư giãn / thư viện / giám đốc / bàn làm việc) rải đều: s.seat = thứ tự trong nhóm, s.seatOf = số người
    const groups = new Map();
    for (const a of list) { const g = placeOf(a); groups.set(g, [...(groups.get(g) || []), a.id]); }
    list.forEach((a, i) => {
      let s = sessions.get(a.id);
      if (!s) { s = sessionOf(a, i); sessions.set(a.id, s); }
      { const ids = groups.get(placeOf(a)) || []; s.seat = Math.max(0, ids.indexOf(a.id)); s.seatOf = ids.length || 1; s.deskNo = DESKS_OF_ROOM[a.room]?.[s.seat] || 0; }
      s.name = a.name || a.id; s.title = s.name; s.dir = `~/${a.room || 'Văn phòng'}`; s.role = a.role || ''; s.place = placeOf(a);
      const st = info?.[a.id]?.status || a.status; if (st) s.status = ENGINE_STATUS[st] || 'rest';
    });
    for (const id of [...sessions.keys()]) if (!keep.has(id)) sessions.delete(id);
    applyMsg({ k: 'snap', sessions: [...sessions.values()].filter((s) => !(info?.[s.id]?.status === 'offline')).map(copy), feed: [], stats: { prompts: 0, read: 0, edit: 0, cmd: 0, deploy: 0 } });
  }

  async function poll() {
    try {
      const d = await (await fetch(`/poll?since=${since}&ver=${ver}`, { cache: 'no-store' })).json();
      setConn(true);
      if (d.agents) {
        ver = d.agentsVer; rooms = d.rooms || rooms;
        const info = {}; for (const a of d.agents) info[a.id] = { status: d.state?.[a.id]?.status || d.state?.[a.id] };
        snapshot(d.agents, info);
        started = true;
      }
      if (started && !first) for (const ev of d.events || []) handle(ev);   // (lần đầu: bỏ lịch sử cũ, chỉ lấy trạng thái hiện tại)
      first = false;
      since = d.next ?? since;
    } catch { setConn(false); }
    setTimeout(poll, POLL_MS);
  }
  poll();
}
window.__agentBridge = startBridge;
