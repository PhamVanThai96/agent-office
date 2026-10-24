## Cai dat Node.js - MACOS
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash

\. "$HOME/.nvm/nvm.sh"

nvm install 24

node -v

nvm -v

## Cấu hình lần đầu
Các file chứa khoá/mật khẩu không có trong repo. Tạo từ file mẫu rồi điền:

```bash
cp config.example.json config.json
cp enzy.example.json enzy.json
npm install
```

- `config.json`: chế độ MOCK/REAL, kết nối API (key) hoặc CLI (claude/codex đã đăng nhập).
- `enzy.json`: tài khoản trang báo cáo Enzy (USER/PASS), danh sách tài khoản QC, lịch chạy báo cáo tự động. Báo cáo Enzy cần Google Chrome cài trên máy.

## Chạy

```bash
cd /home/worker/DEMO-agency-office
npm start            # chế độ MOCK (không cần API key)
# mở http://localhost:3000
```

## Dùng CLI đã đăng nhập (không cần API key) REAL MODE

Server gọi trực tiếp `claude` / `codex` / `gemini` đã đăng nhập trên máy bạn.

1. Cài và đăng nhập một lần: `claude auth login` (hoặc chạy `claude`), `codex login`, hoặc chạy `gemini` rồi đăng nhập Google.
2. Kiểm tra: `claude --version` (hoặc `codex --version`, `gemini --version`) chạy được trong terminal.
3. Trong `config.json`: `"MODE": "REAL"`, `"CONNECTION": "CLI"`, `"AI_PROVIDER": "claude"`. Nếu lệnh không nằm trong PATH, đặt `"CLI": {"claude": "/đường/dẫn/claude"}`.
4. Khởi động lại `npm start`; dòng trạng thái hiển thị `CLI claude/...`. CLI không tìm thấy thì tự dùng MOCK và báo lý do.

Trong hộp **Cấu hình AI**, chọn **Claude** hoặc **GPT (Codex)** rồi bấm **Đăng nhập / xác thực** để kiểm tra phiên CLI trên máy đang chạy server. Nếu đã đăng nhập, ứng dụng tự chuyển sang `REAL` + `CLI`; nếu chưa, chạy `claude auth login` hoặc `codex login` trong terminal của máy đó rồi bấm lại. Nút này không lấy hay lưu access token.

Với Codex CLI, để trống trường Model để Codex tự chọn model mặc định tương thích với phiên bản CLI và tài khoản. Model API như `gpt-4o` sẽ được bỏ qua trong cấu hình CLI.

Lưu ý:
- Biến `*_API_KEY` bị gỡ khi gọi CLI để dùng đúng tài khoản đăng nhập.
- Mỗi lần gọi là một tiến trình mới trong thư mục tạm rỗng, chậm hơn API; công cụ `read_file`/`list_dir` được gọi qua giao thức văn bản (JSON) và vẫn qua hộp xác nhận quyền.
- Tính năng chỉ kiểm thử với CLI giả lập, **chưa thử với CLI thật**; cờ dòng lệnh có thể khác theo phiên bản.
- Điều khoản dịch vụ của nhà cung cấp về việc tự động hoá gói thuê bao chưa được xác minh; hãy tự kiểm tra.

## Sử dụng
1. Nhập yêu cầu vào ô "Ra lệnh cho Quản Lí…" rồi bấm **Giao**. Agent Quản Lí lập kế hoạch, chia task cho các agent; các agent bàn giao/hỏi đáp lẫn nhau và báo cáo về Quản Lí. Quản Lí gửi báo cáo cuối cho CEO ở khung "Báo cáo gửi CEO".
2. Muốn giao thẳng cho một agent, thêm `/id` đầu câu, ví dụ `/writer viết caption Facebook cho son môi mới` (id mặc định: manager, planner, signal, analyst, writer, video, designer, script_review, video_review). Kéo thả file (brief, kịch bản, CSV chỉ số, logo…) vào trang để đính kèm; bấm nút mẫu phía trên ô nhập để chọn nhanh quy trình.
3. Quan sát đường nối giữa các agent để biết ai đang nói chuyện với ai; xem chú giải màu ở đầu trang và chi tiết ở [docs/SOCIAL-COLLAB-LOOP.md](docs/SOCIAL-COLLAB-LOOP.md). Mỗi lần chỉ chạy một yêu cầu.

**Lưu ý:** phải mở trang do `npm start` phục vụ (kể cả qua proxy cổng của code-server). Mở file `index.html` trực tiếp hoặc bằng server tĩnh khác (Live Server, `python -m http.server`) sẽ báo "Unsupported method POST" và văn phòng trống.
