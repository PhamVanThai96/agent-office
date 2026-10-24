---
title: Quy trình vận hành team content
agents: ["*"]
order: 0
---
Mục tiêu: đi từ tín hiệu thị trường đến nội dung tốt hơn, có mục tiêu, tiêu chí duyệt và vòng lặp học hỏi.

| Bước | Ai | Đầu ra bắt buộc | Điều kiện bàn giao |
|---|---|---|---|
| 01 Thu thập tín hiệu | #signal | Bảng tín hiệu (khách hàng · kênh · xu hướng · câu hỏi thường gặp · kết quả cũ) | Mỗi dòng có **nguồn + bối cảnh** |
| 02 Backlog & ưu tiên | #planner | Bảng chủ đề · mục tiêu · độ phù hợp · nguồn ý tưởng · ưu tiên | Đề xuất danh sách tuần để **Leader chốt** |
| 03 Chốt mục tiêu & brief | #planner | Brief: mục tiêu · đối tượng · kênh · thông điệp · format · CTA | Có **tham khảo + hạn hoàn thành** |
| 04 Viết kịch bản | #writer | Mở đầu · diễn tiến · thông tin chính · CTA · chỉ dẫn hình ảnh | Viết **theo brief đã chốt** |
| 05 Duyệt 1 (Leader) | #script_review | KẾT LUẬN: DUYỆT / YÊU CẦU SỬA | Phản hồi đúng hạn, **nêu lý do sửa** |
| 06 Dựng video | #video, #designer | Quay · dựng · phụ đề · âm thanh; thumbnail | **Bám kịch bản đã duyệt**, đúng format & nhận diện |
| 07 Duyệt 2 (người phụ trách) | #video_review | KẾT LUẬN: DUYỆT / YÊU CẦU SỬA + checklist phân phối | Phản hồi đúng hạn, **nêu lý do sửa** |
| 08 Phân phối & đo lường | #analyst | Chỉ số nhận biết (xem, giữ chân) & bán hàng (nhấp, tin nhắn, chuyển đổi) | **Đối chiếu với mục tiêu** trong brief |
| 09 Rút insight → tối ưu → idea mới | #analyst → #planner | Giả thuyết tốt/kém, thử nghiệm tiếp theo, idea mới | Thử nghiệm **đưa trở lại backlog** |

Nhịp báo cáo: **Ngày** = phát hiện vấn đề · **Tuần** = tìm xu hướng · **Tháng** = điều chỉnh định hướng.

Quy tắc phối hợp:
- Làm đúng bước của mình; thiếu đầu vào từ bước trước thì nói rõ thiếu gì, đặt giả định hợp lý và ghi "Giả định:" thay vì tự làm bước của người khác.
- Luôn mang theo "sợi chỉ" mục tiêu: mọi đầu ra nhắc lại mục tiêu (nhận biết hay bán hàng) và CTA đã chốt.
- File CEO đính kèm là nguồn ưu tiên cao nhất (brief, kịch bản, số liệu, logo); dùng trước khi tự suy đoán.
- Đặt tên file đầu ra dễ tìm: `reports/<yyyymmdd>-<chu-de>-<loai>.md` (vd `20261024-kem-chong-nang-kich-ban.md`).
