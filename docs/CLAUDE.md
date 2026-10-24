# CLAUDE.md — DEMO-agency-office

Ghi chú ngắn để phiên Claude sau nắm bối cảnh nhanh. Chi tiết: [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) (kiến trúc, lịch sử) · [HARNESS_REVIEW.md](HARNESS_REVIEW.md) (đã làm / đề xuất tiếp). Ảnh chụp ngày 2026-10-24; kiểm tra lại code trước khi hành động.

## Dự án là gì
App Node.js (ESM, không framework, không build) mô phỏng **văn phòng AI cho team content marketing**. CEO (người dùng) giao việc → Content Lead (`#manager`) chia task theo quy trình trong ảnh `images/quy-trinh-van-hanh-team-content.png` → các agent làm, duyệt, sửa → báo cáo HTML vào `reports/`.

Quy trình 9 bước ↔ agent:
| Bước | Agent | Phòng |
|---|---|---|
| 01 Thu thập tín hiệu | `signal` | Phòng insight |
| 02-03 Backlog, ưu tiên, brief | `planner` | Ban điều hành |
| 04 Viết kịch bản | `writer` | Phòng sản xuất |
| 05 Duyệt 1 (Leader) | `script_review` (gate) | Phòng kiểm duyệt |
| 06 Dựng video / thiết kế | `video`, `designer` | Phòng sản xuất |
| 07 Duyệt 2 (người phụ trách) | `video_review` (gate) | Phòng kiểm duyệt |
| 08-09 Đo lường, insight, idea mới | `analyst` | Phòng insight |

## Chạy
- Node 24 qua nvm: shell của Claude có thể không có `node` → `PATH=~/.nvm/versions/node/v24.22.1/bin:$PATH`.
- `npm start` → http://localhost:3000. Không có test script; **không phải git repo** (bản sao lưu trước đợt sửa lớn ở `backups/`).
- Sửa code server xong phải khởi động lại `npm start`. `agents.json`/`workflows.json` sửa qua UI thì áp dụng ngay; sửa tay `rooms` cần khởi động lại.
- **Test an toàn ở MOCK**: đừng chạy thử trên server thật của người dùng (config REAL + CLI sẽ gọi AI thật và tốn lượt). Chép app ra thư mục tạm (bỏ `node_modules` → symlink, bỏ `config.json`/`permissions.json`/`memory.json`), ghi `config.json` = `{"MODE":"MOCK","PORT":3017}` rồi chạy. Thêm `#sua` vào câu lệnh để agent duyệt trả YÊU CẦU SỬA ở vòng đầu (thử vòng sửa).

## Bản đồ file
| File | Vai trò |
|---|---|
| `server.js` | HTTP: `/poll`, `/task` (nhận `files`), `/upload`, `/auth/connect`, agent/config/report routes |
| `orchestrator.js` | Chạy task theo phụ thuộc, khoá theo agent, **vòng duyệt gate** (`runTask`, `exec`, `MAX_REVISE`) |
| `agents.js` / `agents.json` | Định nghĩa agent + `rooms`; prompt, MOCK, `work()` (đưa file đính kèm + phản hồi sửa vào prompt) |
| `routing.js` / `workflows.json` | Định tuyến theo từ khoá (khớp quy trình đầu tiên), `templates()` cho nút mẫu trên UI |
| `access.js` | Quyền đọc/ghi; `grantRead()` = quyền đọc trong phiên cho file đính kèm; chặn agent ghi vào `skills/`, `agents.json`, `workflows.json` |
| `skills.js` / `skills/` | **Skill dùng chung, độc lập với agent**: mỗi file `.md` tự khai báo `agents: [id]` / `["*"]` / `rooms: [phòng]`; nạp vào system prompt (tối đa ~14.000 ký tự/agent, ~4.000 khi trả lời đồng nghiệp) |
| `cli.js` / `llm.js` / `config.js` | Gọi AI qua CLI đã đăng nhập hoặc API key |
| `public/` | UI thuần: bản đồ văn phòng, panel phải, ô giao việc (kéo thả file), dialog cấu hình/agent |
| `uploads/` | File CEO kéo thả, theo ngày (chưa có cơ chế dọn); `uploads/enzy/` = file số liệu Enzy tự động |
| `enzy/` + `enzy.json` | **Báo cáo quảng cáo Enzy tự động** (xem mục riêng bên dưới) |
| `prompt/daily-report-enzy-data-prompt.md` | Prompt cho #analyst viết nhận định báo cáo Enzy ngày/tuần/tháng |

