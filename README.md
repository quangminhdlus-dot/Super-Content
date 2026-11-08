# Super Content

Ứng dụng quản lý sản xuất nội dung YouTube: **Kho ý tưởng → Lên kịch bản → Chờ quay → Hoàn thiện → Đã xuất bản**. Giao diện tiếng Việt, tối/cam theo Super Day; phông Be Vietnam Pro được đóng gói để dùng ngoại tuyến. Không sử dụng AI, thông báo đẩy hay dữ liệu Super Day.

## Chạy trên máy phát triển

Yêu cầu Node.js 22.12+ (đã kiểm tra với Node 24), npm.

```sh
npm ci --cache /tmp/super-content-npm
npm run dev
```

```sh
npm test             # nghiệp vụ + PostgreSQL cục bộ, không truy cập DB thật
npm run build        # dist/ và service worker có phiên bản theo nội dung build
npm run preview      # kiểm tra bản production
npm run test:e2e     # Chromium: desktop và viewport điện thoại
```

Kiểm thử trình duyệt mặc định dùng `/usr/bin/chromium` trong môi trường cloud. Máy khác: sửa `executablePath` trong `playwright.config.js` theo Chromium đã cài hoặc bỏ trường này và dùng `npx playwright install chromium`. Bộ E2E tự chạy preview trên cổng 4173 với tiền tố `/super-content/`. Cần build trước khi chạy.

## Sử dụng

- **Thêm ý tưởng**: nhập một tiêu đề hoặc dán nhiều dòng. Dòng trống được bỏ. Với tiêu đề trùng (cả trong cùng một lần dán), tích những bản trùng muốn giữ rồi bấm thêm lần nữa.
- Chọn từng video hoặc **Chọn tất cả** trong kết quả tìm kiếm; thanh thao tác cho phép chuyển công đoạn, quay lại, lưu trữ hoặc đưa vào thùng rác.
- Bấm tiêu đề để mở hồ sơ. Kịch bản, ghi chú, các liên kết và ngày xuất bản được tự lưu trên thiết bị; vùng viết không được dựng lại khi nhập nên giữ vị trí con trỏ.
- **Cài đặt**: cỡ chữ, đăng nhập khi có Supabase, tải bản sao JSON, truy cập Lưu trữ/Thùng rác trên điện thoại. Khôi phục giữ nguyên công đoạn của hồ sơ; khôi phục từ thùng rác đồng thời bỏ lưu trữ.
- Xóa vĩnh viễn cần xác nhận. Trong Supabase, nội dung bị xóa, chỉ giữ định danh và dấu xóa để thiết bị cũ không tự làm xuất hiện lại video. Bản sao JSON đã tải và thiết bị chưa đồng bộ có thể còn bản cũ; đây không phải chức năng xóa dữ liệu pháp lý trên toàn bộ thiết bị.

## Chế độ trải nghiệm và an toàn dữ liệu

Không có cấu hình Supabase, ứng dụng dùng IndexedDB thật, không có dữ liệu giả được thêm sẵn. Dữ liệu chỉ nằm trong trình duyệt hiện tại, **chưa đồng bộ giữa các thiết bị**. Không dùng chế độ riêng tư để lưu kịch bản quan trọng; tải bản sao JSON định kỳ. Bản JSON là tệp sao lưu đọc được, chưa có công cụ nhập lại trong giao diện.

Mỗi thay đổi được ghi vào thiết bị trước khi gửi máy chủ. Chỉ báo “đã đồng bộ” sau khi máy chủ chấp nhận. Lỗi mạng giữ hàng đợi trên thiết bị, thử lại khi có mạng hoặc mỗi 15 giây. Lỗi bộ nhớ hiển thị rõ, giữ nguyên vùng viết và cảnh báo khi rời trang; hãy sao chép nội dung trước khi đóng.

Hồ sơ dùng cùng UUID khi chuyển công đoạn. Supabase dùng revision để từ chối ghi đè bản máy chủ mới hơn. Trong **Cài đặt**, tải bản sao rồi chọn bản thiết bị hoặc bản máy chủ khi có xung đột. Khi đang viết, không thay thế nội dung từ xa vào vùng soạn thảo. Chưa hỗ trợ đồng soạn thảo thời gian thực; nên viết ở một tab tại một thời điểm.

## Kết nối Supabase (tùy chọn)

**Không có migration nào tự chạy. Không sửa bảng, dữ liệu hoặc thông báo của Super Day.**

