▶ ĐÃ CHẠY: 2026-11-11 · kết quả: OK — cấp phòng ban theo quyết định (schema_kpi.sql đã chạy Supabase 11/11) · output tại: src/screens/Strategy.jsx, src/lib/kpi.js, scripts/shopee/schema_kpi.sql, test/2026-11-11_chien-luoc-kpi_P8/

# P8 · Bản đồ chiến lược và KPI phòng ban / nhân sự

> Dán vào một phiên Claude Code MỚI tại `/Users/louisle/Claude/seltd-scdash`. Đọc `prompts/active/00_NEN-CHUNG_doc-truoc-moi-prompt.md` trước.

Ảnh tham khảo chức năng: `reference/hcw-plan/m7_ban-do-chien-luoc.jpg`, `m7_xep-hang.jpg`.

## ĐIỀU KIỆN CHẶN — kiểm trước khi làm bất cứ việc gì
Màn này chứa tên nhân viên kèm điểm đánh giá. Trang đang là web công khai, dữ liệu đọc bằng khoá anon.
1. Đọc `scripts/shopee/schema_auth.sql`, `src/screens/Login.jsx`, `src/lib/cloud.js` và trả lời bằng chứng cứ: đăng nhập hiện tại có được máy chủ (RLS theo người dùng đã xác thực) thực thi không, hay chỉ chặn ở giao diện?
2. Nếu chỉ chặn ở giao diện → DỪNG, báo tôi, đề xuất 2 phương án (bật xác thực Supabase cho riêng các bảng `kpi_*`; hoặc chỉ làm cấp phòng ban, không có tên người). KHÔNG tạo bảng chứa tên nhân viên khi chưa có quyết định.

## Trạng thái đích (sau khi tôi quyết)
Màn mới `src/screens/Strategy.jsx` — "Chiến lược & KPI", nhóm nav mới **Chiến lược**, 5 tab đi theo đúng một mạch: mục tiêu → KPI → người chịu trách nhiệm → kết quả.

1. **Bản đồ chiến lược**: 4 tầng Tài chính / Khách hàng / Quy trình nội bộ / Học hỏi & phát triển. Mỗi mục tiêu là một thẻ: tên, phòng chủ trì, số KPI đã giao, % đạt (tự gộp từ KPI con), đếm đạt/khá/chưa đạt. Mũi tên nhân–quả nối mục tiêu tầng dưới lên tầng trên (người dùng chọn "phục vụ cho mục tiêu nào"). Mục tiêu chưa giao KPI hiện rõ "Chưa giao KPI nào".
2. **Thư viện KPI**: tên, đơn vị, chiều tốt (cao/thấp), công thức, nguồn số (**tự động từ app** hoặc **nhập tay**), tần suất.
3. **Phòng ban & nhân sự**: danh mục phòng ban, nhân sự, chi nhánh/kênh.
4. **Giao KPI**: gắn KPI vào mục tiêu + phòng ban hoặc người, mục tiêu theo tháng, trọng số.
5. **Theo dõi**: bộ lọc phòng ban / người / mục tiêu / kỳ · % hoàn thành tổng · điểm bình quân · phân bố xếp loại · điểm theo phòng ban · bảng xếp hạng · xu hướng theo tháng.

## Quy tắc tính
- % đạt của một KPI: chiều cao-là-tốt = thực tế ÷ mục tiêu; chiều thấp-là-tốt = mục tiêu ÷ thực tế. Chặn trên 120% để một KPI không kéo cả điểm.
- Điểm một người/phòng = bình quân có trọng số các KPI được giao. Trọng số một người phải cộng đủ 100% — chưa đủ thì cảnh báo, không tự chuẩn hoá ngầm.
- Xếp loại: Xuất sắc ≥ 100 · Tốt 80–99 · Đạt 60–79 · Chưa đạt < 60. Ngưỡng là hằng số sửa được.
- % đạt của mục tiêu chiến lược = bình quân có trọng số các KPI gắn vào nó.

## KPI tự động — phải nối vào số đã có, không cho nhập tay trùng
Doanh thu, biên lợi nhuận, ROAS, tỷ lệ hoàn, phí sàn % (từ Lãi lỗ / Marketing) · số ngày tồn, tỷ lệ đứt hàng, vòng quay tồn (từ Tồn kho) · sai số dự báo WAPE (từ P5 nếu đã có) · DSO, nợ quá hạn (từ Dòng tiền). Mỗi KPI tự động gọi đúng hàm của màn nguồn và có liên kết sang màn đó.

## Dữ liệu
`scripts/shopee/schema_kpi.sql`: `kpi_objective` (góc nhìn, tên, phòng chủ trì, parent) · `kpi_def` · `kpi_dept` · `kpi_person` · `kpi_assign` (kpi, objective, dept/person, weight) · `kpi_target` (assign, ym, target) · `kpi_actual` (assign, ym, actual — chỉ cho KPI nhập tay) · `kpi_log`. KHÔNG kết xuất ra `src/data/`.

## Cạm bẫy phải tránh
- Kỳ chưa có số thực tế: "chưa có số", không phải 0% (0% sẽ kéo tụt xếp hạng).
- Người có ít KPI dễ điểm cao: hiện số KPI cạnh điểm; dưới 2 KPI thì không xếp hạng.
- Bảng xếp hạng chỉ hiện cho người có quyền (theo quyết định ở mục Điều kiện chặn).
- Bản đồ vẽ bằng SVG/CSS tự dựng như thác nước ở `Pnl.jsx`; KHÔNG thêm thư viện vẽ sơ đồ.
- Không tạo sẵn mục tiêu hay nhân sự mẫu trong DB thật. Trạng thái trống có hướng dẫn 4 bước.

## Được sửa
`src/screens/Strategy.jsx` + `strategy.css` (mới) · `src/lib/kpi.js` (mới) · `src/lib/cloud.js` · `scripts/shopee/schema_kpi.sql` (mới) · `src/app/nav.js` · `src/app/AppShell.jsx` · `Guide.jsx` · `INDEX.md` · `knowledge/LESSONS.md`.

## DỪNG và hỏi tôi khi
- (Đầu phiên) kết quả kiểm tra xác thực.
- Viết xong `schema_kpi.sql`.
- Một KPI tự động không có hàm tương ứng ở màn nguồn → hỏi, đừng tự định nghĩa chỉ số mới.

## Xong khi
- [ ] Giao 2 KPI cho 1 mục tiêu, nhập số → % đạt của thẻ mục tiêu = bình quân trọng số kiểm tay.
- [ ] KPI tự động "doanh thu" ra đúng số màn Tổng quan cùng kỳ.
- [ ] Trọng số chưa đủ 100% → có cảnh báo, điểm không bị chuẩn hoá ngầm.
- [ ] Không có file nào trong `src/data/` chứa tên nhân sự.
- [ ] `npm run build` qua; có ảnh chụp 5 tab.
