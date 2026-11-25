# Chiều hình video khớp camera xem trước

Ngày kiểm tra: 26/11/2026. Thiết bị kiểm thử: Chrome trên Windows với camera tổng hợp; không phải Safari/iPhone vật lý.

## Nguyên nhân và phạm vi sửa

Camera trước được hiển thị bằng CSS `scaleX(-1)`, nhưng `VideoSession` nhận pixel camera gốc. CSS không được MediaRecorder ghi vào tệp.

`src/recording-video.js` tạo riêng luồng hình được lật một lần, theo đúng lớp `mirrored` của phần tử xem trước. Canvas dùng kích thước khung camera đã giải mã, không resize/crop; mỗi khung camera được vẽ bằng phép biến đổi nguyên pixel và yêu cầu capture ngay bằng `requestFrame()`. Camera sau truyền nguyên luồng gốc.

Trước khi tạo encoder, một phần tử video tạm chỉ nhận track hình xác nhận khung sinh ra đã sẵn sàng, rồi được giải phóng. Bước này tránh mở encoder âm thanh khi GPU vẫn đang chuẩn bị khung hình đầu tiên; không nối thêm đường xử lý âm thanh.

Bộ ghi, lựa chọn codec, bitrate, AudioContext và bộ xử lý stereo hiện hành trong `public/prompter/runtime.js` không thay đổi. Track micro gốc được truyền cùng luồng hình mới. Luồng hình tạm được giải phóng sau khi encoder hoàn tất, kể cả khi dừng do gián đoạn hoặc lỗi khởi tạo. Gián đoạn camera gốc được chuyển tiếp vào cơ chế khôi phục hiện hành.

Không sửa CSS/giao diện xem trước, tùy chọn người dùng, đường xem lại/tải xuống, quy tắc đặt tên hay quản lý Kho Video. Không chuyển đổi video cũ và không chạy migration/dịch vụ dữ liệu thật.

## Kiểm thử 1 — Camera trước

Khung hình bất đối xứng có chữ LEFT/RIGHT và hai nửa màu khác nhau. Video MP4 thực tế được ghi qua VideoSession, lưu OPFS, mở lại và tải xuống. Pixel trong tệp mới có hướng giống preview được lật gương; SHA-256 tệp tải xuống bằng SHA-256 tệp trong Kho Video. Bài kiểm thử studio hiện hành cũng so sánh toàn bộ khung đã giải mã với hướng preview.

## Kiểm thử 2 — Camera sau

Cùng nguồn hình, encoder và âm thanh, không lật. Tệp MP4 giữ đúng trái/phải. Đường camera sau trả lại đúng đối tượng MediaStream gốc.

## Kiểm thử 3 — Hướng quay

Cả hai camera được thử ở 1080×1920, 1920×1080, 2160×3840 và 3840×2160, trên Chrome desktop và viewport cảm ứng. Kiểm tra chính kích thước video giải mã; không dùng metadata để che việc lật hình.

## Kiểm thử 4 — Chất lượng và khôi phục

- Cấu hình mã hóa giữ 12 Mb/s cho 1080p, 24 Mb/s cho 4K, âm thanh 256 kb/s và tốc độ camera 30 FPS trong nguồn thử.
- Tệp thực tế: H.264/AAC, hai kênh 48 kHz. Tần số 440 Hz bên trái và 880 Hz bên phải được kiểm tra riêng để phát hiện mất/đảo kênh; đường âm thanh không bị thay thế.
- Xung âm thanh và vạch chớp trong hình được tạo cùng thời điểm, rồi đo lại từ tệp đã mã hóa; bài kiểm thử yêu cầu sai lệch dưới 100 ms.
- FFprobe kiểm tra FPS, bitrate thực tế, codec, kích thước, số kênh và thời gian các stream. FPS trung bình của tệp ngắn có dao động; không suy ra FPS thực chỉ từ cấu hình track. Bitrate thực tế của cảnh màu phẳng nhỏ hơn bitrate yêu cầu do mã hóa biến thiên theo nội dung.
- Kiểm thử mất camera, lỗi tạo encoder, giữ track micro gốc, giải phóng track hình tạm và trạng thái bản nháp gián đoạn.
- Kiểm thử hồi quy studio/Kho Video giữ việc xóa có xác nhận, video khôi phục cũ, tên/số lượt quay, hai hướng quay, đếm ngược, lưới, độ phủ và nhắc chữ.

