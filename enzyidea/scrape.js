import { openEnzyPage, gotoRetry, login, selectBox, CONTENT_PROFILE } from '../enzy/fetch.js';

// Cào "Big Idea có thể triển khai" từ trang Enzy: đăng nhập bằng tài khoản content, chọn thương hiệu + hệ thống "Nghiên cứu Content", mở hết các mục thu gọn
// rồi đọc từng thẻ idea (tiêu đề "1. …", nhóm, "Câu Big Idea", các mục "Nhãn: nội dung", phần "Vì sao hướng này đáng thử?").
const STEP_MS = 120000;
const HEADING = /^\s*(\d{1,2})\s*[.)]\s+(\S.*)$/;
const BIG_IDEA = /^c[âa]u\s+big\s+idea\s*:?\s*$/i;
const WHY = /^v[ìi]\s+sao\b.*\?\s*$/i;
const LABEL = /^([^:\n]{3,70}):\s*(.*)$/;
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Tách một khối chữ của một idea (đã gồm dòng tiêu đề) thành các trường. Hàm thuần, dùng cả khi thử nghiệm. */
export function parseIdeaBlock(headingText, blockText) {
  const m = HEADING.exec(String(headingText || '').split('\n')[0]);
  const title = clip(m ? m[2] : headingText, 220);
  const lines = String(blockText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines.findIndex((l) => clip(l, 400) === clip(headingText, 400) || (m && HEADING.test(l) && clip(HEADING.exec(l)[2], 400) === clip(m[2], 400)));
  const body = first >= 0 ? lines.slice(first + 1) : lines;
  let tag = '', bigIdea = '', why = '';
  const fields = {};
  let mode = '', label = '';
  const put = (k, v) => { if (!v) return; fields[k] = fields[k] ? `${fields[k]} ${v}` : v; };
  for (const line of body) {
    if (BIG_IDEA.test(line)) { mode = 'big'; continue; }
    if (mode === 'big' && !bigIdea) { bigIdea = clip(line, 600); mode = 'after'; continue; }   // câu Big Idea là dòng ngay sau tiêu đề hộp (có thể chứa dấu ":")
    if (WHY.test(line)) { mode = 'why'; continue; }
    const lb = LABEL.exec(line);
    const isLabel = lb && lb[1].split(/\s+/).length <= 9 && !/^https?$/i.test(lb[1]);
    if (isLabel) { mode = 'field'; label = clip(lb[1], 60); put(label, clip(lb[2], 900)); continue; }
    if (!mode && !tag && line.length <= 45) { tag = clip(line, 45); continue; }
    if (mode === 'big') bigIdea = clip(`${bigIdea} ${line}`, 600);
    else if (mode === 'why') why = clip(`${why} ${line}`, 900);
    else if (mode === 'field' && label) fields[label] = clip(`${fields[label]} ${line}`, 900);
  }
  return { no: m ? Number(m[1]) : 0, title, tag, bigIdea, why, fields, raw: clip(String(blockText || '').replace(/\n{2,}/g, '\n'), 3000).replace(/\s*\n\s*/g, ' ') };
}

/** Đọc các idea đang hiển thị trên trang (đã chọn đúng hệ thống). */
export async function extractIdeas(page) {
  await page.waitForFunction((src) => {
    const re = new RegExp(src);
    return [...document.querySelectorAll('[data-testid="stMain"] h1, [data-testid="stMain"] h2, [data-testid="stMain"] h3, [data-testid="stMain"] h4')].some((h) => re.test(h.innerText.trim()));
  }, HEADING.source, { timeout: STEP_MS });
  // mở hết các mục thu gọn (vd "Vì sao hướng này đáng thử?") để lấy được nội dung
  for (let round = 0; round < 3; round++) {
    const closed = page.locator('[data-testid="stExpander"] details:not([open]) > summary');
    const n = await closed.count();
    if (!n) break;
    for (let i = 0; i < n; i++) await closed.nth(0).click().catch(() => {});
    await page.waitForTimeout(500);
  }
  const data = await page.evaluate((src) => {
    const re = new RegExp(src);
    const main = document.querySelector('[data-testid="stMain"]');
    const heads = [...main.querySelectorAll('h1, h2, h3, h4')].filter((h) => re.test(h.innerText.trim()));
    const lead = (main.innerText.match(/^[^\n]*\n+([^\n]{20,300})\n/) || [])[1] || '';
    const cards = heads.map((h) => {
      let box = h.closest('[data-testid="stVerticalBlockBorderWrapper"]');
      // thẻ phải chỉ chứa đúng tiêu đề của chính nó
      if (box && [...box.querySelectorAll('h1, h2, h3, h4')].filter((x) => re.test(x.innerText.trim())).length !== 1) box = null;
      return { heading: h.innerText.trim(), text: box ? box.innerText : '' };
    });
    return { cards, mainText: main.innerText, lead };
  }, HEADING.source);
  const out = [];
  const heads = data.cards.map((c) => c.heading);
  data.cards.forEach((c, i) => {
    let text = c.text;
    if (!text) {   // không có khung riêng cho mỗi idea: cắt chữ của cả trang giữa hai tiêu đề liên tiếp
      const a = data.mainText.indexOf(heads[i]);
      const b = i + 1 < heads.length ? data.mainText.indexOf(heads[i + 1], a + 1) : -1;
      if (a >= 0) text = data.mainText.slice(a, b > a ? b : undefined);
    }
    const idea = parseIdeaBlock(c.heading, text);
    idea.context = clip(data.lead, 300);
    if (idea.title) out.push(idea);
  });
  return out;
}

/** Cào cả quy trình. cfg: { url, user, pass, brand, system }. Ném lỗi có thông báo rõ nếu sai tài khoản / không thấy idea. */
export async function scrapeEnzyIdeas(cfg, { onProgress = () => {}, onRetry, ctl } = {}) {
  if (!cfg.user || !cfg.pass) throw new Error('Chưa cấu hình tài khoản content Enzy (⚙ Cấu hình → Cấu hình content Enzy).');
  onProgress('Mở trang Enzy…');
  const { browser, page } = await openEnzyPage({ ...cfg, profile: CONTENT_PROFILE }, { viewport: { width: 2400, height: 1400 } });   // (hồ sơ Chrome riêng của tài khoản content)
  if (ctl) ctl.browser = browser;   // (nút Dừng đóng trình duyệt ngay)
  try {
    await gotoRetry(page, cfg.url, { ctl, onRetry });
    // Đăng nhập + chọn hệ thống, tối đa 2 lượt: nếu hệ thống không có trong danh sách (đang ở nhầm tài khoản do phiên cũ trong hồ sơ Chrome) thì đăng xuất rồi làm lại
    const signIn = async () => {
      onProgress('Đăng nhập tài khoản content…');
      await login(page, { user: cfg.user, pass: cfg.pass, say: onProgress });
      await page.locator('[data-testid="stMain"]').first().waitFor({ timeout: STEP_MS }).catch(() => {});
    };
    const choose = async () => {
      if (cfg.brand) { onProgress(`Chọn thương hiệu ${cfg.brand}…`); await selectBox(page, 'Thương hiệu', cfg.brand); }
      onProgress(`Chọn hệ thống "${cfg.system}"…`);
      await selectBox(page, 'hệ thống làm việc', cfg.system);
    };
    await signIn();
    try { await choose(); }
    catch (e) {
      if (!/Các lựa chọn đang có/.test(e.message)) throw e;
      const out = page.getByRole('button', { name: /Đăng xuất/ });
      if (!(await out.count())) throw new Error(`${e.message} (đang ở nhầm tài khoản? không thấy nút Đăng xuất để đăng nhập lại)`);
      onProgress(`${e.message} → có thể đang ở nhầm tài khoản, đăng xuất và đăng nhập lại…`);
      await out.first().click();
      await page.locator('input[type="text"][aria-label*="Tài khoản"]').waitFor({ timeout: 60000 });
      await signIn();
      await choose();
    }
    onProgress('Đọc các idea…');
    const ideas = await extractIdeas(page);
    if (!ideas.length) throw new Error('Không thấy idea nào trên trang (giao diện trang có thể đã thay đổi).');
    return ideas;
  } finally { await browser.close(); }
}
