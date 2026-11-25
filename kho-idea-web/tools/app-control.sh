#!/bin/bash
# Điều khiển web Kho Idea Enzy trên máy: start | stop | restart | status. Ứng dụng "Kho Idea Enzy.app" gọi file này.
cd "$(dirname "$0")/.." || exit 1
URL="http://localhost:3200"
up() { curl -fsS "$URL/healthz" >/dev/null 2>&1; }
start() {
  up && return 0
  [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin"
  NODE="$(command -v node)"
  [ -z "$NODE" ] && { echo "NO_NODE"; return 1; }
  [ -f data/may-nay.env ] || { echo "NO_ENV"; return 1; }
  mkdir -p data
  # caffeinate -i: giữ máy không ngủ khi web đang chạy để các lịch 9h30, 14h30 làm việc được
  nohup caffeinate -i "$NODE" --env-file=data/may-nay.env server.js >> data/server.log 2>&1 &
  echo $! > data/server.pid
  for i in $(seq 1 30); do up && return 0; sleep 0.5; done
  echo "NO_START"; return 1
}
stop() {
  [ -f data/server.pid ] && kill "$(cat data/server.pid)" 2>/dev/null
  pkill -f "env-file=data/may-nay.env server.js" 2>/dev/null
  rm -f data/server.pid
  for i in $(seq 1 10); do up || return 0; sleep 0.3; done
}
case "$1" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) up && echo RUNNING || echo STOPPED ;;
  *) echo "Dùng: $0 start|stop|restart|status"; exit 2 ;;
esac
