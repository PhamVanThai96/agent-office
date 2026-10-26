#!/bin/bash
# Cài công cụ transcript video (tuỳ chọn) cho Agent Office: yt-dlp + faster-whisper trong tools/venv, không đụng Python hệ thống.
# Chạy: bash scripts/setup-media.sh   (cần Internet; tải thêm ~100MB thư viện + ~480MB mô hình Whisper "small" ở lần transcript đầu tiên)
# Không cài thì mọi tính năng khác vẫn chạy bình thường; chỉ công cụ video_transcribe báo "chưa cài".
set -e
cd "$(dirname "$0")/.."
PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3.9 python3; do
  command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null && { PY="$(command -v "$c")"; break; }
done
[ -n "$PY" ] || { echo "✖ Cần Python 3.9+ (cài từ https://www.python.org/downloads/ hoặc: xcode-select --install)"; exit 1; }
echo "Python: $PY ($("$PY" -V))"
[ -x tools/venv/bin/python ] || "$PY" -m venv tools/venv
tools/venv/bin/python -m pip install -q --upgrade pip
tools/venv/bin/python -m pip install -q -r tools/requirements.txt
echo "✔ Đã cài: yt-dlp $(tools/venv/bin/yt-dlp --version), faster-whisper"
echo "  Mô hình Whisper sẽ tự tải ở lần transcript đầu tiên (nếu bị treo: HF_HUB_DISABLE_XET=1 đã được bật sẵn trong ứng dụng)."
