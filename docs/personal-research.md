# Nghiên cứu AI cá nhân hóa — bản nâng cấp 003

Ứng dụng hiện tại và năm công đoạn sản xuất được giữ nguyên. Không có thao tác với Super Day, không huấn luyện lại mô hình và không tự sửa tiêu chuẩn gốc. Các tệp migration 001/002 được giữ nguyên.

## Bước tiếp theo: cấu hình dữ liệu trước

1. Mở Supabase project bạn định dùng chung tài khoản với Super Day. Chưa cần gửi khóa vào cuộc trò chuyện.
2. Mở **SQL Editor**, kiểm tra chỉ đọc:

```sql
select to_regclass('public.content_videos') as videos,
       to_regclass('public.content_research_videos') as research,
       to_regclass('public.content_criteria_versions') as personal_criteria;
```

3. Nếu `videos` là null, đọc, phê duyệt và chạy **001_content_videos.sql** trước. Nếu `research` là null, tiếp tục đọc/phê duyệt **002_youtube_research.sql**. Không chạy lại migration đã có trên dữ liệu thật.
4. Khi 001 và 002 đã có, sao lưu dữ liệu và đọc **supabase/003_personal_research.sql**. Chỉ chạy sau khi bạn phê duyệt. Không có lệnh migration tự động trong ứng dụng, CI hoặc máy chủ.
5. Cấu hình hai Actions Variables công khai `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` của đúng project; không dùng service-role cho `VITE_*`. Build/deploy lại nếu thay biến. Đăng nhập bằng tài khoản dùng cho Super Day; dữ liệu ứng dụng vẫn tách riêng.

Migration mới cần phê duyệt: **003_personal_research.sql**. Migration chỉ mở giới hạn JSON kênh cũ lên 500, sao chép nguồn cũ sang danh sách chuẩn hóa, tạo các bảng và RPC mới. Không thay schema bảng hồ sơ video/kịch bản, không sửa hàm lưu theo revision của bản 001. Nếu một schema tự sửa có tên constraint khác bản 002, migration sẽ rollback thay vì tiếp tục trên trạng thái chưa rõ.

## Sử dụng: 100 kênh và cập nhật theo lô

1. Mở **Nghiên cứu → Kênh theo dõi**.
2. Dán một URL mỗi dòng; nhập nhóm chủ đề nếu muốn → **Nhập danh sách kênh**. Hỗ trợ 100 kênh cùng một lần nhập, tối đa 500 kênh/tài khoản. Các dòng lỗi và trùng được báo riêng, dòng hợp lệ vẫn được lưu.
3. Dùng ô tìm kiếm, bộ lọc nhóm, công tắc theo dõi hoặc **Lưu nhóm**. Xóa kênh không xóa ý tưởng/kịch bản hoặc video đã thu thập.
4. URL được chuẩn hóa để bắt trùng `www`/đường dẫn tab/chữ hoa của handle. Hai alias khác nhau trỏ cùng kênh chỉ xác định chắc chắn khi gọi YouTube. Khi phân giải được cùng channel ID, máy chủ tắt bản alias trùng và ghi `duplicate_of`; tên/ID/playlist được lấy từ API, không tự bịa khi chưa có khóa. ID channel phân biệt hoa/thường.
5. **Cập nhật kênh theo lô** cần đăng nhập và backend YouTube đã cấu hình. Mỗi HTTP request chỉ xử lý **một trang playlist ≤50 video của một kênh**, rồi commit dữ liệu cùng checkpoint trên máy chủ. Một kênh ban đầu lấy tối đa 3 trang gần nhất; không tải hết lịch sử. Lần cập nhật sau bắt đầu ở đầu playlist, dừng khi gặp watermark đã thu thập, hoặc giới hạn 3 trang. Các trang mới nhất vẫn được cập nhật thống kê để có snapshot đo tăng trưởng. Không bảo đảm phủ toàn bộ lịch sử/kênh có hơn 150 video mới giữa hai lần cập nhật.
6. Có thể tạm dừng sau lô hiện tại hoặc đóng trang. Mở lại → **Tiếp tục lô còn lại**. Job giữ cursor, page token, watermark, ngân sách API, cấu hình và phiên bản tiêu chuẩn ở máy chủ; không dựa vào trí nhớ tiến trình Node hay localStorage để tiếp tục.
7. Nếu request bị ngắt khi đang giữ lease, đợi tối đa 2 phút trước khi tiếp tục. Lease token và transaction chặn một worker cũ ghi sau worker mới. Chỉ một job hoạt động/tài khoản. Nút **Hủy tiến trình** vô hiệu lease đang chạy; muốn dùng cấu hình/tiêu chuẩn mới trong khi còn job cũ, hãy hủy hoặc hoàn tất job đó rồi tạo lượt mới.

