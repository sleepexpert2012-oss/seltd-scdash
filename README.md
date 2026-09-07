# SELTD Supply Chain Dashboard

Ứng dụng phân tích bán hàng & chuỗi cung ứng nội bộ của SELTD (Sleep Expert).

**Bản chạy: https://louisle-hash.github.io/seltd-scdash/**

## ⚠️ Repo này PUBLIC và chứa dữ liệu kinh doanh thật

`src/data/` chứa **số liệu thật đã tổng hợp**: doanh thu, giá vốn, GM%, giá mua từ
nhà cung cấp, công nợ, tồn kho và chi phí quảng cáo. Repo đang **public** theo quyết
định ngày 2026-09-07, nghĩa là những số này ai cũng đọc được.

Không có khoá API nào trong repo — `secrets/` (partner_key Shopee, access_token,
mật khẩu DB, service_role key Supabase) đã bị gitignore và đã kiểm tra bundle build
không lộ khoá nào.

## Chạy local

```bash
npm install
npm run dev        # http://localhost:5173
```

Mật khẩu đăng nhập nằm ở `src/screens/Login.jsx`. Đây là **khoá mềm phía client**,
chỉ để tránh mở nhầm — bất kỳ ai xem mã nguồn trang đều đọc được. Muốn chặn thật
thì phải dùng xác thực phía server (xem mục Triển khai).

## Nguồn dữ liệu

| Nguồn | Nội dung |
|---|---|
| `Master Data.xlsx` | 143 SKU, 6 NCC, 182 dòng PO |
| Shopee Open API v2 | đơn hàng, escrow (phí sàn), đơn hoàn, quảng cáo, tồn kho 4 kho |
| Supabase (schema `shopee`) | kho dữ liệu thô `raw_*` (giữ nguyên payload jsonb) + view `stg_*` / `mart_*` |

ETL ở `scripts/shopee/`, chạy bằng `run_all.py`, hẹn giờ 06:00 / 12:00 / 20:00
qua launchd (`com.seltd.scdash.etl.plist`). Xem `INDEX.md` để biết chi tiết.

## Màn hình

Tổng quan · Lịch bán hàng · Ngành hàng · Range Review · Ma trận sản phẩm ·
Marketing Analysis · Nhà cung cấp & Mua hàng · Tồn kho & Đặt hàng · Forecast & Kế hoạch

## Triển khai

`.github/workflows/deploy.yml` build và đẩy lên GitHub Pages mỗi lần push vào `main`.
Vite lấy `base` từ biến `PAGES_BASE` (workflow đặt `/<tên-repo>/`) vì Pages phục vụ ở
đường dẫn con — chạy local vẫn dùng `/`.

Cập nhật số liệu: chạy `python3 scripts/shopee/run_all.py` (hoặc chờ job 3 khung giờ),
rồi commit `src/data/*.json` và push — Pages tự build lại.

Nếu sau này cần link **chỉ nội bộ mở được**: giữ repo private, deploy qua Cloudflare
Pages và bật Cloudflare Access giới hạn theo email công ty (miễn phí tới 50 người).
