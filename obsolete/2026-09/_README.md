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
