// Khu vườn mèo 2.5D: dùng chính bức tranh vẽ tay làm nền (public/town2d/garden.webp) → đồ hoạ giống tranh 100%.
// Mỗi con mèo trong tranh là một agent (mèo trên mái nhà là CEO): vùng bấm, vầng sáng trạng thái, nhãn tên, bong bóng thoại.
// Lớp hiệu ứng (canvas 2D): mặt nước lấp lánh, đèn lồng nhấp nháy, cánh hoa anh đào rơi.
// 2.5D: thêm các lớp tách sẵn (PNG trong suốt) vào public/town2d/ và khai báo trong scene.json → các lớp dịch theo chuột (parallax) tạo chiều sâu;
// mèo có "sprite" riêng sẽ cử động (thở/nhún). Phóng to bằng cuộn chuột, kéo để di chuyển, nút "Cố định góc nhìn" giữ nguyên khung.
// Tiết kiệm tài nguyên: hiệu ứng ~20 khung/giây, dừng hẳn khi ẩn tab/ẩn khu vườn hoặc bấm "Dừng chuyển động"; không WebGL.
(function () {
  var town = document.getElementById('town');
  if (!town) return;
  var $ = function (id) { return document.getElementById(id); };
  var glBox = $('townGL'), labelBox = $('townLabels'), card = $('townCard'), stage = $('stage'), legend = $('legend'), sw = $('viewSw'), loading = $('townLoading');
  var BASE = 'town2d/';
  var scene = null, view = null, bg = null, fx = null, ctx = null, layerEls = [], built = '', active = false, selected = '';
  var cats = {}, ceo = null;
  var s0 = 1, zoom = 1, cx = 0, cy = 0, moved = false;   // moved: người dùng đã tự phóng/kéo            // tỉ lệ vừa khung, mức phóng, tâm khung nhìn (toạ độ ảnh)
  var mx = 0, my = 0;                              // vị trí chuột (-1..1) cho parallax
  var locked = false, still = false, raf = 0, lastT = 0, petals = [], sparks = [], boxes = [], ripples = [], linkSvg = null;
  try { locked = localStorage.getItem('ao.town.lock') === '1'; still = !!localStorage.getItem('ao.town.still'); } catch (e) { /* mặc định */ }
  var ICON = { working: '', waiting: '⏳', error: '⚠️', offline: '', idle: '' };   // mèo rảnh/offline: ngủ (chữ Zzz bay lên)
  var SAY_MAX = 64;
  var mk = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  var statusOf = function (id) { return (typeof info !== 'undefined' && info[id] && info[id].status) || 'idle'; };

  // ---------- nạp cảnh ----------
  function loadScene() {
    if (scene) return Promise.resolve(scene);
    return fetch(BASE + 'scene.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { scene = j; return j; });
  }
  function setupDom() {
    glBox.replaceChildren();
    bg = mk('div', 't25-bg'); bg.style.backgroundImage = 'url(' + BASE + scene.layers[0].src + ')';
    view = mk('div', 't25-view'); view.style.width = scene.width + 'px'; view.style.height = scene.height + 'px';
    glBox.append(bg, view);
    layerEls = scene.layers.map(function (L, i) {
      var img = new Image(); img.className = 't25-layer'; img.alt = ''; img.draggable = false; img.decoding = 'async';
      img.src = BASE + L.src; img.dataset.depth = L.depth || 0;
      if (i === 0) img.onload = function () { loading.classList.add('done'); draw(true); };
      img.onerror = function () { if (i === 0) loading.classList.add('done'); };
      view.appendChild(img); return img;
    });
    fx = mk('canvas', 't25-fx'); fx.width = 0; ctx = fx.getContext('2d');
    view.appendChild(fx);
    linkSvg = document.createElementNS(NS, 'svg'); linkSvg.setAttribute('class', 't25-links'); linkSvg.setAttribute('viewBox', '0 0 ' + scene.width + ' ' + scene.height);
    view.appendChild(linkSvg);
    // hạt lấp lánh trong vùng nước, cánh hoa
    sparks = []; boxes = []; ripples = [];
    (scene.water || []).forEach(function (poly, pi) {
      var xs = poly.map(function (p) { return p[0]; }), ys = poly.map(function (p) { return p[1]; });
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      boxes[pi] = [x0, y0, x1, y1];
      for (var r = 0; r < Math.max(2, Math.round((x1 - x0) / 140)); r++) ripples.push({ p: pi, x: x0 + Math.random() * (x1 - x0), y: y0 + Math.random() * (y1 - y0), t0: Math.random() * 3 });
      var n = Math.round((x1 - x0) * (y1 - y0) / 1800);
      for (var i = 0; i < n; i++) sparks.push({ p: pi, x: x0 + Math.random() * (x1 - x0), y: y0 + Math.random() * (y1 - y0), ph: Math.random() * 6.3, sp: 0.8 + Math.random() * 1.6, len: 4 + Math.random() * 9 });
    });
    petals = [];
    for (var i = 0; i < 120; i++) petals.push(newPetal(true));
    bindInput();
  }
  // Cánh hoa: ~2/3 rụng từ các cây anh đào, ~1/3 bay theo gió từ mép trên/trái khắp khu vườn.
  function newPetal(anywhere) {
    var wind = Math.random() < 0.35, em = scene.petals[Math.floor(Math.random() * scene.petals.length)];
    var x = wind ? Math.random() * scene.width * 0.8 - 60 : em[0] + Math.random() * em[2];
    var y = wind ? -20 + Math.random() * 40 : em[1] + Math.random() * em[3];
    if (anywhere) { y = Math.random() * scene.height; x = Math.random() * scene.width; }
    return { x: x, y: y, vy: 0.3 + Math.random() * 0.55, vx: 0.25 + Math.random() * (wind ? 0.9 : 0.45), ph: Math.random() * 6.3, rot: Math.random() * 6.3, vr: 0.015 + Math.random() * 0.04, s: 0.55 + Math.random() * 1.0, c: Math.random() < 0.3 ? 1 : 0 };
  }

  // ---------- mèo ↔ agent ----------
  function makeCat(spot, color, id, name, isCeo) {
    var hit = mk('div', 't25-hit'); hit.style.left = (spot.x - spot.r) + 'px'; hit.style.top = (spot.y - spot.r) + 'px'; hit.style.width = hit.style.height = spot.r * 2 + 'px';
    hit.onclick = function (e) { e.stopPropagation(); select(id); };
    hit.onmouseenter = function () { me.hover = true; showLabel(me); }; hit.onmouseleave = function () { me.hover = false; showLabel(me); };
    var me = {};
    var ico = mk('div', 't25-ico'); ico.style.left = (spot.x + spot.r * 0.55) + 'px'; ico.style.top = (spot.top - 10) + 'px';
    var sprite = null;
    if (spot.sprite) { sprite = new Image(); sprite.className = 't25-layer t25-sprite'; sprite.src = BASE + spot.sprite; sprite.alt = ''; sprite.draggable = false; sprite.style.transformOrigin = spot.x + 'px ' + (spot.y + spot.r * 0.6) + 'px'; view.insertBefore(sprite, fx); }
    var patch = null;
    if (!sprite) {   // cắt mảng tranh quanh con mèo (viền mờ dần) để mèo thở/nhún mà không cần ảnh tách lớp
      var pw = spot.r * 2.6, ph = spot.r * 2.5, pl = spot.x - pw / 2, pt = spot.y - ph * 0.62;
      patch = mk('div', 't25-patch');
      patch.style.cssText = 'left:' + pl + 'px;top:' + pt + 'px;width:' + pw + 'px;height:' + ph + 'px;background-image:url(' + BASE + scene.layers[0].src + ');background-size:' + scene.width + 'px ' + scene.height + 'px;background-position:' + (-pl) + 'px ' + (-pt) + 'px;animation-delay:-' + (Math.random() * 3).toFixed(2) + 's';
      view.insertBefore(patch, fx);
    }
    var zzz = mk('div', 't25-zzz'); zzz.innerHTML = '<i>z</i><i>z</i><i>Z</i>';
    zzz.style.left = (spot.x + spot.r * 0.25) + 'px'; zzz.style.top = (spot.top - 4) + 'px'; zzz.style.fontSize = Math.max(12, spot.r * 0.45) + 'px';
    view.append(hit, ico, zzz);
    var label = mk('div', 'tlabel' + (isCeo ? ' ceo' : ''), name); label.style.setProperty('--c', color); label.onclick = function () { select(id); };
    var say = mk('div', 'tsay'); say.hidden = true; say.style.setProperty('--c', color);
    labelBox.append(say, label);
    return Object.assign(me, { spot: spot, hit: hit, ico: ico, sprite: sprite, patch: patch, zzz: zzz, label: label, say: say });
  }
  // Màu theo phòng ban (thứ tự "rooms" trong agents.json): agent cùng phòng có viền nhãn/vòng sáng cùng màu.
  var DEPT = ['#e2a33a', '#4f8ef0', '#36a877', '#d0567f', '#8b6fd6', '#2fa3b3'];
  function deptColor(room) { var rooms = (typeof cfg !== 'undefined' && cfg.rooms) || []; var i = rooms.indexOf(room); return DEPT[(i < 0 ? 0 : i) % DEPT.length]; }
  function showLabel(c) { c.label.classList.add('show'); c.label.classList.toggle('sel', !!c.sel); }   // nhãn tên luôn hiện; đang chọn thì nổi bật
  function build(agents) {
    var key = JSON.stringify(agents.map(function (a) { return [a.id, a.name, a.color]; }));
    if (key === built && view) return;
    built = key;
    loadScene().then(function () {
      setupDom();
      labelBox.replaceChildren(); cats = {};
      agents.forEach(function (a, i) {
        var spot = scene.spots[i]; if (!spot) return;   // nhiều agent hơn số mèo trong tranh: thêm chỗ trong scene.json
        cats[a.id] = makeCat(spot, deptColor(a.room), a.id, a.name, false);
      });
      ceo = makeCat(scene.ceo, '#c0392b', 'ceo', '👑 Mèo Boss Cute', true);
      fit(); restoreCam(); refresh(); loop();
    }).catch(function (e) { loading.classList.add('done'); console.warn('[garden] không nạp được scene.json:', e.message); });
  }

  // ---------- khung nhìn: vừa khung, phóng to, kéo ----------
  // Vùng chứa mọi con mèo (+ chỗ cho nhãn tên) trong toạ độ ảnh: luôn phải nằm trong khung.
  function catBox() {
    var pts = scene.spots.concat([scene.ceo]);
    var x0 = Math.min.apply(null, pts.map(function (p) { return p.x - p.r; })) - 30, x1 = Math.max.apply(null, pts.map(function (p) { return p.x + p.r; })) + 30;
    var y0 = Math.min.apply(null, pts.map(function (p) { return p.top; })) - 34, y1 = Math.max.apply(null, pts.map(function (p) { return p.y + p.r; })) + 16;
    return { x0: Math.max(0, x0), x1: Math.min(scene.width, x1), y0: Math.max(0, y0), y1: Math.min(scene.height, y1) };
  }
  // Khung lấp phần còn lại của cửa sổ (theo mọi kích thước trình duyệt); tranh phóng to tới mức phủ kín khung
  // nhưng không cắt mất con mèo nào (cắt bớt mép tranh nếu cần; phần còn trống là nền mờ của chính bức tranh).
  function fit() {
    if (!scene) return;
    var top = town.getBoundingClientRect().top;
    var want = Math.round(Math.max(340, window.innerHeight - (top > 0 && top < window.innerHeight / 2 ? top : 40) - 16));
    if (Math.abs(town.clientHeight - want) > 2) town.style.height = want + 'px';
    var w = glBox.clientWidth, h = glBox.clientHeight; if (!w || !h) return;
    var b = catBox(), contain = Math.min(w / scene.width, h / scene.height), cover = Math.max(w / scene.width, h / scene.height);
    var keep = Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0));
    s0 = Math.max(contain, Math.min(cover, keep));
    if (!moved) { cx = (b.x0 + b.x1) / 2; cy = (b.y0 + b.y1) / 2; zoom = 1; }
    apply();
  }
  function clamp() {
    var w = glBox.clientWidth, h = glBox.clientHeight, s = s0 * zoom;
    var hw = Math.min(scene.width / 2, w / 2 / s), hh = Math.min(scene.height / 2, h / 2 / s);
    cx = Math.max(hw, Math.min(scene.width - hw, cx)); cy = Math.max(hh, Math.min(scene.height - hh, cy));
  }
  function apply() {
    if (!view) return;
    clamp();
    var w = glBox.clientWidth, h = glBox.clientHeight, s = s0 * zoom;
    var tx = w / 2 - cx * s, ty = h / 2 - cy * s;
    view.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) scale(' + s.toFixed(4) + ')';
    sizeFx();
    view.dataset.s = s; view.dataset.tx = tx; view.dataset.ty = ty;
    placeLabels(); parallax();
  }
  function placeLabels() {
    if (!view) return;
    var s = +view.dataset.s, tx = +view.dataset.tx, ty = +view.dataset.ty, W = glBox.clientWidth;
    var all = Object.keys(cats).map(function (k) { return cats[k]; }); if (ceo) all.push(ceo);
    all.forEach(function (c) {
      var x = tx + c.spot.x * s, y = Math.max(22, ty + c.spot.top * s);      // nhãn không bị cắt ở mép trên
      c.label.style.transform = 'translate(-50%,-100%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      // bong bóng thoại: nằm trên nhãn; nếu không đủ chỗ phía trên (vd mèo Boss trên nóc nhà) thì đặt xuống dưới nhãn; luôn nằm trong khung
      var sayH = c.say.hidden ? 0 : c.say.offsetHeight, sayW = c.say.hidden ? 0 : c.say.offsetWidth;
      var above = y - 26 - sayH >= 6, sy = above ? y - 26 : y + 8 + sayH;
      var sx = Math.max(sayW / 2 + 6, Math.min(W - sayW / 2 - 6, x));
      c.say.style.transform = 'translate(-50%,-100%) translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px)';
    });
  }
  function parallax() {
    layerEls.forEach(function (img) { var d = +img.dataset.depth; img.style.transform = d ? 'translate(' + (mx * d * 5).toFixed(1) + 'px,' + (my * d * 3).toFixed(1) + 'px)' : ''; });
  }
  var drag = null;
  function bindInput() {
    glBox.onwheel = function (e) {
      if (locked || !view) return;
      e.preventDefault();
      var r = glBox.getBoundingClientRect(), s = s0 * zoom, px = e.clientX - r.left, py = e.clientY - r.top;
      var ix = cx + (px - r.width / 2) / s, iy = cy + (py - r.height / 2) / s;   // điểm ảnh dưới con trỏ giữ nguyên khi phóng
      zoom = Math.max(1, Math.min(3.5, zoom * Math.exp(-e.deltaY * 0.0015))); moved = true;
      var s2 = s0 * zoom; cx = ix - (px - r.width / 2) / s2; cy = iy - (py - r.height / 2) / s2;
      apply();
    };
    glBox.onpointerdown = function (e) { if (locked || e.target.classList.contains('t25-hit')) return; drag = { x: e.clientX, y: e.clientY, cx: cx, cy: cy }; glBox.setPointerCapture(e.pointerId); glBox.classList.add('drag'); };
    glBox.onpointermove = function (e) {
      var r = glBox.getBoundingClientRect();
      mx = ((e.clientX - r.left) / r.width) * 2 - 1; my = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (drag) { moved = true; var s = s0 * zoom; cx = drag.cx - (e.clientX - drag.x) / s; cy = drag.cy - (e.clientY - drag.y) / s; apply(); }
      else if (layerEls.length > 1) parallax();
    };
    glBox.onpointerup = glBox.onpointercancel = function () { drag = null; glBox.classList.remove('drag'); };
    glBox.ondblclick = function () { if (locked) return; moved = false; fit(); };
  }

  // ---------- hiệu ứng động (canvas 2D, ~15 khung/giây) ----------
  // Tối ưu CPU/bộ nhớ: đèn lồng và cánh hoa vẽ sẵn thành ảnh nhỏ rồi chỉ drawImage (không tạo gradient/path mỗi khung);
  // mỗi vùng nước chỉ 3 lần stroke (sóng, gợn, lấp lánh); canvas hiệu ứng theo độ phân giải thực hiển thị (fxK ≤ 1).
  var glowSprite = null, petalSprites = null, fxK = 1;
  function sprites() {
    if (glowSprite) return;
    glowSprite = document.createElement('canvas'); glowSprite.width = glowSprite.height = 64;
    var g = glowSprite.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,214,140,1)'); gr.addColorStop(1, 'rgba(255,190,110,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    petalSprites = ['rgba(246,176,198,0.92)', 'rgba(255,214,226,0.95)'].map(function (col) {
      var c = document.createElement('canvas'); c.width = 20; c.height = 14; var x = c.getContext('2d');
      x.fillStyle = col; x.beginPath(); x.ellipse(10, 7, 8.8, 5.4, 0, 0, 6.2832); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.ellipse(7.6, 5.8, 3.2, 1.8, 0, 0, 6.2832); x.fill();
      return c;
    });
  }
  // Độ phân giải canvas hiệu ứng = độ phân giải đang hiển thị (màn thường ~0,7×, Retina 1×) → ít điểm ảnh phải vẽ/ghép.
  function sizeFx() {
    if (!fx) return;
    var k = Math.max(0.4, Math.min(1, s0 * zoom * (window.devicePixelRatio || 1)));
    if (Math.abs(k - fxK) < 0.06 && fx.width) return;
    fxK = k; fx.width = Math.round(scene.width * k); fx.height = Math.round(scene.height * k);
  }
  function draw(force, t) {
    if (!ctx || !scene) return;
    sprites();
    var sec = (t || performance.now()) / 1000, W = scene.width, H = scene.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, fx.width, fx.height);
    ctx.setTransform(fxK, 0, 0, fxK, 0, 0);
    // mặt nước: sóng trôi theo dòng + vòng gợn + tia lấp lánh (mỗi loại một nét vẽ cho cả vùng)
    ctx.lineCap = 'round';
    (scene.water || []).forEach(function (poly, pi) {
      var b = boxes[pi], off = (sec * 22) % 30;
      ctx.save(); ctx.beginPath(); poly.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath(); ctx.clip();
      ctx.beginPath();
      for (var yy = b[1] - 6, row = 0; yy < b[3] + 6; yy += 12, row++) {
        for (var xx = b[0] - 30 + off + (row % 2) * 15, first = true; xx < b[2] + 30; xx += 12) {
          var yv = yy + Math.sin(xx * 0.05 - sec * 2.4 + row * 0.9) * 2.4;
          if (first) { ctx.moveTo(xx, yv); first = false; } else ctx.lineTo(xx, yv);
        }
      }
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.13 + 0.04 * Math.sin(sec * 1.3)).toFixed(3) + ')'; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.beginPath();
      ripples.forEach(function (rp) {
        if (rp.p !== pi) return;
        var age = (sec + rp.t0) % 3.2;
        if (age < 0.07) { rp.x = b[0] + Math.random() * (b[2] - b[0]); rp.y = b[1] + Math.random() * (b[3] - b[1]); }
        ctx.moveTo(rp.x + 3 + age * 9, rp.y); ctx.ellipse(rp.x, rp.y, 3 + age * 9, 1.5 + age * 4, 0, 0, 6.2832);
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.beginPath();
      sparks.forEach(function (k) {
        if (k.p !== pi || Math.sin(sec * k.sp + k.ph) < 0.55) return;
        var dx = Math.sin(sec * 0.6 + k.ph) * 6; ctx.moveTo(k.x + dx - k.len / 2, k.y); ctx.lineTo(k.x + dx + k.len / 2, k.y);
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.restore();
    });
    // đèn lồng nhấp nháy: ảnh quầng sáng vẽ sẵn, chỉ đổi độ trong
    ctx.globalCompositeOperation = 'lighter';
    (scene.lanterns || []).forEach(function (L, i) {
      ctx.globalAlpha = 0.32 + 0.1 * Math.sin(sec * 2.3 + i * 1.7) + 0.05 * Math.sin(sec * 7.1 + i);
      var r = L[2] * 2.4; ctx.drawImage(glowSprite, L[0] - r, L[1] - r, r * 2, r * 2);
    });
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // cánh hoa anh đào rơi: ảnh cánh hoa vẽ sẵn + phép biến đổi (không save/restore, không path)
    for (var i = 0; i < petals.length; i++) {
      var p = petals[i];
      if (!still) { p.y += p.vy * 1.33; p.x += (p.vx + Math.sin(sec * 1.2 + p.ph) * 0.35) * 1.33; p.rot += p.vr * 1.33; if (p.y > H || p.x > W) { petals[i] = p = newPetal(false); } }
      var c = Math.cos(p.rot) * p.s * fxK, sn = Math.sin(p.rot) * p.s * fxK, fl = 0.6 + 0.4 * Math.abs(Math.sin(sec * 2 + p.ph));
      ctx.setTransform(c, sn, -sn * fl, c * fl, p.x * fxK, p.y * fxK);
      ctx.drawImage(petalSprites[p.c ? 1 : 0], -5, -3.5, 10, 7);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  function loop() {
    cancelAnimationFrame(raf); raf = 0;
    if (!active || document.hidden || still) { draw(true); return; }
    var tick = function (t) {
      raf = 0;
      if (!active || document.hidden || still) return;
      if (t - lastT >= 64) { lastT = t; draw(false, t); }   // ~15 khung/giây
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  // ---------- đường giao việc (nét đứt phát sáng, chấm chạy theo đường, tự mờ sau ~4 giây) ----------
  var NS = 'http://www.w3.org/2000/svg';
  var svgEl = function (tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; };
  var liveLinks = {};
  function link(from, to, color, label) {
    if (!active || !linkSvg) return;
    var A = from === 'user' ? ceo : cats[from], B = to === 'user' ? ceo : cats[to];
    if (!A || !B || A === B) return;
    var ax = A.spot.x, ay = A.spot.y - A.spot.r * 0.3, bx = B.spot.x, by = B.spot.y - B.spot.r * 0.3;
    var dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, off = Math.min(90, len * 0.22);
    var qx = (ax + bx) / 2 - (dy / len) * off, qy = (ay + by) / 2 + (dx / len) * off - off * 0.4;
    var d = 'M' + ax + ',' + ay + ' Q' + qx.toFixed(1) + ',' + qy.toFixed(1) + ' ' + bx + ',' + by, key = from + '>' + to;
    if (liveLinks[key]) liveLinks[key].remove();
    var g = svgEl('g', { class: 't25-link' });
    // đường mảnh, trong suốt, không chữ: viền trắng mờ + nét đứt màu loại việc + chấm nhỏ chạy theo đường
    g.append(svgEl('path', { d: d, fill: 'none', stroke: '#ffffff', 'stroke-width': 3.5, 'stroke-opacity': 0.45, 'stroke-linecap': 'round' }),
      svgEl('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-opacity': 0.75, class: 't25-dash', 'stroke-linecap': 'round' }),
      svgEl('circle', { cx: ax, cy: ay, r: 3.5, fill: color, 'fill-opacity': 0.8 }), svgEl('circle', { cx: bx, cy: by, r: 3.5, fill: color, 'fill-opacity': 0.8 }));
    var dot = svgEl('circle', { r: 4.5, fill: '#fff', 'fill-opacity': 0.9, stroke: color, 'stroke-width': 2 });
    dot.append(svgEl('animateMotion', { dur: '1.2s', repeatCount: '3', path: d }));
    g.append(dot);
    linkSvg.appendChild(g); liveLinks[key] = g;
    setTimeout(function () { g.remove(); if (liveLinks[key] === g) delete liveLinks[key]; }, 4100);
  }

  // ---------- trạng thái, thẻ thông tin ----------
  function refresh() {
    if (typeof info === 'undefined') return;
    var n = 0;
    Object.keys(cats).forEach(function (id) {
      var s = statusOf(id), c = cats[id];
      if (s === 'working' || s === 'waiting') n++;
      c.ico.textContent = ICON[s] || ''; c.ico.className = 't25-ico st-' + s;
      if (c.sprite) c.sprite.className = 't25-layer t25-sprite st-' + s;
      if (c.patch) c.patch.className = 't25-patch st-' + s;
      c.zzz.className = 't25-zzz st-' + s;
      var rep = (info[id] && info[id].report) || '', show = (s === 'working' || s === 'waiting') && rep;
      c.say.hidden = !show; c.say.textContent = show ? (ICON[s] || '') + ' ' + rep.replace(/\s+/g, ' ').slice(0, SAY_MAX) + (rep.length > SAY_MAX ? '…' : '') : '';
      c.label.classList.toggle('off', s === 'offline'); c.label.dataset.st = s;
      c.busy = s === 'working'; c.sel = id === selected; showLabel(c);
    });
    if (ceo) { var cs = n ? 'waiting' : 'idle'; if (ceo.patch) ceo.patch.className = 't25-patch st-' + cs; ceo.zzz.className = 't25-zzz st-' + cs; ceo.say.hidden = !n; ceo.say.textContent = n ? '👀 Đang theo dõi ' + n + ' agent làm việc' : ''; ceo.sel = selected === 'ceo'; showLabel(ceo); }
    if (selected) fillCard(selected);
    placeLabels();
  }
  function select(id) { selected = id; card.hidden = false; refresh(); }
  function fillCard(id) {
    var x = mk('button', 'x', '×'); x.onclick = function () { selected = ''; card.hidden = true; refresh(); };
    card.replaceChildren();
    if (id === 'ceo') {
      var go = mk('a', 'pb', '📄 Xem báo cáo'); go.href = 'reports/'; go.target = '_blank'; go.rel = 'noopener';
      card.append(x, mk('h5', '', '👑 Mèo Boss Cute'), mk('div', 'r', 'CEO (bạn) — người giao việc cho Content Lead và duyệt kết quả.'), mk('div', 'rep', 'Mở danh sách báo cáo đã hoàn thành của team (theo tháng, có tìm kiếm và tải về).'), go);
      return;
    }
    var m = (typeof meta !== 'undefined' && meta[id]) || {}, st = info[id] || { status: 'idle', report: '' };
    var ed = mk('button', 'pb', '✎ Sửa'); ed.onclick = function () { openEditor(id); };
    card.append(x, mk('h5', '', m.name || id), mk('div', 'r', '#' + id + ' · ' + (m.role || '') + ' · ' + (STATUS[st.status] || st.status)),
      mk('div', 'r', (m.skills && m.skills.length ? 'Skill: ' + m.skills.join(', ') + ' · ' : '') + 'AI: ' + (m.ai || '')), mk('div', 'rep', st.report || 'Chưa có báo cáo.'), ed);
  }

  // ---------- cố định góc nhìn, dừng chuyển động ----------
  var lockBox = $('townLock'), fixBtn = $('townFix'), stillBtn = $('townStill');
  function paintLock() { if (lockBox) lockBox.checked = locked; if (fixBtn) { fixBtn.textContent = locked ? '🔓 Bỏ cố định góc nhìn' : '🔒 Cố định góc nhìn'; fixBtn.classList.toggle('on', locked); } glBox.classList.toggle('locked', locked); }
  function setLocked(v) { locked = v; try { localStorage.setItem('ao.town.lock', v ? '1' : '0'); if (v) localStorage.setItem('ao.garden.cam', JSON.stringify([zoom, cx, cy])); } catch (e) { /* bỏ qua */ } paintLock(); }
  function restoreCam() {
    if (!locked) return;
    try { var c = JSON.parse(localStorage.getItem('ao.garden.cam') || 'null'); if (c && c.length === 3) { zoom = c[0]; cx = c[1]; cy = c[2]; moved = true; apply(); } } catch (e) { /* bỏ qua */ }
  }
  if (lockBox) lockBox.onchange = function () { setLocked(lockBox.checked); };
  if (fixBtn) fixBtn.onclick = function () { setLocked(!locked); };
  paintLock();
  function paintStill() { stillBtn.textContent = still ? '▶ Bật chuyển động' : '⏸ Dừng chuyển động'; town.classList.toggle('still', still); }
  paintStill();
  stillBtn.onclick = function () { still = !still; paintStill(); try { localStorage.setItem('ao.town.still', still ? '1' : ''); } catch (e) { /* bỏ qua */ } loop(); };

  // ---------- công tắc 2D / khu vườn ----------
  var pending = window.aoAgents || null;
  function setView(on) {
    active = on; town.hidden = !on; stage.hidden = on; legend.hidden = on;
    Array.prototype.forEach.call(sw.children, function (b) { b.classList.toggle('on', (b.dataset.v === '3d') === on); });
    try { localStorage.setItem('ao.view', on ? '3d' : '2d'); } catch (e) { /* bỏ qua */ }
    if (on) { if (!view) loading.classList.remove('done'); pending = window.aoAgents || pending; if (pending) build(pending); fit(); refresh(); loop(); }
    else { cancelAnimationFrame(raf); raf = 0; }
  }
  Array.prototype.forEach.call(sw.children, function (b) { b.onclick = function () { setView(b.dataset.v === '3d'); var d = $('offDlg'); if (d && d.open) d.close(); }; });
  document.addEventListener('visibilitychange', function () { if (active) { refresh(); loop(); } });
  new ResizeObserver(function () { if (active) fit(); }).observe(town);
  window.addEventListener('resize', function () { if (active) fit(); });

  window.townBuild = function (agents) { pending = agents; if (active) build(agents); else built = ''; };
  window.townRefresh = function () { if (active) refresh(); };
  window.townLink = link;
  window.townReady = true;
  try { if (window.__townWant || localStorage.getItem('ao.view') === '3d') setTimeout(function () { setView(true); }, 0); } catch (e) { if (window.__townWant) setView(true); }
})();
