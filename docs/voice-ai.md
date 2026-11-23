# Ghi âm & biên tập AI

Nút **Ghi âm** có ở kịch bản, tiêu đề và các textarea nhập nội dung (ghi chú, ý tưởng, mô tả nghiên cứu). Đăng nhập Supabase trước khi ghi. Bấm bắt đầu, cấp quyền micro, nói tiếng Việt rồi dừng. Mỗi đoạn tự dừng sau 2 phút hoặc khi ứng dụng chuyển sang nền; tối đa 8 MiB. Sau khi chèn đoạn này, bấm micro để ghi đoạn tiếp theo. Mỗi đoạn là một tệp MediaRecorder hoàn chỉnh, không gửi riêng các timeslice thiếu header.

Chrome ưu tiên WebM/Opus; Safari iPhone dùng MP4/AAC khi trình duyệt hỗ trợ. Tên tệp và Content-Type gửi OpenAI theo container thực tế; không đổi đuôi WebM thành WAV. Bản chép gốc và bản trau chuốt được hiển thị riêng. Có thể chọn một bản, chèn tại con trỏ, thay thế toàn bộ ô (cần xác nhận), hoặc hủy. Chèn không xóa vùng đang chọn. Nội dung đã thay đổi hoặc chuyển tài khoản/hồ sơ sẽ không bị ghi đè bằng kết quả cũ.

Biên tập dùng chỉ dẫn chỉ sửa câu chữ, giữ ý nghĩa, số liệu, tên riêng, luận điểm và trích dẫn, không dùng tools. Kiểm tra bổ sung từ chối các trích dẫn trong dấu ngoặc kép bị thêm/xóa/sửa. Không có bộ kiểm tra tự động nào đảm bảo mọi thay đổi ngữ nghĩa; luôn đọc lại trước khi dùng.

## Hạ tầng và cấu hình

Tái sử dụng backend Node hiện có và `admin.auth.getUser(token)` để xác thực JWT trước khi xử lý âm thanh. Không migration, không bucket Storage, không thay đổi bảng Super Content hoặc Super Day. Vì đã có backend Render, không cần triển khai Edge Function mới. GitHub Pages tiếp tục chỉ chứa frontend.

Biến **trên dịch vụ backend Render Super-Content**:

| Biến | Giá trị / mục đích |
| --- | --- |
| `OPENAI_API_KEY` | Secret dự án OpenAI có quyền dùng hai model; không dùng tiền tố `VITE_` |
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-transcribe` (mặc định) |
| `OPENAI_VOICE_EDIT_MODEL` | `gpt-6.1-terra` (mặc định) |
| `SUPABASE_URL` | Giữ cấu hình hiện có |
| `SUPABASE_SERVICE_ROLE_KEY` | Giữ secret backend hiện có; không đưa vào trình duyệt |
| `RESEARCH_ALLOWED_ORIGINS` | Giữ origin Pages hiện có; CORS dùng origin không có đường dẫn |

Frontend dùng lại Actions variables `VITE_RESEARCH_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Không cần biến frontend mới. `OPENAI_MODEL` hiện có chỉ dành cho nghiên cứu; không đổi model của chức năng đó. `.env.server.local` chỉ phục vụ phát triển, **không cấu hình máy chủ production**.

`POST /api/voice/transcribe` nhận raw binary với MIME thực tế; backend kiểm tra kích thước và magic bytes rồi chuyển multipart tới OpenAI. `POST /api/voice/polish` nhận `{ original }`. Cả hai yêu cầu Bearer Supabase hợp lệ. Nội dung không vượt 20.000 ký tự; giới hạn 30 yêu cầu mỗi loại/giờ/tài khoản, 2 yêu cầu đồng thời/tài khoản và 8 toàn tiến trình. Hạn mức trong RAM đặt lại khi restart và không phải ngân sách thanh toán cứng; đặt thêm ngân sách/cảnh báo tại OpenAI Platform nếu cần.

