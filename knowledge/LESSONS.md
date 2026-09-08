# Bài học dự án SELTD Supply Chain Dashboard

## 08/09/2026 — Bộ theo dõi lấy mốc đóng băng thì không bao giờ báo động
- **Việc**: anh Louis phát hiện dữ liệu đứng ở 12:25 hôm trước mà app vẫn ghi
  "Bình thường".
- **Sai gì**: màn Cơ sở hạ tầng đo tuổi dữ liệu bằng `exportedAt - pulled`. Cả hai
  mốc đều đóng băng cùng lúc kết xuất, nên hiệu số **không bao giờ lớn lên** —
  không phụ thuộc thời gian thực thì không thể phát hiện "đã lâu không cập nhật".
  Tôi còn viết comment biện hộ cho lựa chọn đó ("so với bây giờ thì báo oan").
- **Sửa gì**: đo từ `Date.now()`, rồi tách thành hai phần để chỉ ra nguyên nhân —
  ETL không kéo được, hay kéo được mà chưa deploy.
- **Rule rút ra**:
  1. **Bất kỳ chỉ số "đã bao lâu rồi" phải neo vào đồng hồ hiện tại.** Nếu công
     thức không chứa `now`, nó không phải chỉ số theo dõi.
  2. **Kiểm bộ báo động bằng dữ liệu đã hỏng thật**, không chỉ dữ liệu tốt. Nạp lại
     đúng file của bản lỗi và xem nó có đổi màu không — nhìn màn hình xanh không
     chứng minh được gì.
  3. Khi thấy comment tự biện hộ cho một lựa chọn thiết kế lạ, đọc lại lựa chọn đó:
     lời biện hộ thường là dấu hiệu hồi đó đã biết nó đáng ngờ.

## 08/09/2026 — Một connection dùng chung phá vỡ cơ chế cô lập lỗi
- **Việc**: lượt ETL 20:00 chết 7/9 bước.
- **Sai gì**: mỗi bước có `try/except` riêng nhưng cùng dùng một connection mở ở
  `main()`. Pooler ngắt một lần là mọi bước sau chết với "the connection is closed".
- **Rule rút ra**: cô lập lỗi phải cô lập cả **tài nguyên**, không chỉ khối `try`.
  Tài nguyên dùng chung mà chết thì cơ chế cô lập chỉ còn trên giấy.

## 08/09/2026 — Việc theo lịch trên laptop không phải là việc theo lịch
- **Sai gì**: launchd bỏ lượt 06:00 vì máy ngủ, bắn bù lúc 09:48 khi chưa có mạng
  rồi chết vì `ensure_token()` nằm ngoài vùng bắt lỗi.
- **Rule rút ra**:
  1. Bước lấy token/đăng nhập phải nằm **trong** vùng bắt lỗi và có chờ-thử-lại —
     nó là bước dễ chết nhất khi máy vừa thức.
  2. Job cần chạy đúng giờ thì đặt ở nơi luôn thức (GitHub Actions), đừng đặt trên
     laptop. Và **job cập nhật dữ liệu chưa xong khi chưa deploy** — kéo về máy
     local mà không đẩy lên thì người dùng vẫn xem số cũ.

## 08/09/2026 — Token tự đổi thì không thể sống trong secret hay file
- **Sai gì**: token Shopee nằm trong `secrets/shopee.json`. Chuyển job lên Actions
  là tắc: `refresh_token` đổi mỗi lần làm mới mà secret chỉ đọc được.
- **Rule rút ra**: tách **thông tin tĩnh** (partner key — để trong secret) khỏi
  **thông tin tự đổi** (access/refresh token — để trong DB dùng chung). Chỉ cho một
  nơi chạy job; hai nơi cùng refresh sẽ vô hiệu hoá token của nhau.

## 08/09/2026 — Đổi máy chạy là đổi múi giờ
- **Sai gì**: `datetime.now().isoformat()` không có múi giờ. Trên laptop VN thì tình
  cờ đúng; lượt Actions đầu tiên ghi "kết xuất 03:20" (UTC) và app đọc thành giờ VN,
  lệch 7 tiếng — đủ để bộ báo động vừa sửa lại báo oan.
- **Rule rút ra**: mọi mốc thời gian ghi ra file cho app đọc **phải có offset**.
  Kiểm bằng cách chạy lại với `TZ=UTC`.

## 08/09/2026 — Hai view cho cùng một chỉ số là hai con số
- **Việc**: audit toàn app.
- **Sai gì**: `mart_sales_sku_day.rev` không trừ voucher shop còn
  `mart_sales_sku_month.rev` thì trừ. Màn Lịch bán hàng báo doanh thu cao hơn mọi
  màn khác **cả 21/21 tháng**, tổng +105,6tr, tháng nặng nhất +34%. Tồn tại âm
  thầm nhiều ngày vì không ai so hai màn với nhau.
- **Rule rút ra**:
  1. Chỉ số nào có **hai đường tính** thì phải có một phép kiểm cộng hai đường lại
     và so — không dựa vào việc đọc code thấy giống nhau.
  2. Khi lệch, so **từng thành phần** (GMV, số lượng, giá vốn, doanh thu) để khoanh
     vùng: ở đây GMV/SL/giá vốn khớp, chỉ doanh thu lệch → ra ngay khoản voucher.
  3. `create or replace view` của Postgres không cho đổi tên cột đã có — cột mới
     phải thêm vào **cuối** danh sách select.

## 08/09/2026 — Cùng một tên chỉ số, hai mẫu số khác nhau
- **Sai gì**: "chi phí quảng cáo" ở màn Marketing là phần gán được chiến dịch
  (48,6tr), ở màn Lãi lỗ là tổng toàn shop (57,3tr). Lệch 15%, riêng 06/2026 mất
  60%. Mọi chỉ số dẫn xuất (ROAS, CPC, TACOS) tính trên mẫu số nhỏ nên ROAS bị
  nhìn cao hơn thật ~18%.
- **Rule rút ra**: khi nguồn cho **hai mức tổng hợp** của cùng một khoản (cấp shop
  và cấp chiến dịch), đừng chọn một cái rồi im lặng. Hiện tổng lớn ở KPI, ghi rõ
  phần không phân bổ được, và nói rõ chỉ số nào tính trên mẫu số nào.

## 08/09/2026 — Kho không bán hàng vẫn bị tính là hàng bán được
- **Sai gì**: tồn của "Kho hàng lỗi" cộng vào tồn khả dụng nên chạy vào điểm đặt
  hàng, tồn chết và vốn đọng. Chỉ 2 unit nên không ai thấy.
- **Rule rút ra**: dữ liệu kho luôn có cột **loại kho** — phải lọc theo nó ngay tại
  nguồn, đừng cộng tất cả rồi mới trừ ở tầng hiển thị. Sai số nhỏ hôm nay là sai
  nguyên tắc, và nó lớn dần.

## 08/09/2026 — Audit phải để lại thứ chạy lại được
- **Việc**: sau khi soát tay ra 3 lỗi thật, tôi dựng tab *Tự soát dữ liệu* với 9
  phép kiểm tính lại mỗi lần mở trang.
- **Rule rút ra**: mỗi lỗi tìm được bằng tay nên biến thành **một phép kiểm sống**
  trong app. Audit một lần chỉ sạch một lần; phép kiểm thì bắt được lần sau.
