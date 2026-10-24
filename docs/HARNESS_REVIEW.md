# Review harness — DEMO-agency-office (2026-10-24)

Góc nhìn harness engineering: phần "khung" quanh model — định tuyến, ngữ cảnh, công cụ, quyền, vòng phản hồi, quan sát, đánh giá. Mục tiêu: team content giao việc nhanh, kết quả ổn định, dễ kiểm soát chi phí.

## Đã làm trong đợt này

| # | Thay đổi | File |
|---|---|---|
| 1 | Bộ agent mới theo quy trình 9 bước của team content (tín hiệu → backlog/brief → kịch bản → duyệt 1 → dựng → duyệt 2 → đo lường/insight) | `agents.json` |
| 2 | Workflow mới cho từng đoạn quy trình + quy trình đầy đủ, có bước song song (dựng video ‖ thiết kế) | `workflows.json`, `routing.js` |
| 3 | **Review gate**: agent có `"gate": true` kết luận `KẾT LUẬN: YÊU CẦU SỬA` → tự trả việc về bước sản xuất trước, làm lại có kèm phản hồi, duyệt lại (tối đa 1 vòng). Vẫn chưa đạt → dừng các bước sau | `orchestrator.js`, `agents.js` |
| 4 | Sau bước duyệt, bước tiếp theo nhận **cả bản đã duyệt** (không chỉ lời kết luận) | `orchestrator.js` |
| 5 | Tên phòng cấu hình trong `agents.json` (`rooms`), giao diện xếp theo thứ tự phòng thay vì tên cố định | `agents.js`, `public/app.js` |
| 6 | **Kéo thả / dán / chọn file** khi giao việc → lưu `uploads/<ngày>/`, cấp quyền đọc trong phiên cho đúng file đó, trích đoạn file văn bản đưa thẳng vào prompt | `server.js`, `access.js`, `agents.js`, `public/*` |
| 7 | Ô giao việc nhiều dòng (Enter gửi, Shift+Enter xuống dòng), nút mẫu quy trình, nhãn "sửa lần N" trên bảng task, màu luồng "yêu cầu sửa" | `public/*` |
| 8 | Sửa lỗi `resolveCommand` trỏ nhầm `claude` → `codex` | `cli.js` |
| 9 | Thư mục `skills/` độc lập với agent (chọn skill theo frontmatter `agents`/`rooms`/`*`), có giới hạn độ dài, agent không được tự sửa | `skills.js`, `skills/`, `access.js` |

## Đề xuất tiếp theo (chưa làm), xếp theo ưu tiên

### P1 — An toàn & độ tin cậy
1. **Bind `127.0.0.1` mặc định + token truy cập.** Server nghe mọi interface, không có xác thực; ai cùng mạng có thể giao việc, đổi cấu hình, cấp quyền file, tải file lên. Thêm `HOST` trong config (mặc định loopback) và token đơn giản cho các route POST.
2. **Huỷ task đang chạy.** Hiện không dừng được một yêu cầu dài (CLI timeout 180s × nhiều bước). Cần `AbortController` truyền xuống `llm.js`/`cli.js` + nút "Dừng" trên UI.
3. **Timeout & retry theo agent.** Lỗi mạng/CLI làm hỏng cả chuỗi; thêm retry 1 lần với backoff cho lỗi tạm thời, timeout riêng từng agent.
4. **Kết luận duyệt có cấu trúc.** Gate đang dựa vào regex `KẾT LUẬN: …`. Với API nên dùng tool/JSON schema `{verdict, reasons[]}`; với CLI giữ regex làm fallback.
5. **Dọn `uploads/`** theo hạn (vd 14 ngày) và giới hạn tổng dung lượng.

### P2 — Ngữ cảnh & chi phí
6. **Ngân sách ngữ cảnh.** Mỗi bước nhận toàn văn kết quả các bước trước; quy trình đầy đủ dồn ngữ cảnh lớn dần. Nên chuyển "artifact" (brief, kịch bản đã duyệt) thành file trong `reports/<run>/` và chỉ đưa tóm tắt + đường dẫn.
7. **Đo token/chi phí theo agent và theo lượt chạy**, hiển thị trên bảng task; cảnh báo khi vượt ngưỡng.
8. **Bộ nhớ có cấu trúc cho team content**: `backlog.json` (chủ đề, ưu tiên, trạng thái) thay cho `memory.json` dạng tóm tắt tự do. (Brand voice đã có ở `skills/01-brand-voice.md`.) Cân nhắc nạp skill theo bước/task thay vì theo agent để giảm token.
9. **CLI mode**: giao thức công cụ dạng JSON trong văn bản dễ vỡ; nên kiểm tra schema tham số trước khi gọi handler và trả lỗi rõ để model tự sửa.

### P3 — Quan sát & đánh giá
10. **Nhật ký chạy dạng JSONL** (`runs/<id>.jsonl`: sự kiện, prompt đã rút gọn, kết quả, thời gian) để xem lại và debug; hiện `history` chỉ nằm trong RAM.
11. **Bộ test hồi quy cho định tuyến**: danh sách câu lệnh mẫu → workflow mong đợi (`node --test`), chạy được ở MOCK. Thêm `npm test`.
12. **Eval chất lượng nội dung**: chấm tự động kịch bản theo checklist của Duyệt 1 (hook ≤3s, có CTA, đủ 5 phần) để so sánh prompt/model.
13. **SSE thay cho polling 600ms** — giảm tải, sự kiện tức thời.

### Đề xuất GUI tiếp theo
- **Thanh quy trình 9 bước** phía trên bản đồ, sáng bước đang chạy; bấm vào bước để giao việc đúng đoạn đó.
- **Xem chi tiết task**: bấm vào dòng task mở kết quả đầy đủ + lịch sử sửa (bản trước/sau, phản hồi duyệt).
- **Duyệt bởi người thật (human-in-the-loop)**: tuỳ chọn để CEO tự bấm DUYỆT / YÊU CẦU SỬA tại gate thay cho agent duyệt.
- **Lịch nội dung / backlog dạng bảng** đọc từ `backlog.json`, kéo thả đổi ưu tiên.
- **Lên lịch nhịp báo cáo** ngày/tuần/tháng (cron nội bộ) cho #analyst.
- Panel phải có tab (Báo cáo · Task · Giao tiếp · Quyền) thay vì xếp dọc dài.