Số đo tại máy kiểm thử, 16 tệp MP4 (8 tổ hợp camera/độ phân giải/hướng × 2 viewport):

| Thông số | Kết quả |
| --- | --- |
| Kích thước giải mã | Đúng toàn bộ bốn kích thước, gồm 4K dọc/ngang |
| FPS trung bình toàn tệp ngắn | 29,04–31,05 FPS |
| FPS đoạn ổn định 0,5–2,5 giây, camera trước desktop | 29,78–29,82 FPS |
| FPS đoạn ổn định, camera sau đối chứng desktop | 29,81–29,83 FPS |
| Codec | H.264 / AAC |
| Âm thanh giải mã | Stereo, 48.000 Hz; đúng tần số riêng từng kênh |
| Sai lệch chớp sáng–âm thanh lớn nhất | 66,7 ms (độ phân giải phép đo hình 33,3 ms) |
| Tệp tải xuống so với Kho Video | Cùng kích thước và SHA-256 |

Kiểm thử nghiệp vụ: 63/63 đạt. Hồi quy trình duyệt cục bộ: 95 đạt, 13 bỏ qua theo cấu hình có sẵn. Kiểm thử camera/studio cục bộ: 24/24 đạt; cả 16 tệp thử trên Windows hoàn tất ở chất lượng gốc. Đồng bộ và các dịch vụ giả lập: 21/21 đạt. Theo phạm vi đã chốt, CI Linux chỉ ghi các ca thiết yếu 1080p; không tiếp tục thử hiệu suất mã hóa 4K trên runner không có GPU. Kiểm tra khả năng giữ kích thước 4K vẫn thực hiện mà không chạy benchmark mã hóa.

## Giới hạn Safari/iPhone

Chưa xác minh iPhone 16 Pro Max vật lý, Photos/Files trên iPhone hoặc CapCut. Chrome với viewport iPhone không thay thế kiểm thử Safari thật. Chưa xác nhận hiệu năng 4K khi quay dài, nhiệt, pin, ánh sáng yếu hay ứng dụng ở nền trên iPhone.

Đường lật hình cần Canvas capture, requestVideoFrameCallback và requestFrame; kiểm tra kích thước/FPS track xuất trước khi mở encoder. Nếu trình duyệt không cung cấp/giữ được thông số yêu cầu, ứng dụng báo lỗi, không tự hạ xuống 1080p, giảm bitrate hoặc ghi camera trước sai chiều. Khả năng API và FPS khai báo không bảo đảm thông lượng mã hóa thực trên mọi thiết bị; cần đo lại tệp Safari trên thiết bị thật để xác nhận toàn bộ điều kiện chất lượng.

Không thêm cơ chế tự dừng theo benchmark FPS hoặc thay đổi kiến trúc encoder. Các thử nghiệm hiệu suất 4K trên runner Linux không GPU đã dừng vì không đại diện thiết bị sử dụng. Cấu hình chất lượng gốc được giữ nguyên; hiệu năng Safari thực tế sẽ được xác nhận bằng bản quay trên iPhone của người dùng.

Bản phát hành sau khi thu hẹp phạm vi: 7/7 kiểm tra thiết yếu cục bộ đạt, gồm tệp camera trước/sau ở hai hướng, hình/tiếng, kích thước và cấu hình chất lượng, studio, gián đoạn và giải phóng tài nguyên. Không chạy thêm vòng benchmark 4K.

## Khôi phục

Phiên bản website trước thay đổi: `7515dac03b8c2b11725925b4f877e1296f0b693f`. Giữ nhánh `codex/rollback-camera-preview-20261126` tại commit này. Có thể khôi phục mã nguồn phiên bản đó và phát hành lại bằng workflow Pages hiện hành; không chuyển đổi hoặc xóa video đã có trên thiết bị.

Tài liệu nền tảng: [WebKit MediaRecorder](https://webkit.org/blog/11353/), [Canvas captureStream](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream), [requestFrame](https://developer.mozilla.org/en-US/docs/Web/API/CanvasCaptureMediaStreamTrack/requestFrame), [requestVideoFrameCallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).

## Chạy lại

`npm test`, `npm run build`, `npm run test:e2e`, `npm run test:sync`. Bài `tests/browser/recording-video.spec.js` lưu từng MP4 và báo cáo JSON trong thư mục kết quả Playwright; Chrome khác máy đặt `PLAYWRIGHT_CHROMIUM_EXECUTABLE` theo bản cài đặt hiện có.