1. Chọn Supabase project hiện dùng cho Super Day nếu muốn dùng chung tài khoản. Đọc và xác nhận trước khi chạy thủ công [`supabase/001_content_videos.sql`](supabase/001_content_videos.sql) trong SQL Editor. Chạy một lần; script cố ý không che giấu bảng/hàm đã tồn tại bằng `IF NOT EXISTS`.
2. Bảng riêng `content_videos`, RLS theo `auth.uid()`, RPC ghi theo revision và kiểm tra chủ sở hữu. Không cấp quyền đọc cho khách chưa đăng nhập.
3. Sao chép `.env.example` thành `.env.local`, điền `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` (anon/publishable public key). **Không dùng service_role hoặc secret key.** Các biến `VITE_*` được công khai trong trình duyệt.
4. Bật Email/Password trong Supabase Authentication. Đặt Site URL/Redirect URLs theo URL Pages thực tế nếu bật xác nhận email. Ứng dụng có đăng ký và đăng nhập bằng email/mật khẩu.
5. Build lại. Đăng nhập cùng tài khoản trên hai thiết bị để kiểm tra đồng bộ. Dữ liệu trải nghiệm được giữ riêng, không tự tải lên tài khoản; dữ liệu cục bộ của mỗi tài khoản được tách theo user ID.

Mạng phát triển cần cho phép HTTPS đến project Supabase của bạn. Không yêu cầu khóa bí mật cho chế độ trải nghiệm. Kiểm thử RLS cục bộ dùng PostgreSQL WASM/PGlite với hai danh tính độc lập, không thay thế việc kiểm tra cấu hình Supabase thật.

## GitHub Pages & iPhone

Workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) build bằng lockfile, chạy kiểm thử nghiệp vụ/DB và deploy Pages khi push `main` hoặc chạy thủ công. Trong GitHub **Settings → Pages → Source**, chọn **GitHub Actions**. Nếu dùng Supabase, đặt hai repository Actions variables cùng tên như trên trước khi build.

Toàn bộ tài nguyên, manifest, scope và service worker dùng đường dẫn tương đối; đã kiểm thử với `/super-content/`. Repo hiện tại có origin `quangminhdlus-dot/Super-Content`; URL và chữ hoa/thường cuối cùng phải lấy từ kết quả job `deploy`, không suy ra rằng URL dự kiến đã hoạt động.

Sau khi có URL HTTPS: mở bằng Safari trên iPhone → Chia sẻ → **Thêm vào Màn hình chính**. Tên Super Content, biểu tượng PNG riêng, chế độ standalone, safe-area và điều hướng 5 tab. Service worker chỉ lưu tài nguyên tĩnh cùng origin; không lưu phản hồi API hay phiên đăng nhập. Cần mở trực tuyến thành công ít nhất một lần trước khi dùng ngoại tuyến. Khi có bản mới, đóng tất cả cửa sổ ứng dụng rồi mở lại để kích hoạt bản cập nhật.

Đã kiểm tra Chromium desktop/viewport cảm ứng 390×844. Chưa kiểm thử trên iPhone/Safari thật. Chưa xác nhận triển khai Pages hoặc đồng bộ với Supabase thật.

## Nghiên cứu YouTube

Bổ sung khu vực Nghiên cứu YouTube, cấu hình nguồn, Quét ngay qua máy chủ, thống kê theo thời gian, điểm cơ hội và danh sách đề xuất cần duyệt. Năm công đoạn hiện tại giữ nguyên.

Hướng dẫn từng bước: [Supabase, YouTube API, máy chủ và cách kiểm thử](docs/youtube-research.md). Khóa YouTube/OpenAI chỉ đặt ở backend. Migration `002_youtube_research.sql` cần bạn phê duyệt trước khi chạy; ứng dụng không tự thay đổi DB thật.

```sh
npm run research:server # cần secrets máy chủ theo server/.env.example
npm run test:sync       # kiểm thử đồng bộ/nghiên cứu qua API giả lập
```

Chưa bật lịch tự động, thông báo đề xuất hay MCP. Chưa cấu hình Supabase/YouTube/OpenAI thật trong môi trường này.

## Kết quả xác thực trong môi trường phát triển

- `npm test`: 11 kiểm thử đạt, gồm nghiệp vụ, nghiên cứu YouTube/AI giả lập, API xác thực, RLS PostgreSQL, giới hạn quét và duyệt chống trùng.
- `npm run test:e2e`: 8 kiểm thử đạt ở desktop và mobile viewport, gồm quy trình 20 tiêu đề/7 video, kịch bản, ngoại tuyến, lỗi lưu trữ và cấu hình/duyệt đề xuất nghiên cứu.
- `npm run test:sync`: 2 kiểm thử đạt với **API Supabase và máy chủ nghiên cứu giả lập**, gồm đồng bộ hai phiên, xung đột, Quét ngay, lỗi quota và chuyển đề xuất vào kho. Không phải kiểm thử dịch vụ thật.
- Build production đã được chạy thành công. Để xuất bản, chọn Pages Source là GitHub Actions rồi kiểm tra job `deploy`. Chỉ xác nhận URL ứng dụng hoạt động sau khi job triển khai thành công.
