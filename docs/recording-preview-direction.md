# Khôi phục ghi trực tiếp từ camera

Ngày 26/11/2026: chọn phương án B theo yêu cầu người dùng. Tệp giữ chiều camera gốc; người dùng tự lật sau khi tải nếu cần.

## Thay đổi

Khôi phục lời gọi VideoSession.create nhận trực tiếp currentCapture.stream và AudioContext hiện hành, đúng như phiên bản ổn định 7515dac. Xóa recording-video.js và toàn bộ bước Canvas, yêu cầu requestFrame/FPS cùng video tạm. Không thay CSS preview, codec, bitrate, camera constraints, runtime xử lý stereo, Kho Video, Supabase hoặc dữ liệu người dùng.

## Kiểm tra thiết yếu

Kiểm tra bản ghi camera trước/sau ở dọc/ngang, kích thước và cấu hình encoder, âm thanh stereo 48 kHz, xem lại và tệp tải xuống có SHA-256 bằng tệp Kho Video. Bài studio hiện hành kiểm tra preview vẫn lật gương, ghi/dừng/xem lại/tải xuống và Kho Video lưu bản quay. Không chạy benchmark 4K/GPU.

## Giới hạn

Chưa kiểm thử iPhone vật lý. Windows/Chromium không xác nhận chất lượng Safari, âm lượng micro thật hay hiệu năng quay dài trên iPhone. Mã nguồn ghi hình và runtime âm thanh được giữ đúng đường ổn định trước tính năng lật. Cần người dùng quay thử trên iPhone để xác nhận thiết bị thật.

## Khôi phục

Nhánh codex/rollback-camera-preview-20261126 giữ phiên bản ổn định 7515dac03b8c2b11725925b4f877e1296f0b693f. Các commit phát hành đều được giữ trong Git; việc khôi phục mã không chuyển đổi hay xóa video trên thiết bị.
