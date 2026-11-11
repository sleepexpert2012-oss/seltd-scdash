▶ ĐÃ CHẠY: 2026-11-11 · kết quả: OK (schema_fc.sql đã chạy Supabase 11/11) · output tại: src/screens/ForecastSnap.jsx, src/lib/fcSnap.js, scripts/shopee/schema_fc.sql, test/2026-11-11_ban-du-bao-chot_P5/

# P5 · Dự báo bán & cung ứng: chốt bản dự báo và đối chiếu với thực tế

> Dán vào một phiên Claude Code MỚI tại `/Users/louisle/Claude/seltd-scdash`. Đọc `prompts/active/00_NEN-CHUNG_doc-truoc-moi-prompt.md` trước. Prompt này KHÔNG phụ thuộc P0.

Ảnh tham khảo chức năng: `reference/hcw-plan/m6_du-bao-ban_4-buoc.jpg`, `m6_ban-du-bao.jpg`, `m6_nhom-hang.jpg`.

## Hiện trạng
`src/screens/Forecast.jsx` (màn 7) có 4 tab: Kế hoạch đặt hàng · Hoạch định cung ứng (S&OP) · Dự báo 6 tháng tới · Phương pháp & hệ số. Dự báo được TÍNH LẠI mỗi lần mở (`forecastRestOfYear`, `forecastNext6`, `stockPlan` trong `metrics.js`). Vì không có bản nào được đóng băng nên KHÔNG thể đo dự báo đúng hay sai — đây là lỗ hổng cần vá.

## Trạng thái đích — thêm 2 tab vào `Forecast.jsx`, không sửa 4 tab cũ

### Tab "Bản dự báo"
- Danh sách bản: tên · kịch bản (Thấp / Cơ sở / Cao) · khoảng kỳ (12 tháng) · trạng thái **Đang soạn** / **Đã chốt** · người chốt · ngày chốt.
- Tạo bản mới: lấy số lượng dự báo theo SKU × tháng từ đúng các hàm đang có; kịch bản Thấp/Cao = hệ số nhân người dùng nhập (mặc định 0,85 và 1,15, ghi rõ là giả định).
- Khi Đang soạn: sửa số lượng từng ô SKU × tháng, sửa giá bán dự kiến theo SKU. Ô đã sửa tay có dấu và lưu giá trị máy tính để so.
- **Chốt**: bản thành chỉ đọc vĩnh viễn. Muốn đổi phải nhân bản thành bản mới.
- Tổng quan một bản: doanh thu thuần dự kiến · giá vốn dự kiến · lợi nhuận gộp và biên gộp · cột doanh thu theo kỳ với đường lợi nhuận gộp (thấy mùa vụ) · nhóm hàng nào kéo doanh thu (vành khuyên theo ngành) · 7 SKU đứng đầu.
- Câu nhận định về mùa vụ: tháng đỉnh, đỉnh gấp mấy lần tháng thấp nhất, cần hàng về trước ngày nào (tháng đỉnh trừ lead time đang dùng ở `stockPlan`).

### Tab "Đối chiếu dự báo"
Chọn một bản ĐÃ CHỐT. Chỉ tính trên các tháng đã có thực tế trọn vẹn.
- **WAPE** = Σ|thực tế − dự báo| ÷ Σ thực tế. **Bias** = Σ(dự báo − thực tế) ÷ Σ thực tế (dương = dự báo cao hơn thực tế).
- **Tỷ lệ trúng** = % SKU có sai số trong ±20%.
- **Giá trị gia tăng của dự báo** = WAPE của cách ngây thơ (bình quân 3 tháng gần nhất trước ngày chốt) − WAPE của bản. Âm nghĩa là dự báo còn tệ hơn đoán đơn giản.
- Bảng theo ngành rồi mở xuống SKU: `Dự báo | Thực tế | Sai lệch SL | Sai lệch % | Bias | Hậu quả`.
- Cột **Hậu quả** quy ra tiền: dự báo thừa → vốn nằm trong tồn dư (SL thừa × giá vốn); dự báo thiếu → doanh thu mất (SL thiếu × giá bán), chỉ ghi "mất" khi SKU đó có ngày hết hàng trong kỳ.
- Nhận định: 5 SKU lệch nhiều tiền nhất và hướng xử lý (chỉnh hệ số nào ở tab "Phương pháp & hệ số").

## Dữ liệu
`scripts/shopee/schema_fc.sql`: `fc_snapshot` (id, name, scenario, factor, from_ym, to_ym, status, created_by, locked_at, locked_by, note) · `fc_snapshot_line` (snapshot_id, sku, ym, qty_calc, qty, price). RPC: `save_fc_snapshot`, `save_fc_lines`, `lock_fc_snapshot`. Hàm ghi phải TỪ CHỐI sửa bản đã chốt ở phía DB, không chỉ khoá ở giao diện.

## Cạm bẫy phải tránh
- Thực tế dùng để đối chiếu = bán trên sàn + bán ngoài sàn (phiếu xuất), đúng như nhu cầu đang dùng ở `SKU_DEMAND`. Lệch phạm vi là sai số giả.
- Tháng hết hàng: thực tế thấp vì không có hàng, không phải vì nhu cầu thấp. Đánh dấu các ô này và cho công tắc loại khỏi WAPE.
- SKU mới chưa có trong bản đã chốt → liệt kê riêng, không tính vào WAPE.
- KHÔNG viết lại thuật toán dự báo. Chỉ đóng băng kết quả và đo.
- WAPE tính ở cấp SKU rồi cộng, không tính trên tổng (tổng che sai số bù trừ nhau).

## Được sửa
`src/screens/Forecast.jsx` · `forecast.css` · `src/lib/metrics.js` (chỉ thêm hàm) · `src/lib/cloud.js` · `scripts/shopee/schema_fc.sql` (mới) · `Guide.jsx` · `INDEX.md` · `knowledge/LESSONS.md`.

## DỪNG và hỏi tôi khi
- Viết xong `schema_fc.sql`.
- Chưa có bản chốt nào đủ cũ để đối chiếu → dựng xong tab, hiện trạng thái "cần chốt ít nhất 1 bản và chờ hết 1 tháng", rồi dừng. KHÔNG tạo bản chốt lùi ngày để có số đẹp.

## Xong khi
- [ ] Tổng số lượng của bản mới (kịch bản Cơ sở, chưa sửa tay) = tổng ở tab "Dự báo 6 tháng tới"/kế hoạch hiện có cho cùng khoảng kỳ.
- [ ] Gọi RPC sửa một bản đã chốt → DB trả lỗi.
- [ ] WAPE kiểm tay trên 3 SKU khớp.
- [ ] 4 tab cũ không đổi một con số nào.
- [ ] `npm run build` qua; có ảnh chụp.