## Cơ chế quan trọng
- **Workflow**: bước = id agent hoặc `{agent, when:[từ khoá không dấu], title}`; mảng lồng = song song. Thứ tự quy trình trong file quyết định ưu tiên khớp. Không khớp → LIVE: Content Lead tự lập kế hoạch bằng AI; MOCK: `signal → planner`.
- **Gate** (`"gate": true`): dòng đầu phải là `KẾT LUẬN: DUYỆT` hoặc `KẾT LUẬN: YÊU CẦU SỬA` (regex `needsRevision`). Yêu cầu sửa → chạy lại các bước sản xuất ngay trước (không phải gate) kèm `ctx.feedback`, rồi duyệt lại; hết vòng vẫn chưa đạt → các bước sau bị `skipped`. Bước sau gate nhận cả bản đã duyệt (`reviewed`).
- **File đính kèm**: `/upload` (header `x-file-name` encodeURIComponent, tối đa 20MB, cần cùng Origin) → `/task {task, files:[id]}` (tối đa 10 file, chỉ nhận đường dẫn trong `uploads/`). File văn bản có trích đoạn 3000 ký tự trong prompt; ảnh dùng được làm `base` cho `make_image`.
- **Phòng**: đúng 4 phòng × 3 chỗ (`ROOM_CAPACITY`), UI xếp theo thứ tự trong `rooms`.
- **Skills** (`skills/`, xem `skills/README.md`): không nằm trong `agents.json` nên thêm/sửa/xoá agent không ảnh hưởng (đã test). Agent mới tự nhận skill `*` + skill theo phòng. Sửa file là áp dụng ngay (cache theo mtime). `01-brand-voice.md` có chỗ **[ĐIỀN]** team cần điền. `file-skill` trong agents.json vẫn hoạt động, cộng thêm sau skill thư mục. Cần kiến thức mới cho team → thêm file vào `skills/`, đừng nhồi vào prompt agent.

## Báo cáo quảng cáo Enzy tự động (2026-10-24)
- Nguồn: https://enzyfood.streamlit.app/ (Streamlit, app thật ở `/~/+/`, có màn hình đăng nhập). `enzy/fetch.js` dùng `playwright-core` + Google Chrome có sẵn (headless, viewport 3600px để AgGrid hiện đủ cột): đăng nhập → Thương hiệu "Enzy" → hệ thống "Facebook Ads" → Khoảng thời gian → bật "So sánh nhiều tài khoản QC" → chọn đúng tài khoản (bấm option đúng tên; gõ tìm sẽ chọn nhầm "Enzy 12"/"Enzy QV2"; tối đa 5 tài khoản) → Cửa hàng → "Tạo báo cáo" → đọc ô chỉ số, AgGrid "Tổng kết theo tài khoản" (iframe `st_aggrid`) và khối code "🤖 Prompt phân tích quảng cáo" (`# TỔNG TÀI KHOẢN`, `# THEO CHIẾN DỊCH`, `# TỪNG ADS` top 100).
- Kỳ: ngày = "Hôm qua (trọn ngày)", tuần = "7 ngày gần nhất (không gồm hôm nay)", tháng = "30 ngày gần nhất (không gồm hôm nay)".
- `enzy/metrics.js`: **số liệu do code tính** (NS/DT = Chi ÷ DT, so với kỳ trước, bảng theo tài khoản, biểu đồ, top/bottom chiến dịch); AI chỉ diễn giải. `enzy/index.js`: lịch (kiểm tra mỗi 30s, mỗi loại tối đa 1 lần/ngày, lỗi thì thử lại sau 1 giờ, server bật muộn vẫn chạy bù), hàng đợi, lưu `data/enzy/<kỳ>/<yyyymmdd>.json` (+ `-raw.txt`), `reports/enzy/<kỳ>/<yyyymmdd>-so-lieu.md`, rồi giao `/analyst` với prompt + file số liệu; số liệu được gắn vào báo cáo HTML qua `opts.appendix` của orchestrator.
- `enzy.json` (quyền 600): URL, **USER/PASS (người dùng tự điền; Claude không nhập mật khẩu)**, BRAND, SYSTEM, STORE, ACCOUNTS, PROMPT, SCHEDULE. Có thể dùng biến môi trường `ENZY_USER`/`ENZY_PASS`. Agent bị chặn đọc/ghi `enzy.json`, `config.json`, `permissions.json`.
- API: `POST /enzy/run {kind}`, `POST /enzy/schedule`, trạng thái nằm trong `/poll` (`enzy`). UI: khung "Báo cáo quảng cáo Enzy tự động" ở cột phải (nút chạy ngay, ⏰ lịch).
- Thử không cần trang thật: `ENZY_FAKE_RAW=<file json dữ liệu thô> ENZY_USER=x ENZY_PASS=x node server.js` trên bản sao MOCK.
- Trang thay đổi giao diện → sửa selector trong `enzy/fetch.js`; lỗi hiện ở khung Enzy và nhật ký.

