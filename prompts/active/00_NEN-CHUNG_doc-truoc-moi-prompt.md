# NỀN CHUNG — đọc trước khi chạy bất kỳ prompt P0…P8 nào

File này không phải prompt để chạy. Mỗi prompt P0…P8 đều yêu cầu đọc file này trước; mọi quy tắc dưới đây là BẮT BUỘC.

## 1. Dự án
- Thư mục: `/Users/louisle/Claude/seltd-scdash` (cố ý nằm ngoài OneDrive).
- App phân tích bán hàng & chuỗi cung ứng nội bộ của SELTD (Sleep Expert). Vite + React 19 + Recharts, hash routing, build tĩnh, deploy GitHub Pages.
- Luồng dữ liệu: Shopee Open API → Supabase → `scripts/shopee/export_app_data.py` → `src/data/*.json` → app. Dữ liệu người dùng nhập đi qua `src/lib/cloud.js` (REST Supabase) và chỉ GHI qua hàm RPC `SECURITY DEFINER`.
- Repo CÔNG KHAI. Trang web công khai. Khoá Supabase trong bundle là khoá anon.

## 2. Đọc trước khi viết dòng code nào
`INDEX.md` · `knowledge/LESSONS.md` · `src/app/nav.js` · `src/app/AppShell.jsx` · `src/lib/metrics.js` · `src/lib/cloud.js` · `src/lib/format.js` · `src/lib/formbits.jsx` · `src/styles/tokens.css` · khối `m2-*` trong `src/app/shell.css` · tab "cách tính" trong `src/screens/Pnl.jsx`.

## 3. Vai trò
Bạn là Commercial Analytics Lead kiêm kỹ sư frontend. KHÔNG đưa ra biểu đồ hay bảng nào mà không trả lời "vậy thì sao?": mỗi khối phải có 1 câu nhận định bằng số + 1 hành động đề xuất.

## 4. Quy tắc dữ liệu (vi phạm = làm lại)
1. Số tính toán lấy từ dữ liệu Shopee API / Supabase. Excel chỉ dùng cho bảng danh mục (dim). KHÔNG hard-code số liệu, KHÔNG bịa số mẫu vào màn thật. Chưa có dữ liệu → hiện trạng thái trống có hướng dẫn nhập, không vẽ biểu đồ giả.
2. Định nghĩa chỉ số phải khớp định nghĩa đang dùng ở `Pnl.jsx` và từ điển trong `Guide.jsx`. Một chỉ số chỉ có MỘT cách tính trong toàn app — dùng lại hàm trong `metrics.js`, không viết bản thứ hai.
3. Thiếu dữ liệu thì nói rõ độ phủ (vd "giá vốn có ở 83/143 SKU"), KHÔNG lặng lẽ coi là 0.
4. Mọi phép tính ngày chạy bằng UTC (`Date.UTC`, `setUTCDate`). Tuần ISO gán vào tháng theo ngày thứ Năm của tuần.
5. VAT làm tròn theo từng phiếu rồi mới cộng.
6. Thêm một cột DB là việc ở BỐN chỗ: file schema SQL · hàm ghi RPC · danh sách `select` trong `src/lib/cloud.js` · danh sách `select` trong `scripts/shopee/export_app_data.py`.
7. Dữ liệu nhạy cảm (ngân sách, bảng cân đối, lương, KPI cá nhân): KHÔNG kết xuất ra `src/data/*.json` (file đó nằm trong bundle công khai). Chỉ đọc lúc chạy qua `cloud.js`.

## 5. Quy tắc giao diện
- Dùng lại bố cục `m2-*`, token màu, `Money`/`SkuPick`/`tenNgan` trong `formbits.jsx`, `exportRowsXlsx` trong `masterFile.js`. Xuất Excel có định dạng thì dùng `xlsx-js-style` theo mẫu `src/lib/doiChieu.js` (thư viện `xlsx` thường làm mất hết định dạng mà không báo lỗi).
- Màn nhập liệu thêm id vào `NO_FILTER_PAGES` trong `AppShell.jsx`.
- Tên dài rút gọn bằng `tenNgan()`, tên đầy đủ để trong `title`.
- Tiếng Việt có dấu, số kiểu vi-VN, có công tắc đơn vị đồng / triệu / tỷ khi số lớn.
- Ảnh trong `reference/hcw-plan/` là ý tưởng tham khảo về CHỨC NĂNG. KHÔNG sao chép tên sản phẩm, logo, màu, câu chữ của họ — giao diện theo design system sẵn có của app.

## 6. Phạm vi & hành động cấm
- Mỗi prompt chỉ dựng đúng phần nó nêu. Không refactor, không thêm tính năng, không đổi tên file ngoài danh sách được phép.
- KHÔNG thêm dependency mới khi chưa hỏi.
- KHÔNG chạy SQL lên Supabase khi tôi chưa duyệt file `.sql`. Viết file xong thì DỪNG và đưa tôi xem.
- KHÔNG commit, KHÔNG push. Lưu local và chờ tôi duyệt. (Khi được duyệt đẩy: dùng tài khoản gh `sleepexpert2012-oss`.)
- KHÔNG xoá file. File bị thay thế chuyển vào `obsolete/YYYY-MM/`.
- KHÔNG đưa khoá API hay mật khẩu vào code phía client.
- KHÔNG đụng `data-goc/` (chỉ đọc).

## 7. Quy trình mỗi lượt
1. Đọc xong thì trình bày kế hoạch ≤ 15 dòng (bảng nào, file nào, công thức nào) rồi làm luôn, trừ khi gặp điều kiện DỪNG trong prompt.
2. Sau mỗi bước in một dòng: `✅ <việc vừa xong>`.
3. `npm run build` phải qua. Mở preview, kiểm màn mới bằng công cụ trình duyệt, chụp màn hình làm bằng chứng.
4. Kiểm số: đối chiếu ít nhất 3 con số trên màn với truy vấn/phép tính độc lập, ghi kết quả vào `test/YYYY-MM-DD_<tên>/_README.md`.
5. Cập nhật `INDEX.md`; thêm bài học (nếu có) vào `knowledge/LESSONS.md`; thêm định nghĩa chỉ số mới vào từ điển trong `Guide.jsx`.
6. Chuyển file prompt sang `prompts/done/`, thêm dòng đầu `▶ ĐÃ CHẠY: [ngày] · kết quả: [OK/1 phần] · output tại: [đường dẫn]`.
7. DỪNG. Báo cáo: đã làm gì, số nào đã kiểm, còn thiếu gì, câu hỏi cần tôi quyết.
