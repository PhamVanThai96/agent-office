#!/bin/bash
# Bấm đúp file này (trong Finder) để chạy Agent Office — không cần gõ lệnh, không phụ thuộc đường dẫn.
# Tự: tìm Node.js trên máy, cài thư viện lần đầu, chọn cổng trống, mở trình duyệt, giữ máy không ngủ khi đang chạy.
# Đặt AGENT_OFFICE_NO_BROWSER=1 để không tự mở trình duyệt.

cd "$(dirname "$0")" || exit 1
APP_DIR="$(pwd)"
MIN_NODE=20

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
fail() { printf '\n\033[31m✖ %s\033[0m\n\n' "$*"; read -n 1 -s -r -p "Nhấn phím bất kỳ để đóng cửa sổ…"; echo; exit 1; }

# --- 1. Tìm Node.js (PATH, nvm, Homebrew, Volta, fnm, bản cài chính thức) và kiểm tra phiên bản ---
node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null; }
pick_node() {
  local c m best="" bestm=0
  local -a cands=()
  command -v node >/dev/null 2>&1 && cands+=("$(command -v node)")
  for c in "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node "$HOME"/.volta/bin/node \
           /opt/homebrew/bin/node /usr/local/bin/node /opt/homebrew/opt/node/bin/node /usr/bin/node; do
    [ -x "$c" ] && cands+=("$c")
  done
  for c in "${cands[@]}"; do
    m="$(node_major "$c")"
    [[ "$m" =~ ^[0-9]+$ ]] || continue
    if [ "$m" -ge "$MIN_NODE" ] && [ "$m" -gt "$bestm" ]; then best="$c"; bestm="$m"; fi
  done
  [ -n "$best" ] && printf '%s' "$best"
}
NODE="$(pick_node)"
if [ -z "$NODE" ]; then
  osascript -e 'display dialog "Máy chưa có Node.js (cần bản '"$MIN_NODE"' trở lên, khuyên dùng bản LTS mới nhất).\n\nBấm \"Mở trang tải\", cài Node.js rồi bấm đúp lại file này." buttons {"Đóng","Mở trang tải"} default button "Mở trang tải" with icon caution' 2>/dev/null | grep -q "Mở trang tải" && open "https://nodejs.org/en/download"
  fail "Chưa tìm thấy Node.js $MIN_NODE+. Hãy cài từ https://nodejs.org rồi chạy lại."
fi
export PATH="$(dirname "$NODE"):$PATH"   # để npm và các lệnh con dùng cùng bản Node
bold "Agent Office"
info "Thư mục : $APP_DIR"
info "Node.js : $("$NODE" -v) ($NODE)"

# --- 2. Cài thư viện lần đầu / khi package-lock.json đổi / khi sai kiến trúc máy (vd chép từ Mac Intel sang Mac M) ---
LOCK="$(shasum package-lock.json 2>/dev/null | cut -d' ' -f1)"
need_install=0
[ -d node_modules ] || need_install=1
[ "$(cat node_modules/.ao-lock 2>/dev/null)" = "$LOCK" ] || need_install=1
"$NODE" -e "import('sharp').then(()=>process.exit(0),()=>process.exit(1))" >/dev/null 2>&1 || need_install=1
if [ "$need_install" = 1 ]; then
  bold "Đang cài thư viện (lần đầu, cần Internet, vài phút)…"
  command -v npm >/dev/null 2>&1 || fail "Không thấy npm đi kèm Node.js."
  npm install --no-audit --no-fund || fail "Cài thư viện thất bại. Kiểm tra kết nối Internet rồi chạy lại."
  [ -d node_modules ] && printf '%s' "$LOCK" > node_modules/.ao-lock
fi

# --- 3. Nếu server đã chạy sẵn thì chỉ mở trình duyệt ---
CFG_PORT="$("$NODE" -e "try{process.stdout.write(String(JSON.parse(require('fs').readFileSync('config.json','utf8')).PORT||''))}catch{}" 2>/dev/null)"
BASE_PORT="${PORT:-${CFG_PORT:-3000}}"
open_url() { [ -n "$AGENT_OFFICE_NO_BROWSER" ] || open "$1"; }
for ((p = BASE_PORT; p < BASE_PORT + 10; p++)); do
  if curl -fs -m 1 "http://localhost:$p/poll" 2>/dev/null | grep -q '"agentsVer"'; then
    info "Agent Office đang chạy sẵn ở http://localhost:$p — mở trình duyệt."
    open_url "http://localhost:$p"
    sleep 2; exit 0
  fi
done

# --- 4. Chạy server (tự đổi cổng nếu bận), mở trình duyệt khi sẵn sàng ---
LOG="$(mktemp -t agent-office)"
bold "Đang khởi động server…"
"$NODE" server.js > >(tee "$LOG") 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null; rm -f "$LOG"; exit 0' INT TERM HUP
URL=""
for _ in $(seq 1 60); do
  URL="$(grep -o 'http://localhost:[0-9]*' "$LOG" 2>/dev/null | head -1)"
  [ -n "$URL" ] && break
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
if [ -z "$URL" ]; then
  wait "$PID" 2>/dev/null
  fail "Server không khởi động được (xem thông báo lỗi ở trên)."
fi
command -v caffeinate >/dev/null 2>&1 && caffeinate -i -w "$PID" >/dev/null 2>&1 &
bold "✔ Agent Office đã chạy: $URL"
info "Giữ cửa sổ này mở khi dùng. Đóng cửa sổ hoặc nhấn Ctrl+C để dừng server."
open_url "$URL"
wait "$PID"
