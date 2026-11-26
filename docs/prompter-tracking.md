# Theo giọng nói: phạm vi hiển thị

Nguồn chính sách: `src/prompter-guide.ts`, `src/prompter-matcher.ts`.
Nguồn kết nối runtime: `scripts/prompter-hosted.tsx`, `scripts/prompter-semantic.worker.ts`; đây là bản nguồn TypeScript để build vào cây nhúng hiện có, không phải bản vá bundle.

Cây nguồn nhúng đã xác minh: `../capture-quality`. Trước thay đổi, build runtime có SHA-256 chuẩn hóa LF `e371ac3be419cda7cc0b42da629ebfeb798382e531121f2f1aec4e58ae3881e9`, khớp `public/prompter/runtime.js` tại commit `0d4ff158bb7eca41b55bc9bb61049c27b2d558cc`.

Build bằng `node scripts/build-prompter-tracking.mjs [đường-dẫn-cây-nguồn-nhúng]`. Script kiểm tra hash các nguồn quay/thu âm/nhận diện được bảo vệ, đồng bộ đúng ba nguồn theo dõi, dùng Vite của cây nguồn hiện có và chỉ xuất runtime, worker semantic và release. Không xóa tài nguyên cũ, video hoặc bộ nhớ trình duyệt. Việc build lại cần cây nguồn nhúng hiện có cùng dependency của nó; repo này giữ nguồn thay đổi và bundle triển khai.

Thuật toán xét các câu giao với viewport cộng một dòng đệm. Câu giao với viewport được xét trọn câu. Mỗi lượt chỉ xếp hạng vùng này; chỉ mục kịch bản được tạo một lần. Cụm cuối lời nói có trọng số cao hơn phần đầu cũ của cửa sổ ASR. Các câu tương tự/trùng nhau cần từ phân biệt hoặc khoảng cách semantic rõ. Câu xa cần cụm mạnh hoặc xác nhận bổ sung; câu rõ có thể nhảy trực tiếp cả xuôi và ngược. Cuộn tay reset lịch sử, tạm ngưng áp dụng lời nói và loại kết quả semantic cũ.

Kiểm thử: `node --test tests/prompter-tracking.test.js` (10 tình huống tiếng Việt); `npx playwright test tests/browser/prompter-tracking.spec.js --workers=1` (reader thực, desktop/mobile, không media). Semantic dùng điểm giả lập để xác minh chính sách, không phải đo chất lượng mô hình thực. Không xác minh iPhone thật. Giữ mô hình và bộ nhận diện hiện có; nếu mô hình chưa sẵn sàng, chỉ bám bằng cụm từ. Hai ý không có dấu hiệu phân biệt sẽ giữ yên.

Workflow Pages hiện có nhận biết tập file chỉ liên quan tracking để chạy đúng hai bài kiểm thử trên và bỏ các bài media/sync không liên quan. Thay đổi ngoài tập này vẫn chạy bộ kiểm tra thông thường.

Mốc khôi phục: nhánh `codex/before-smart-tracking-20261126` tại `0d4ff15`. Nhánh `codex/rollback-camera-preview-20261126` được giữ nguyên.
