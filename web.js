// Công cụ web_search / web_fetch: lấy thông tin mới nhất từ Internet (AI không tự biết dữ liệu sau thời điểm huấn luyện).
import dns from 'node:dns/promises';
import net from 'node:net';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 AgentOffice/1.0';
const FETCH_MS = 40000; // một số website (WordPress) phản hồi chậm 10-20s
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

const ENT = { nbsp: ' ', lt: '<', gt: '>', quot: '"', amp: '&', ndash: '–', mdash: '—', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', bull: '•', times: '×' };
const decode = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
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
async function get0(u, hops = 0, attempt = 0) {
  const s = await safeUrl(u);
  if (s.error) return s;
  try {
    // Cả tiêu đề lẫn thân trang nằm trong cùng một giới hạn thời gian và cùng try/catch (trước đây lỗi khi đọc thân trang làm hỏng cả lượt gọi công cụ).
    const r = await fetch(s.url, { redirect: 'manual', headers: { 'user-agent': UA, 'accept-language': 'vi,en;q=0.8', accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(FETCH_MS) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) return hops < 4 ? get(new URL(r.headers.get('location'), s.url).href, hops + 1) : { error: 'Quá nhiều chuyển hướng.' };
    if (r.status >= 500 && attempt < 1) return get0(u, hops, attempt + 1);
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer()).subarray(0, MAX_BYTES);
    return { body: buf.toString('utf8'), type: r.headers.get('content-type') || '' };
  } catch (e) {
    const code = e.cause?.code || e.name || e.message;
    // Thử lại một lần khi quá thời gian/mất kết nối; lỗi TLS ở "www." thì thử tên miền gốc.
    if (/TLS|SSL|ENOTFOUND/i.test(String(code)) && /^www\./.test(s.url.hostname) && attempt < 1) { const u2 = new URL(s.url); u2.hostname = u2.hostname.slice(4); return get0(u2.href, hops, attempt + 1); }
    if (attempt < 1 && /Timeout|ECONNRESET|UND_ERR|EPIPE|ETIMEDOUT/i.test(String(code))) return get0(u, hops, attempt + 1);
    return { error: `Không tải được: ${/Timeout/i.test(String(code)) ? `quá thời gian chờ ${FETCH_MS / 1000}s (website phản hồi chậm, thử lại sau)` : code}` };
  }
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

// Dữ liệu có cấu trúc trong trang (JSON-LD): tên, mô tả, giá của sản phẩm — đáng tin hơn đoán từ chữ trên trang.
function structured(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1]); } catch { continue; }
    const nodes = [].concat(j['@graph'] || j);
    for (const n of nodes) {
      const t = [].concat(n?.['@type'] || []);
      if (t.includes('Product')) {
        const offer = [].concat(n.offers || [])[0] || {};
        const price = offer.price ?? offer.lowPrice;
        out.push(`Sản phẩm: ${n.name || ''}${price ? ` | giá ${price} ${offer.priceCurrency || ''}` : ''}${n.sku ? ` | sku ${n.sku}` : ''}${n.brand?.name ? ` | thương hiệu ${n.brand.name}` : ''}${n.description ? ` | ${decode(String(n.description)).replace(/\s+/g, ' ').slice(0, 400)}` : ''}`);
      } else if (t.includes('Organization') && n.description) out.push(`Tổ chức: ${n.name || ''} | ${decode(String(n.description)).replace(/\s+/g, ' ').slice(0, 300)}${n.sameAs ? ` | kênh: ${[].concat(n.sameAs).slice(0, 6).join(', ')}` : ''}`);
    }
  }
  return out.slice(0, 6);
}

// Chữ của trang: tiêu đề + mô tả + dữ liệu cấu trúc + phần nội dung chính (<main>), bỏ menu/giỏ hàng/chân trang để không tốn giới hạn ký tự vào phần thừa.
function pageText(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1];
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0];
  const body = main || html.replace(/<(header|nav|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ');
  const head = [title && `Tiêu đề trang: ${decode(title).replace(/\s+/g, ' ').trim()}`, desc && `Mô tả: ${decode(desc).trim()}`, ...structured(html)].filter(Boolean).join('\n');
  return (head ? head + '\n\n' : '') + text(body);
}

export async function webFetch(url, max = 6000) {
  const r = await get(String(url || ''));
  if (r.error) return r;
  const body = /html/i.test(r.type) ? pageText(r.body) : r.body;
  return { url, retrievedAt: new Date().toISOString(), content: body.slice(0, max), truncated: body.length > max, ...(body.length > max ? { totalChars: body.length } : {}) };
}
