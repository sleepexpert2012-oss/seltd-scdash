▶ ĐÃ CHẠY: 2026-11-11 · kết quả: OK (schema_wc.sql đã chạy Supabase 11/11) · output tại: src/screens/Cashflow.jsx (TheoThang, VonLuuDong), src/lib/fin.js (workingCapital), scripts/shopee/schema_wc.sql, test/2026-11-11_dong-tien-thang-von-luu-dong_P2/

# P2 · Dòng tiền: nhìn 12 tháng + Vốn lưu động (chu kỳ tiền mặt)

> Dán vào một phiên Claude Code MỚI tại `/Users/louisle/Claude/seltd-scdash`. Đọc `prompts/active/00_NEN-CHUNG_doc-truoc-moi-prompt.md` trước. Prompt này KHÔNG phụ thuộc P0.

Ảnh tham khảo chức năng: `reference/hcw-plan/m2_dong-tien-12-thang.jpg`, `m2_von-luu-dong-ccc.jpg`.

## Hiện trạng
`src/screens/Cashflow.jsx` (màn 13) có 3 tab: "Kế hoạch theo tuần" (tuần ISO, người dùng tự nhập), "Báo cáo lãnh đạo" và "Theo khách hàng". Có cảnh báo tuần âm quỹ. Chưa có: góc nhìn theo tháng, tốc độ đốt tiền, ngưỡng quỹ tối thiểu, chu kỳ tiền mặt.

## Trạng thái đích — thêm 2 tab vào `Cashflow.jsx`

### Tab "Theo tháng"
Gộp kế hoạch tuần thành tháng (tuần gán vào tháng theo ngày thứ Năm). Không thêm ô nhập nào ngoài MỘT ô "Quỹ tối thiểu" (lưu Supabase, cùng cơ chế với kế hoạch tuần).
- 4 thẻ: Tổng thu · Tổng chi · Dòng tiền thuần · Số dư cuối kỳ.
- Dải cảnh báo: tháng/tuần ĐẦU TIÊN số dư xuống dưới quỹ tối thiểu, thiếu bao nhiêu.
- Tốc độ đốt tiền = bình quân dòng tiền thuần của 3 tháng gần nhất CÓ dòng tiền thuần âm; đường băng = số dư hiện tại ÷ tốc độ đốt (tháng). Không có tháng âm → ghi "không đốt tiền", không hiện số vô cực.
- Biểu đồ cột thu/chi + đường dòng tiền thuần theo tháng; biểu đồ đường số dư cuối tháng với đường ngang quỹ tối thiểu.

### Tab "Vốn lưu động"
Chọn kỳ chốt (cuối tháng). Hiện:
- **Chu kỳ tiền mặt (CCC) = DIO + DSO − DPO**, kèm 3 thanh DIO/DSO/DPO.
- DIO = giá trị tồn cuối kỳ (theo giá vốn) ÷ giá vốn hàng bán 90 ngày gần nhất × 90.
- DSO = phải thu cuối kỳ ÷ doanh thu bán chịu 90 ngày × 90. Tách HAI dòng: khách ngoài sàn (từ `ar_*`: phiếu xuất − thanh toán) và tiền Shopee chưa giải ngân (nếu dữ liệu escrow trong Supabase cho phép tính; không tính được thì bỏ dòng này và GHI RÕ là chưa tính).
- DPO = phải trả nhà cung cấp cuối kỳ (`supplier_debt`) ÷ giá vốn hàng mua 90 ngày × 90.
- 3 thẻ tiền: Giá trị tồn · Phải thu · Phải trả; và Vốn lưu động ròng = Tồn + Phải thu − Phải trả.
- Nhận định: khâu nào giam tiền nhiều nhất, rút 1 ngày ở khâu đó giải phóng bao nhiêu đồng (= mẫu số ngày tương ứng).
- **Xu hướng CCC**: chỉ vẽ từ kỳ có dữ liệu thật. Phải thu dựng lại được từ ngày phiếu/thanh toán; tồn dựng lại được từ mốc kiểm kho `BASE_AS_OF` trở đi; công nợ nhà cung cấp chỉ có ảnh chụp hiện tại. KHÔNG nội suy quá khứ. Thêm bảng `wc_snapshot` + bước ghi ảnh chụp cuối tháng trong `export_app_data.py` để lịch sử tích luỹ dần.

## Cạm bẫy phải tránh
- Giá vốn chưa phủ hết SKU → giá trị tồn bị THẤP. Hiện "tính trên N/143 SKU, thiếu giá vốn M SKU chiếm X% số lượng tồn". Không cho DIO ra số đẹp giả.
- Doanh thu Shopee không phải bán chịu theo nghĩa công nợ khách hàng; đừng lấy tổng doanh thu làm mẫu số DSO của khách ngoài sàn.
- Phiếu xuất có VAT: phải thu gồm VAT, làm tròn theo từng phiếu (đã có trong `doiChieu.js` — gọi lại, không viết bản mới).
- Công nợ nhà cung cấp là số người dùng báo, có ngày cập nhật → hiện ngày đó cạnh DPO.

## Được sửa
`src/screens/Cashflow.jsx` · `cashflow.css` · `src/lib/metrics.js` (chỉ thêm hàm) · `src/lib/cloud.js` · `scripts/shopee/schema_wc.sql` (mới) · `scripts/shopee/export_app_data.py` · `Guide.jsx` · `INDEX.md` · `knowledge/LESSONS.md`.

## DỪNG và hỏi tôi khi
- Viết xong `schema_wc.sql`.
- Không xác định được tiền Shopee chưa giải ngân từ dữ liệu hiện có.
- Số dư cuối tháng tính từ tab mới lệch với số dư cuối tuần tương ứng ở tab kế hoạch tuần.

## Xong khi
- [ ] Tổng thu, tổng chi 12 tháng ở tab "Theo tháng" = tổng các tuần ở tab kế hoạch tuần (lệch 0 đồng).
- [ ] Phải thu ở tab Vốn lưu động = tổng "còn phải thu" ở tab "Theo khách hàng" cùng ngày chốt.
- [ ] Mỗi chỉ số DIO/DSO/DPO bấm vào thấy được tử số, mẫu số, độ phủ.
- [ ] 3 tab cũ không đổi hành vi.
- [ ] `npm run build` qua; có ảnh chụp.
