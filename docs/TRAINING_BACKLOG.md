# Đào tạo từ content WIN — ghi chú & sub-tasks (cập nhật 24/10/2026)

Nguồn: `docs/Tổng hợp bài quảng cáo - page Hạt nêm chay - Hạt Nêm Chay.csv` (1.268 dòng; cột WIN: 91 dòng đánh X, 89 có link Facebook). Dữ liệu thô/đã phân tích nằm ở `data/win-training/` (không đưa vào git), script ở `scripts/win-training/`.

## Đã làm (đợt 1 = 1/4 content win mạnh nhất, 23 content)
- Mở từng link Facebook công khai (không đăng nhập) bằng Chrome ẩn danh: lấy chữ mô tả, cảm xúc/bình luận/chia sẻ, thời lượng video, ngày đăng (khi trang hiển thị), chụp khung hình tại giây 0/2/5/10/20/40 của 9 video top để đọc chữ trên video và bố cục hình ảnh. Đã thu thập cả 89 link win + 80 link đối chứng (60 content "0", 20 content "XEM XÉT → DỪNG") vào `data/win-training/fb_raw.json`.
- Tính tỷ lệ thắng theo chủ đề/người làm/tháng trên toàn bộ CSV (1.244 dòng có quyết định, tỷ lệ thắng nền 7,3%).
- Kết quả đã đưa vào: skill `skills/05-content-win-enzy.md` (nạp khi yêu cầu có từ khoá content/video/hook/caption/ads/idea…, dành cho planner, writer, video, script_review, video_review) và bài học trong sổ tay agent (writer đã hợp nhất; planner, video, script_review, video_review đang ở "bài học chờ hợp nhất" — tự hợp nhất sau lần chạy tới hoặc bấm "Hợp nhất" trong 🧠 Trí nhớ).

## Phát hiện chính (đợt 1)
1. Content win có trung vị 712 cảm xúc / 222 bình luận / 24 chia sẻ so với 32 / 9 / 1 của content thường; nhiều video 1–8,5 triệu lượt xem. Độ dài caption, emoji, CTA, giọng "Tiến" gần như KHÔNG khác nhau giữa win và thường → yếu tố quyết định nằm ở hook, chủ đề, cấu trúc video và niềm tin (người thật + nhà máy).
2. 6 kiểu hook thắng: phá lầm tưởng; nêu sự phản đối "đắt/giả"; giá trị "làm thật giữ phước"; cảnh báo/tin nóng; gọi đúng đối tượng (bận rộn/ăn chay); ưu đãi cụ thể ngay đầu. "Hạt nêm gì mà đắt thế?" tạo nhiều bình luận nhất (17,7K bình luận / 10K cảm xúc).
3. Video thắng 45–110s (đa số 60–90s): chữ hook lớn → người mặc đồng phục Enzy trong nhà máy cầm sản phẩm → cận nguyên liệu → cảnh dùng thật → chữ kết quả → CTA; mỗi cảnh ≤3 giây; unbox và người ăn thật cũng thắng.
4. Chủ đề có tỷ lệ thắng cao: tăng giá/gồng giá 22%, bỏ/không mì chính 21%, hàng giả 20%, unbox 20%, khác biệt/không lừa/giữ phước 20%; dịp 30/4 35%, Vu Lan–2/9 25%, Noel 22%, 8/3 18%; Tết chỉ 9%; hạt nêm chay 11% > bánh 9% > rắc cơm 6%; "cho bé/ăn dặm" 5%. Người làm: GIAO 16%, THUÝ 10%, các người khác 6–9%.
5. Bài win hơi thiên về thứ Bảy/thứ Hai (tín hiệu yếu).

## Giới hạn dữ liệu (cần biết trước khi tin kết luận)
- Không đăng nhập Facebook nên: không nghe được lời thoại video, không biết GIỜ đăng, một số bài ẩn/xoá không mở được (2 link win lỗi, 2 dòng win không có link), lượt xem không hiển thị cho nhiều reel; chỉ thấy khung hình khi đóng hộp thoại mời đăng nhập (chỉ đóng cửa sổ nhắc, không đăng nhập).
- Năm đăng của nhiều dòng được SUY RA từ thứ tự trong CSV (cột ngày chỉ có ngày/tháng) — kiểm tra lại nếu cần phân tích theo năm.
- "WIN" trong CSV là đánh giá nội bộ (lead rẻ + chuyển đổi tốt), không phải số liệu Facebook; tương tác Facebook chỉ là chỉ báo phụ. Chưa đối chiếu với CPA/ROAS thật của từng content.
- Caption lấy từ trang công khai có thể bị cắt ("Xem thêm"); với nhiều reel chỉ lấy được tiêu đề ngắn.

