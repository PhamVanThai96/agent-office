// Dán nguyên văn vào javascript_tool trên trang kết quả Thư viện quảng cáo Facebook (đã tìm theo từ khoá).
// Trả về các quảng cáo VIDEO thực phẩm đang chạy >= 45 ngày, sắp xếp chạy lâu nhất trước.
await new Promise(r => setTimeout(r, 2500));
for (let k = 0; k < 4; k++) { window.scrollTo(0, document.body.scrollHeight); await new Promise(r => setTimeout(r, 1400)); }
const parseD = (s) => { const m = /(\d+) Tháng (\d+), (\d{4})/.exec(s); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; };
const now = new Date();
const FOOD = /hạt nêm|bột nêm|gia vị|mắm|ngũ cốc|sữa hạt|yến|mật ong|nấm|rong biển|chay|ăn kiêng|healthy|dinh dưỡng|kỷ tử|nông sản|thực phẩm|ruốc|chà bông|muối|gạo|rau củ|đặc sản|cháo|organic|hữu cơ|nghệ|sốt|bánh|trà|cà phê|sữa|đậu|hạt điều|óc chó/i;
const BAD = /máy |nồi |gia dụng|bình |hộp đựng|túi nhôm|màng bọc|tuyển ctv|đại lý|da |mụn|tóc|xe |buffet|nhà hàng|quán|lẩu|phân bón|hạt giống|bệnh viện|khoá học/i;
const res = new Map();
for (const v of document.querySelectorAll('video')) {
  let a = v; while (a && !((a.innerText || '').includes('ID thư viện'))) a = a.parentElement;
  if (!a) continue;
  const t = a.innerText; if ((t.match(/ID thư viện/g) || []).length !== 1) continue;
  const id = /ID thư viện: (\d+)/.exec(t)[1]; if (res.has(id)) continue;
  const lines = t.split('\n').map(x => x.trim()).filter(x => x && x !== '​');
  const iSp = lines.indexOf('Được tài trợ');
  const d = parseD((/Ngày bắt đầu chạy: ([^\n]+)/.exec(t) || [])[1] || ''); const days = d ? Math.round((now - d) / 864e5) : 0;
  const page = iSp > 0 ? lines[iSp - 1] : ''; const body = iSp >= 0 ? lines.slice(iSp + 1).join(' ') : '';
  if (days < 45 || !FOOD.test(page + ' ' + body) || BAD.test(page + ' ' + body.slice(0, 80))) continue;
  res.set(id, { id, days, page, body: body.slice(0, 120) });
}
JSON.stringify([...res.values()].sort((a, b) => b.days - a.days).map(x => [x.id, x.days + ' ngày', x.page, x.body]))
