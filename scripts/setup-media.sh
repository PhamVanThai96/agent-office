#!/bin/bash
# Cài công cụ transcript video (tuỳ chọn) cho Agent Office: yt-dlp + faster-whisper trong tools/venv, không đụng Python hệ thống.
# Chạy: bash scripts/setup-media.sh   (cần Internet; tải thêm ~100MB thư viện + ~480MB mô hình Whisper "small" ở lần transcript đầu tiên)
# Không cài thì mọi tính năng khác vẫn chạy bình thường; chỉ công cụ video_transcribe báo "chưa cài".
set -e
cd "$(dirname "$0")/.."

# PyAV 13.1 wheels support Intel macOS 10.13+ and Apple Silicon macOS 11+.
MAC_VERSION="$(sw_vers -productVersion 2>/dev/null || true)"
MAC_ARCH="$(uname -m)"
if [ -z "$MAC_VERSION" ]; then
  echo "✖ Không nhận diện được macOS. Script này dành cho máy Mac." >&2
  exit 1
fi
if [ "$MAC_ARCH" = "arm64" ]; then
  MAC_MAJOR="${MAC_VERSION%%.*}"
  if [ "$MAC_MAJOR" -lt 11 ]; then
    echo "✖ PyAV không có wheel Apple Silicon cho macOS dưới 11.0 (đang dùng $MAC_VERSION)." >&2
    exit 1
  fi
elif [ "$MAC_ARCH" = "x86_64" ]; then
  MAC_MAJOR="${MAC_VERSION%%.*}"
  MAC_MINOR="$(printf '%s' "$MAC_VERSION" | awk -F. '{print $2+0}')"
  if [ "$MAC_MAJOR" -lt 10 ] || { [ "$MAC_MAJOR" -eq 10 ] && [ "$MAC_MINOR" -lt 13 ]; }; then
    echo "✖ PyAV không có wheel Intel cho macOS dưới 10.13 (đang dùng $MAC_VERSION)." >&2
    exit 1
  fi
else
  echo "✖ Kiến trúc Mac chưa được hỗ trợ: $MAC_ARCH (hỗ trợ arm64 và x86_64)." >&2
  exit 1
fi

PY=""
supports_python() {
  EXPECTED_ARCH="$MAC_ARCH" "$1" -c 'import os, platform, sys; ok = sys.implementation.name == "cpython" and (3, 9) <= sys.version_info[:2] <= (3, 13) and platform.machine() == os.environ["EXPECTED_ARCH"]; sys.exit(0 if ok else 1)' 2>/dev/null
}
for c in python3.13 python3.12 python3.11 python3.10 python3.9 python3; do
  command -v "$c" >/dev/null 2>&1 && supports_python "$c" && { PY="$(command -v "$c")"; break; }
done
[ -n "$PY" ] || { echo "✖ Cần CPython 3.9–3.13 để dùng wheel PyAV có sẵn. Cài một bản Python tại https://www.python.org/downloads/ rồi chạy lại."; exit 1; }
echo "Python: $PY ($("$PY" -V))"
if [ -x tools/venv/bin/python ] && ! supports_python tools/venv/bin/python; then
  echo "Venv hiện tại không tương thích; tạo lại tools/venv bằng $PY."
  rm -rf tools/venv
fi
[ -x tools/venv/bin/python ] || "$PY" -m venv tools/venv
tools/venv/bin/python -m pip install -q --upgrade pip
if ! tools/venv/bin/python -m pip install -q --only-binary=:all: -r tools/requirements.txt; then
  echo "✖ Không tìm thấy wheel dựng sẵn tương thích cho một thư viện; pip không được phép build từ source." >&2
  echo "  Đã kiểm tra macOS $MAC_VERSION ($MAC_ARCH), Python $("$PY" -V). Cài CPython 3.9–3.13 hoặc nâng macOS lên bản được hỗ trợ rồi chạy lại." >&2
  exit 1
fi
echo "✔ Đã cài: yt-dlp $(tools/venv/bin/yt-dlp --version), faster-whisper"
echo "  Mô hình Whisper sẽ tự tải ở lần transcript đầu tiên (nếu bị treo: HF_HUB_DISABLE_XET=1 đã được bật sẵn trong ứng dụng)."
