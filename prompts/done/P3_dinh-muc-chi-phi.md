▶ ĐÃ CHẠY: 2026-11-11 · kết quả: OK · output tại: src/screens/CostNorm.jsx, src/lib/fin.js (costNorm), test/2026-11-11_dinh-muc-chi-phi_P3/

# P3 · Định mức chi phí: trần % trên doanh thu và khoản vượt trần

> Dán vào một phiên Claude Code MỚI tại `/Users/louisle/Claude/seltd-scdash`. Đọc `prompts/active/00_NEN-CHUNG_doc-truoc-moi-prompt.md` trước. **Điều kiện tiên quyết: P0 đã chạy xong.** Chưa có thì DỪNG và báo.

Ảnh tham khảo chức năng: `reference/hcw-plan/m4_dinh-muc-kpi.jpg`, `m4_dinh-muc-bang.jpg`.

## Câu hỏi màn này phải trả lời
"Khoản chi nào đang ăn quá phần của nó trong mỗi đồng doanh thu, vượt bao nhiêu TIỀN, và tôi cắt ở đâu trước?"

## Trạng thái đích
Màn mới `src/screens/CostNorm.jsx` — "Định mức chi phí", nhóm **Tài chính**, đặt sau "Lãi lỗ". Chọn kỳ: tháng / quý / lũy kế năm.

1. **4 thẻ**: Tổng chi phí thực tế · Chênh lệch so ngân sách (đồng) · Tỷ lệ tiêu hao ngân sách (%) · "N/M khoản tạo ra 80% chi phí" (Pareto).
2. **Bảng định mức** — mỗi dòng một khoản mục chi phí lấy từ `fin_line`, gom theo nhóm:
   `Khoản mục | Ngân sách | Thực tế | Còn lại | Tiêu hao % (thanh) | % trên doanh thu thực tế | Trần % | Vượt trần (điểm %) | Tiền vượt trần | Trạng thái`
   - Tiền vượt trần = max(0, % thực tế − trần %) × doanh thu thực tế của kỳ.
   - Trạng thái: **Trong trần** (< 90% trần) · **Cần chú ý** (90–100% trần) · **Vượt trần** (> trần). Khoản chưa đặt trần → "Chưa đặt trần", không tô màu.
   - Sắp mặc định theo Tiền vượt trần giảm dần.
   - Sửa trần % ngay trên dòng (ghi qua `save_fin_line`).
3. **Xu hướng**: chọn 1 khoản → đường % trên doanh thu theo tháng với đường ngang trần. Mặc định chọn khoản vượt nhiều tiền nhất.
4. **Cơ cấu chi phí**: vành khuyên theo nhóm (giá vốn / phí sàn / marketing / chi phí hoạt động / tài chính / thuế).
5. **Khối nhận định**: tổng tiền vượt trần của kỳ, 3 khoản vượt nhiều nhất, và nếu đưa cả 3 về đúng trần thì biên lợi nhuận ròng tăng bao nhiêu điểm %.
6. Xuất Excel bảng định mức.

## Riêng cho bán hàng trên sàn (bắt buộc có)
Ngoài các khoản trong `fin_line`, luôn hiện 4 dòng tự tính, không cần ngân sách vẫn theo dõi được trần:
tổng phí sàn (6 khoản, đúng định nghĩa ở `Pnl.jsx`) · quảng cáo Shopee · voucher shop · tiền hoàn hàng. Tất cả chia cho CÙNG một mẫu số doanh thu.

## Cạm bẫy phải tránh
- Mẫu số "doanh thu" phải là đúng một định nghĩa đang dùng ở `Pnl.jsx` (đọc tab "cách tính"). Ghi mẫu số ngay dưới tiêu đề bảng.
- Voucher shop đã bị trừ khi tính doanh thu ở `Pnl.jsx`; nếu đưa vào bảng chi phí phải ghi rõ để người đọc không cộng hai lần vào tổng chi phí. Dòng này KHÔNG cộng vào thẻ "Tổng chi phí".
- Khoản cố định (lương, thuê nhà) có % trên doanh thu dao động theo doanh thu, không phải do chi tăng → với khoản `co_dinh`, cột trạng thái xét theo Tiêu hao ngân sách, không xét theo trần %.
- Tháng chưa nhập chi phí thực tế: hiện "chưa nhập", loại khỏi Pareto và tổng.

## Được sửa
`src/screens/CostNorm.jsx` + `costnorm.css` (mới) · `src/lib/fin.js` (chỉ thêm hàm) · `src/app/nav.js` · `src/app/AppShell.jsx` · `Guide.jsx` · `INDEX.md` · `knowledge/LESSONS.md`.

## DỪNG và hỏi tôi khi
- Chưa khoản nào có trần % → dựng xong, hiện trạng thái hướng dẫn đặt trần, rồi dừng. KHÔNG tự đề xuất con số trần rồi lưu vào DB; chỉ được gợi ý trên màn hình bằng trung bình 6 tháng gần nhất, có nhãn "gợi ý".

## Xong khi
- [ ] Tổng phí sàn và quảng cáo từng tháng khớp màn Lãi lỗ (lệch 0 đồng).
- [ ] Tổng "Tiền vượt trần" = cộng tay từ 3 dòng kiểm ngẫu nhiên.
- [ ] Đổi kỳ → mọi khối đổi theo; khoản cố định không bị gắn nhãn "Vượt trần" chỉ vì doanh thu giảm.
- [ ] `npm run build` qua; có ảnh chụp.
