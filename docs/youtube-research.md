# Nghiên cứu YouTube — cấu hình và vận hành

Phần nâng cấp dùng ứng dụng hiện tại. Năm công đoạn, IndexedDB cũ, bảng `content_videos` và hàm lưu kịch bản không bị thay thế. Không có migration tự chạy; không có thao tác với bảng, thông báo hoặc dữ liệu Super Day.

## 1. Cấu hình đồng bộ Supabase

1. Mở project Supabase đang dùng cho Super Day nếu muốn dùng chung **tài khoản**. Không tạo lại bảng Super Day, không sao chép khóa quản trị vào giao diện.
2. Sao lưu dữ liệu hiện có. Trong SQL Editor, **đọc và phê duyệt** `supabase/001_content_videos.sql` nếu CHƯA có bảng `content_videos`. Nếu đã có bảng và hàm này, bỏ qua 001; không chạy lại trên dữ liệu hiện có.
3. Đọc và phê duyệt `supabase/002_youtube_research.sql`, sau đó mới chạy một lần. Migration là một transaction; cố ý báo lỗi nếu bảng/hàm đã tồn tại để tránh che giấu schema khác phiên bản. Chỉ tạo các bảng `content_research_*`, chính sách và hàm riêng. Không tự động reset, drop hay sửa bảng Super Day.
4. Trong Authentication → Providers bật Email/Password nếu chưa bật. Dùng cùng email/mật khẩu Super Day. Với xác nhận email, đặt Site URL/Redirect URLs phù hợp URL Super Content thực tế. Dùng chung tài khoản không có nghĩa chia sẻ dữ liệu giữa hai ứng dụng.
5. Sao chép `.env.example` thành `.env.local`. Điền `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` (public anon hoặc publishable key của project). Không dùng service-role/secret key trong bất kỳ biến `VITE_*` nào.
6. Build lại giao diện. Khi xuất bản trên Pages, đặt hai biến trên trong repository **Settings → Secrets and variables → Actions → Variables**; workflow đã đọc chúng.
7. Đăng nhập trên máy tính và iPhone. Tạo một ý tưởng kiểm tra; chỉ tiếp tục khi bên còn lại nhìn thấy sau đồng bộ. Kiểm tra từng tài khoản chỉ đọc dữ liệu của chính nó. Đừng xóa dữ liệu trình duyệt khi còn thay đổi chưa đồng bộ.

Môi trường hiện tại chưa có các binding Supabase/YouTube/OpenAI. Các bước trên chưa được chạy trên project thật. Không cần cung cấp giá trị bí mật qua cuộc trò chuyện.

## 2. Tạo khóa YouTube Data API

1. Mở Google Cloud Console → chọn/tạo project dùng cho nghiên cứu.
2. APIs & Services → Library → bật **YouTube Data API v3**.
3. Credentials → Create credentials → **API key**.
4. API restrictions: chỉ cho **YouTube Data API v3**. Application restrictions: giới hạn IP máy chủ khi dịch vụ có IP egress cố định. Không dùng giới hạn HTTP referrer vì API được gọi từ máy chủ.
5. Cất khóa trong secret settings của dịch vụ máy chủ: `YOUTUBE_API_KEY`. Không đưa vào GitHub Pages, `VITE_*`, file commit hoặc JavaScript trình duyệt.
6. Theo dõi quota trong Google Cloud. Mỗi tìm kiếm từ khóa thường tốn 100 đơn vị; đọc kênh/playlist/video thường tốn 1 đơn vị/yêu cầu. Máy chủ giới hạn 650 đơn vị tính theo các mức này/lần quét, tối đa 5 từ khóa và 10 kênh. Đơn vị là ước tính theo chi phí API hiện hành; nhiều tài khoản dùng chung project có thể hết quota sớm hơn giới hạn riêng của từng người.

Đây là API chính thức: `/channels`, `/playlistItems`, `/videos`, `/search`. Không scraping, không cookie YouTube. Nếu Google thay đổi quy tắc quota, cập nhật bộ tính `server/youtube.js`.

## 3. Chạy dịch vụ máy chủ

GitHub Pages chỉ phục vụ giao diện tĩnh, **không chạy được** dịch vụ Node. Dùng một Node web service hỗ trợ Node 22.12+ và HTTPS (ví dụ Render, Railway hoặc máy chủ riêng). Dịch vụ không cần ổ đĩa bền vững; dữ liệu ở Supabase.

