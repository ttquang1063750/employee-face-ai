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

- [x] `leave-requests.ts`: bỏ vòng polling riêng (setInterval trùng với `RealtimeService` đã tự poll cùng endpoint) — `RealtimeService` giờ là nguồn dữ liệu duy nhất (`leaveRequests` signal + `pendingLeaveCount` computed từ đó), trang chỉ còn 1 lần gọi API riêng cho initial load/error UX. Đồng thời import `LeaveRequest` từ `core/models/leave-request.model.ts` thay vì định nghĩa lại (gộp luôn mục ở dưới vì cùng chỗ sửa)
- [x] `leave-requests.ts`: bỏ import `dashboard.scss`/`employee-list.scss` để "mượn" style bảng/pagination — phát hiện style bảng (`.logs-card`/`.logs-table`...) đã thực sự bị vỡ từ lúc tách dashboard thành component (dashboard.scss không còn các class đó). Đã tự chứa style trong `leave-requests.scss`, thêm `.hud-loading-state`/`.hud-spinner` dùng chung vào `_hud-form.scss`
- [x] `employee-detail.ts`: sửa bug `workingHours` — check-in cuối ngày không có check-out giờ được đánh dấu "⚠️ Chưa tính đủ" thay vì âm thầm bỏ qua; check-in trùng lặp giữ lần đầu tiên (không ghi đè); thêm guard chống số giờ âm khi check-out sớm hơn check-in
- [x] `employee-list.ts`: import `EmployeeBase` từ `core/models/employee.model.ts` thay vì định nghĩa lại
- [x] `employee-list.ts`: dọn `triggerFileInput()` chết/hỏng (gọi sai id) + bỏ `onclick` thô trong template, thống nhất qua Angular binding (`viewChild` + template ref, giống `videoElement`/`canvasElement`)

## Từ audit các trang admin (mức trung bình)

- [ ] Thống nhất `.hud-pagination`/error-state dùng `_hud-form.scss` ở cả 3 trang (đang tự định nghĩa lại cục bộ, dễ lệch style)
- [ ] `employee-detail.ts`: các ngày mặc định (thêm chức vụ/lương/dự án, bộ lọc chấm công) chỉ tính 1 lần lúc tải trang — cần tính lại mỗi lần mở modal/áp dụng filter
- [ ] `employee-detail.ts`: tách bớt full-page spinner khi reload sau khi lưu (hiện y hệt lần tải đầu, giật cục không cần thiết)
- [x] `leave-requests.ts`: import `LeaveRequest` từ model (đã làm ở trên); xử lý lỗi polling nền giờ theo đúng 1 chính sách chung trong `RealtimeService` (im lặng bỏ qua có chủ đích, thay vì thiếu xử lý hoàn toàn như code cũ)
- [ ] Cân nhắc tách `employee-detail.ts` (2151 dòng) thành các component nhỏ: attendance-summary, positions-timeline, income-history, skills-panel, projects-panel, base-profile-modal
