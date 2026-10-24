---
title: Thumbnail, ảnh bìa & key visual
agents: [designer, video_review]
order: 41
---
## Nguyên tắc thumbnail / ảnh bìa
- 1 thông điệp, chữ ≤ 5 từ, cỡ lớn đọc được khi thu nhỏ bằng ngón tay cái.
- Tương phản mạnh: chữ sáng trên nền tối (dùng rect gradient tối phía sau chữ) hoặc ngược lại.
- Ưu tiên mặt người có cảm xúc hoặc sản phẩm cận cảnh; tối đa 3 yếu tố chính.
- Màu, font, logo theo brand voice; logo nhỏ, không che nội dung chính.
- Chữ trên ảnh khớp hook của kịch bản đã duyệt (không tự đặt thông điệp mới).

## Vùng an toàn khi dùng make_image (ảnh 1080×1920)
- Chữ chính trong khoảng y = 300 → 1400, x = 80 → 900.
- Tránh ~300px dưới cùng (caption, nút) và ~180px bên phải (nút tương tác).

## Cách dựng bằng make_image
1. Nền: ảnh CEO đính kèm (`base`) hoặc màu thương hiệu (`background`).
2. Lớp `rect` gradient tối (`fill` → `fillTo`, `opacity` 0 → `opacityTo` 0.7) ở vùng đặt chữ.
3. Lớp `text` tiêu đề (size 90-120, bold, có `stroke`), dòng phụ (size 40-56).
4. Logo bằng lớp `image` (nếu có file).
Chỉ báo xong khi make_image trả `ok` và nêu đường dẫn file.

## Kích thước
TikTok/Reels/Story 1080×1920 · YouTube 1280×720 · Facebook 1200×628 · vuông 1080×1080 · dọc feed 1080×1350.
