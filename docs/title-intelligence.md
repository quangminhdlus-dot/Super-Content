# Tiêu đề YouTube dựa trên dữ liệu (11/2026)

## Mục tiêu
Thay đề xuất một tiêu đề mô tả đơn thuần bằng **ba tiêu đề tạo tò mò có kiểm soát** cho nội dung phát triển con người, thói quen, sự nghiệp, lãnh đạo và kinh doanh. Tiêu đề đầu tiên tự điền nếu người dùng chưa đặt tiêu đề; hai phương án còn lại được hiển thị để thay thế bằng một chạm trong trình biên tập.

## Quy trình hoạt động
1. Người dùng viết/ghi âm ý tưởng; nội dung được lưu trước để tránh mất dữ liệu.
2. AI rút một cụm tìm kiếm tiếng Anh phản ánh chủ đề, không dùng nguyên văn phụ đề làm truy vấn dài.
3. **Nếu YOUTUBE_API_KEY tồn tại trên Render:** YouTube Data API trả video cùng chủ đề được xuất bản trong 365 ngày gần nhất; hệ thống chỉ giữ video dài ít nhất 3 phút và có ít nhất 5.000 lượt xem, xem tối đa 50 kết quả.
4. Từ tối đa 8 video đáng xem, ứng dụng lấy khoảng 50 video mới nhất từ mỗi kênh để tìm **trung vị lượt xem/ngày tính từ lúc xuất bản** trong nhóm cùng độ dài và tuổi đời tương đương. Chỉ xác nhận video vượt tương đối khi có ít nhất 5 video đối chứng và chỉ số ≥2×; ưu tiên nhóm xuất bản trong 6 tháng vừa qua khi phù hợp. Đây là **đại diện hiệu suất tích lũy**, không phải tăng trưởng view thực theo giờ/ngày hoặc tỷ lệ nhấp.
5. AI tham khảo **cấu trúc tiêu đề**, không sao chép nội dung, rồi đề xuất ba cách khai thác dựa trên các mô thức: nghịch lý; sự thật bị bỏ qua; cái giá vô hình; câu hỏi trái kỳ vọng; so sánh hai cách sống; bước ngoặt.
6. Giao diện cho chọn từng tiêu đề, hiển thị công thức và mức độ đối chiếu. Khi có video nguồn, cung cấp liên kết YouTube; nếu không, ghi rõ chưa đủ dữ liệu.

## Giới hạn và trung thực
- Không ai có thể đọc tỷ lệ nhấp, mức giữ chân, số lần hiển thị hoặc doanh thu của video thuộc kênh khác qua YouTube Data API công khai. Lượt xem cao có thể do nhiều yếu tố khác ngoài tiêu đề: chủ đề, hình đại diện, kênh, phân phối, thời điểm.
- Không tuyên bố các mô thức *đã được chứng minh hiệu quả nhân quả* chỉ từ dữ liệu quan sát. Sau khi xuất bản video trên chính kênh, có thể kiểm chứng bằng thử nghiệm tiêu đề của YouTube Studio, khi tài khoản hỗ trợ.
- Nếu khóa YouTube trống, API hạn mức, thất bại, hoặc ít đối chứng, vẫn tạo tiêu đề bằng sáu công thức có kiểm soát nhưng **không gắn nhãn đã nghiên cứu thị trường**.
- Giới hạn chi phí: tối đa một truy vấn tìm kiếm/chủ đề (100 đơn vị API), tối đa 8 kênh đối chứng; cache 6 giờ, giới hạn dự trữ 2.600 đơn vị/ngày trên tiến trình máy chủ. Không đảm bảo quét toàn bộ YouTube; Google có hạn mức 10.000 đơn vị/ngày mặc định cho dự án đủ điều kiện.
- Mẫu tiếng Anh chỉ là nguồn tham khảo dạng tiêu đề; kết quả cho người dùng luôn bằng tiếng Việt. Mô hình phải giữ nguyên luận điểm, không dựng số liệu hoặc hứa hẹn không có trong ý tưởng.
- Không lưu ý tưởng, phụ đề hay khóa API vào dữ liệu nghiên cứu. Khóa YouTube và OpenAI chỉ chạy ở máy chủ. Tất cả yêu cầu AI đều cần Supabase xác thực.

## Triển khai
- Cần `OPENAI_API_KEY` và `YOUTUBE_API_KEY` trên cùng **máy chủ Super Content** ở Render, không đặt trong biến `VITE_*`.
- Cần xuất bản **frontend GitHub Pages và backend Render** cùng phiên bản thay đổi; chỉ triển khai frontend sẽ chưa nâng cấp kết quả AI.
- Không cần migration SQL, không sửa bảng Super Day, không đụng tới lịch thông báo.
- Bài thử chính: `npm test`, `npm run build`, `npm run test:e2e`, `npm run test:sync`.

## Giai đoạn nâng cấp tiếp theo
Đây là nghiên cứu **theo nhu cầu khi tạo ý tưởng**, không phải dịch vụ quét âm thầm 24 giờ. Nếu muốn theo dõi tự động mỗi ngày/hàng tuần, có thể sử dụng tiến trình quét kênh hiện có và lưu lịch sử lượt xem theo phiên, từ đó tính tốc độ tăng trưởng thực; bước này cần cấu hình lịch chạy, quyền và ngân sách riêng.
