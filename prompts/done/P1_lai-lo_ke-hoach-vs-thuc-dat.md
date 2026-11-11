▶ ĐÃ CHẠY: 2026-11-11 · kết quả: OK · output tại: src/screens/PnlPlan.jsx, src/lib/fin.js (compare), src/lib/xlsxBang.js, test/2026-11-11_ke-hoach-vs-thuc-dat_P1/

# P1 · Lãi lỗ: Kế hoạch vs Thực đạt và chênh lệch

> Dán vào một phiên Claude Code MỚI tại `/Users/louisle/Claude/seltd-scdash`. Đọc `prompts/active/00_NEN-CHUNG_doc-truoc-moi-prompt.md` trước. **Điều kiện tiên quyết: P0 đã chạy xong** (`src/lib/fin.js` và bảng `fin_*` tồn tại). Chưa có thì DỪNG và báo.

Ảnh tham khảo chức năng: `reference/hcw-plan/m1_pnl-kpi.jpg`, `m1_pnl-bang-doi-chieu.jpg`, `m8_chenh-lech.jpg`.

## Hiện trạng
`src/screens/Pnl.jsx` (màn 11) có thác nước GMV → lãi lỗ và 6 tab, toàn bộ là số thực tế. Chưa có so sánh với kế hoạch.

## Trạng thái đích
Thêm MỘT tab mới "Kế hoạch vs Thực đạt" vào `Pnl.jsx`. Không tạo màn mới, không đổi 6 tab cũ.

1. **Thanh điều khiển**: chọn phiên bản ngân sách (mặc định phiên bản hiện hành) · chip T1…T12 chọn tháng lũy kế đến (mặc định = tháng thực tế trọn vẹn gần nhất, dùng `LAST_ACTUAL_MONTH`) · công tắc "tính cả tháng đang chạy" (mặc định tắt) · đơn vị đồng/triệu/tỷ.
2. **Dải KPI** 5 thẻ: Doanh thu · Giá vốn · Lợi nhuận gộp · Chi phí hoạt động · Lợi nhuận ròng. Mỗi thẻ: kế hoạch lũy kế, thực đạt lũy kế, % đạt.
3. **Bảng đối chiếu** theo khoản mục (gom theo `grp`, mở được dòng con):
   `Khoản mục | Thực đạt lũy kế | Ngân sách lũy kế | Δ tuyệt đối | Δ % | Dự báo cả năm | Ngân sách cả năm | Δ cả năm`
   - Dự báo cả năm = thực đạt đến tháng chọn + ngân sách các tháng còn lại.
   - Màu theo CHIỀU CÓ LỢI: doanh thu/lợi nhuận cao hơn kế hoạch = xanh; chi phí cao hơn kế hoạch = đỏ.
4. **Vì sao lợi nhuận lệch kế hoạch**: bảng xếp hạng khoản mục theo mức đóng góp vào Δ lợi nhuận ròng (đồng), tổng các dòng phải bằng đúng Δ lợi nhuận ròng. Đây là khối "vậy thì sao" chính.
5. **3 biểu đồ**: (a) Doanh thu & lợi nhuận ròng kế hoạch vs thực tế theo tháng; (b) biên gộp % và biên ròng % kế hoạch vs thực tế; (c) "1 đồng doanh thu đi đâu" — thanh 100% chồng: giá vốn / phí sàn / marketing / chi phí hoạt động / lợi nhuận, hai thanh kế hoạch và thực tế cạnh nhau.
6. Mỗi khối có 1 câu nhận định sinh từ số (vd "Lợi nhuận hụt 42tr so với kế hoạch, 31tr đến từ phí sàn vượt 1,8 điểm %").
7. Nút xuất Excel bảng đối chiếu (có định dạng, theo mẫu `doiChieu.js`).

## Cạm bẫy phải tránh
- So lũy kế phải cùng số tháng ở hai vế. Tháng đang chạy dở mà so với ngân sách trọn tháng là sai — mặc định loại ra.
- Tháng chưa nhập chi phí ngoài sàn: lợi nhuận ròng tháng đó KHÔNG đáng tin. Hiện dải cảnh báo nêu tên tháng, và thẻ Lợi nhuận ròng ghi "chưa đủ chi phí".
- Giá vốn chưa phủ hết SKU: hiện độ phủ ngay trên thẻ Giá vốn.
- Δ % khi ngân sách = 0 → hiện "—", không chia cho 0.
- Số thực tế phải gọi từ `fin.js`/`metrics.js`, không tính lại trong màn.

## Được sửa
`src/screens/Pnl.jsx` · `src/screens/pnl.css` · `src/lib/fin.js` (chỉ thêm hàm) · `src/screens/Guide.jsx` (thêm định nghĩa) · `INDEX.md` · `knowledge/LESSONS.md`.

## DỪNG và hỏi tôi khi
- Chưa có phiên bản ngân sách nào có số → dựng xong trạng thái trống rồi dừng, đừng tạo số mẫu.
- Tổng "vì sao lệch" không khớp Δ lợi nhuận ròng sau 2 lần sửa.

## Xong khi
- [ ] Thực đạt lũy kế trên tab mới = tổng các tháng tương ứng ở tab "theo tháng" cũ (lệch 0 đồng) cho doanh thu, phí sàn, lợi nhuận.
- [ ] Tổng cột đóng góp ở khối "vì sao lệch" = Δ lợi nhuận ròng.
- [ ] Đổi tháng lũy kế → cả KPI, bảng, biểu đồ đổi theo.
- [ ] 6 tab cũ không đổi một con số nào.
- [ ] `npm run build` qua; có ảnh chụp.
