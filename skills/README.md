# Thư mục skills — kiến thức dùng chung cho các agent

Mỗi file `.md` trong thư mục này là một "skill": kiến thức, quy chuẩn, checklist giúp agent làm đúng cách của team. Server tự đọc lại khi file thay đổi, **không cần khởi động lại**.

## Skill độc lập với agent
- Skill **không nằm trong `agents.json`**. Thêm, sửa, xoá agent (kể cả qua giao diện) không chạm tới thư mục này.
- Mỗi skill tự khai báo nó áp dụng cho ai, ở phần đầu file (frontmatter):

```markdown
---
title: Viết kịch bản video ngắn
agents: [writer, script_review]      # theo id agent
rooms: [Phòng sản xuất]              # hoặc theo phòng: agent mới đặt vào phòng này tự nhận skill
order: 20                             # số nhỏ được đưa vào trước
---
```

- `agents: ["*"]` = áp dụng cho mọi agent (dùng cho kiến thức chung như quy trình, thương hiệu, tuân thủ).
- Agent bị xoá → skill vẫn còn, chỉ là không ai dùng tới id đó nữa. Agent mới → tự nhận skill chung (`*`) và skill theo phòng; muốn thêm skill riêng thì thêm id vào `agents:` của file skill.
- Trường `file-skill` trong `agents.json` vẫn dùng được cho skill riêng của một agent (đọc thêm, không thay thế thư mục này).
- File bắt đầu bằng `_` hoặc tên `README.md` không được nạp. Agent không được ghi vào thư mục `skills/`.

## Danh sách
| File | Áp dụng | Nội dung |
|---|---|---|
| `00-team-operating-system.md` | tất cả | Quy trình 9 bước, đầu ra & điều kiện bàn giao từng bước, nhịp báo cáo |
| `01-brand-voice.md` | tất cả | **Thông tin thương hiệu — team cần điền** (sản phẩm, đối tượng, giọng điệu, CTA, nhận diện) |
| `02-compliance.md` | tất cả | Quảng cáo đúng luật & chính sách nền tảng, tính chính xác |
| `10-signal-listening.md` | signal | Nguồn tín hiệu, cách ghi nguồn, chấm độ mạnh tín hiệu |
| `20-backlog-brief.md` | planner, script_review | Chấm ưu tiên ICE, mẫu brief |
| `30-script-writing.md` | writer, script_review | Công thức hook, cấu trúc kịch bản, CTA theo mục tiêu |
| `31-channel-specs.md` | phòng sản xuất, video_review | Thông số từng kênh (kiểm tra lại định kỳ) |
| `40-video-production.md` | video, video_review | Shot list, nhịp dựng, phụ đề SRT |
| `41-visual-design.md` | designer, video_review | Thumbnail, ảnh bìa, vùng an toàn |
| `50-review-checklists.md` | script_review, video_review | Checklist Duyệt 1 / Duyệt 2, mức độ lỗi |
| `60-metrics-insight.md` | analyst, planner | Định nghĩa chỉ số, công thức, mẫu giả thuyết & thử nghiệm |
| `70-enzy-ads-report.md` | analyst, planner, manager | Định nghĩa số liệu quảng cáo Enzy (Chi, Lead, Đơn Pancake, NS/DT, ROAS, CPA mục tiêu), quy tắc đánh giá |

## Viết skill tốt
- Ngắn, dạng checklist/bảng; mỗi file nên dưới ~3.000 ký tự (mỗi agent nạp tối đa ~14.000 ký tự skill, quá thì cắt bớt file có `order` lớn).
- Viết điều agent **phải làm / không được làm**, kèm ví dụ ngắn. Tránh lặp lại prompt của agent.
- Số liệu thay đổi theo thời gian (thông số nền tảng, benchmark) ghi kèm ngày cập nhật.
