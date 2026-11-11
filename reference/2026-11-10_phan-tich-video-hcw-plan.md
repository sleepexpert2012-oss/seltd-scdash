# Phân tích video "HCW Plan — Tạo báo cáo quản trị thông minh" (2026-11-10)

Nguồn: quay màn hình một quảng cáo, 137 giây, 9 phân đoạn đánh số. Khung hình cắt ra nằm ở `reference/hcw-plan/` (không đẩy lên repo). Mục đích: lấy Ý TƯỞNG CHỨC NĂNG để dựng thêm vào app SELTD, không sao chép giao diện hay câu chữ.

## 9 chức năng trong video và đối chiếu với app

| # | Video cho thấy | App SELTD hiện có | Thiếu gì để làm được | Prompt |
|---|---|---|---|---|
| 1 | Lãi lỗ: Kế hoạch vs Thực hiện, lũy kế T1–T12, thẻ % đạt, bảng Ngân sách / Thực đạt / Dự báo hiện tại, biên LN, "1 đồng doanh thu" | `Pnl.jsx` — chỉ số thực tế | Ngân sách theo tháng; chi phí ngoài sàn | P0 → P1 |
| 2 | Dòng tiền 12 tháng: thu, chi, số dư, burn rate, đường băng, cảnh báo dưới ngưỡng; Vốn lưu động: CCC = DIO + DSO − DPO | `Cashflow.jsx` — kế hoạch tuần, theo khách | Góc nhìn tháng, ngưỡng quỹ, CCC; giá vốn chưa phủ hết SKU | P2 |
| 3 | Tình hình tài chính: thẻ điểm 5 chỉ số, cơ cấu tài sản/nguồn vốn, CFO/CFI/CFF theo quý, TSCĐ | Không có | Bảng cân đối kế toán (phải lấy từ kế toán) | P7 |
| 4 | Định mức chi phí: trần %, kế hoạch/thực tế/còn lại, khoản vượt trần, Pareto 7/17 | Không có (có sẵn số phí sàn, ads) | Trần % và ngân sách | P0 → P3 |
| 5 | Điểm hòa vốn: định phí, CM 33,4%, mức hòa vốn theo tháng lũy kế, biên an toàn 15,2% | Không có | Phân loại cố định/biến đổi; định phí | P0 → P4 |
| 6 | Bán hàng & Cung ứng: 4 bước (dự báo bán → cung ứng → đối chiếu), bản "Đang soạn"/chốt, kịch bản, mùa vụ, nhóm hàng | `Forecast.jsx` — tính lại mỗi lần mở | Đóng băng bản dự báo; đo sai số | P5 |
| 7 | Bản đồ chiến lược BSC, thư viện KPI, giao KPI, xếp hạng nhân viên | Không có | Danh mục nhân sự, mục tiêu; **vấn đề quyền riêng tư** | P8 |
| 8 | Kế hoạch – Thực tế – Chênh lệch (cột Δ so ngân sách) | Không có | Như #1 | gộp vào P1 |
| 9 | Nhận xét tự động trong module Báo cáo & Xuất: thẻ chỉ số, "phát hiện chính", ô "nhận định của bạn", bản gộp để in, Excel | Không có | Bộ quy tắc; nơi lưu nhận định | P6 |

## Ba nhận định quyết định cách dựng
1. **Sáu trong chín chức năng sống nhờ một thứ app chưa có: kế hoạch.** Video luôn có hai cột Kế hoạch và Thực đạt. App SELTD chỉ có Thực đạt. Vì vậy P0 (ngân sách + chi phí ngoài sàn + phân loại cố định/biến đổi) phải làm trước; thiếu nó thì P1, P3, P4 chỉ là khung rỗng.
2. **"A.I" trong video là quy tắc tất định**, không phải mô hình ngôn ngữ — chính màn hình của họ ghi "Số liệu do phần mềm tính (tất định)". Với trang tĩnh công khai, đây cũng là cách duy nhất an toàn: không có chỗ giấu khoá API. P6 dựng đúng theo hướng đó.
3. **Hai chức năng đụng dữ liệu nhạy cảm**: bảng cân đối (P7) và điểm KPI từng nhân viên (P8). Trang hiện đọc dữ liệu bằng khoá anon, nên cả hai prompt mở đầu bằng điều kiện chặn — hỏi trước, dựng sau.

## Thứ tự chạy đề xuất
`P0 → P1 → P3 → P4` (cùng dùng lớp ngân sách) · `P2` và `P5` chạy lúc nào cũng được · `P6` sau cùng để gom phát hiện từ các màn trước · `P7`, `P8` chỉ chạy khi đã có dữ liệu và quyết định về quyền truy cập.

## Thứ video có mà KHÔNG đưa vào prompt
- Quản lý module, hướng dẫn sử dụng (app đã có "Giới thiệu & Định nghĩa").
- Dự báo nhiều năm / bảng cân đối dự phóng 3–5 năm: cần mô hình tài chính đầy đủ, chưa có dữ liệu nền; để sau P7.
- Phân tích hiệu quả theo nhãn/chi nhánh: SELTD chưa có chiều chi nhánh.