## Kết nối CLI (không cần API key)
- `MODE=REAL` + `CONNECTION=CLI` → spawn CLI trong thư mục tạm, prompt qua stdin, xoá `*_API_KEY` khỏi env.
- Nút **Đăng nhập / xác thực** → `POST /auth/connect` → `detect` (`--version`) + `authStatus` (`claude auth status` / `codex login status`); thành công thì **ghi đè** config sang provider đó — đừng gọi thử khi người dùng chưa muốn đổi.
- Claude CLI: `~/.local/bin/claude`. Codex: bản trong `/Applications/ChatGPT.app/.../codex`.
- **Phiên đăng nhập Claude desktop app không dùng chung với Claude CLI**; CLI phải `claude auth login` riêng (OAuth trình duyệt → dán mã vào terminal). File `claude` trong `~/Library/Application Support/Claude/claude-code-vm/` là bản Linux nội bộ của app.
- Kiểm tra nhanh bằng code của app:
  ```bash
  PATH=~/.nvm/versions/node/v24.22.1/bin:$PATH node -e "import('./cli.js').then(async m=>{for(const [p,c] of [['claude','claude'],['gpt','codex']])console.log(c,m.resolveCommand(c),m.detect(c),await m.authStatus(p,c))})"
  ```

## Việc còn mở (2026-10-24)
- Claude CLI đã cài nhưng chưa đăng nhập xong. `images/code.md` chứa mã đăng nhập dán nhầm vào file → nên xoá.
- `SOURCE_DIR` trong `config.json` và đường dẫn trong `permissions.json` trỏ tới `/Users/phamvannam/...` (máy khác).
- Chưa thử bộ agent mới với AI thật (mới test MOCK). Báo cáo Enzy: chưa chạy với trang thật vì chưa có USER/PASS trong `enzy.json`; lịch tự động đang tắt. `skills/01-brand-voice.md` chưa được điền thông tin thương hiệu. Đề xuất harness còn lại: xem `HARNESS_REVIEW.md`.

## Quy ước
- `config.json` chứa API key (quyền 600): **không bao giờ** in nguyên file; chỉ đọc trường không bí mật hoặc che key. Không in/dán OAuth token, mã đăng nhập.
- Giữ tách bạch model API (`MODELS`) và model CLI (`CLI_MODELS`).
- Giữ cơ chế xin quyền file của `access.js`; hỏi trước khi nới lỏng.
- Không phải git repo: sao lưu file vào `backups/<mô-tả>-<ngày>/` trước khi sửa lớn.
- Code/comment theo phong cách hiện có: comment tiếng Việt, ngắn; prompt agent tiếng Việt.
- Sau khi sửa: chạy `node --check`, test MOCK ở cổng riêng, nói rõ đã thử AI thật hay chưa.