Cài đặt: `npm ci`. Lệnh khởi động: `npm run research:server`. Trên máy phát triển, sao chép `server/.env.example` thành `.env.server.local` ở gốc kho; file này đã bị Git bỏ qua. Trên hosting, dùng trang quản lý secrets thay vì upload tệp.

| Biến chỉ ở máy chủ | Giá trị |
| --- | --- |
| `SUPABASE_URL` | URL project ở bước 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key của cùng project; secret có quyền cao, chỉ lưu trên máy chủ |
| `YOUTUBE_API_KEY` | Khóa YouTube ở bước 2 |
| `RESEARCH_ALLOWED_ORIGINS` | Danh sách origin giao diện, phân cách bằng dấu phẩy. Ví dụ `https://quangminhdlus-dot.github.io` — **không có đường dẫn repo** |
| `PORT` | Hosting tự cung cấp hoặc 8787 khi chạy cục bộ |
| `OPENAI_API_KEY` | Tùy chọn; bỏ trống để chỉ sàng lọc số liệu và dùng gợi ý biên tập |
| `OPENAI_MODEL` | Tùy chọn; mặc định `gpt-4.1-mini` |

Máy chủ cần egress HTTPS đến `www.googleapis.com`, `<project-ref>.supabase.co`; thêm `api.openai.com` nếu bật AI. Trình duyệt cần HTTPS đến Supabase, origin máy chủ, và `i.ytimg.com` để tải ảnh. Bật TLS, không vô hiệu xác thực chứng chỉ. Khóa Supabase service-role không được trả về client hoặc ghi vào log.

`GET /health` chỉ kiểm tra tiến trình còn sống, không xác nhận khóa hợp lệ hay migration đã có. `POST /api/research/scan` cần `Authorization: Bearer <access token Supabase của người dùng>`. Máy chủ xác minh token qua Supabase Auth, lấy cấu hình theo đúng user ID; không nhận user ID hoặc URL đích từ request. Origin khác allowlist bị từ chối. Máy chủ còn giới hạn 80 request/phút/IP kết nối để giảm lạm dụng xác thực; nếu có reverse proxy, cấu hình thêm giới hạn tại proxy (không tin `X-Forwarded-For` tùy ý). Giới hạn bền vững trong PostgreSQL: 10 lần/24 giờ/tài khoản, nghỉ ít nhất 60 giây, chỉ một lượt đang chạy; lượt gián đoạn được đánh dấu hết lease sau 5 phút khi quét lại. Ngân sách thời gian quét 90 giây; frontend chờ tối đa 100 giây. Không tự retry hàng loạt khi nhận lỗi quota.

Dịch vụ được triển khai tách biệt; workflow Pages không deploy hoặc cấp secrets cho backend. Chưa có dịch vụ nào được triển khai từ phiên làm việc này.

## 4. Kết nối giao diện với máy chủ

1. Đặt `VITE_RESEARCH_API_URL=https://dia-chi-may-chu` trong `.env.local`, hoặc Actions Variable cùng tên khi dùng Pages. Đây là URL công khai, không chứa khóa.
2. Workflow `.github/workflows/pages.yml` đã đọc biến này. Build lại và triển khai giao diện sau khi bạn muốn xuất bản.
3. Đăng nhập, mở **Nghiên cứu YouTube** bằng menu trái hoặc nút kính lúp trên thanh trên ở điện thoại. Năm tab công đoạn phía dưới giữ nguyên.
4. Thêm đường dẫn `/@handle`, `/channel/UC…`, hoặc `/user/...`; hỗ trợ đuôi `/videos`, `/shorts`, `/streams`, `/featured`, `/about`. Với đường dẫn cũ `/c/...`, mở kênh và lấy đường dẫn @. Kênh sẽ được phân giải chính thức thành ID khi quét; không gửi request đến URL tùy ý của người nhập.
5. Thêm/sửa/xóa từ khóa; chọn kênh, từ khóa hoặc kết hợp. Kết hợp nghĩa là **gộp hai nguồn**, không bắt buộc một video khớp cả hai. Cùng YouTube ID chỉ lưu một hồ sơ nghiên cứu, giữ nhiều nguồn phát hiện.
6. Chọn ngày đăng (UTC) và 1–50 kết quả mỗi lượt. Bấm **Lưu cấu hình** hoặc **Quét ngay** (tự lưu cấu hình trước). Xem lần chạy gần nhất, số kết quả, lỗi và cảnh báo. Có nút tải lại và lịch sử 10 lượt gần nhất.
7. Tích đề xuất (tối đa 50), chọn **Chuyển vào Kho ý tưởng**. Không có cơ chế tự duyệt. Bỏ qua/lưu trữ chỉ tác động đề xuất, không xóa ý tưởng/kịch bản đã có.

