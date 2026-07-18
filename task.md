# Task Checklist — Cải thiện/nâng cấp hệ thống

Quy trình: làm từng mục một, hỏi xác nhận trước khi chuyển sang mục tiếp theo.

## Đã hoàn thành

- [x] `server.py`: chuyển `HTTPServer` → `ThreadingHTTPServer` + lock quanh các lời gọi DeepFace (tránh check-in chặn toàn bộ server)
- [x] Dashboard: tách widget/chart/logs-table thành component riêng, thêm loading skeleton
- [x] Dashboard: sửa "CHẤM CÔNG HÔM NAY" luôn cố định ngày hôm nay, giờ theo đúng khoảng ngày đã chọn
- [x] Dashboard: sửa widget "Chỉ số hạnh phúc" hiển thị sai (0%/Rất thấp) khi chưa có dữ liệu
- [x] Mobile filter bar bị dồn về bên phải trên `_hud-form.scss`
- [x] Benchmark chứng minh hiệu năng chấm công không suy giảm đáng kể tới 500 nhân viên (`benchmarks/`)
- [x] `docker-compose.yml`: bỏ `version` field lỗi thời
- [x] `start.sh`: bỏ dòng export CUDA_VISIBLE_DEVICES thừa

## Bảo mật

- [x] Hash mật khẩu (hiện đang lưu plaintext) — cả bảng `employees` và luồng login/create/update liên quan
- [x] Rate-limit cho `POST /api/login` để chống brute-force
- [x] Giới hạn kích thước ảnh upload/base64 trước khi ghi file & đưa vào DeepFace (chặn ảnh quá khổ)

## Hiệu năng / Vận hành

- [x] Thống nhất `detector_backend` giữa luồng đăng ký (duplicate-check) và luồng chấm công — hiện dùng 2 backend khác nhau (`opencv` vs `retinaface`) nên duy trì 2 cache `.pkl` riêng, tốn gấp đôi công tính embedding
- [x] Log rotation / giới hạn dung lượng cho `backend.log`, `frontend.log`, `logs/` (ảnh audit chấm công)

## Chất lượng code

- [x] Kiểm tra `RealtimeService` inject trong `dashboard.ts` có thực sự được dùng không, dọn nếu là dead code
- [x] Style cho `.err-text` / `.retry-btn` trong dashboard error-state (hiện chưa có CSS)
- [x] Rà soát test coverage frontend (Vitest) — hiện rất mỏng, dễ regression khi refactor tiếp
- [x] Audit các trang admin khác (employee-list, employee-detail, leave-requests) xem có widget/logic lặp lại giống dashboard trước khi refactor không

## Từ audit các trang admin (mức cao)

- [ ] `leave-requests.ts`: bỏ vòng polling riêng (setInterval trùng với `RealtimeService` đã tự poll cùng endpoint) — chỉ đọc `realtimeService.pendingLeaveCount()`
- [ ] `leave-requests.ts`: bỏ import `dashboard.scss`/`employee-list.scss` để "mượn" style bảng/pagination — tách thành style/component dùng chung thay vì khớp nối chéo 3 trang
- [ ] `employee-detail.ts`: sửa bug `workingHours` — check-in cuối ngày không có check-out bị bỏ qua âm thầm, check-in trùng lặp ghi đè nhau, không có guard chống số giờ âm khi check-out sớm hơn check-in
- [ ] `employee-list.ts`: import `EmployeeBase` từ `core/models/employee.model.ts` thay vì định nghĩa lại
- [ ] `employee-list.ts`: dọn `triggerFileInput()` chết/hỏng (gọi sai id) + bỏ `onclick` thô trong template, thống nhất qua Angular binding

## Từ audit các trang admin (mức trung bình)

- [ ] Thống nhất `.hud-pagination`/error-state dùng `_hud-form.scss` ở cả 3 trang (đang tự định nghĩa lại cục bộ, dễ lệch style)
- [ ] `employee-detail.ts`: các ngày mặc định (thêm chức vụ/lương/dự án, bộ lọc chấm công) chỉ tính 1 lần lúc tải trang — cần tính lại mỗi lần mở modal/áp dụng filter
- [ ] `employee-detail.ts`: tách bớt full-page spinner khi reload sau khi lưu (hiện y hệt lần tải đầu, giật cục không cần thiết)
- [ ] `leave-requests.ts`: import `LeaveRequest` từ `core/models/leave-request.model.ts` thay vì định nghĩa lại; thêm xử lý lỗi cho polling nền (hiện im lặng khi fail)
- [ ] Cân nhắc tách `employee-detail.ts` (2151 dòng) thành các component nhỏ: attendance-summary, positions-timeline, income-history, skills-panel, projects-panel, base-profile-modal