Âm thanh chỉ nằm tạm trong RAM trình duyệt và RAM backend khi chuyển tiếp, không ghi đĩa, DB hay log nội dung. Responses API dùng `store: false`; chính sách lưu giữ phía nhà cung cấp vẫn theo tài khoản OpenAI. Khi nhận dạng thành công, giải phóng Blob; nếu upload lỗi, giữ Blob trong cửa sổ hiện tại để thử lại thủ công. Hủy/đóng cửa sổ giải phóng micro, bộ nhớ và hủy request; hủy không đảm bảo hoàn tiền cho yêu cầu OpenAI đã xử lý. Không tự retry gây tính phí lặp. Nếu chỉ biên tập lỗi, thử lại không tải âm thanh hoặc nhận dạng lần nữa. Bản chép không tự lưu cho đến khi người dùng chèn/thay thế; sau đó đi qua luồng input/tự lưu/đồng bộ hiện có.

## Kiểm thử và triển khai

Chạy `npm test`, `npm run build`, `npm run test:e2e`, `npm run test:sync`. Kiểm thử mock xác nhận WebM/MP4, hạn mức, xác thực/CORS, quá kích thước, quyền micro, hủy khi chờ quyền, hủy/xem lại/chèn/thay thế, con trỏ, thay đổi đồng thời, dừng tự động và retry riêng từng bước. Kiểm thử Chromium không thay thế việc thử trên Safari iPhone thật.

Đẩy code theo quy trình hiện có: PR chạy kiểm thử, `main` chạy kiểm thử và triển khai Pages; Render tự deploy từ `main`. Kiểm tra cả revision Render và job Pages, vì frontend/backend triển khai độc lập. `/health` có `voice.configured` cho biết backend có secret, không chứng minh model/quota hoạt động. Không đưa secret vào workflow, artifact hoặc `.env.example`.

Sau triển khai:

1. Mở ứng dụng trực tuyến, đóng/mở lại PWA để nhận service worker mới. Đăng nhập như bình thường.
2. Mở một hồ sơ thử nghiệm, nhập `Nội dung giữ lại`, đặt con trỏ ở giữa và ghi 10–20 giây. Xác nhận micro ngừng khi bấm dừng.
3. Kiểm tra hai bản, hủy và xác nhận kịch bản không đổi. Ghi lại, chọn bản gốc rồi chèn; tải lại kiểm tra tự lưu. Kiểm tra trên thiết bị thứ hai để xác minh đồng bộ thật.
4. Chọn thay thế rồi hủy xác nhận: nội dung phải nguyên vẹn. Thử lại và xác nhận thay thế trên hồ sơ thử nghiệm.
5. Từ chối quyền micro, ghi khi mất mạng, ngắt mạng sau khi ghi, thử lại khi có mạng, hủy khi đang chờ xử lý; nội dung cũ phải được giữ. Không tải lại tab nếu cần giữ âm thanh chưa gửi.
6. Lặp lại trên Chrome desktop và Safari iPhone HTTPS, đặc biệt chuyển ứng dụng sang nền và quyền micro. Xem Network: Chrome là WebM, Safari thường là MP4; không có request trực tiếp tới OpenAI hay API key trong JavaScript frontend.

## Chi phí dự kiến

Theo bảng giá OpenAI kiểm tra ngày 23/11/2026: [gpt-transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe) **0,0045 USD/phút**; [gpt-6.1-terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra) **1 USD/triệu token đầu vào, 5 USD/triệu token đầu ra**. Ví dụ 60 phút có 12.000–24.000 token bản chép và lượng đầu ra tương đương: khoảng **0,34–0,42 USD/giờ ghi âm**, cộng phần chỉ dẫn và các lần thử lại. Đây là ước tính, tiếng Việt và độ dài câu ảnh hưởng số token. Đoạn 2 phút thường khoảng 0,01–0,02 USD. Không thêm phí cố định vì dùng dịch vụ Render hiện có; cold start và quota miễn phí vẫn áp dụng. Giá/hạn mức có thể thay đổi.