Chưa đăng nhập: cấu hình được lưu trong IndexedDB, có nhãn rõ chưa đồng bộ và nút quét bị vô hiệu. Không thêm video giả vào bản chạy thật. Cấu hình trải nghiệm không tự tải lên tài khoản. Cấu hình chưa bấm Lưu có thể mất khi rời khu vực; hãy lưu trước khi chuyển màn hình.

## 5. Số liệu và điểm cơ hội

- Giữ video ID, tiêu đề, kênh, ngày đăng, URL, thumbnail, description rút gọn, danh mục YouTube, thời lượng, nguồn phát hiện, thời gian thu thập và thống kê. Like/comment không công khai được giữ là `null`, không giả thành 0.
- Mỗi lần quét tạo snapshot riêng. Tốc độ chỉ được tính khi có hai snapshot hợp lệ cách nhau ít nhất một giờ, tối đa 30 ngày; bộ đếm giảm được coi là không đủ bằng chứng để tính tốc độ từ cặp đó.
- So sánh **cùng kênh + cùng danh mục YouTube + cùng nhóm thời lượng** (≤3 phút, ≤20 phút, dài hơn) và tuổi video nằm trong 0,5–2 lần tuổi video đang xét, chỉ kết luận từ video đã đăng ít nhất một giờ; ngưỡng tuổi tối thiểu để chia tỷ lệ là một giờ. Cần ít nhất 5 video đối chiếu, lấy trung vị lượt xem. Tốc độ cũng cần 5 tốc độ mẫu để có tỷ lệ so sánh.
- Điểm tối đa 100: tỷ lệ lượt xem 40, tỷ lệ tốc độ 25, tỷ lệ like 10, mật độ bình luận 5, mức khớp từ khóa/nguồn kênh 20. Khớp từ khóa là đối chiếu văn bản, chưa phải hiểu ngữ nghĩa. Đủ sàng lọc khi lượt xem hoặc tốc độ ≥2 lần trung vị nhóm có đủ mẫu. Ưu tiên nhóm đủ sàng lọc trước, rồi điểm và lượt xem.
- Không đủ mẫu: hiện rõ tin cậy thấp, không ghi “đột biến”. Chỉ có mẫu lượt xem: tin cậy hạn chế. Có cả mẫu tốc độ: mức vừa, không tự nâng lên cao. Danh mục/thời lượng chỉ là đại diện, không xác nhận Shorts hay cùng thể loại sâu.
- Mật độ bình luận chỉ là dấu hiệu thảo luận; không đọc bình luận nên không kết luận tranh luận, tiêu cực hoặc lý do người xem phản ứng. Không thu thập dữ liệu cá nhân người bình luận.
- AI **tùy chọn**, tối đa 3 video đã qua sàng lọc số liệu trong danh sách đề xuất/lượt; không quét AI trên toàn bộ nguồn. Dùng Responses API, đầu ra JSON có schema, không tools. Chỉ gửi metadata công khai và kết quả số liệu, không gửi kịch bản riêng. Khi AI lỗi, giữ số liệu và gợi ý biên tập theo mẫu; ghi cảnh báo. Không có khóa AI thì không phát sinh request/chi phí AI.

Giới hạn tổng 2.000 video mẫu/lượt, được áp dụng phía máy chủ. Giới hạn mẫu được hiển thị sau lượt quét: tối đa 150 video tải lên/kênh theo dõi, 50 kết quả mới nhất/từ khóa, baseline 100 video cho tối đa 10 kênh phát hiện qua từ khóa. Khoảng ngày là bộ lọc trên mẫu này, **không phải cam kết quét toàn bộ lịch sử trong khoảng ngày**. Giao diện hiển thị tối đa 500 đề xuất gần nhất, 10 lần chạy; bộ đánh giá đọc tối đa 10.000 snapshot mới nhất trong 30 ngày. Các giới hạn giữ chi phí và thời gian phù hợp bản đầu; dữ liệu DB cũ không bị xóa.

