---
title: Đọc số liệu quảng cáo Enzy (Facebook Ads + Pancake)
agents: [analyst, planner, manager]
order: 70
---
Nguồn: trang báo cáo nội bộ enzyfood.streamlit.app (hệ thống tự lấy, CEO không cần tải tay). Lịch chạy tự động: ngày (hôm qua), tuần (7 ngày), tháng (30 ngày). Số liệu đã tính sẵn nằm ở `reports/enzy/<kỳ>/<yyyymmdd>-so-lieu.md`, lịch sử ở `data/enzy/<kỳ>/`.

## Định nghĩa (đúng theo trang báo cáo)
| Chỉ số | Cách tính / ý nghĩa |
|---|---|
| Chi tiêu | Tiền quảng cáo đã tiêu, **đã gồm 10% thuế** |
| Lead | Cuộc trò chuyện tin nhắn mới do quảng cáo tạo ra |
| Đơn / Doanh thu | Đơn Pancake không huỷ, gắn đúng ID quảng cáo (đơn không gắn ID không có trong bảng) |
| NS/DT | Chi tiêu ÷ Doanh thu — tỷ lệ chi phí quảng cáo trên doanh thu, càng thấp càng tốt (= 1 ÷ ROAS) |
| ROAS | Doanh thu ÷ Chi tiêu |
| CPA | Chi tiêu ÷ Đơn; mục tiêu hiện tại 150.000đ/đơn (đọc lại trong file số liệu) |
| Giá/lead | Chi tiêu ÷ Lead |
| Tỷ lệ chốt | Đơn ÷ Lead (có thể > 100% khi khách cũ đặt lại qua cùng ads) |

## Quy tắc đánh giá
- Đánh giá theo **CPA so với mục tiêu** trước, rồi NS/DT/ROAS. CPA ≤ mục tiêu và ROAS cao → ứng viên tăng ngân sách 20-30%/lần.
- Chiến dịch chi nhiều mà 0 đơn hoặc CPA > 2× mục tiêu → đề xuất tắt/giảm; dữ liệu quá ít (< 2 đơn, chi < 2% tổng) → "theo dõi thêm".
- Giá/lead cao + CTR thấp → vấn đề ở nội dung quảng cáo (#writer/#designer). Giá/lead ổn nhưng tỷ lệ chốt thấp → vấn đề ở sale/tư vấn hoặc sai tệp khách.
- "Ads có chi nhưng 0 đơn" chiếm > 30% tổng chi → cảnh báo lãng phí.
- Ngày: tránh kết luận từ biến động 1 ngày của chiến dịch nhỏ; tuần/tháng mới quyết định cơ cấu ngân sách.
- Tên chiến dịch có quy ước: ngày tạo - nhóm (LTT/DS/VN) - LM/TN - mã nội dung/ngân sách; dùng để gom nhận định theo nhóm nội dung khi có thể.
