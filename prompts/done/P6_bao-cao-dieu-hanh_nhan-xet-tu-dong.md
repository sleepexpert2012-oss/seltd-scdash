▶ ĐÃ CHẠY: 2026-11-11 · kết quả: OK (schema_report.sql đã chạy Supabase 11/11) · output tại: src/screens/Report.jsx, src/lib/insights.js, scripts/shopee/schema_report.sql, test/2026-11-11_bao-cao-dieu-hanh_P6/

# P6 · Báo cáo điều hành: nhận xét tự động + nhận định của người viết + in/xuất

> Dán vào một phiên Claude Code MỚI tại `/Users/louisle/Claude/seltd-scdash`. Đọc `prompts/active/00_NEN-CHUNG_doc-truoc-moi-prompt.md` trước. Nên chạy SAU P1–P5 để có nhiều quy tắc hơn, nhưng không bắt buộc: quy tắc nào thiếu dữ liệu thì tự bỏ qua.

Ảnh tham khảo chức năng: `reference/hcw-plan/m9_ai-phan-tich.jpg`, `m9_nhan-dinh.jpg`.

## Quyết định kiến trúc đã chốt (không bàn lại)
"Nhận xét tự động" là **bộ quy tắc tất định chạy trong trình duyệt**, KHÔNG gọi mô hình ngôn ngữ. Lý do: trang là web tĩnh công khai, không có chỗ giấu khoá API; và số trong báo cáo điều hành phải tái lập được — cùng dữ liệu luôn ra cùng câu. KHÔNG thêm lời gọi API AI nào, kể cả "tuỳ chọn".

## Trạng thái đích

### 1. `src/lib/insights.js` — bộ quy tắc
Hàm thuần `runInsights({ from, to, compare })` trả về mảng:
`{ id, nhom, muc_do: 'canh_bao'|'luu_y'|'tot', tieu_de, bang_chung: [{nhan, gia_tri}], vay_thi_sao, hanh_dong, man_nguon }`
và mảng `bo_qua: [{ id, ly_do }]` cho quy tắc không đủ dữ liệu.

Mỗi quy tắc là một hàm riêng, có ngưỡng khai báo thành hằng số ở đầu file kèm chú thích vì sao chọn ngưỡng đó. Dựng đúng các quy tắc sau:
| id | Phát hiện | Nguồn |
|---|---|---|
| `tap_trung_thang` | Một tháng chiếm > 35% doanh thu kỳ | metrics |
| `tap_trung_sku` | 5 SKU đầu chiếm > 50% doanh thu | metrics |
| `tap_trung_khach` | Một khách ngoài sàn chiếm > 50% phải thu | `ar_*` |
| `ln_lech_ke_hoach` | Lợi nhuận lệch kế hoạch > 5% và khoản gây lệch lớn nhất | P1 |
| `bien_doi_chieu` | Doanh thu và lợi nhuận đi ngược chiều so kỳ trước | Pnl |
| `phi_san_tang` | Phí sàn % doanh thu tăng > 1 điểm % | platform.fees |
| `roas_duoi_hoa_von` | ROAS thực tế < ROAS hòa vốn | P4 + platform.ads |
| `vuot_tran` | Khoản chi vượt trần, xếp theo tiền | P3 |
| `quy_duoi_nguong` | Tuần đầu tiên quỹ dưới mức tối thiểu | P2 |
| `no_qua_han` | Phải thu quá hạn: số tiền, số ngày, khách | `doiChieu.js` |
| `dat_chua_giao` | Đơn đã đặt chưa giao: giá trị, số lượng | `ar_order` |
| `sap_dut_hang` / `ton_cham` | SKU sắp hết / tồn quá số ngày bán | `stockPlan` |
| `ty_le_hoan` | Tỷ lệ hoàn tăng, lý do đứng đầu | platform.returns |
| `du_bao_lech` | Bias dự báo > ±15% | P5 |

Câu chữ sinh từ mẫu có chèn số. Mỗi phát hiện phải có đủ 3 phần: con số — vậy thì sao — làm gì.