Giới hạn: 10 job mới/24 giờ/tài khoản, cách 60 giây, tối đa 2.500 đơn vị API/job; tiếp tục job không tiêu thêm một lượt khởi tạo. Máy chủ giới hạn 300 HTTP request/phút/IP. Chỉ có thao tác thủ công, không scheduler/notification/MCP.

## Tiêu chuẩn nội dung

1. Mở tab **Tiêu chuẩn nội dung**.
2. Viết định vị, khán giả, chủ đề, điều kiện đáng làm, nội dung tránh và ví dụ tốt/xấu cùng lý do.
3. Chỉnh năm trọng số: tăng trưởng, tương tác, phù hợp, tính mới và tiềm năng. Mỗi giá trị 0–100, ít nhất một giá trị >0; bộ chấm điểm chuẩn hóa theo tổng trọng số.
4. **Lưu tiêu chuẩn mới** tạo phiên bản bất biến. Có lịch sử và nút dùng nội dung cũ làm phiên bản mới. Hai thiết bị lưu từ cùng một bản cũ sẽ được cảnh báo xung đột, không âm thầm ghi đè.
5. Một job dùng phiên bản tiêu chuẩn lúc tạo job, kể cả khi bạn sửa tiêu chuẩn trong lúc job đang chạy.

AI thực sự nhận **toàn bộ nội dung tiêu chuẩn, version ID và ví dụ đã xác nhận tương tự video** trong request đánh giá. Kết quả AI gồm mức phù hợp/tính mới/tiềm năng, giải thích và góc khai thác. Các điểm này được đưa vào công thức có trọng số do bạn đặt, không chỉ hiển thị nguyên văn tiêu chuẩn. AI không được thay trọng số. Không có bước tự động sửa tiêu chuẩn hoặc đề xuất trọng số lớn cần duyệt; mọi lần sửa đều do người dùng lưu rõ ràng.

Nếu chưa có AI key hoặc API lỗi, hệ thống dùng quy tắc đối chiếu từ vựng, chủ đề tránh và ví dụ tương tự. Giao diện ghi **Quy tắc / Chưa có AI**, không gọi đó là hiểu ngữ nghĩa hay mô hình đã học. Các diễn giải quy tắc được giữ để bạn kiểm tra.

## Bộ nhớ học hỏi

1. Trong từng đề xuất, chọn **Chọn làm video**, **Xem xét sau**, **Không phù hợp** hoặc **Đặc biệt xuất sắc**, thêm lý do nếu muốn → **Lưu lựa chọn**.
2. Chọn làm video còn gọi luồng duyệt chống trùng hiện có để đưa/liên kết hồ sơ vào Kho ý tưởng; không viết đè kịch bản, không kéo hồ sơ ở công đoạn khác về đầu. Không phù hợp đưa đề xuất vào phần bỏ qua. Đánh giá xuất sắc/xem xét sau không tự tạo ý tưởng.
3. Mở **Bộ nhớ học hỏi**: lịch sử quyết định giữ thời gian, lý do, snapshot video, phiên bản tiêu chuẩn lúc lựa chọn và phiên bản lúc video được đánh giá.
4. Nhấn **Xác nhận ghi nhớ từ lựa chọn này** nếu muốn dùng nó cho các lần nghiên cứu tiếp. Chưa xác nhận thì phản hồi chỉ là lịch sử, không tham gia xếp hạng. Không có cơ chế tự khai thác lịch sử chưa được bạn đồng ý.
5. Sửa nội dung, đổi xu hướng ưu tiên/thường loại, bỏ tích xác nhận hoặc xóa ghi nhớ. Mất xác nhận/xóa có hiệu lực ở lần đánh giá mới; lý do của lần đánh giá cũ vẫn được giữ như lịch sử, không bị viết lại.

Giai đoạn này dùng truy xuất từ vựng tương tự, tối đa 6 ví dụ xác nhận phù hợp/video từ tối đa 500 ghi nhớ gần nhất; điều chỉnh độ phù hợp theo quy tắc bị chặn trong ±0,15 trước chuẩn hóa. Không điều chỉnh trọng số gốc, không fine-tuning. Model nhận lý do/nhãn của ví dụ; giải thích hiển thị ghi nhớ được dùng. Việc xác nhận một phản hồi không bảo đảm video tương lai có nội dung thật tương đồng, vì chưa đọc nội dung đầy đủ.

## Hai chế độ nghiên cứu và hai nhóm đề xuất

