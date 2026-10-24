import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Radar xu hướng THỜI GIAN THỰC cho thị trường Việt Nam, chỉ dùng nguồn công khai, không cần đăng nhập:
//  - Google Trends (tìm kiếm đang tăng, kèm số lượt và tin liên quan),
//  - Google News theo chủ đề (tin mới nhất, có nguồn và giờ đăng),
//  - RSS VnExpress / Tuổi Trẻ / Dân Trí (chủ đề đời sống, sức khỏe, ẩm thực),
// Mỗi lần quét được lưu theo ngày (data/trends/) để so sánh "mới nổi so với hôm qua".
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'trends');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export const DEFAULT_TOPICS = ['ăn chay', 'thực phẩm sạch', 'gia vị nấu ăn', 'eat clean', 'bột ngọt', 'ăn dặm cho bé'];
const FEEDS = [
  ['VnExpress · Đời sống', 'https://vnexpress.net/rss/doi-song.rss'],
  ['VnExpress · Sức khỏe', 'https://vnexpress.net/rss/suc-khoe.rss'],
  ['Tuổi Trẻ · Nhịp sống trẻ', 'https://tuoitre.vn/rss/nhip-song-tre.rss'],
  ['Dân Trí · Sức khỏe', 'https://dantri.com.vn/rss/suc-khoe.rss'],
];
const TTL = 20 * 60 * 1000;
let cache = null;

const decode = (s) => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (x, t) => decode((x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')) || [])[1] || '');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

async function get(url, ms = 20000) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'vi,en;q=0.8' }, signal: AbortSignal.timeout(ms) });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return { body: await r.text() };
  } catch (e) { return { error: e.cause?.code || e.name || e.message }; }
}

const items = (xml) => [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);
const ago = (d) => { const h = (Date.now() - d) / 36e5; return h < 1 ? 'vừa xong' : h < 24 ? `${Math.round(h)} giờ trước` : `${Math.round(h / 24)} ngày trước`; };

async function googleTrends() {
  const r = await get('https://trends.google.com/trending/rss?geo=VN');
  if (r.error) return { error: r.error, items: [] };
  const out = items(r.body).map((it) => {
    const t = Date.parse(tag(it, 'pubDate'));
    return {
      keyword: tag(it, 'title'), traffic: tag(it, 'ht:approx_traffic'), at: Number.isFinite(t) ? ago(t) : '',
      news: [...it.matchAll(/<ht:news_item>[\s\S]*?<\/ht:news_item>/g)].slice(0, 2).map((n) => ({ title: clip(tag(n[0], 'ht:news_item_title'), 110), source: tag(n[0], 'ht:news_item_source') })),
    };
  }).filter((x) => x.keyword);
  return { items: out.slice(0, 25) };
}

async function googleNews(topic, days) {
  const r = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(`${topic} when:${days}d`)}&hl=vi&gl=VN&ceid=VN:vi`);
  if (r.error) return { topic, error: r.error, items: [] };
  const out = items(r.body).map((it) => {
    const t = Date.parse(tag(it, 'pubDate')), full = tag(it, 'title'), source = tag(it, 'source');
    return { title: clip(source ? full.replace(new RegExp(`\\s*-\\s*${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '') : full, 120), source, at: Number.isFinite(t) ? ago(t) : '', ts: t || 0 };
  }).filter((x) => x.ts).sort((a, b) => b.ts - a.ts);
  return { topic, items: out.slice(0, 6).map(({ ts, ...x }) => x) };
}

async function rssFeed([name, url], days) {
  const r = await get(url);
  if (r.error) return { name, error: r.error, items: [] };
  const min = Date.now() - days * 864e5;
  const out = items(r.body).map((it) => ({ title: clip(tag(it, 'title'), 120), ts: Date.parse(tag(it, 'pubDate')) })).filter((x) => x.title && x.ts >= min).sort((a, b) => b.ts - a.ts);
  return { name, items: out.slice(0, 6).map((x) => ({ title: x.title, at: ago(x.ts) })) };
}

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const readDay = (k) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, `${k}.json`), 'utf8')); } catch { return null; } };

/**
 * Quét xu hướng VN. opts: { topics?: string[], days?: number (tin theo chủ đề, mặc định 14) }.
 * Trả về kết quả gọn (đã cắt) kèm phần "mới nổi so với lần quét trước".
 */
export async function scanTrends(opts = {}) {
  const topics = (Array.isArray(opts.topics) && opts.topics.length ? opts.topics : DEFAULT_TOPICS).map((t) => String(t).trim()).filter(Boolean).slice(0, 6);
  const days = Math.min(Math.max(Number(opts.days) || 14, 1), 30);
  const key = JSON.stringify([topics, days]);
  if (cache && cache.key === key && Date.now() - cache.t < TTL) return { ...cache.r, cached: true };
  const [gt, ...rest] = await Promise.all([googleTrends(), ...topics.map((t) => googleNews(t, days)), ...FEEDS.map((f) => rssFeed(f, 3))]);
  const news = rest.slice(0, topics.length), feeds = rest.slice(topics.length);

  // So với lần quét gần nhất của ngày trước: từ khoá nào mới xuất hiện.
  const prev = readDay(dayKey(new Date(Date.now() - 864e5))) || (() => { try { const f = fs.readdirSync(DIR).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x) && x < `${dayKey()}.json`).sort().at(-1); return f ? readDay(f.slice(0, 10)) : null; } catch { return null; } })();
  const prevSet = new Set((prev?.googleTrends || []).map((x) => x.keyword.toLowerCase()));
  const fresh = prev ? gt.items.filter((x) => !prevSet.has(x.keyword.toLowerCase())).map((x) => x.keyword) : [];

  const r = {
    retrievedAt: new Date().toISOString(), region: 'Việt Nam',
    googleTrends: { note: 'Từ khoá đang được tìm nhiều nhất hôm nay (không lọc theo ngành: chọn cái liên quan sản phẩm/đối tượng, bỏ tin tai nạn/chính trị/nhạy cảm).', ...gt, ...(prev ? { newSinceLastScan: fresh.slice(0, 12), previousScan: prev.retrievedAt } : {}) },
    newsByTopic: news.map((n) => ({ topic: n.topic, items: n.items, ...(n.error ? { error: n.error } : {}) })),
    mediaHeadlines: feeds.map((f) => ({ source: f.name, items: f.items, ...(f.error ? { error: f.error } : {}) })),
    limits: 'Không đọc được TikTok/Facebook/YouTube (cần đăng nhập hoặc chạy JS): với xu hướng các nền tảng này dùng web_search (vd "trend TikTok tuần này") và dữ liệu của team, ghi rõ nguồn + ngày.',
  };
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, `${dayKey()}.json`), JSON.stringify({ retrievedAt: r.retrievedAt, topics, googleTrends: gt.items, news: news.map((n) => ({ topic: n.topic, titles: n.items.map((i) => i.title) })) }));
  } catch { /* lịch sử chỉ để so sánh */ }
  cache = { key, t: Date.now(), r };
  return r;
}
