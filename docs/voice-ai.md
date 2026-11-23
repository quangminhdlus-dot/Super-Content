# Ghi âm & biên tập AI

Nút **Ghi âm** có ở **Nội dung ý tưởng** (Kho ý tưởng), **Nội dung kịch bản** (các công đoạn sau) và các ô ghi chú/mô tả khác. **Không gắn micro vào tiêu đề** hoặc ô nhập hàng loạt tiêu đề. Để tạo ý tưởng từ lời nói, bấm **Thêm ý tưởng → Tạo ý tưởng bằng nội dung / ghi âm**. Ý tưởng mới có thể chưa có tiêu đề; sau khi ghi âm, xem lại và **Chèn tại con trỏ** vào ô **Nội dung ý tưởng**, hệ thống tự gọi AI để đề xuất tiêu đề ngắn (chỉ khi tiêu đề đang trống). Nếu đề xuất lỗi, nội dung vẫn được lưu và có thể bấm **Gợi ý tiêu đề từ nội dung** để thử lại. Không có tiêu đề nào được AI ghi đè nếu người dùng đã tự đặt. Nếu nội dung cũ đã ghi nhầm thành tiêu đề dài, có nút chuyển xuống nội dung từng mục có xác nhận, không tự sửa hàng loạt. Đăng nhập Supabase trước khi ghi. **Chạm nút Ghi âm một lần là micro được mở và ghi tự động**, không cần bấm thêm nút Bắt đầu ghi. Nếu trình duyệt chưa có quyền micro, người dùng vẫn phải cấp quyền trong hộp thoại hệ thống; nếu từ chối hoặc gặp lỗi có thể bấm Thử ghi lại. Nói tiếng Việt rồi bấm Dừng & nhận dạng. Mỗi đoạn tự dừng sau 10 phút hoặc khi ứng dụng chuyển sang nền; tối đa 8 MiB. Sau khi chèn đoạn này, bấm micro để ghi đoạn tiếp theo. Mỗi đoạn là một tệp MediaRecorder hoàn chỉnh, không gửi riêng các timeslice thiếu header.

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

Theo bảng giá OpenAI kiểm tra ngày 23/11/2026: [gpt-transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe) **0,0045 USD/phút**; [gpt-6.1-terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra) **1 USD/triệu token đầu vào, 5 USD/triệu token đầu ra**. Ví dụ 60 phút có 12.000–24.000 token bản chép và lượng đầu ra tương đương: khoảng **0,34–0,42 USD/giờ ghi âm**, cộng phần chỉ dẫn và các lần thử lại. Đây là ước tính, tiếng Việt và độ dài câu ảnh hưởng số token. Đoạn 10 phút có chi phí nhận dạng khoảng 0,045 USD, cộng chi phí biên tập. Không thêm phí cố định vì dùng dịch vụ Render hiện có; cold start và quota miễn phí vẫn áp dụng. Giá/hạn mức có thể thay đổi.


## Ghi ý tưởng nhanh và hạn mức thời lượng

- Nút micro nổi ngay phía trên thanh điều hướng dưới cùng trên điện thoại, dùng trực tiếp ở mọi công đoạn. Chạm một lần mở micro và bắt đầu ghi (sau quyền hệ thống và đăng nhập).
- Dừng bằng nút vuông, xem bản chép, chọn bản cần dùng và bấm **Lưu ý tưởng**; ứng dụng tự tạo ý tưởng ở **Kho ý tưởng**, lưu lời nói ở trường **nội dung**, và đề xuất tiêu đề sau nếu bỏ trống.
- Tối đa **10 phút / đoạn hoặc 8 MiB**, tùy ngưỡng đạt trước. Giới hạn kỹ thuật không phải phút sử dụng miễn phí.
- Hệ thống hiện cho phép **30 lần nhận dạng / giờ / tài khoản** và 30 lần biên tập / giờ; không có hạn mức phút miễn phí hoặc tổng thời lượng/ngày do ứng dụng đảm bảo. OpenAI API tính phí riêng theo mức dùng; ngân sách cần theo dõi trong OpenAI Platform.


## Cập nhật điều khiển ghi âm và chống mất ý tưởng

- Khi ghi có **Xóa (X)**, **Tạm dừng/Tiếp tục** và **Gửi (mũi tên)**. Tạm dừng chỉ đóng băng đồng hồ, không gửi dữ liệu và không tạo ý tưởng. Nút gửi hoàn tất đoạn ghi, nhận dạng rồi lưu.
- Ở nút **Ghi ý tưởng nhanh**, bản chép **gốc** được lưu vào Kho ý tưởng bằng IndexedDB và đưa vào hàng chờ đồng bộ **ngay sau khi nhận dạng thành công, trước khi AI trau chuốt**. Lỗi biên tập không làm mất bản chép gốc.
- Sau gửi hiện lựa chọn **Mở trong Kho ý tưởng** hoặc **Lưu vào kịch bản** (chuyển mục đã lưu sang công đoạn Lên kịch bản). Đóng cửa sổ sau khi đã lưu vẫn giữ nguyên ý tưởng.
- Nếu tải lên/nhận dạng lỗi trước khi có bản chép, âm thanh vẫn được giữ **trong cửa sổ ghi hiện tại** để Thử lại. Đóng khi chưa gửi/chưa lưu có xác nhận xóa; Xóa chủ động sẽ hủy bản ghi. Không hứa khôi phục âm thanh nếu trình duyệt bị hệ điều hành đóng hoặc tải lại trước khi nhận dạng.
- Chuyển ứng dụng sang nền khi đang ghi sẽ cố tạm dừng, không tự động gửi. Giới hạn 10 phút là **thời gian ghi thực tế**, không cộng thời gian tạm dừng. Khi hết thời lượng, cần chạm Gửi để hoàn tất.

## Lưu một chạm sau ghi âm (cập nhật)

- Ghi âm nhanh: **Gửi → nhận dạng → lưu bản gốc an toàn → AI trau chuốt → cập nhật nội dung → tự đóng và trở về Kho ý tưởng**. Không có bước chọn bản gốc/bản trau chuốt hoặc bấm Lưu thêm.
- Tiêu đề tự động dùng nội dung cuối cùng đã trau chuốt; nếu dịch vụ gợi ý tên không khả dụng, hệ thống tạo một tiêu đề ngắn từ đầu nội dung để tránh ý tưởng không có tên.
- Khi chạm micro trong ô **Nội dung ý tưởng/kịch bản**, bản đã trau chuốt được tự chèn ở vị trí con trỏ và kích hoạt lưu như khi nhập chữ. Khi ghi từ biểu mẫu Thêm ý tưởng, nội dung được tự lưu thành ý tưởng mới.
- Nếu biên tập AI thất bại, bản gốc đã lưu vẫn an toàn và cửa sổ giữ nút **Thử lại**; nếu ô nội dung bị chỉnh đồng thời, không ghi đè và mở bản chép để phục hồi.
- **Ngày tạo** được gán khi lưu ý tưởng; **Ngày xuất bản** chỉ tự gán khi chuyển sang mục **Đã xuất bản**, không phải ngày ghi âm.
