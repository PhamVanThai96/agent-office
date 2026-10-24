# Skills (YAML)

Mỗi skill là một file `skills/<số>-<tên>.yaml`. Hệ thống đọc lại khi file đổi; agent không có quyền ghi vào thư mục này.

```yaml
id: 03-san-pham-enzy            # định danh
title: Sản phẩm Enzy            # tên hiển thị
summary: Một dòng mô tả skill   # giúp tra cứu nhanh
agents: [planner, writer]       # id agent dùng skill; ["*"] = tất cả
rooms: []                       # (tuỳ chọn) áp dụng theo tên phòng
exclude: [assistant]            # (tuỳ chọn) loại agent khỏi skill
when: [tiktok, reels]           # (tuỳ chọn) chỉ nạp khi yêu cầu có từ khoá không dấu; bỏ trống = luôn nạp
order: 3                        # thứ tự nạp (nhỏ trước)
tags: [sản phẩm, giá]
updated: 2026-10-24
sections:                       # các mục có thể tra cứu riêng
  - id: hat-nem-chay
    title: Hạt nêm chay Enzy
    tags: [giá, thành phần]
    text: |-
      Nội dung (markdown) của mục.
```

- **Nạp vào prompt:** nội dung các mục được ghép lại theo thứ tự (không đổi so với bản .md cũ). Skill có `when` chỉ nạp khi yêu cầu nhắc tới từ khoá.
- **Tra cứu nhanh:** công cụ `skill_search {query}` tìm trong tên, thẻ và nội dung các mục của các skill agent được dùng (kể cả skill chỉ nạp theo ngữ cảnh) và trả về tối đa 3 mục khớp nhất — agent không cần nạp cả skill. Mỗi mục nên ngắn, có tiêu đề và `tags` rõ ràng.
- **File .md cũ** (frontmatter + markdown) vẫn đọc được; chuyển sang YAML bằng `node scripts/convert-skills.mjs` (bản gốc được chuyển vào `backups/skills-md-<ngày>/`).
- Cú pháp YAML hỗ trợ: khoá/giá trị, danh sách `[a, b]` hoặc `- mục`, danh sách đối tượng, khối chữ `|-`, chú thích `#`. Không dùng neo/alias.
- `agents` mới tự nhận skill `*` và skill theo phòng; skill vẫn còn khi xoá agent.
