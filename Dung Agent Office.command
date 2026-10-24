#!/bin/bash
# Bấm đúp để dừng server Agent Office đang chạy từ thư mục này (không cần biết cổng).
cd "$(dirname "$0")" || exit 1
APP_DIR="$(pwd -P)"
found=0
for pid in $(lsof -nP -iTCP -sTCP:LISTEN -t 2>/dev/null | sort -u); do
  cmd="$(ps -o command= -p "$pid" 2>/dev/null)"
  case "$cmd" in *node*server.js*) ;; *) continue ;; esac
  dir="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  if [ "$(cd "$dir" 2>/dev/null && pwd -P)" = "$APP_DIR" ]; then
    kill "$pid" 2>/dev/null && { printf '✔ Đã dừng server (tiến trình %s).\n' "$pid"; found=1; }
  fi
done
[ "$found" = 1 ] || echo "Không có server Agent Office nào đang chạy từ thư mục này."
sleep 2
