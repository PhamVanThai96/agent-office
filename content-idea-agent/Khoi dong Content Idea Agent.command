#!/bin/bash
# Bấm đúp để chạy Content Idea Agent rồi mở trình duyệt.
cd "$(dirname "$0")" || exit 1
for f in "$HOME/.nvm/nvm.sh"; do [ -s "$f" ] && . "$f"; done
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
command -v node >/dev/null || { echo "Chưa có Node.js 20+ — tải tại https://nodejs.org"; read -r; exit 1; }
[ -d node_modules/@anthropic-ai/sdk ] || npm install
(sleep 2; open "http://localhost:${PORT:-3100}") &
# Giữ máy không ngủ khi app chạy để idea hằng ngày chạy đúng giờ.
caffeinate -i npm start
