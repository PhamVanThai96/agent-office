// Công cụ web_search / web_fetch: lấy thông tin mới nhất từ Internet (AI không tự biết dữ liệu sau thời điểm huấn luyện).
import dns from 'node:dns/promises';
import net from 'node:net';

const UA = 'Mozilla/5.0 (AgentOffice)';
const MAX_BYTES = 1_500_000;

const privateIp = (ip) => net.isIP(ip) === 4
  ? /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip)
  : /^(::1|::|fc|fd|fe80)/i.test(ip) || /^::ffff:/i.test(ip);

async function safeUrl(u) {
  let url;
  try { url = new URL(u); } catch { return { error: 'URL không hợp lệ.' }; }
  if (!/^https?:$/.test(url.protocol)) return { error: 'Chỉ hỗ trợ http/https.' };
  const addrs = net.isIP(url.hostname) ? [{ address: url.hostname }] : await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length) return { error: 'Không phân giải được tên miền.' };
  if (addrs.some((a) => privateIp(a.address))) return { error: 'Không được truy cập địa chỉ mạng nội bộ.' };
  return { url };
}

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
const text = (h) => decode(h.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|tr|li|h\d|table|br)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/[ \t\r]+/g, ' ').replace(/\n\s*/g, '\n').trim();

const cache = new Map(); // dùng chung giữa các agent: cùng URL trong 10 phút thì không tải lại
async function get(u, hops = 0) {
  const hit = cache.get(u);
  if (hit && Date.now() - hit.t < 600000) return hit.r;
  const r = await get0(u, hops);
  if (!r.error) { cache.set(u, { t: Date.now(), r }); if (cache.size > 60) cache.delete(cache.keys().next().value); }
  return r;
}
async function get0(u, hops = 0) {
  const s = await safeUrl(u);
  if (s.error) return s;
  let r;
  try { r = await fetch(s.url, { redirect: 'manual', headers: { 'user-agent': UA, 'accept-language': 'vi,en;q=0.8' }, signal: AbortSignal.timeout(15000) }); }
  catch (e) { return { error: `Không tải được: ${e.cause?.code || e.message}` }; }
  if (r.status >= 300 && r.status < 400 && r.headers.get('location')) return hops < 4 ? get(new URL(r.headers.get('location'), s.url).href, hops + 1) : { error: 'Quá nhiều chuyển hướng.' };
  if (!r.ok) return { error: `HTTP ${r.status}` };
  const buf = Buffer.from(await r.arrayBuffer()).subarray(0, MAX_BYTES);
  return { body: buf.toString('utf8'), type: r.headers.get('content-type') || '' };
}

export async function webSearch(query) {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) return { error: 'Thiếu từ khoá.' };
  const r = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
  if (r.error) return r;
  const results = [];
  for (const m of r.body.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g)) {
    let href = decode(m[1]);
    const real = href.match(/[?&]uddg=([^&]+)/);
    if (real) href = decodeURIComponent(real[1]);
    results.push({ title: text(m[2]), url: href, snippet: text(m[3] || '') });
    if (results.length >= 8) break;
  }
  return results.length ? { query: q, retrievedAt: new Date().toISOString(), results } : { error: 'Không có kết quả (công cụ tìm kiếm có thể đang chặn). Thử web_fetch tới một trang cụ thể.' };
}

export async function webFetch(url, max = 8000) {
  const r = await get(String(url || ''));
  if (r.error) return r;
  const body = /html/i.test(r.type) ? text(r.body) : r.body;
  return { url, retrievedAt: new Date().toISOString(), content: body.slice(0, max), truncated: body.length > max };
}
