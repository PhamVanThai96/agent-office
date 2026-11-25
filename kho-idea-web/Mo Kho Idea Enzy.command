#!/bin/bash
# Bấm đúp để mở Kho Idea Enzy trên máy này (http://localhost:3200).
# Chạy nền: đóng cửa sổ Terminal này web vẫn chạy. Muốn tắt: bấm đúp "Tat Kho Idea Enzy.command".
cd "$(dirname "$0")" || exit 1
URL="http://localhost:3200"

if curl -fsS "$URL/healthz" >/dev/null 2>&1; then
  open "$URL"; exit 0
fi

[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin"
NODE="$(command -v node)"
if [ -z "$NODE" ]; then
  osascript -e 'display dialog "Chưa có Node.js (bản 22.13 trở lên). Tải tại nodejs.org rồi mở lại." buttons {"OK"}' >/dev/null 2>&1
  exit 1
fi
if [ ! -f data/may-nay.env ]; then
  echo "Thiếu file data/may-nay.env (tên đăng nhập admin, mật khẩu, AGENT_TOKEN)."; exit 1
fi

mkdir -p data
# caffeinate -i: giữ máy không ngủ khi web đang chạy để lịch 9h30 đẩy idea vào được.
nohup caffeinate -i "$NODE" --env-file=data/may-nay.env server.js >> data/server.log 2>&1 &
echo $! > data/server.pid

for i in $(seq 1 20); do
  curl -fsS "$URL/healthz" >/dev/null 2>&1 && break
  sleep 0.5
done
open "$URL"
