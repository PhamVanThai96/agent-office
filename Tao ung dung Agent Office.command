#!/bin/bash
# Tạo ứng dụng "Agent Office.app" (kéo vào Dock / bấm đúp như app thường) trỏ tới thư mục hiện tại.
# Mặc định tạo ở ~/Applications; có thể chọn nơi khác: ./"Tao ung dung Agent Office.command" /duong/dan/thu-muc
# Nếu sau này di chuyển thư mục dự án, chạy lại file này để tạo lại.
cd "$(dirname "$0")" || exit 1
APP_DIR="$(pwd -P)"
OUT="${1:-$HOME/Applications}"
LAUNCHER="$APP_DIR/Khoi dong Agent Office.command"
[ -f "$LAUNCHER" ] || { echo "Không thấy file khởi động."; exit 1; }
command -v osacompile >/dev/null 2>&1 || { echo "Máy này không có osacompile (chỉ có trên macOS)."; exit 1; }
mkdir -p "$OUT" || exit 1
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
APP="$OUT/Agent Office.app"
rm -rf "$APP"
osacompile -o "$APP" -e "do shell script \"open -a Terminal \" & quoted form of \"$(esc "$LAUNCHER")\"" || { echo "Tạo ứng dụng thất bại."; exit 1; }
# Biểu tượng ứng dụng (logo mèo đeo tai nghe): thay applet.icns do osacompile tạo ra.
ICON="$APP_DIR/public/brand/AgentOffice.icns"
if [ -f "$ICON" ]; then
  cp "$ICON" "$APP/Contents/Resources/applet.icns" && touch "$APP" && echo "✔ Đã gắn biểu tượng Agent Office."
fi
printf '✔ Đã tạo: %s\n  Kéo ứng dụng vào Dock để mở nhanh. Lần đầu macOS có thể hỏi xác nhận: chuột phải → Mở.\n' "$APP"
sleep 3