## Việc còn dang dở (làm tiếp theo thứ tự)
- [ ] **Đợt 2 (23 content, hạng 24–46 theo cảm xúc):** đọc caption đầy đủ + chụp khung hình video; bổ sung vào skill `05` mục hook/cấu trúc; thêm bài học cho agent. Danh sách: `data/win-training/batches.json` (khoá `batches[1]`).
- [ ] **Đợt 3 (hạng 47–69):** chủ yếu bài sale theo dịp (30/4, Tết, 8/3, Vu Lan…), nhiều ảnh/ít dữ liệu → so sánh cấu trúc ưu đãi (mua 2 tặng 1, freeship, đếm ngược), ảnh sản phẩm/banner.
- [ ] **Đợt 4 (hạng 70–89) + 2 link lỗi + 2 dòng không có link:** thử mở lại link lỗi, hỏi người làm nếu bài đã xoá.
- [ ] **Đối chứng sâu:** so sánh win với 80 content đối chứng đã thu thập (hook, cấu trúc, chủ đề) để loại các yếu tố "giống nhau ở cả hai nhóm"; mở rộng đối chứng nếu cần (mẫu hiện 60 + 20).
- [ ] **Gắn dữ liệu quảng cáo thật:** nối cột "ID Bài Quảng cáo" với báo cáo Enzy (CPA, tỷ lệ chốt, doanh thu) để xác nhận yếu tố nào tạo ĐƠN chứ không chỉ tương tác.
- [ ] **Lời thoại & giờ đăng:** nếu CEO cung cấp file video/phụ đề hoặc xuất dữ liệu Meta (giờ đăng, thời gian xem TB, giữ chân), phân tích thêm; hoặc đăng nhập tài khoản Facebook của team khi muốn app đọc thêm (cần người dùng tự đăng nhập).
- [ ] **Hợp nhất sổ tay:** bấm "Hợp nhất" cho planner, video, script_review, video_review (🧠 Trí nhớ & kỹ năng agent) để bài học đợt 1 vào sổ tay chính thức.
- [ ] **Kiểm thử đầu ra:** cho writer/planner làm 1 kịch bản + 1 brief mới theo skill `05` rồi so với content win thật.
- [ ] **Cập nhật kỹ năng định kỳ:** lặp lại quy trình khi có thêm content win mới (dòng X mới trong CSV).

## Cách chạy tiếp (script)
```bash
# 1) thu thập trang Facebook công khai (đọc data/win-training/crawl_list.json, ghi fb_raw.json; chạy lại chỉ tải mục lỗi)
node scripts/win-training/crawl.mjs
# 2) phân tích thô → data/win-training/parsed.json
python3 scripts/win-training/parse.py
# 3) khung hình video (đọc data/win-training/top_videos.json; ghi data/win-training/frames/vN.jpg)
node scripts/win-training/frames.mjs
```
Muốn đợt 2: tạo `top_videos.json` từ `batches.json` (khoá `batches[1]`), chạy bước 3 rồi xem ảnh và đối chiếu caption trong `parsed.json`.