## 6. Dữ liệu, bảo mật và mở rộng

Các bảng mới đều có RLS theo `auth.uid()`. Client chỉ được ghi cấu hình của mình, đọc dữ liệu nghiên cứu của mình và gọi hai RPC duyệt/thay trạng thái. Ghi dữ liệu video nghiên cứu, snapshot, nhật ký và cấp lượt quét chỉ cho service-role trên backend. RPC sử dụng `search_path` rỗng và kiểm tra quyền rõ ràng. Log chỉ chứa run ID/mã lỗi, không in khóa, access token, URL có key hay lỗi thô từ nhà cung cấp.

RPC duyệt chạy trong một transaction và khóa theo tài khoản. `content_research_links` có khóa duy nhất `(user_id, youtube_id)`; nếu nguồn đã tồn tại trong một hồ sơ nhập tay, dùng lại hồ sơ ấy và giữ nguyên tiêu đề/kịch bản/công đoạn. Không kéo video đang sản xuất về Kho ý tưởng, không khôi phục hồ sơ trong thùng rác một cách ngầm định. Liên kết giữ toàn bộ snapshot nghiên cứu và lịch sử thống kê ở thời điểm duyệt. Mở hồ sơ video → **Hồ sơ nghiên cứu gốc** để xem. Các snapshot mới sau đó vẫn ở bảng thống kê, không sửa bằng chứng gốc khi duyệt.

`content_research_settings.schedule` chuẩn bị `cadence`, `local_time`, `timezone`; `enabled` bắt buộc false trong phiên bản này. `content_research_integrations` chuẩn bị cấu hình nhận đề xuất và MCP, cũng chưa bật. Sau này cần scheduler tính `next_run_at` theo múi giờ (daily/every_3_days/weekly), outbox gửi đề xuất có idempotency và OAuth/MCP với scope theo tài khoản. Không tái sử dụng service-role làm token MCP; không bật endpoint không xác thực. Bảng `content_research_imports` chuẩn bị ledger `source=chatgpt`, `external_id` duy nhất/tài khoản và `batch_id` (luồng YouTube cũng ghi ledger này); nguồn ChatGPT sau này cần xác thực, kiểm tra nội dung được duyệt và batch import transaction tương tự RPC duyệt; chưa có API MCP hoặc nhập từ ChatGPT trong bản này.

## 7. Kiểm tra sau khi cấu hình thật

1. Quét một kênh có video trong khoảng ngày. Kiểm tra log run thành công, số lượng, video ID và số liệu đối chiếu trực tiếp YouTube. Kênh có thể ẩn lượt thích/bình luận hoặc có video riêng tư/đã xóa; API không trả các video không truy cập được.
2. Thử từ khóa và kết hợp; cùng ID không tạo hai video nghiên cứu. Quét ngay lần nữa phải bị giới hạn; đợi 60 giây rồi kiểm tra snapshot mới. Để kiểm tra tốc độ cần chờ ít nhất 1 giờ, không sửa ngày snapshot trong DB thật.
3. Duyệt 2 đề xuất trên máy tính; iPhone cùng tài khoản phải thấy ý tưởng sau đồng bộ. Duyệt lặp không tăng số ý tưởng; kịch bản đã viết vẫn nguyên vẹn.
4. Dùng tài khoản khác để thử đọc/duyệt ID của tài khoản trước: phải bị chặn. Kiểm tra không thể gọi RPC cấp lượt hoặc ghi trực tiếp thống kê bằng anon/access token người dùng.
5. Thử khóa YouTube sai/hết quota: UI hiện lỗi, nhật ký có mã lỗi an toàn, dữ liệu trước đó vẫn giữ. Không chụp/in khóa khi báo lỗi.
6. Nếu bật AI, xác minh chỉ ≤3 video đủ sàng lọc được gửi/lượt, theo dõi chi phí trong dashboard. Chưa kết luận AI đã hoạt động nếu không có request thật.

Trong môi trường phát triển: 11 kiểm thử nghiệp vụ/API/PostgreSQL/PGlite, 8 kiểm thử Chromium desktop/mobile và 2 kiểm thử đồng bộ/nghiên cứu với API giả lập đều đạt. **Chưa chạy YouTube/OpenAI/Supabase thật, chưa chạy trên iPhone/Safari thật, chưa áp dụng migration hoặc triển khai dịch vụ nghiên cứu.**
