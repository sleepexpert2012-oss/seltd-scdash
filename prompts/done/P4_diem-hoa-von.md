▶ ĐÃ CHẠY: 2026-11-11 · kết quả: OK · output tại: src/screens/BreakEven.jsx, src/lib/fin.js (beCalc, adsBreakEven), test/2026-11-11_diem-hoa-von_P4/

# P4 · Điểm hòa vốn và biên an toàn

> Dán vào một phiên Claude Code MỚI tại `/Users/louisle/Claude/seltd-scdash`. Đọc `prompts/active/00_NEN-CHUNG_doc-truoc-moi-prompt.md` trước. **Điều kiện tiên quyết: P0 đã chạy xong** (cần phân loại cố định/biến đổi và chi phí ngoài sàn). Chưa có thì DỪNG và báo.

Ảnh tham khảo chức năng: `reference/hcw-plan/m5_hoa-von.jpg`, `m5_bien-an-toan.jpg`.

## Câu hỏi màn này phải trả lời
"Mỗi tháng phải bán bao nhiêu thì đủ trả chi phí cố định, hiện đang cách mốc đó bao xa, và quảng cáo được phép đắt đến đâu?"

## Công thức (ghi nguyên văn vào tab "cách tính" của màn)
- Số dư đảm phí = Doanh thu − Chi phí biến đổi (giá vốn + phí sàn + quảng cáo + các khoản `bien_doi` khác).
- Tỷ lệ số dư đảm phí (CM%) = Số dư đảm phí ÷ Doanh thu.
- Doanh thu hòa vốn = Chi phí cố định ÷ CM%.
- Biên an toàn (MOS) = (Doanh thu − Doanh thu hòa vốn) ÷ Doanh thu.
- ROAS hòa vốn = 1 ÷ CM% tính TRƯỚC quảng cáo.
- Hòa vốn theo đơn/ngày = Doanh thu hòa vốn tháng ÷ giá trị đơn bình quân ÷ số ngày trong tháng.

## Trạng thái đích
Màn mới `src/screens/BreakEven.jsx` — "Điểm hòa vốn", nhóm **Tài chính**. Chọn nguồn: Thực tế / Ngân sách hiện hành. Chọn phạm vi: tháng hoặc lũy kế năm.

1. **4 thẻ**: Doanh thu hòa vốn · Chi phí cố định · CM% · Biên an toàn. Kèm dải kết luận lớn: "ĐÃ VƯỢT điểm hòa vốn, dư X" hoặc "CHƯA hòa vốn, thiếu X".
2. **Biểu đồ lũy kế**: đường doanh thu lũy kế theo tháng (kế hoạch và thực tế) cắt đường ngang mức hòa vốn năm; đánh dấu tháng cắt.
3. **Bảng tháng**: `Tháng | Doanh thu | Chi phí biến đổi | Số dư đảm phí | Chi phí cố định | Lãi/lỗ | Doanh thu hòa vốn tháng | Chênh lệch | Biên an toàn`.
4. **Thẻ quảng cáo**: ROAS hòa vốn so với ROAS thực tế của kỳ (lấy từ `platform.json` → `ads`), kết luận "mỗi đồng quảng cáo đang lãi/lỗ bao nhiêu sau khi trừ chi phí biến đổi".
5. **Thẻ vận hành**: số đơn/ngày cần để hòa vốn so với số đơn/ngày thực tế.
6. **Thử kịch bản** — đúng 3 thanh trượt, không hơn: giá bán ±%, phí sàn ± điểm %, chi phí cố định ±%. Hiện doanh thu hòa vốn mới và chênh so hiện tại. Không lưu.
7. **Cơ cấu chi phí biến đổi tại mức hòa vốn**: bảng khoản mục, số tiền, tỷ trọng.

## Cạm bẫy phải tránh
- CM% ≤ 0 → không có điểm hòa vốn. Hiện cảnh báo đỏ "bán càng nhiều càng lỗ, phải sửa giá hoặc chi phí biến đổi trước", không hiện số âm hay vô cực.
- Tháng chưa nhập chi phí cố định → loại khỏi tính toán và nêu tên tháng; đừng coi chi phí cố định = 0 (sẽ ra hòa vốn = 0).
- Giá vốn chưa phủ hết SKU làm CM% bị CAO giả → hiện độ phủ cạnh CM%.
- Khoản bán biến đổi: dùng đúng `behavior` người dùng chọn ở P0, liệt kê các giả định này ở cuối màn.
- Hòa vốn lũy kế năm và hòa vốn từng tháng là hai con số khác nhau; nhãn phải nói rõ đang xem cái nào.

## Được sửa
`src/screens/BreakEven.jsx` + `breakeven.css` (mới) · `src/lib/fin.js` (chỉ thêm hàm) · `src/app/nav.js` · `src/app/AppShell.jsx` · `Guide.jsx` · `INDEX.md` · `knowledge/LESSONS.md`.

## DỪNG và hỏi tôi khi
- Chưa có khoản mục nào đánh dấu `co_dinh` có số → dựng trạng thái trống rồi dừng.
- ROAS thực tế tính theo định nghĩa ở màn Marketing khác với cách cần dùng ở đây.

## Xong khi
- [ ] Với một tháng kiểm tay: Doanh thu hòa vốn × CM% = Chi phí cố định (lệch < 1 đồng do làm tròn).
- [ ] Tại doanh thu = doanh thu hòa vốn, lãi/lỗ = 0.
- [ ] Doanh thu, phí sàn, quảng cáo khớp màn Lãi lỗ.
- [ ] Kéo thanh trượt về 0 → trả về đúng số gốc.
- [ ] `npm run build` qua; có ảnh chụp.