### 2. Màn mới `src/screens/Report.jsx` — "Báo cáo điều hành", nhóm nav mới **Báo cáo** (đặt ngay sau "Phân tích kinh doanh")
- **Thanh điều khiển**: kỳ báo cáo (tháng / quý / lũy kế năm) · so với (kỳ trước / cùng kỳ năm trước / kế hoạch) · đơn vị.
- **Danh sách báo cáo đã lưu** (tên, kỳ, người lưu, giờ lưu).
- **Khối trái — Máy đọc số**: thẻ chỉ số chính của kỳ (doanh thu, lợi nhuận, biên, quỹ cuối kỳ) + danh sách phát hiện theo mức độ. Lọc theo nhóm: Tất cả / Doanh thu / Chi phí / Lợi nhuận & biên / Dòng tiền & công nợ / Tồn kho. Mỗi phát hiện có nút tắt (ẩn khỏi bản in) và liên kết sang màn nguồn. Nút "Phân tích lại". Cuối khối liệt kê quy tắc bị bỏ qua và lý do.
- **Khối phải — Nhận định của bạn**: ô soạn thảo cho người viết (đậm, nghiêng, gạch đầu dòng, hoàn tác). Máy KHÔNG bao giờ ghi đè phần này.
- **Xem bản gộp**: xem trước đúng trang sẽ in — tiêu đề, kỳ, thẻ chỉ số, phát hiện đang bật, nhận định của người viết, chân trang ghi thời điểm dữ liệu.
- **In** (CSS in A4 dọc, ngắt trang không cắt đôi một phát hiện) và **Xuất Excel** (có định dạng, theo mẫu `doiChieu.js`; số trong file luôn là đồng đầy đủ dù màn đang xem triệu/tỷ).

### 3. Lưu trữ
`scripts/shopee/schema_report.sql`: `report_doc` (id, name, period_from, period_to, compare, note_html, hidden_ids, snapshot_json, saved_by, saved_at). `snapshot_json` giữ nguyên các phát hiện tại lúc lưu để báo cáo cũ không đổi khi dữ liệu mới về. RPC `save_report_doc`, `del_report_doc`.

## Cạm bẫy phải tránh
- Quy tắc không đủ dữ liệu phải vào `bo_qua`, không được ra phát hiện "0%" hay "không có vấn đề".
- Không để hai quy tắc nói cùng một chuyện bằng hai con số khác nhau — dùng lại đúng hàm của màn nguồn.
- Kỳ có tháng chạy dở: ghi rõ trong tiêu đề báo cáo "tính đến ngày …".
- Nội dung người dùng gõ phải được làm sạch trước khi chèn vào trang (chỉ cho phép thẻ b, i, u, ul, ol, li, p, br).
- Không thêm thư viện soạn thảo; dùng `contentEditable` với danh sách thẻ cho phép ở trên.

## Được sửa
`src/lib/insights.js` (mới) · `src/screens/Report.jsx` + `report.css` (mới) · `src/lib/cloud.js` · `scripts/shopee/schema_report.sql` (mới) · `src/app/nav.js` · `src/app/AppShell.jsx` · `Guide.jsx` · `INDEX.md` · `knowledge/LESSONS.md`.

## DỪNG và hỏi tôi khi
- Viết xong `schema_report.sql`.
- Một quy tắc cần ngưỡng mà dữ liệu hiện có cho thấy ngưỡng trong bảng trên luôn bật hoặc không bao giờ bật → báo tôi kèm phân phối thực tế, đừng tự đổi ngưỡng.

## Xong khi
- [ ] Chạy hai lần trên cùng kỳ → danh sách phát hiện giống hệt nhau.
- [ ] Mỗi con số trong 5 phát hiện kiểm ngẫu nhiên khớp với màn nguồn.
- [ ] Lưu báo cáo, đổi dữ liệu giả lập, mở lại → nội dung đã lưu không đổi.
- [ ] Bấm "Phân tích lại" không làm mất chữ ở khối "Nhận định của bạn".
- [ ] Bản in A4 không tràn lề, không cắt đôi phát hiện; có ảnh chụp bản xem trước.
- [ ] Không có lời gọi mạng nào tới dịch vụ AI.
