#!/bin/bash
# Bấm đúp để tắt Kho Idea Enzy đang chạy trên máy này.
cd "$(dirname "$0")" || exit 1
if [ -f data/server.pid ] && kill "$(cat data/server.pid)" 2>/dev/null; then
  rm -f data/server.pid; echo "Đã tắt Kho Idea Enzy."
else
  pkill -f "env-file=data/may-nay.env" 2>/dev/null && echo "Đã tắt Kho Idea Enzy." || echo "Kho Idea Enzy không chạy."
fi
