# Kho Idea Enzy — website độc lập

Web xem và duyệt idea content của team Enzy.

- **Admin** (bạn): thêm, sửa, xoá, duyệt / không duyệt (kèm góp ý) idea; tạo, khoá, xoá tài khoản nhân viên; đặt lại mật khẩu.
- **Nhân viên**: đăng nhập bằng tài khoản riêng và **chỉ xem** (lọc theo sản phẩm, dạng content, người phát ngôn; chép bảng sang Google Sheet).
- **Agent tự động** (lịch 9h30 trong Claude app): đưa idea mới vào mục *Chờ duyệt* bằng `AGENT_TOKEN`, không sửa hay xoá được gì.

Không cần thư viện ngoài, chỉ cần Node ≥ 22.13. Dữ liệu (idea, tài khoản) lưu trong file SQLite ở thư mục `DATA_DIR`.

## Biến môi trường

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `ADMIN_USERNAME` | lần đầu | Tên đăng nhập admin (a-z, 0-9, `.` `_` `-`). Chỉ dùng để tạo admin khi chưa có admin nào. |
| `ADMIN_PASSWORD` | lần đầu | Mật khẩu admin, tối thiểu 8 ký tự. Đổi được trong web sau khi đăng nhập. |
| `AGENT_TOKEN` | nên có | Chuỗi ngẫu nhiên ≥ 24 ký tự để agent tự động đưa idea lên. Giữ bí mật. |
| `DATA_DIR` | trên cloud | Thư mục lưu dữ liệu, phải là **ổ lưu trữ bền** (volume). Dockerfile đặt sẵn `/data`. |
| `NODE_ENV` | trên cloud | `production` (Dockerfile đặt sẵn) — bật cookie Secure/HTTPS. |
| `PORT` | tự có | Cloud tự đặt. |

Tạo `AGENT_TOKEN` ngẫu nhiên:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Đưa lên Railway (chạy 24/7, khoảng 5 USD/tháng)

1. Đăng nhập https://railway.com bằng GitHub → **New Project** → **Deploy from GitHub repo** → chọn repo `agent-office`.
2. Mở service vừa tạo → **Settings** → **Root Directory** = `kho-idea-web` (Railway tự nhận `Dockerfile`).
3. **Settings → Volumes → Add Volume**, Mount path = `/data` (để idea và tài khoản không mất khi deploy lại).
4. **Variables**: thêm `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `AGENT_TOKEN`.
5. **Settings → Networking → Generate Domain** → được link dạng `https://kho-idea-xxxx.up.railway.app`. Muốn dùng tên miền riêng (vd `idea.enzy.vn`) thì thêm Custom Domain và trỏ CNAME theo hướng dẫn của Railway.
6. Mở link, đăng nhập admin → **Tài khoản** → tạo tài khoản cho từng nhân viên (quyền *Nhân viên*), gửi riêng tên đăng nhập + mật khẩu cho họ.
7. Chuyển idea cũ sang: **Nhập từ bảng** → dán nội dung file `data/y-tuong-tu-trang-cu.json` (trên máy, không có trong git) → **Nhập**.

### Hoặc Render

New → **Web Service** → repo `agent-office`, Root Directory `kho-idea-web`, Runtime **Docker**, gói **Starter** (gói Free không có ổ lưu trữ, dữ liệu sẽ mất). Thêm **Disk** mount `/data`, và các biến môi trường như trên.

## Chạy thử trên máy

```bash
cd kho-idea-web
ADMIN_USERNAME=admin ADMIN_PASSWORD='mat-khau-tam-thoi' AGENT_TOKEN='chuoi-ngau-nhien-du-24-ky-tu' npm start
```

Mở http://localhost:3200.

## API cho agent tự động

- `GET /api/ideas?from=YYYY-MM-DD` — danh sách idea (kèm `duyet`, `gopY` để agent học góp ý).
- `POST /api/ideas` — body `{"ideas": [ ... ]}` (tối đa 50), mỗi idea gồm `day`, `sanPham`, `thoiGian`, `loai`, `mucTieu`, `idea`, `nguoiPhatNgon`, `soLuong`, `linkMau`, `why`. Idea của agent luôn vào *Chờ duyệt*.

Gửi kèm header `Authorization: Bearer <AGENT_TOKEN>`.

## Bảo mật

- Mật khẩu băm bằng scrypt; phiên đăng nhập lưu dạng băm, cookie HttpOnly + SameSite, Secure trên HTTPS.
- Sai mật khẩu 8 lần trong 15 phút thì tạm khoá đăng nhập theo IP + tài khoản.
- Quyền kiểm tra ở máy chủ: tài khoản nhân viên gọi API sửa/xoá/duyệt đều bị từ chối (403).
- Repo đang công khai: không commit mật khẩu, token hay thư mục `data/`.