- **Tìm trong kho kênh đã thu thập**: chỉ đọc dữ liệu Supabase của kênh đang theo dõi; không gọi YouTube. Nhập truy vấn tiêu đề/mô tả, khoảng ngày, số đề xuất. Nếu chưa có dữ liệu, dùng Cập nhật kênh trước.
- **Tìm trên YouTube theo từ khóa**: dùng `search.list` chính thức, một từ khóa/lô, ≤50 kết quả/từ khóa, tối đa 5 từ khóa. Có thể tìm kênh ngoài danh sách. Chế độ kết hợp gộp kho hiện có và nguồn từ khóa.
- **Cơ hội tăng trưởng** chỉ dùng khi có mẫu thống kê đủ theo tiêu chí cũ (cùng kênh/danh mục/thời lượng/tuổi). **Giá trị chiến lược dài hạn** có thể xuất hiện khi phù hợp tiêu chuẩn dù chưa chứng minh vượt trội.
- Bộ lọc nhóm giúp xem riêng hai nhóm. Điểm theo trọng số quyết định thứ tự; tiêu chuẩn thay đổi sẽ được phản ánh ở job mới.
- Đánh giá cuối đọc tối đa 2.000 hồ sơ thu thập gần nhất; snapshot trong 30 ngày tối đa 10.000 bản. Không có baseline mới tự động cho mọi kênh ngoài danh sách, nên video mới từ tìm kiếm thường có tin cậy thấp về tăng trưởng. Không giả số liệu để bù thiếu mẫu.
- Truy vấn cache không tạo snapshot lượt xem mới hoặc thay ngày thu thập. Tốc độ tính theo timestamp thu thập thật. Dữ liệu cũ hơn 24 giờ bị hạ tin cậy và không kết luận cơ hội tăng trưởng hiện tại; hãy cập nhật kênh.
- Không kết luận tranh luận từ số bình luận. Nguồn đã truy cập luôn ghi rõ: **tiêu đề, mô tả công khai rút gọn và thống kê YouTube**. Không đọc transcript/video/bình luận, không bịa nội dung chi tiết hoặc phát ngôn của tác giả.

## Máy chủ và bảo mật

Dùng cấu hình Node/YouTube/Supabase trong [hướng dẫn trước](youtube-research.md), secrets chỉ ở máy chủ. Frontend Pages không chạy Node. Backend cần deploy lại phiên bản mới cùng migration 003; dùng `npm run research:server`. `VITE_RESEARCH_API_URL` vẫn là URL backend HTTPS; không thêm API key vào biến trình duyệt.

API mới: `POST /api/research/jobs` (kind research/refresh, query tùy chọn), `POST /api/research/jobs/:id/step`. Token Supabase phải hợp lệ; tài khoản được suy ra từ token. Trạng thái/progress đọc qua RLS `content_research_jobs`. Route cũ `/api/research/scan` là alias tạo job, không còn chạy hết danh sách trong một request.

Chỉ service-role được cấp/claim/commit job và ghi đánh giá. Các RPC tiêu chuẩn, phản hồi, kênh và hủy job dùng `auth.uid()`. Memory có RLS và kiểm tra feedback thuộc chính tài khoản đó. Lịch sử tiêu chuẩn/đánh giá/feedback chỉ đọc với client; không sửa xóa lịch sử bằng trình duyệt. Không thu thập dữ liệu Super Day.

AI tùy chọn: chỉ phân tích tối đa 6 video đầu đã được sàng lọc/xếp hạng theo quy tắc, từ shortlist 12 video/job. Model nhận tiêu chuẩn và ghi nhớ đã xác nhận (có thể là dữ liệu cá nhân bạn nhập); chỉ bật AI khi bạn đồng ý gửi dữ liệu này đến nhà cung cấp. Không gửi kịch bản riêng. Nếu lỗi giữ điểm quy tắc, ghi cảnh báo trong đánh giá. Chi phí giới hạn theo 6 request, mỗi request ≤900 output tokens, timeout 12 giây. Nguồn YouTube là dữ liệu không đáng tin, model không có tools hay quyền sửa cấu hình.

## Những gì đã kiểm tra và chưa kiểm tra

Kiểm thử cục bộ dùng PostgreSQL WASM/PGlite, Chromium desktop/mobile viewport và API giả lập: nhập 100 kênh/alias trùng, phiên bản tiêu chuẩn và xung đột, tiêu chuẩn thay đổi làm đổi rank, tiêu chuẩn/ví dụ thực sự vào payload AI, memory xác nhận ảnh hưởng lý do/rank, phản hồi theo tài khoản, RLS, snapshot không bị tạo giả khi tìm cache, checkpoint/lease cũ bị từ chối, giữ nguyên kịch bản và năm công đoạn.

Chưa áp dụng SQL lên Supabase thật; chưa gọi YouTube/OpenAI thật hoặc chạy 100 kênh thật, chưa thử iPhone/Safari thật. Dịch vụ vẫn có thể ở trạng thái chờ cấu hình khóa/backend. GitHub Actions chỉ build, test và xuất bản giao diện; không chạy migration hoặc tự deploy backend.
