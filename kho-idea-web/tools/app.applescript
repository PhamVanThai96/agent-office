-- Kho Idea Enzy: bấm để mở web Kho Idea trên máy (tự khởi động nếu đang tắt).
property ctl : "/Users/mac/Documents/CODE-AI-AGENT/DEMO-agency-office/kho-idea-web/tools/app-control.sh"
property siteURL : "http://localhost:3200"

on run
	set runState to do shell script quoted form of ctl & " status"
	if runState is "RUNNING" then
		set r to display dialog "Kho Idea Enzy đang chạy." & return & "Tự mở web sau 5 giây." with title "Kho Idea Enzy" buttons {"Tắt web", "Khởi động lại", "Mở web"} default button "Mở web" giving up after 5 with icon note
		set b to button returned of r
		if b is "Tắt web" then
			do shell script quoted form of ctl & " stop"
			display notification "Đã tắt web. Lịch 9h30 và 14h30 sẽ không chạy được cho tới khi mở lại." with title "Kho Idea Enzy"
			return
		else if b is "Khởi động lại" then
			display notification "Đang khởi động lại…" with title "Kho Idea Enzy"
			startSite("restart")
		end if
	else
		display notification "Đang khởi động web…" with title "Kho Idea Enzy"
		startSite("start")
	end if
	open location siteURL
end run

on startSite(cmd)
	set ctlOut to do shell script quoted form of ctl & " " & cmd & " 2>&1; true"
	if ctlOut contains "NO_NODE" then
		display dialog "Máy chưa có Node.js (bản 22.13 trở lên). Tải tại nodejs.org rồi mở lại." with title "Kho Idea Enzy" buttons {"OK"} with icon stop
		error number -128
	else if ctlOut contains "NO_ENV" then
		display dialog "Thiếu file cấu hình data/may-nay.env trong thư mục kho-idea-web." with title "Kho Idea Enzy" buttons {"OK"} with icon stop
		error number -128
	else if ctlOut contains "NO_START" then
		display dialog "Web chưa khởi động được. Xem lỗi trong kho-idea-web/data/server.log." with title "Kho Idea Enzy" buttons {"OK"} with icon stop
		error number -128
	end if
end startSite
