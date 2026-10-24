// Đăng nhập Admin dùng chung cho mọi trang (chính, trí nhớ, token, báo cáo): các thao tác sửa/xoá agent, đổi cấu hình… trả 401
// → hiện hộp thoại nhập Admin ID + mật khẩu → thử lại yêu cầu. Phiên là cookie HttpOnly nên đăng nhập ở một trang dùng được cho cả trang khác.
(function () {
  var BASE = new URL('./', (document.currentScript && document.currentScript.src) || location.href).href;
  var dlg = null, css = null;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function ensure() {
    if (!css) {
      css = el('style');
      css.textContent = '#aoAdmin form{display:block!important;padding:0!important;border:0!important;box-shadow:none!important;position:static!important;background:none!important;margin:0}#aoAdmin input{flex:none!important;border-radius:9px!important;height:auto}#aoAdmin{border:0;border-radius:16px;padding:20px 22px;width:min(380px,92vw);box-shadow:0 20px 50px rgba(30,40,70,.45);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#232834}'
        + '#aoAdmin::backdrop{background:rgba(30,35,50,.55)}#aoAdmin h3{margin:0 0 4px;font-size:17px}#aoAdmin p{margin:0 0 12px;color:#667085;font-size:13px}'
        + '#aoAdmin label{display:block;font-size:12px;color:#667085;margin-bottom:8px}#aoAdmin input{display:block;width:100%;box-sizing:border-box;margin-top:3px;padding:9px 11px;border:1px solid #d9d6cc;border-radius:9px;font:inherit;background:#fff;color:#232834}'
        + '#aoAdmin .btns{display:flex;gap:8px;margin-top:12px}#aoAdmin button{flex:1;height:36px;border:0;border-radius:10px;font:inherit;font-weight:600;cursor:pointer;background:#34517a;color:#fff}'
        + '#aoAdmin button.sec{background:#eeece5;color:#3a4150}#aoAdmin button.dg{background:#8a3a37}#aoAdmin .err{color:#8a3a37;font-size:12.5px;min-height:18px;margin-top:6px}#aoAdmin .ok{color:#1d6b46}'
        + '@media (prefers-color-scheme:dark){#aoAdmin{background:#1b222b;color:#e8edf2}#aoAdmin p,#aoAdmin label{color:#9aa8b6}#aoAdmin input{background:#10151b;color:#e8edf2;border-color:#2b3541}#aoAdmin button.sec{background:#2b3541;color:#e8edf2}}';
      document.head.appendChild(css);
    }
    if (!dlg) { dlg = el('dialog'); dlg.id = 'aoAdmin'; document.body.appendChild(dlg); }
    return dlg;
  }
  function api(path, body) {
    return fetch(BASE + path, body === undefined ? { cache: 'no-store' } : { method: 'POST', body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { j.status = r.status; return j; }, function () { return { ok: false, error: 'Lỗi máy chủ', status: r.status }; }); });
  }
  function field(label, type, name, autocomplete) {
    var l = el('label', '', label), i = el('input'); i.type = type; i.name = name; i.autocomplete = autocomplete || 'off'; l.appendChild(i); return { l: l, i: i };
  }
  function show(build) {
    var d = ensure(); d.replaceChildren();
    return new Promise(function (resolve) {
      var done = function (v) { d.onclose = null; if (d.open) d.close(); resolve(v); };
      build(d, done);
      d.onclose = function () { resolve(false); };
      if (!d.open) d.showModal();
      var first = d.querySelector('input'); if (first) setTimeout(function () { first.focus(); }, 30);
    });
  }

  // Đăng nhập (hoặc thiết lập lần đầu nếu chưa có Admin). Trả về Promise<boolean>.
  function prompt(info) {
    info = info || {};
    return api('admin/status').then(function (st) {
      if (st.loggedIn) return true;
      return show(function (d, done) {
        var setup = !st.configured;
        d.appendChild(el('h3', '', setup ? 'Thiết lập Admin lần đầu' : 'Xác thực Admin'));
        d.appendChild(el('p', '', setup ? (st.canSetup ? 'Tạo Admin ID và mật khẩu để bảo vệ việc sửa/xoá agent và đổi cấu hình. Mật khẩu tối thiểu 8 ký tự.' : 'Chưa có Admin. Việc thiết lập lần đầu chỉ làm được trên chính máy chạy server (mở http://localhost).') : (info.message || 'Nhập Admin ID và mật khẩu để tiếp tục.')));
        var f = el('form'), id = field('Admin ID', 'text', 'id', 'username'), pw = field('Mật khẩu', 'password', 'password', setup ? 'new-password' : 'current-password'), pw2 = setup ? field('Nhập lại mật khẩu', 'password', 'password2', 'new-password') : null;
        f.append(id.l, pw.l); if (pw2) f.appendChild(pw2.l);
        var err = el('div', 'err'), b = el('div', 'btns'), ok = el('button', '', setup ? 'Tạo Admin' : 'Đăng nhập'), no = el('button', 'sec', 'Huỷ');
        ok.type = 'submit'; no.type = 'button'; no.onclick = function () { done(false); };
        if (setup && !st.canSetup) ok.disabled = true;
        b.append(ok, no); f.append(err, b); d.appendChild(f);
        f.onsubmit = function (e) {
          e.preventDefault(); err.textContent = '';
          if (setup && pw.i.value !== pw2.i.value) { err.textContent = 'Hai mật khẩu không khớp.'; return; }
          ok.disabled = true;
          api(setup ? 'admin/setup' : 'admin/login', { id: id.i.value.trim(), password: pw.i.value }).then(function (r) {
            ok.disabled = false;
            if (r.ok) done(true); else { err.textContent = r.error || 'Không đăng nhập được.'; pw.i.value = ''; pw.i.focus(); }
          });
        };
      });
    });
  }

  // fetch có tự xử lý 401 "cần Admin": hiện hộp thoại rồi thử lại một lần.
  function adminFetch(url, opts) {
    return fetch(url, opts).then(function (r) {
      if (r.status !== 401) return r;
      return r.clone().json().then(function (j) {
        if (!j || !/^admin_/.test(j.error || '')) return r;
        return prompt(j).then(function (ok) { return ok ? fetch(url, opts) : r; });
      }, function () { return r; });
    });
  }

  // Bảng quản trị: trạng thái, đăng xuất, đổi mật khẩu.
  function panel() {
    return api('admin/status').then(function (st) {
      if (!st.configured || !st.loggedIn) return prompt().then(function (ok) { if (ok) return panel(); });
      return show(function (d, done) {
        d.appendChild(el('h3', '', 'Quản trị (Admin)'));
        d.appendChild(el('p', '', 'Đang đăng nhập: ' + st.id + '. Phiên tự hết sau 30 phút không hoạt động.'));
        var f = el('form'), cur = field('Mật khẩu hiện tại', 'password', 'current', 'current-password'), nid = field('Admin ID mới (tuỳ chọn)', 'text', 'newId', 'off'), np = field('Mật khẩu mới (để trống = giữ nguyên)', 'password', 'newPassword', 'new-password'), np2 = field('Nhập lại mật khẩu mới', 'password', 'np2', 'new-password');
        if (st.env) f.appendChild(el('p', '', 'Admin đang đặt bằng biến môi trường ADMIN_ID/ADMIN_PASSWORD nên không đổi ở đây.'));
        else f.append(cur.l, nid.l, np.l, np2.l);
        var err = el('div', 'err'), b = el('div', 'btns'), save = el('button', '', 'Lưu thay đổi'), out = el('button', 'dg', 'Đăng xuất'), cl = el('button', 'sec', 'Đóng');
        save.type = 'submit'; out.type = 'button'; cl.type = 'button';
        if (st.env) save.style.display = 'none';
        b.append(save, out, cl); f.append(err, b); d.appendChild(f);
        cl.onclick = function () { done(true); };
        out.onclick = function () { api('admin/logout', {}).then(function () { done(true); }); };
        f.onsubmit = function (e) {
          e.preventDefault(); err.textContent = ''; err.className = 'err';
          if (np.i.value !== np2.i.value) { err.textContent = 'Hai mật khẩu mới không khớp.'; return; }
          if (!nid.i.value.trim() && !np.i.value) { err.textContent = 'Nhập Admin ID mới hoặc mật khẩu mới.'; return; }
          api('admin/change', { current: cur.i.value, newId: nid.i.value.trim(), newPassword: np.i.value }).then(function (r) {
            if (r.ok) { err.className = 'err ok'; err.textContent = 'Đã cập nhật.'; setTimeout(function () { done(true); }, 700); } else err.textContent = r.error || 'Không đổi được.';
          });
        };
      });
    });
  }

  window.adminFetch = adminFetch;
  window.adminPrompt = prompt;
  window.adminPanel = panel;
  window.adminStatus = function () { return api('admin/status'); };
})();