## Danh sách đợt 1 (đã đào tạo)
  - HNC BỎ MÌ CHÍNH ( THẢO ) (THẢO, 20,800 cảm xúc) https://www.facebook.com/reel/837632362413282
  - GVRC BẬN RỘN ( LOAN ) (LOAN, 16,000 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/1525803205046303/#
  - HNC 6.9 FIX 20.10 NGÀY THƯỜNG ( LOAN ) (LOAN, 12,000 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/3076985809166836/#
  - GVRC UNBOX ( LOAN ) (LOAN, 11,000 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/3897752563831555/#
  - HNC ĐẮT ( LOAN ) (LOAN, 10,000 cảm xúc) https://www.facebook.com/122171506478306664
  - HNC GIỮ PHƯỚC ( LOAN ) (LOAN, 10,000 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/1027440472874025/#
  - HNC TRƯỜNG CHAY (KHÁC, 9,700 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/1744678572726311/
  - GVRC ĂN CHAY (KHÁC, 9,600 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/589596656775961
  - GVRC CÓ BỮA ĂN ( LOAN ) (LOAN, 9,300 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/683673297780541/#
  - HNC GỒNG GIÁ (LOAN) (LOAN, 7,500 cảm xúc) https://www.facebook.com/reel/1712796193044357
  - GVRC CHO BÉ ( LOAN ) (LOAN, 6,300 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/649561947998590/#
  - GVRC STAC REVIEW (LOAN, 5,700 cảm xúc) https://www.facebook.com/reel/831488019487664
  - HNC TIẾN TẬP ĂN CHAY (KHÁC, 5,200 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/27925132110433860/
  - GVRC VĂN PHÒNG ( LOAN ) (LOAN, 4,500 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/1452421806176923/#
  - 13.05_HNC VỪA VUI KHOẺ (LOAN) (LOAN, 4,200 cảm xúc) https://www.facebook.com/reel/1276222221299825/#
  - HNC BỎ MÌ CHÍNH ID MỚI ( THẢO ) (KHÁC, 3,800 cảm xúc) https://www.facebook.com/reel/1531798817809497
  - HNC UNBOX ( LOAN ) (LOAN, 3,200 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/1841542993268076/#
  - 13.08_HNC TẠI SAO ĐẮT (TRÂN) (TRÂN, 3,100 cảm xúc) https://www.facebook.com/reel/2063914854515977
  - GVRC COMBO 3 HỘP ( LOAN ) (LOAN, 2,400 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/1465686417810139/#
  - HNC 6 TUỔI FIX (LOAN) (LOAN, 2,300 cảm xúc) https://www.facebook.com/reel/1315063550763336
  - 18.09_HNC ĐỪNG MUA_M2T1 (NGA) (NGA, 2,200 cảm xúc) https://www.facebook.com/reel/1604006614770044
  - GVRC ĐỦ CHẤT ( THẢO ) (THẢO, 1,700 cảm xúc) https://www.facebook.com/reel/1343506330771281
  - HNC VÙNG NGUYÊN LIỆU (KHÁC, 1,600 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/1841495133355862/#

## Danh sách đợt 2 (kế tiếp)
  - BÁNH 1 GÓI ( LOAN ) (LOAN, 1,300 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/1424320358987361/#
  - HNC ĐẮT 2 ( THÚY ) (THUÝ, 1,300 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/1347734260040451/#
  - GVRC TIỆN LỢI KOL STAC ( THẢO ) (THẢO, 1,200 cảm xúc) https://www.facebook.com/reel/1841359106750300
  - 12.10_HNC ƯU ĐÃI CHỊ ĐẸP_20.10 (NGA) (NGA, 1,200 cảm xúc) https://www.facebook.com/reel/1419149957063024
  - 11.7_GVRC HẠN CHẾ DẦU MỠ (TRÂN) (TRÂN, 1,100 cảm xúc) https://www.facebook.com/reel/3016318355237284
  - 26.09_HNC KBN ĐẮT (TRÂN) (TRÂN, 1,100 cảm xúc) https://www.facebook.com/reel/4514545302166097/#
  - 13.10_HNC UI SALE CHẤN ĐỘNG 20.10 (TRÂN) (TRÂN, 1,100 cảm xúc) https://www.facebook.com/reel/1445197731045595/#
  - BÁNH SẢN XUẤT ( LOAN ) (LOAN, 1,000 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/1522796969133313/#
  - BÁNH TIỂU ĐƯỜNG ( LOAN ) (LOAN, 1,000 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/1492206922158766/#
  - HNC 30.4 GIẢM GIÁ ( GIAO ) (GIAO, 1,000 cảm xúc) https://www.facebook.com/reel/941283478760767/#
  - 15.09_HNC SALE NHẦM_M2T1 (NGA) (NGA, 1,000 cảm xúc) https://www.facebook.com/reel/2227016414749275
  - HNC HÀNG GIẢ ( HIỀN ) (HIỀN, 968 cảm xúc) https://www.facebook.com/reel/708463578180320/#
  - HNC TĂNG GIÁ ( THUÝ ) (THUÝ, 900 cảm xúc) https://www.facebook.com/reel/908693012173246/#
  - HNC HSD ( THẢO ) (THẢO, 733 cảm xúc) https://www.facebook.com/reel/1278244757560987/#
  - HNC BA VỪA 30.4 ( THÚY ) (THUÝ, 691 cảm xúc) https://www.facebook.com/reel/1490751495992830
  - 10.06_T2_HNC NHẠT_KBN (GIAO) (GIAO, 655 cảm xúc) https://www.facebook.com/reel/27237537172569491
  - 29.6_HNC_ENZY 6 TUỔI (HLAN)_3 (HLAN, 642 cảm xúc) https://www.facebook.com/reel/1528871205389915
  - 22.08_HNC SALE VULAN + 2/9 (4) (TRÂN) (TRÂN, 598 cảm xúc) https://www.facebook.com/reel/1537936614197902
  - 16.09_HNC M2T1 (1) (TRÂN) (TRÂN, 522 cảm xúc) https://www.facebook.com/reel/904209272542557/#
  - BÁNH 10H SÁNG ( LOAN ) (LOAN, 497 cảm xúc) https://www.facebook.com/HatNemChayEnzy/videos/1231267448491358/#
  - 23.5_DAILY_HNC GIỮ PHƯỚC_B (MINH HIỀN) (MINH HIỀN, 494 cảm xúc) https://www.facebook.com/reel/1992199538074748/#
  - GVRC NOEL VÀ TẾT ( THẢO ) (THẢO, 467 cảm xúc) https://www.facebook.com/reel/1391892545921245
  - GVRC IDEAD FB FIX ( HIỀN ) (HIỀN, 461 cảm xúc) https://www.facebook.com/reel/1275438441349249/#
