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

## 09/09/2026 — Nhật ký đặt sai chỗ thì mất luôn khả năng phát hiện
- **Việc**: anh Louis thấy `fact_return` "lần cuối 07/09" trong khi job chạy đủ.
- **Sai gì**: `db.Run(...)` đặt trong `if __name__ == '__main__'` chứ không trong hàm
  mà `run_all.py` gọi. Chạy tay có nhật ký, chạy theo lịch không có. Ba bước bị vậy.
  Dữ liệu vẫn đúng nên không ai thấy gì sai — nhưng nếu bước đó hỏng thật thì bảng
  theo dõi cũng hiện y như thế.
- **Rule rút ra**:
  1. Ghi nhật ký phải nằm **trong hàm làm việc**, không nằm ở entry point. Entry
     point chỉ gọi hàm.
  2. Sau khi dựng bảng theo dõi, phải kiểm **mọi bước đều xuất hiện trong đó** —
     bước im lặng nhìn giống bước khoẻ.
  3. Bộ tự soát phải có một phép kiểm cho **chính bộ theo dõi**: mọi job phải ghi
     nhật ký ở cùng một lượt. Tôi bỏ sót phép kiểm này ở đợt audit hôm trước.

## 11/09/2026 — Chú thích sai còn nguy hiểm hơn không có chú thích
- **Việc**: dựng màn Giới thiệu & Định nghĩa, đọc lại meta của file dữ liệu.
- **Sai gì**: mọi file JSON bị đóng dấu *"Đã loại 19 SKU không có trong Master Data
  (17.9tr doanh thu, ~0.9%)"*. Câu truy vấn join vào `model_sku` THÔ nên đếm cả SKU chỉ
  bị **đổi tên** — chúng vẫn nằm trong app qua bảng `sku_alias`. Phần mất thật chỉ
  0,2tr (0,01%). Tệ hơn: con số "~0.9%" là **hằng số gõ tay**, không tính từ dữ liệu,
  nên không bao giờ tự sai lệch lộ ra.
- **Rule rút ra**:
  1. Không bao giờ gõ tay một tỷ lệ vào chú thích — tính từ chính dữ liệu, để nó tự đúng
     hoặc tự lộ ra khi sai.
  2. Khi đối chiếu "cái gì bị loại", phải so trên khoá **đã chuẩn hoá**, không so trên
     khoá thô — nếu không sẽ đếm nhầm phép đổi tên thành mất dữ liệu.
  3. Kiểm chú thích bằng cách so tổng hai đầu (app vs mart). Lệch 0,2tr mà chú thích nói
     17,9tr là đủ để biết chú thích sai.

## 11/09/2026 — Từ điển chỉ số phải nằm trong app, không nằm trong đầu
- **Việc**: dựng tab *Từ điển chỉ số* (44 chỉ số) trong màn Giới thiệu & Định nghĩa.
- **Vì sao cần**: gần như mọi tranh luận về số trong dự án này hoá ra là **hai người dùng
  hai định nghĩa khác nhau** cho cùng một chữ (GMV vs doanh thu, phí sàn có gồm voucher
  không, ROAS nào). Mỗi lần lại giải thích lại từ đầu.
- **Rule rút ra**: mỗi chỉ số cần ba thứ, không phải một: **công thức · nguồn · cạm bẫy**.
  Cột "cạm bẫy" (chỗ đã có người đọc sai thật) là cột giá trị nhất và là cột hay bị bỏ nhất.
  Và phải cảnh báo ngay trong code: sửa công thức mà không sửa từ điển thì nó thành
  **sai lệch có thẩm quyền**, tệ hơn là không có từ điển.

## 2026-11-10 — Màn Bán hàng / Phiếu xuất kho / Danh mục
**Việc**: dựng nhập liệu cho kênh ngoài sàn + bảng đối chiếu công nợ gửi khách.

**Sai gì**
1. Gom đơn hàng, phiếu xuất và danh mục vào một màn "Bán hàng đại lý". Sai hai lớp:
   đặt tên theo một kênh (đại lý) nên không dùng lại được cho kênh khác, và gom
   nghiệp vụ kho vào màn bán. Người dùng phải nhắc ba lần mới tách đúng.
2. `ar_order_line` chỉ lưu `qty` và `price`. Đơn DH001 có 71 cái chăn tặng (chiết
   khấu 100%) nên giá trị đơn bị thổi từ 20,3tr lên 63,9tr.
3. Cộng ngày bằng `new Date(iso+'T00:00:00')` rồi `toISOString()`. Ở múi +7 ngày bị
   lùi một: hạn thanh toán 05/09 ra 04/09, mọi số "quá hạn (ngày)" lệch 1.
4. `fetchSales()` và `export_app_data.py` chọn cột theo danh sách cứng. Thêm cột vào
   DB mà quên sửa hai chỗ này thì app vẫn chạy, chỉ là hiện số sai — không có lỗi nào.

**Sửa gì**
- Tách ba màn theo nghiệp vụ, đặt tên trung tính ("Bán hàng"), nhóm menu riêng.
- Thêm `disc`/`amount`/`note` vào `ar_order_line`, `save_order()` tự tính `amount`.
- `src/lib/doiChieu.js` dùng `Date.UTC` + `setUTCDate` cho mọi phép ngày.
- Đối chiếu kết quả với chính file Excel đang gửi khách, từng ô.

