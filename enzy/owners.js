// Dashboard content theo người thực hiện: lọc quảng cáo có tên người ở cuối ("... 13.08_HNC TẠI SAO ĐẮT (TRÂN)"),
// gom theo content (phần "dd.mm_TÊN CONTENT"), tính chỉ số bằng code và dựng một trang HTML độc lập (có lọc/sắp xếp).

const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase().replace(/\s+/g, ' ').trim();
const num = (v) => {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').trim();
  if (!t || t === '—' || t === '-') return 0;
  const n = Number(t.replace(/,/g, '').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const TAIL = /\(\s*([^()]+?)\s*\)\s*$/;

export const ownerOf = (adName) => (String(adName ?? '').match(TAIL)?.[1] || '').trim();

// "…CT WIN 1 - 13.08_HNC TẠI SAO ĐẮT (TRÂN)" → "13.08_HNC TẠI SAO ĐẮT"
export function contentOf(adName) {
  const s = String(adName ?? '').replace(TAIL, '').replace(/\s+/g, ' ').trim();
  const m = s.match(/\d{1,2}\.\d{1,2}_.*$/);
  return (m ? m[0] : s.split(' - ').pop() || s).trim();
}

// rows: các hàng của file Excel "Tải về file Excel" trên trang báo cáo. Trả về tất cả ads đã chuẩn hoá.
export function normalizeAds(rows) {
  return (rows || []).map((r) => ({
    account: String(r['Tài khoản QC'] ?? ''), name: String(r['Tên quảng cáo'] ?? ''),
    sp: num(r['Ads đã chi']), im: num(r['Lượt hiển thị']), ck: num(r['Click (all)']), lk: num(r['Lượt nhấp liên kết']),
    ld: num(r['Số lead']), od: num(r['Số đơn hàng']), rv: num(r['Doanh thu trong kỳ']),
  })).filter((a) => a.name);
}

// owners: ["TRÂN","NGA"] (không phân biệt hoa thường/dấu). Người còn lại (và quảng cáo chưa gắn tên) được gộp thành nhóm "KHÁC" để so sánh.
export const OTHER = 'KHÁC';
export function groupByOwner(ads, owners) {
  const want = new Map(owners.map((o) => [plain(o), o.trim().toUpperCase()]));
  const map = new Map();
  let total = 0, owned = 0;
  for (const a of ads) {
    total += a.sp;
    const tag = ownerOf(a.name), label = want.get(plain(tag));
    if (label) owned += a.sp;
    const grp = label || OTHER, content = contentOf(a.name), key = `${grp}|${content}`;
    if (!map.has(key)) map.set(key, { o: grp, who: [], n: content, sp: 0, im: 0, ck: 0, lk: 0, od: 0, ld: 0, rv: 0, ad: 0, ads: [] });
    const g = map.get(key);
    if (!label) { const w = tag && !/^\d+$/.test(tag) ? tag.toUpperCase() : 'chưa gắn tên'; if (!g.who.includes(w)) g.who.push(w); }
    for (const k of ['sp', 'im', 'ck', 'lk', 'od', 'ld', 'rv']) g[k] += a[k];
    if (a.sp > 0) g.ad++;
    g.ads.push({ a: a.account, n: a.name, sp: a.sp, od: a.od, rv: a.rv });
  }
  const rows = [...map.values()].filter((g) => g.sp > 0);
  for (const g of rows) { g.ads.sort((x, y) => y.sp - x.sp); g.who = g.who.join(', '); }
  const names = [...new Set([...want.values()])];
  if (rows.some((g) => g.o === OTHER)) names.push(OTHER);
  return { rows, total, owned, owners: names, listed: [...new Set([...want.values()])] };
}

// Bảng so sánh các nhóm người thực hiện dạng markdown (đưa thẳng vào báo cáo tuần/tháng và cho #analyst đọc). {{DASH}} = đường dẫn tới dashboard.
export function ownerSummaryMarkdown(g, periodLabel) {
  const vnd = (n) => Math.round(n).toLocaleString('vi-VN');
  const pct = (a, b) => (b ? `${(a / b * 100).toFixed(1).replace('.', ',')}%` : '–');
  const sum = (rows) => rows.reduce((t, r) => ({ sp: t.sp + r.sp, rv: t.rv + r.rv, od: t.od + r.od, ld: t.ld + r.ld, n: t.n + 1 }), { sp: 0, rv: 0, od: 0, ld: 0, n: 0 });
  const all = sum(g.rows);
  const line = (name, t) => `| ${name} | ${pct(t.sp, all.sp)} | ${t.n} | ${vnd(t.sp)} | ${vnd(t.rv)} | ${pct(t.sp, t.rv)} | ${t.od} | ${t.od ? vnd(t.sp / t.od) : '–'} | ${t.ld} | ${t.ld ? vnd(t.sp / t.ld) : '–'} |`;
  const L = [`## So sánh người thực hiện${periodLabel ? ` — ${periodLabel}` : ''}`, '',
    'Gán theo tên người ở cuối tên quảng cáo; người khác hoặc chưa gắn tên gộp thành "Người còn lại".', '',
    '| Nhóm | % chi tiêu | Content | Chi tiêu (đ) | Doanh thu (đ) | NS/DT | Đơn | CPA (đ) | Lead | CPL (đ) |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const o of g.owners) L.push(line(o === OTHER ? 'Người còn lại' : o, sum(g.rows.filter((r) => r.o === o))));
  L.push(line('**Toàn bộ tài khoản**', all), '');
  for (const o of g.listed) {
    const top = g.rows.filter((r) => r.o === o).sort((a, b) => b.rv - a.rv).slice(0, 3);
    if (top.length) L.push(`**Top content ${o}:** ` + top.map((r) => `${r.n} (DT ${(r.rv / 1e6).toFixed(1).replace('.', ',')} tr, NS/DT ${pct(r.sp, r.rv)}, ${r.od} đơn)`).join(' · '), '');
  }
  L.push('[📈 Mở Dashboard content (lọc, sắp xếp, xem từng quảng cáo)]({{DASH}})', '');
  return L.join('\n');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(new RegExp('[\\u2028\\u2029]', 'g'), ' ');

const CSS = `:root{--bg:#f4f6f8;--panel:#fff;--ink:#16202b;--mute:#5d6b7a;--line:#dde3ea;--spend:#8aa1b8;--rev:#1f5fbf;--good:#14795f;--goodbg:#d9f1e9;--bad:#b3261e;--badbg:#fbe0dd;--warn:#8a5a00;--warnbg:#fbeccb;--mid:#a15c00;--midbg:#fde4cc;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#10151b;--panel:#1a222b;--ink:#e8edf2;--mute:#9aa8b6;--line:#2c3743;--spend:#5f7893;--rev:#6ea2f0;--good:#5fd1b0;--goodbg:#14352c;--bad:#ff9b92;--badbg:#3d1d1b;--warn:#f0c463;--warnbg:#3a2e10;--mid:#ffb867;--midbg:#3b2a12;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:400 15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-variant-numeric:tabular-nums}
main{max-width:1080px;margin:0 auto;padding:28px 18px 48px}
header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 16px;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:14px}
h1{font-size:20px;font-weight:700;margin:0}.sub{color:var(--mute);font-size:13px}
.hero{padding:26px 0 20px}.hero p{font-size:clamp(24px,5vw,38px);line-height:1.15;font-weight:700;margin:0;max-width:22em;letter-spacing:-.01em}
.hero .n{color:var(--rev)}.hero small{display:block;margin-top:10px;font-size:14px;color:var(--mute);font-weight:400}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(138px,1fr));border:1px solid var(--line);background:var(--panel);border-radius:8px}
.kpi{padding:14px 16px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);margin:0 -1px -1px 0}
.kpi b{display:block;font-size:21px;font-weight:600}.kpi span{font-size:12.5px;color:var(--mute)}
h2{font-size:16px;margin:34px 0 4px;font-weight:600}.note{color:var(--mute);font-size:13px;margin:0 0 12px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 14px}
.chip{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:999px;padding:6px 14px;font:inherit;font-size:13px;cursor:pointer}
.chip[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.chip:focus-visible,th button:focus-visible{outline:2px solid var(--rev);outline-offset:2px}
.row{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin-bottom:10px;display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:8px 22px}
.row h3{margin:0 0 8px;font-size:14.5px;font-weight:600;overflow-wrap:anywhere}
.bar{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12.5px}.bar i{display:block;height:12px;border-radius:2px;min-width:2px}
.bar .sp{background:var(--spend)}.bar .rv{background:var(--rev)}.bar em{font-style:normal;color:var(--mute);white-space:nowrap}
.side{font-size:13px;display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-content:start}.side span{color:var(--mute)}.side b{text-align:right}
.hi{color:var(--bad)}.lo{color:var(--good)}
.badge{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;margin-left:8px;vertical-align:1px}
.own{display:inline-block;font-size:11px;font-weight:700;padding:1px 8px;border-radius:4px;margin-right:8px;background:var(--line);color:var(--ink);vertical-align:1px}
.b0{background:var(--goodbg);color:var(--good)}.b1{background:var(--warnbg);color:var(--warn)}.b2{background:var(--midbg);color:var(--mid)}.b3{background:var(--badbg);color:var(--bad)}
.legend{display:flex;gap:16px;font-size:12.5px;color:var(--mute);margin-bottom:10px}.legend i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.tw{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
table{border-collapse:collapse;width:100%;min-width:980px;font-size:13px}
th,td{padding:9px 11px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left;white-space:normal;min-width:210px}
th{font-weight:600;color:var(--mute)}th button{all:unset;cursor:pointer}th button:hover{color:var(--ink)}
tfoot td,tr.tot td{font-weight:600;border-bottom:0;background:var(--bg)}
.cmpcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:14px}
.cc{padding:14px 16px}.cc h3{margin:0 0 8px;font-size:15px}.cc .sub{font-weight:400;font-size:12.5px}
.cc .side{margin-top:8px}td.c{text-align:center}
details{grid-column:1/-1;font-size:12.5px;color:var(--mute)}summary{cursor:pointer}
details table{min-width:0;margin-top:6px}details td{white-space:normal;font-size:12px;padding:5px 8px}
.foot{margin-top:26px;color:var(--mute);font-size:12.5px}.foot p{margin:4px 0}
@media (max-width:640px){.row{grid-template-columns:1fr}}`;

// Mã chạy trong trang (không phụ thuộc thư viện). DATA = { title, sub, owners, rows, coverage }.
const APP = `
var NA="N/A",$=function(i){return document.getElementById(i)};
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function sum(a,k){return a.reduce(function(s,x){return s+x[k]},0)}
function div(a,b){return b>0?a/b:null}
function num(n){return n==null?NA:Math.round(n).toLocaleString("vi-VN")}
function pct(n,d){return n==null?NA:(n*100).toLocaleString("vi-VN",{minimumFractionDigits:d,maximumFractionDigits:d})+"%"}
function mil(n){return (n/1e6).toLocaleString("vi-VN",{minimumFractionDigits:2,maximumFractionDigits:2})+" tr"}
function calc(x){x.ctr=div(x.ck,x.im);x.ctl=div(x.lk,x.im);x.cpa=div(x.sp,x.od);x.cpl=div(x.sp,x.ld);x.ns=div(x.sp,x.rv);x.cv=div(x.od,x.ld);return x}
function tot(a){return calc({sp:sum(a,"sp"),im:sum(a,"im"),ck:sum(a,"ck"),lk:sum(a,"lk"),od:sum(a,"od"),ld:sum(a,"ld"),rv:sum(a,"rv"),ad:sum(a,"ad")})}
var ALL=DATA.rows.map(calc),OW=DATA.owners,own="ALL",D=[],T=null,MED=0,flt=-1,sortK="rv",asc=false;
var LAB=["Content hiệu quả","Cần theo dõi","Cần tối ưu","Chưa hiệu quả"],CL=["b0","b1","b2","b3"];
function scope(){return own=="ALL"?ALL:ALL.filter(function(x){return x.o==own})}
function label(){return own=="ALL"?"toàn bộ tài khoản":own=="KHÁC"?"nhóm người còn lại":own}
function prep(){
  D=scope();T=tot(D);
  var sp=D.map(function(x){return x.sp}).sort(function(a,b){return a-b}),h=sp.length>>1;MED=sp.length?(sp.length%2?sp[h]:(sp[h-1]+sp[h])/2):0;
  D.forEach(function(x){var s=(x.cpa!=null&&T.cpa!=null&&x.cpa>T.cpa?1:0)+(x.ns!=null&&T.ns!=null&&x.ns>T.ns?1:0)+(x.cv!=null&&T.cv!=null&&x.cv<T.cv?1:0);x.sig=s;x.k=x.sp<MED?1:(x.od==0?3:(s==0?0:(s>=3?3:2)))});
}
var COLS=[["n","Content"],["o","Người"],["sp","Chi tiêu"],["im","Hiển thị"],["ck","Nhấp"],["ctr","CTR"],["lk","Nhấp link"],["ctl","CTR link"],["od","Lượt mua"],["cpa","CPA"],["ld","Lead"],["cpl","CPL"],["rv","Doanh thu"],["ns","NS/DT"],["k","Phân loại"]];
function cell(k,x){return k=="n"?esc(x.n):k=="o"?esc((x.o||"")+(x.who?" · "+x.who:"")):k=="ctr"||k=="ctl"?pct(x[k],2):k=="ns"?pct(x[k],1):k=="k"?'<span class="badge '+CL[x.k]+'" style="margin:0">'+LAB[x.k]+'</span>':num(x[k])}
function chips(){
  var po=[["ALL","Tất cả ("+ALL.length+")"]].concat(OW.map(function(o){return [o,o+" ("+ALL.filter(function(x){return x.o==o}).length+")"]}));
  $("owners").innerHTML=po.map(function(c){return '<button class="chip" data-o="'+esc(c[0])+'" aria-pressed="'+(own==c[0])+'">'+esc(c[1])+'</button>'}).join("");
  var CH=[["Tất cả",-1]].concat(LAB.map(function(l,i){return [l,i]}));
  $("chips").innerHTML=CH.map(function(c){var n=c[1]<0?D.length:D.filter(function(x){return x.k==c[1]}).length;return '<button class="chip" data-k="'+c[1]+'" aria-pressed="'+(flt==c[1])+'">'+c[0]+' ('+n+')</button>'}).join("");
}
function head(){
  var n=D.reduce(function(s,x){return s+x.ad},0);
  $("sub").textContent=DATA.period+" · "+n+" quảng cáo, "+D.length+" content";
  if(!D.length){$("hero").innerHTML='Chưa có quảng cáo có chi tiêu cho <span class="n">'+esc(label())+'</span> trong kỳ này.';$("kpis").innerHTML="";return}
  $("hero").innerHTML='Cứ 100đ doanh thu, '+esc(label())+' chi <span class="n">'+(T.ns==null?NA:Math.round(T.ns*100)+'đ')+'</span>.<small>Chi '+mil(T.sp)+' cho doanh thu '+mil(T.rv)+', được '+T.od+' đơn và '+T.ld+' lead.</small>';
  var K=[["Ngân sách đã chi",mil(T.sp)],["Doanh thu",mil(T.rv)],["Ngân sách/Doanh thu",pct(T.ns,1)],["CPA",T.cpa==null?NA:num(T.cpa)+"đ"],["CPL",T.cpl==null?NA:num(T.cpl)+"đ"],["CTR",pct(T.ctr,2)],["CTR link",pct(T.ctl,2)],["Lượt mua / Lead",T.od+" / "+T.ld]];
  $("kpis").innerHTML=K.map(function(k){return '<div class="kpi"><b>'+k[1]+'</b><span>'+k[0]+'</span></div>'}).join("");
}
function compare(){
  var rows=OW.map(function(o){var a=ALL.filter(function(x){return x.o==o});var t=tot(a);t.n=o=="KHÁC"?"Người còn lại":o;t.cnt=a.length;return t});
  var all=tot(ALL);all.n="Toàn bộ tài khoản";all.cnt=ALL.length;
  var mxs=Math.max.apply(null,rows.map(function(t){return Math.max(t.sp,t.rv)}).concat([1]));
  $("cmpcards").innerHTML=rows.map(function(t){
    var ns=t.ns==null||all.ns==null?"":(t.ns>all.ns?"hi":"lo"),cp=t.cpa==null||all.cpa==null?"":(t.cpa>all.cpa?"hi":"lo");
    return '<div class="card cc"><h3>'+esc(t.n)+'<span class="sub"> · '+pct(div(t.sp,all.sp),0)+' chi tiêu</span></h3>'+
    '<div class="bar"><i class="sp" style="width:'+(t.sp/mxs*100*.7)+'%"></i><em>'+mil(t.sp)+'</em></div>'+
    '<div class="bar"><i class="rv" style="width:'+(t.rv/mxs*100*.7)+'%"></i><em>'+mil(t.rv)+'</em></div>'+
    '<div class="side"><span>NS/DT</span><b class="'+ns+'">'+pct(t.ns,1)+'</b><span>CPA</span><b class="'+cp+'">'+(t.cpa==null?NA:num(t.cpa)+"đ")+'</b><span>CPL</span><b>'+(t.cpl==null?NA:num(t.cpl)+"đ")+'</b><span>Đơn / lead</span><b>'+t.od+" / "+t.ld+'</b></div></div>'}).join("");
  var one=function(t,b){return '<tr'+(b?' class="tot"':'')+'><td>'+esc(t.n)+'</td><td>'+pct(div(t.sp,all.sp),1)+'</td><td>'+t.cnt+'</td><td>'+t.ad+'</td><td>'+num(t.sp)+'</td><td>'+num(t.rv)+'</td><td>'+pct(t.ns,1)+'</td><td>'+t.od+'</td><td>'+(t.cpa==null?NA:num(t.cpa))+'</td><td>'+t.ld+'</td><td>'+(t.cpl==null?NA:num(t.cpl))+'</td><td>'+pct(t.cv,1)+'</td><td>'+pct(t.ctr,2)+'</td></tr>'};
  $("cmp").innerHTML='<tr><th>Nhóm</th><th>% chi tiêu</th><th>Content</th><th>Quảng cáo</th><th>Chi tiêu</th><th>Doanh thu</th><th>NS/DT</th><th>Lượt mua</th><th>CPA</th><th>Lead</th><th>CPL</th><th>Đơn/Lead</th><th>CTR</th></tr>'+rows.map(function(t){return one(t,false)}).join("")+one(all,true);
}
function draw(){
  var L=D.filter(function(x){return flt<0||x.k==flt}).sort(function(a,b){var u=a[sortK],v=b[sortK];if(u==null)return 1;if(v==null)return -1;var r=typeof u=="string"?u.localeCompare(v):u-v;return asc?r:-r});
  var mx=Math.max.apply(null,D.map(function(x){return Math.max(x.sp,x.rv)}).concat([1]));
  $("rows").innerHTML=L.map(function(x){
    var cp=x.cpa==null||T.cpa==null?"":(x.cpa>T.cpa?"hi":"lo"),nn=x.ns==null||T.ns==null?"":(x.ns>T.ns?"hi":"lo");
    var ads='<details><summary>'+x.ads.length+' quảng cáo</summary><table><tbody>'+x.ads.map(function(a){return '<tr><td>'+esc(a.n)+'</td><td>'+esc(a.a)+'</td><td>'+num(a.sp)+'</td><td>'+a.od+' đơn</td><td>'+num(a.rv)+'</td></tr>'}).join("")+'</tbody></table></details>';
    return '<div class="row"><div><h3><span class="own">'+esc(x.o)+(x.who?' · '+esc(x.who):'')+'</span>'+esc(x.n)+'<span class="badge '+CL[x.k]+'">'+LAB[x.k]+'</span></h3>'+
    '<div class="bar"><i class="sp" style="width:'+(x.sp/mx*100*.72)+'%"></i><em>'+mil(x.sp)+'</em></div>'+
    '<div class="bar"><i class="rv" style="width:'+(x.rv/mx*100*.72)+'%"></i><em>'+mil(x.rv)+'</em></div></div>'+
    '<div class="side"><span>NS/DT</span><b class="'+nn+'">'+pct(x.ns,1)+'</b><span>CPA</span><b class="'+cp+'">'+(x.cpa==null?NA:num(x.cpa)+"đ")+'</b><span>CPL</span><b>'+(x.cpl==null?NA:num(x.cpl)+"đ")+'</b><span>Đơn / lead</span><b>'+x.od+" / "+x.ld+'</b></div>'+ads+'</div>';
  }).join("")||'<p class="note">Không có content nào trong nhóm này.</p>';
  $("thead").innerHTML='<tr>'+COLS.map(function(c){return '<th aria-sort="'+(c[0]==sortK?(asc?"ascending":"descending"):"none")+'"><button data-k="'+c[0]+'">'+c[1]+(c[0]==sortK?(asc?" ▲":" ▼"):"")+'</button></th>'}).join("")+'</tr>';
  $("tbody").innerHTML=L.map(function(x){return '<tr>'+COLS.map(function(c){return '<td'+(c[0]=="k"?' class="c"':"")+'>'+cell(c[0],x)+'</td>'}).join("")+'</tr>'}).join("");
  var t=tot(L);t.n="Tổng ("+L.length+" content)";t.o="";t.k=-1;
  $("tfoot").innerHTML='<tr>'+COLS.map(function(c){return '<td>'+(c[0]=="k"?"":cell(c[0],t))+'</td>'}).join("")+'</tr>';
}
function all(){prep();head();chips();draw()}
$("owners").onclick=function(e){var b=e.target.closest(".chip");if(!b)return;own=b.dataset.o;flt=-1;all()};
$("chips").onclick=function(e){var b=e.target.closest(".chip");if(!b)return;flt=+b.dataset.k;chips();draw()};
$("thead").onclick=function(e){var b=e.target.closest("button");if(!b)return;var k=b.dataset.k;if(k==sortK)asc=!asc;else{sortK=k;asc=(k=="n"||k=="o"||k=="cpa"||k=="cpl"||k=="ns")}draw()};
compare();all();
`;

/**
 * data: { title, period, updated, kindLabel, owners, rows, total, owned } (kết quả groupByOwner + thông tin kỳ).
 * Trả về chuỗi HTML hoàn chỉnh, không gọi tài nguyên ngoài.
 */
export function buildOwnerDashboard(data) {
  const share = data.total ? Math.round((data.owned / data.total) * 100) : 0;
  const payload = { period: data.period, owners: data.owners, rows: data.rows };
  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)}</title>
<style>${CSS}</style></head><body><main>
<header><h1>Content ${esc(data.listed.join(' & '))} và nhóm còn lại – theo dõi hiệu quả quảng cáo</h1><span class="sub" id="sub"></span></header>
<section class="hero"><p id="hero"></p></section>
<div class="kpis" id="kpis"></div>
<h2>So sánh các nhóm người thực hiện</h2>
<p class="note">Quảng cáo được gán cho người có tên ở cuối tên quảng cáo, ví dụ “… 13.08_HNC TẠI SAO ĐẮT (${esc(data.listed[0] || 'TÊN')})”. ${esc(data.listed.join(' + '))} chiếm ${share}% tổng chi tiêu; ${100 - share}% còn lại (người khác hoặc chưa gắn tên) được gộp thành nhóm “Người còn lại” để đối chiếu. Màu đỏ/xanh so với mặt bằng toàn tài khoản.</p>
<div class="cmpcards" id="cmpcards"></div>
<div class="tw"><table id="cmp" style="min-width:860px"></table></div>
<h2>Chi tiêu và doanh thu theo content</h2>
<p class="note">Lọc theo người thực hiện và nhóm. Phân loại là so sánh tương đối giữa các content trong nhóm đang xem, chưa có KPI mục tiêu.</p>
<div class="chips" id="owners"></div><div class="chips" id="chips"></div>
<div class="legend"><span><i style="background:var(--spend)"></i>Chi tiêu</span><span><i style="background:var(--rev)"></i>Doanh thu</span></div>
<div id="rows"></div>
<h2>Bảng chỉ số đầy đủ</h2>
<p class="note">Bấm tiêu đề cột để sắp xếp. Dòng tổng tính theo các content đang hiển thị.</p>
<div class="tw"><table><thead id="thead"></thead><tbody id="tbody"></tbody><tfoot id="tfoot"></tfoot></table></div>
<div class="foot">
<p>${esc(data.kindLabel)} · cập nhật lúc ${esc(data.updated || '–')} · nguồn: file Excel của trang báo cáo Enzy (từng quảng cáo, gồm 10% thuế).</p>
<p>Phân loại: chi tiêu dưới mức trung vị của các content trong nhóm → Cần theo dõi. Đủ chi tiêu: so với mặt bằng của nhóm, đếm số tín hiệu xấu (CPA cao hơn, NS/DT cao hơn, tỷ lệ đơn/lead thấp hơn): 0 → Hiệu quả, 1–2 → Cần tối ưu, 3 → Chưa hiệu quả; 0 đơn → Chưa hiệu quả.</p>
<p>CTR = nhấp ÷ hiển thị, CTR link = nhấp link ÷ hiển thị, CPA = chi tiêu ÷ lượt mua, CPL = chi tiêu ÷ lead, NS/DT = chi tiêu ÷ doanh thu. Tất cả tính từ tổng.</p>
</div></main>
<script>var DATA=${json(payload)};${APP}</script></body></html>
`;
}
