// Dán vào javascript_tool trên trang https://www.facebook.com/ads/library/?id=<ID>, thay __ID__ bằng ID.
// Trả về "ID|link_video|số QC nhãn đang chạy|nội dung QC" — link video dùng để tải bằng curl (kèm Referer facebook).
await new Promise(r => setTimeout(r, 3500));
const want = '__ID__'; let hit = null;
for (const v of document.querySelectorAll('video')) {
  let a = v; while (a && !((a.innerText || '').includes('ID thư viện'))) a = a.parentElement;
  if (!a) continue; const t = a.innerText; if ((t.match(/ID thư viện/g) || []).length !== 1) continue;
  if (t.includes(want)) { const i = t.indexOf('Được tài trợ'); hit = [want, v.currentSrc || v.src, (/~?(\d+) kết quả/.exec(document.body.innerText) || [])[1] || '', t.slice(i + 13, i + 400).replace(/\s+/g, ' ')].join('|'); break; }
}
hit || 'KHONG_THAY_VIDEO'
