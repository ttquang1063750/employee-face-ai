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
- [ ] Log rotation / giới hạn dung lượng cho `backend.log`, `frontend.log`, `logs/` (ảnh audit chấm công)

## Chất lượng code

- [x] Kiểm tra `RealtimeService` inject trong `dashboard.ts` có thực sự được dùng không, dọn nếu là dead code
- [ ] Style cho `.err-text` / `.retry-btn` trong dashboard error-state (hiện chưa có CSS)
- [ ] Rà soát test coverage frontend (Vitest) — hiện rất mỏng, dễ regression khi refactor tiếp
- [ ] Audit các trang admin khác (employee-list, employee-detail, leave-requests) xem có widget/logic lặp lại giống dashboard trước khi refactor không
