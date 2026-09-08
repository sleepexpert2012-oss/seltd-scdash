# Dữ liệu giả đã bị thay thế — 2026-09-07

3 file này là dữ liệu GIẢ dùng để dựng giao diện từ 2026-09-06 đến 2026-09-07,
đã được thay bằng dữ liệu THẬT từ Shopee API:

| File giả | Thay bằng |
|---|---|
| `sales_mock.json` | `src/data/sales.json` (2.212 đơn thật) |
| `sales_daily_mock.json` | `src/data/sales_daily.json` |
| `stock_mock.json` | `src/data/stock.json` (tồn 4 kho Shopee) |

Giữ lại để đối chiếu: dữ liệu giả từng cho GM 28,5% / huỷ 31%, dữ liệu thật cho
GM 36,7% / huỷ 46%. Script sinh vẫn ở `scripts/gen_mock_*.py` nếu cần dựng lại
giao diện mà không có mạng.

KHÔNG xoá trước 2026-12.

## com.seltd.scdash.etl.plist — 08/09/2026
Lịch chạy ETL bằng launchd trên MacBook. Thay bằng `.github/workflows/etl.yml`.

Vì sao bỏ: máy ngủ là mất lượt (06:00 ngày 08/09 trượt, launchd bắn bù lúc 09:48
khi Wi-Fi chưa lên nên chết luôn), và job này không deploy nên link public đứng ở
bản cũ dù job vẫn chạy. Đã `launchctl bootout` và dọn plist khỏi ~/Library/LaunchAgents.

KHÔNG nạp lại song song với Actions: hai lượt cùng refresh token Shopee sẽ vô hiệu
hoá refresh_token của nhau, mất quyền và phải uỷ quyền lại shop.

## github-actions-deploy.yml.txt — 08/09/2026
Bản workflow chỉ deploy, viết sẵn hồi 07/09 nhưng chưa dùng được vì token thiếu
scope `workflow`. Thay bằng `.github/workflows/etl.yml` (kéo dữ liệu + build + deploy).
