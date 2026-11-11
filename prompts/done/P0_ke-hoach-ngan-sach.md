▶ ĐÃ CHẠY: 2026-11-11 · kết quả: OK (schema_fin.sql đã chạy Supabase 11/11; code chưa push) · output tại: src/screens/Budget.jsx, src/lib/fin.js, scripts/shopee/schema_fin.sql, test/2026-11-10_ngan-sach-lop-nen_P0/

# P0 · Lớp nền: Kế hoạch năm (ngân sách) + chi phí ngoài sàn

> Dán vào một phiên Claude Code MỚI tại `/Users/louisle/Claude/seltd-scdash`. Đọc `prompts/active/00_NEN-CHUNG_doc-truoc-moi-prompt.md` trước — mọi quy tắc trong đó là bắt buộc.

## Vì sao có prompt này
App hiện chỉ có số THỰC TẾ từ Shopee và bán ngoài sàn. Ba chức năng sắp dựng (Kế hoạch vs Thực đạt, Định mức chi phí, Điểm hòa vốn) đều cần ba thứ app chưa có: ngân sách theo tháng, chi phí hoạt động ngoài sàn, và phân loại cố định/biến đổi. Prompt này chỉ dựng lớp nhập liệu đó. KHÔNG dựng màn phân tích nào.

## Hiện trạng
- Thực tế tự có: doanh thu, giá vốn (SL × giá vốn ở Master Data — chưa phủ hết SKU), 6 khoản phí sàn và voucher (`src/data/platform.json` → `fees`), quảng cáo Shopee (`platform.json` → `ads`), hoàn hàng (`returns`), bán ngoài sàn (`ar_*`).
- Chưa có ở đâu: lương, kho bãi, thuê nhà, dịch vụ mua ngoài, vật tư, marketing ngoài sàn theo tháng dồn tích. `Cashflow.jsx` có 6 dòng `CHI_KHAC` nhưng đó là TIỀN CHI theo tuần, không phải chi phí theo tháng.

## Trạng thái đích
1. `scripts/shopee/schema_fin.sql` gồm:
   - `fin_line` — danh mục khoản mục: `code`, `name`, `grp` (doanh_thu | gia_von | phi_san | marketing | opex | tai_chinh | thue), `behavior` (bien_doi | co_dinh), `source` (auto | nhap), `cap_pct` (trần % trên doanh thu, cho phép null), `sort`, `active`.
   - `fin_plan` — ngân sách: `version`, `ym`, `line`, `amount`. Khoá (`version`,`ym`,`line`).
   - `fin_plan_version` — `version`, `name`, `year`, `is_current`, `note`.
   - `fin_actual` — thực tế nhập tay cho khoản `source='nhap'`: `ym`, `line`, `amount`, `note`.
   - `fin_log` — ai sửa gì, lúc nào, giá trị cũ → mới.
   - RPC ghi: `save_fin_line`, `save_fin_plan` (nhận mảng ô), `save_fin_actual`, `set_fin_current_version`. RLS bật + `grant select`.
   - Seed `fin_line`: các dòng auto khớp đúng tên cột đang có trong `platform.json`; 6 dòng opex lấy đúng mã và tên trong `CHI_KHAC` của `Cashflow.jsx` để thống nhất với file Excel đang dùng.
2. `src/lib/fin.js` — hàm thuần: `actualByMonth(year)` trả về mọi khoản mục theo tháng (auto lấy từ dữ liệu sẵn có, nhập lấy từ `fin_actual`), `planByMonth(version)`, `coverage()` (độ phủ giá vốn, tháng nào thiếu chi phí nhập tay).
3. Màn mới `src/screens/Budget.jsx` — "Kế hoạch & Ngân sách", nhóm **Tài chính** trong `nav.js`, 3 tab:
   - **Ngân sách**: lưới khoản mục × 12 tháng, sửa ô trực tiếp, dán cả khối từ Excel, cột tổng năm, dòng tổng theo nhóm, chọn/nhân bản phiên bản, đánh dấu phiên bản hiện hành.
   - **Chi phí thực tế**: lưới như trên nhưng chỉ khoản `source='nhap'`; cạnh mỗi ô hiện số tiền chi cùng tháng lấy từ kế hoạch dòng tiền làm THAM CHIẾU (không tự điền).
   - **Khoản mục**: sửa tên, nhóm, cố định/biến đổi, trần %.
   - Nút nhập/xuất Excel cho từng lưới.

## Cạm bẫy phải tránh
- Quảng cáo Shopee là `auto`. Marketing ngoài sàn mới là `nhap`. Dòng `ads` trong `CHI_KHAC` gộp cả hai → tách thành hai khoản, đừng để trùng.
- Dồn tích ≠ tiền chi. KHÔNG lấy số `cashflow_week` làm chi phí thực tế.
- Khoản bán biến đổi (kho bãi FBS…) để người dùng tự chọn `behavior`; mặc định ghi rõ giả định trong chú thích.
- Tháng chưa nhập chi phí thực tế phải hiện "chưa nhập", không phải 0.

## Được sửa
`scripts/shopee/schema_fin.sql` (mới) · `src/lib/fin.js` (mới) · `src/screens/Budget.jsx` + `budget.css` (mới) · `src/lib/cloud.js` · `src/app/nav.js` · `src/app/AppShell.jsx` · `INDEX.md` · `knowledge/LESSONS.md`. Không sửa file nào khác.

## DỪNG và hỏi tôi khi
- Viết xong `schema_fin.sql` (tôi duyệt rồi mới chạy lên Supabase).
- Định nghĩa "doanh thu" để tính trần % có hơn một cách hiểu so với `Pnl.jsx`.
- Phát hiện đăng nhập của app chỉ chặn ở phía client: ngân sách sẽ đọc được bằng khoá anon — báo tôi quyết trước khi ghi dữ liệu thật.

## Xong khi
- [ ] Nhập 1 ô, tải lại trang, số còn nguyên; `fin_log` có 1 dòng.
- [ ] Dán khối 12×N từ Excel vào đúng vị trí, không lệch cột.
- [ ] `actualByMonth` cho tổng doanh thu và tổng phí sàn từng tháng KHỚP màn Lãi lỗ (lệch 0 đồng).
- [ ] Không có file nào trong `src/data/` chứa ngân sách.
- [ ] `npm run build` qua; có ảnh chụp 3 tab.
