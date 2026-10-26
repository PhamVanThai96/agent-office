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

## Chạy trên máy Mac khác

Chỉ cần cài **Node.js 20+** (https://nodejs.org). Sau đó bấm đúp `Khoi dong Agent Office.command` (hoặc `npm install && npm start`); không có đường dẫn nào cố định theo máy.

- File bí mật/dữ liệu **không nằm trong git** (`config.json`, `enzy.json`, `permissions.json`, `memory.json`, `data/` gồm `data/admin.json`, `uploads/`, `reports/`): trên máy mới hãy `cp config.example.json config.json` và `cp enzy.example.json enzy.json`, rồi nhập khoá/tài khoản ở giao diện (⚙ Cấu hình) và tạo lại Admin (🔐 hoặc `node scripts/set-admin.mjs`).
- Lấy số liệu Enzy dùng **Google Chrome** có sẵn trên máy (cài Chrome nếu chưa có).
- Dùng AI bằng CLI (claude/codex đã đăng nhập sẵn trên máy đó) hoặc API (điền khoá ở ⚙ Cấu hình).
- **Tuỳ chọn – transcript video** (công cụ `video_transcribe`): chạy một lần `bash scripts/setup-media.sh` (cần Python 3.9+, tải ~100MB thư viện; mô hình Whisper ~480MB tự tải ở lần dùng đầu). Không cài thì mọi tính năng khác vẫn chạy bình thường.

## Chạy nhanh trên Mac (không cần gõ lệnh)

Mở thư mục dự án trong Finder rồi **bấm đúp `Khoi dong Agent Office.command`**. File này tự làm hết, không phụ thuộc đường dẫn nên chép thư mục sang Mac nào cũng chạy:

1. Tìm Node.js trên máy (PATH, nvm, Homebrew, Volta, fnm); chưa có thì hiện hộp thoại mở trang tải (cần Node 20 trở lên, khuyên dùng bản mới nhất).
2. Cài thư viện lần đầu (`npm install`, cần Internet); tự cài lại khi `package-lock.json` đổi hoặc khi chép từ Mac khác kiến trúc (Intel ↔ Apple Silicon).
3. Nếu server đã chạy sẵn thì chỉ mở trình duyệt; cổng 3000 bận thì tự dùng cổng kế tiếp.
4. Mở trình duyệt tới địa chỉ đúng và giữ máy không ngủ khi đang chạy (để báo cáo tự động chạy đúng giờ).

Giữ cửa sổ Terminal mở khi dùng; đóng cửa sổ hoặc nhấn Ctrl+C để dừng. Các file khác:
- `Dung Agent Office.command`: dừng server đang chạy từ thư mục này.
- `Tao ung dung Agent Office.command`: tạo `Agent Office.app` ở `~/Applications` (hoặc thư mục bạn truyền vào) để kéo vào Dock; di chuyển thư mục dự án thì chạy lại file này.

Lần đầu mở file tải từ Internet/AirDrop/zip, macOS có thể chặn: chuột phải file → **Mở** → Mở, hoặc chạy một lần `xattr -dr com.apple.quarantine "<thư mục dự án>"`. Nếu file mất quyền chạy: `chmod +x *.command`.

Chạy bằng lệnh (cách cũ, mọi hệ điều hành):

```bash
cd <thư mục dự án>
npm start            # chế độ MOCK (không cần API key)
# mở http://localhost:3000 (nếu cổng bận, xem địa chỉ in ra ở dòng "Agent Office: …")
```

## Dùng CLI đã đăng nhập (không cần API key) REAL MODE

## Install claude cli command

`curl -fsSL https://claude.ai/install.sh | bash`

or command in MacOS

`brew install --cask claude-code`


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
