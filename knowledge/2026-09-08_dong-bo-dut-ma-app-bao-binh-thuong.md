# Đồng bộ đứt mà app vẫn báo "Bình thường" — 08/09/2026

Anh Louis phát hiện: dữ liệu đứng ở **12:25 trưa 07/09** mà màn Cơ sở hạ tầng vẫn
ghi "Bình thường". Không phải một lỗi mà **bốn** lỗi độc lập, hai trong đó là lỗi
thiết kế của bản dựng ban đầu.

## 1. Lượt 20:00 ngày 07/09 — chết 7/9 bước
`logs/etl.log` ghi `server closed the connection unexpectedly` ở bước 2, rồi 6 dòng
liên tiếp `the connection is closed`.

Nguyên nhân: `run_all.py` mở **một** connection ở `main()` rồi truyền cho cả 9 bước.
Session pooler của Supabase ngắt một lần là các bước sau chết theo. Docstring ghi
"một bước lỗi không làm chết cả job" — đúng với lỗi API, **sai** với lỗi kết nối.

Sửa: mỗi bước tự mở connection riêng, gặp `OperationalError`/`InterfaceError` thì
thử lại một lần sau 5s.

## 2. Lượt 06:00 ngày 08/09 — chết 0/9 bước, không ghi được log nào
MacBook đang ngủ nên launchd không chạy đúng 06:00; nó bắn lượt bù lúc **09:48** khi
máy vừa thức, lúc đó Wi-Fi chưa lên → `socket.gaierror: nodename nor servname
provided`. Mà `sc.ensure_token()` nằm **ngoài** `step()` nên nó giết cả tiến trình,
exit code 1, `shopee.etl_run` không có nổi một dòng nào của ngày 08/09 — mất cả dấu
vết để chẩn đoán.

Sửa: `wait_net()` thử `ensure_token()` tối đa 10 lần × 30s trước khi bỏ lượt.

## 3. App KHÔNG THỂ phát hiện gián đoạn — lỗi thiết kế nặng nhất
`Infra.jsx` đo tuổi dữ liệu bằng `EXPORT_AT - pulled`, tức mốc so sánh là **lúc kết
xuất**, không phải bây giờ. Comment trong code còn ghi hẳn lý do: *"lấy bây giờ mà
so thì trang càng để lâu càng báo gián đoạn oan"*.

Lập luận đó sai ở chỗ **mốc đó đóng băng cùng dữ liệu**: bảng kéo 12:25, kết xuất
17:04 → chênh 4,7h ≤ ngưỡng 9h → "Bình thường" **vĩnh viễn**, job đứng bao lâu cũng
không đổi. Một bộ phát hiện gián đoạn mà về nguyên tắc không thể phát hiện gián đoạn.

Sửa: đo `NOW - pulled` (tuổi thật người xem đang nhìn), và tách thành hai phần để
chỉ ra nguyên nhân:
- `lagAtExport = EXPORT_AT - pulled` → ETL không kéo được
- `PAGE_AGE_H = NOW - EXPORT_AT` → kéo được nhưng chưa deploy

Kiểm chứng: nạp lại **đúng** file `infra.json` của bản đang public — cái hôm qua cho
ra "Bình thường" — bản sửa cho ra "Chậm nhịp" + dải cảnh báo "kết xuất cách đây 17.1 giờ".

## 4. Bản public không bao giờ tự cập nhật
`run_all.py` ghi `src/data/*.json` ở máy local rồi dừng: không build, không deploy.
Bundle trên link vẫn là bản cũ (`index-BKqUEo_0.js`), và repo còn 6 file `src/data/`
modified chưa commit — đúng dấu vết. Nghĩa là dù job chạy đủ 3 lượt/ngày, người
trong tổ chức mở link **vẫn thấy số cũ**; chỉ Supabase là mới.

Sửa: chuyển job lên `.github/workflows/etl.yml` — kéo Shopee → Supabase → kết xuất →
build → đẩy `gh-pages`, chạy trên máy GitHub nên không phụ thuộc laptop.

## Nút thắt khi chuyển lên Actions: token Shopee
`access_token` hết hạn 4 giờ, `refresh_token` **tự đổi mỗi lần làm mới**. Secret của
GitHub chỉ đọc được, không ghi lại được → không có chỗ lưu token mới.

Giải: bảng `shopee.oauth_token` trong Supabase là bản gốc duy nhất. `shopee_client`
đọc token từ DB (cache trong tiến trình), ghi lại sau mỗi refresh, `ensure_token()`
xoá cache trước khi quyết định để nhận token máy khác vừa làm mới. Secret chỉ giữ
phần tĩnh: `SUPABASE_DSN`, `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_SHOP_ID`.

**Đã tắt launchd** (`launchctl bootout` + dọn plist). Không được chạy song song hai
nơi: hai lượt cùng refresh sẽ vô hiệu hoá `refresh_token` của nhau → mất quyền, phải
uỷ quyền lại shop.

## Lỗi phát sinh ngay khi chuyển máy
Lượt Actions đầu tiên chạy 9/9 nhưng bản public ghi "kết xuất **03:20**" — đó là giờ
UTC của runner. `export_app_data.py` dùng `datetime.now().isoformat()` không có múi
giờ; chạy trên laptop thì tình cờ đúng, chạy trên máy UTC thì app đọc thành giờ VN và
lệch 7 tiếng → hai tiếng sau sẽ báo "trang đang xem số cũ" oan. Sửa: ghi kèm `+07:00`.
Kiểm bằng `TZ=UTC` → ra `10:24:21+07:00`.

## Bảo mật của workflow trên repo PUBLIC
Chỉ dùng trigger `schedule` + `workflow_dispatch`. **Tuyệt đối không** thêm
`pull_request`: PR từ fork mà chạy được workflow là đọc được `SHOPEE_PARTNER_KEY`.
`concurrency: etl-shopee` chặn hai lượt chồng nhau. GitHub che secret trong log
(kiểm rồi: hiện `token: ***`).

## Kiểm chứng cuối
Actions chạy tay 2 lượt, cả hai xanh (3m34s), ETL 9/9 trên máy GitHub. Bundle trên
link đổi `BKqUEo_0` → `C_L9oD1v` → `BFpaBDvS`. Bản public ghi đúng "kết xuất 10:27
08/09/2026", bảng hạ tầng ghi "GitHub Actions — .github/workflows/etl.yml", chữ
"launchd" đã biến mất.
