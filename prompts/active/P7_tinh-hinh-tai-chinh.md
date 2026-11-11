# P7 · Tình hình tài chính: bảng cân đối, thẻ điểm sức khỏe, lưu chuyển tiền theo quý

> Dán vào một phiên Claude Code MỚI tại `/Users/louisle/Claude/seltd-scdash`. Đọc `prompts/active/00_NEN-CHUNG_doc-truoc-moi-prompt.md` trước.

Ảnh tham khảo chức năng: `reference/hcw-plan/m3_tinh-hinh-tai-chinh_va-menu.jpg`, `m3_scorecard.jpg`.

## ĐIỀU KIỆN CHẶN — kiểm trước khi làm bất cứ việc gì
App không có và không tự suy ra được bảng cân đối kế toán. Trước khi viết code, hỏi tôi 2 câu và CHỜ trả lời:
1. File bảng cân đối kế toán (và báo cáo lưu chuyển tiền tệ nếu có) nằm ở đâu, theo kỳ nào (tháng / quý / năm)?
2. Bảng cân đối sẽ đọc được bằng khoá anon nếu để trên trang công khai — tôi chấp nhận, hay chờ có đăng nhập thật phía máy chủ?
Chưa có câu trả lời cho cả hai thì KHÔNG tạo bảng, KHÔNG dựng màn.

## Trạng thái đích (sau khi có trả lời)
Màn mới `src/screens/Position.jsx` — "Tình hình tài chính", nhóm **Tài chính**, 2 tab.

### Tab "Nhập số" — nơi duy nhất nhập
- Lưới khoản mục × kỳ chốt. Khoản mục theo mẫu B01-DNN rút gọn: Tiền · Phải thu · Tồn kho · TS ngắn hạn khác · TSCĐ & dài hạn (nguyên giá, khấu hao lũy kế) | Phải trả người bán · Thuế phải nộp · Vay ngắn hạn · Nợ ngắn hạn khác · Vay dài hạn · Vốn chủ · Lợi nhuận chưa phân phối.
- Lưu chuyển tiền theo quý: hoạt động kinh doanh / đầu tư / tài chính.
- Dán từ Excel, nhập/xuất Excel.
- **Kiểm cân**: Tổng tài sản phải bằng Tổng nguồn vốn. Lệch → hiện số lệch, vẫn cho lưu nháp nhưng kỳ đó KHÔNG được đưa vào tab Trực quan.
- Cạnh ô Tiền / Phải thu / Tồn kho / Phải trả người bán: hiện số app tự tính cùng ngày làm tham chiếu và mức lệch. Không tự điền.

### Tab "Trực quan"
- **Thẻ điểm** tại kỳ chốt đang chọn, mỗi chỉ số có đèn xanh/vàng/đỏ và ngưỡng hiện ngay bên dưới:
  Thanh toán hiện hành = TS ngắn hạn ÷ Nợ ngắn hạn · Thanh toán nhanh = (TS ngắn hạn − Tồn kho) ÷ Nợ ngắn hạn · Nợ ÷ Vốn chủ · ROE = LN sau thuế ÷ Vốn chủ bình quân · ROA = LN sau thuế ÷ Tổng tài sản bình quân.
- Một câu kết luận tổng: mấy trên 5 chỉ số đạt ngưỡng, chỉ số yếu nhất là gì và nguyên nhân từ khoản mục nào.
- Cơ cấu tài sản và cơ cấu nguồn vốn (2 vành khuyên) + so với kỳ trước (khoản nào tăng/giảm nhiều nhất).
- Doanh thu & lợi nhuận sau thuế theo quý; lưu chuyển tiền theo quý (3 cột kinh doanh/đầu tư/tài chính).
- TSCĐ: giá trị còn lại theo kỳ.
- So nhiều năm nếu có từ 2 năm số trở lên; chỉ có 1 năm thì ẩn khối này, không vẽ đường một điểm.

## Dữ liệu
`scripts/shopee/schema_bs.sql`: `bs_line` (danh mục khoản mục, bên tài sản/nguồn vốn, ngắn/dài hạn) · `bs_value` (period_end, line, amount) · `cf_quarter` (yq, loai, amount) · `bs_threshold` (chỉ số, ngưỡng xanh, ngưỡng vàng — người dùng sửa được) · `bs_log`. RPC ghi tương ứng. KHÔNG kết xuất ra `src/data/`.

## Cạm bẫy phải tránh
- ROE/ROA dùng số dư BÌNH QUÂN đầu kỳ–cuối kỳ; chỉ có một kỳ thì ghi "dùng số cuối kỳ" ngay cạnh con số.
- ROE/ROA theo quý phải ghi rõ là số của quý, không tự nhân 4 thành số năm.
- Lợi nhuận sau thuế lấy từ số kế toán nhập ở đây, KHÔNG lấy lợi nhuận ở màn Lãi lỗ (màn đó là lãi lỗ quản trị, chưa có thuế và khấu hao). Hiện cả hai và mức lệch để người đọc biết.
- Ngưỡng đèn mặc định phải ghi nguồn/giả định và cho sửa; không trình bày như chuẩn mực tuyệt đối.
- Mẫu số bằng 0 hoặc âm (vốn chủ âm) → hiện "không tính được" kèm lý do.

## Được sửa
`src/screens/Position.jsx` + `position.css` (mới) · `src/lib/cloud.js` · `scripts/shopee/schema_bs.sql` (mới) · `src/app/nav.js` · `src/app/AppShell.jsx` · `Guide.jsx` · `INDEX.md` · `knowledge/LESSONS.md`.

## DỪNG và hỏi tôi khi
- (Đầu phiên) hai câu ở mục Điều kiện chặn.
- Viết xong `schema_bs.sql`.
- File kế toán tôi đưa có khoản mục không xếp được vào danh mục rút gọn.

## Xong khi
- [ ] Nhập một kỳ lệch cân → kỳ đó không xuất hiện ở tab Trực quan.
- [ ] 5 chỉ số kiểm tay trên một kỳ khớp.
- [ ] Tổng hai vành khuyên = Tổng tài sản = Tổng nguồn vốn.
- [ ] Không có file nào trong `src/data/` chứa số bảng cân đối.
- [ ] `npm run build` qua; có ảnh chụp.