**Rule rút ra**
- **Đặt tên màn theo việc, không theo kênh.** "Bán hàng" dùng lại được, "Bán hàng
  đại lý" thì không.
- **Một màn một nghiệp vụ.** Đơn là cam kết, xuất kho là hàng đi — hai thứ sinh ra
  hai loại số, đừng gom.
- **Mọi phép cộng ngày trong app phải chạy bằng UTC.** Không có ngoại lệ.
- **Thêm cột vào DB là việc bốn chỗ**: schema · hàm ghi · `cloud.js` · `export_app_data.py`.
  Thiếu một chỗ thì sai số mà không báo lỗi.
- **Nghiệm thu bằng chính file gốc khách đang giữ**, so từng ô, không so tổng.

## 2026-11-10 (bổ sung) — Xuất Excel có định dạng
**Việc**: bản đối chiếu công nợ gửi khách phải có màu/viền như file mẫu.

**Sai gì**: dùng `xlsx` (SheetJS cộng đồng) để xuất. Nó ghi dữ liệu đúng nhưng
**âm thầm bỏ hết style** — không lỗi, không cảnh báo, chỉ là file ra trắng trơn.

**Sửa gì**: chuyển riêng đường xuất đối chiếu sang `xlsx-js-style` (fork cùng API).
Đọc style file mẫu bằng openpyxl để lấy đúng mã màu, độ rộng cột, cỡ chữ, kiểu viền,
rồi dựng lại từng ô — không đoán màu bằng mắt.

**Rule rút ra**
- **`xlsx` bản cộng đồng không ghi được style.** Cần màu thì dùng `xlsx-js-style`.
- **Muốn giống mẫu thì đọc mẫu bằng máy**, lấy mã màu thật (`1F3864`, `BFBFBF`…),
  đừng ước lượng từ ảnh chụp.
- **Nghiệm thu file xuất bằng cách mở lại và so từng ô với mẫu**, cả giá trị lẫn style.
- Tô xen kẽ bảng chi tiết phải theo **cụm nghiệp vụ** (từng phiếu), không theo dòng.

## 2026-11-11 · P0 Kế hoạch & Ngân sách
- **Việc:** dựng lớp ngân sách + chi phí thực tế nhập tay (`fin_*`, `src/lib/fin.js`, màn Kế hoạch & Ngân sách).
- **Sai suýt mắc:** (1) dòng `ads` của Dòng tiền gộp cả Shopee Ads lẫn tiếp thị ngoài — đưa thẳng vào chi phí là đếm hai lần quảng cáo Shopee; đã tách `ads_shopee` (tự tính) và `ads` (chỉ phần ngoài Shopee). (2) Ô nhập theo "triệu" mà gõ số đồng đầy đủ ra 52.300 tỷ không báo gì. (3) Dòng tổng hiện 0 khi chưa có số nào → người đọc tưởng lợi nhuận bằng 0. (4) Bắt nhập thuế TNDN hằng tháng thì không tháng nào "đủ chi phí".
- **Sửa:** tách khoản; hỏi lại khi một ô ≥ 100 tỷ; ô/tổng không có số để trống, không ghi 0; loại thuế khỏi phép kiểm đủ tháng.
- **Rule:** dữ liệu nhập tay phân biệt "chưa có số" (null) với "0" ở MỌI tầng — DB (không có dòng), hàm tính (null), giao diện (ô trống, nhãn "chưa nhập"). Supabase REST cắt ở 1.000 dòng không báo lỗi → bảng có thể vượt ngưỡng phải đọc theo trang.

## 2026-11-11 · P1–P6 lớp quản trị tài chính
- **Việc:** dựng Kế hoạch vs Thực đạt, Định mức chi phí, Điểm hòa vốn, Dòng tiền theo tháng + Vốn lưu động, Bản dự báo chốt, Báo cáo điều hành.
- **Sai suýt mắc:**
  1. % đạt khi kế hoạch âm: KH lỗ −655 mà thực tế lỗ −751 ra "đạt 115%" — đọc như vượt kế hoạch.
  2. Mẫu số chung cho mọi chi phí: giá vốn Shopee chia doanh thu toàn công ty ra 45% thay vì 63%.
  3. Nối số dư dòng tiền liên tục từ tuần đầu, bỏ qua tuần người dùng đã nhập tiền mặt thực tế → số dư −744 tr trong khi thật là 16,8 tr.
  4. Prompt giả định `SKU_DEMAND` gồm bán ngoài sàn — thực ra chỉ Shopee; so dự báo với cả ngoài sàn là lệch phạm vi.
  5. Regex Postgres: `\b` là ký tự backspace, ranh giới từ là `\y`.
  6. Chuyển trang qua menu mới sau HMR có thể không ăn (PAGES dựng lúc nạp module) → tải lại trang trước khi kết luận lỗi.
- **Rule:** tỷ lệ "% đạt" chỉ dùng khi mẫu dương; mỗi chi phí chia cho doanh thu của kênh sinh ra nó; số người dùng nhập tay (tiền mặt thực tế) luôn thắng số nối từ kế hoạch; kiểm phạm vi dữ liệu của hàm có sẵn trước khi so.
