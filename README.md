# Super Content

Ứng dụng quản lý sản xuất nội dung YouTube: **Kho ý tưởng → Lên kịch bản → Chờ quay → Hoàn thiện → Đã xuất bản**. Giao diện tiếng Việt, tối/cam theo Super Day; phông Be Vietnam Pro được đóng gói để dùng ngoại tuyến. Nghiên cứu YouTube và AI cá nhân hóa là tùy chọn, cần backend riêng. Không sử dụng thông báo đẩy hay dữ liệu Super Day.

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

Workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) build bằng lockfile, chạy kiểm thử nghiệp vụ/DB, E2E và đồng bộ trên pull request và trước khi deploy Pages từ `main`. Pull request không xuất bản website. Trong GitHub **Settings → Pages → Source**, chọn **GitHub Actions**. Nếu dùng Supabase, đặt hai repository Actions variables cùng tên như trên trước khi build.

Toàn bộ tài nguyên, manifest, scope và service worker dùng đường dẫn tương đối; đã kiểm thử với `/super-content/`. Repo hiện tại có origin `quangminhdlus-dot/Super-Content`; URL và chữ hoa/thường cuối cùng phải lấy từ kết quả job `deploy`, không suy ra rằng URL dự kiến đã hoạt động.

Sau khi có URL HTTPS: mở bằng Safari trên iPhone → Chia sẻ → **Thêm vào Màn hình chính**. Tên Super Content, biểu tượng PNG riêng, chế độ standalone, safe-area và điều hướng 5 tab. Service worker chỉ lưu tài nguyên tĩnh cùng origin; không lưu phản hồi API hay phiên đăng nhập. Cần mở trực tuyến thành công ít nhất một lần trước khi dùng ngoại tuyến. Khi có bản mới, đóng tất cả cửa sổ ứng dụng rồi mở lại để kích hoạt bản cập nhật.

Đã kiểm tra Chromium desktop/viewport cảm ứng 390×844. Chưa kiểm thử trên iPhone/Safari thật. Chưa xác nhận triển khai Pages hoặc đồng bộ với Supabase thật.

## Nghiên cứu AI cá nhân hóa

**Nâng cấp tìm video bằng mô tả nhu cầu, từ khóa hoặc video mẫu:** xem [hướng dẫn AI Search 004](docs/ai-search.md). Phương pháp và nguồn độc lập, có nhiệm vụ lưu lại, chiến lược có thể sửa và điểm nhu cầu/tiêu chuẩn/thị trường riêng. Cần review migration 004 và cập nhật backend trước khi dùng tính năng mới với dịch vụ thật; không có migration tự chạy.

Nâng cấp nền tảng hiện có với quản lý 500 kênh (nhập 100+ cùng lúc), job có checkpoint phía máy chủ, tiêu chuẩn có phiên bản, phản hồi lựa chọn và ghi nhớ cần xác nhận. Năm công đoạn và kịch bản hiện có được giữ nguyên.

**Bắt đầu tại [hướng dẫn cá nhân hóa 003](docs/personal-research.md)**: migration mới cần phê duyệt, nhập kênh, tiêu chuẩn, bộ nhớ và cấu hình dịch vụ. Không sửa migration 001/002 đã phát hành. Không chạy SQL thật tự động.

```sh
npm run research:server # secrets ở server/.env.example, không đưa vào VITE_*
npm test               # nghiệp vụ + PostgreSQL cục bộ + AI/YouTube giả lập
npm run build
npm run test:e2e        # desktop và kích thước điện thoại
npm run test:sync       # API dịch vụ giả lập
```

Chưa bật lịch tự động, thông báo, MCP hoặc phân tích hiệu suất sau xuất bản. AI/YouTube cần khóa trên backend; Pages chỉ xuất bản frontend. Không có dịch vụ Supabase/YouTube/OpenAI thật nào được cấu hình hoặc chạy migration từ phiên phát triển này.

Xem [phạm vi kiểm thử, các lỗi đã sửa và bước vận hành còn cần xác minh](docs/quality-audit.md). Backend trả revision Render (khi có `RENDER_GIT_COMMIT`) tại `GET /health`; trạng thái `ok` chỉ xác nhận tiến trình HTTP, chưa xác nhận các nhà cung cấp bên ngoài.
