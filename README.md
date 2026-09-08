# SELTD Supply Chain Dashboard

Ứng dụng phân tích bán hàng & chuỗi cung ứng nội bộ của SELTD (Sleep Expert).

**Bản chạy: https://sleepexpert2012-oss.github.io/seltd-scdash/**

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

Deploy bằng `scripts/pages/deploy.sh`: build rồi đẩy `dist/` lên nhánh `gh-pages`,
GitHub Pages phục vụ từ nhánh đó.

```bash
./scripts/pages/deploy.sh
```

Vite lấy `base` từ biến `PAGES_BASE` (script đặt `/<tên-repo>/`) vì Pages phục vụ ở
đường dẫn con — chạy local vẫn dùng `/`.

## Cập nhật số liệu

Tự động: `.github/workflows/etl.yml` chạy 06:00 · 12:00 · 20:00 giờ VN trên máy của
GitHub — kéo Shopee → Supabase → kết xuất `src/data/*.json` → build → đẩy `gh-pages`.
Không phụ thuộc laptop có thức hay không. Chạy bù: tab **Actions** → *ETL Shopee +
deploy app* → **Run workflow**.

Actions chỉ đẩy nhánh `gh-pages`, **không** commit vào `main`. Muốn lưu lại phiên bản
dữ liệu trong git thì chạy tay rồi commit `src/data/*.json` như trước.

Token Shopee nằm ở bảng `shopee.oauth_token` trong Supabase, không nằm trong file:
`access_token` hết hạn 4 giờ và `refresh_token` tự đổi mỗi lần làm mới, nên máy nào
chạy job cũng phải đọc/ghi chung một chỗ. Secret của repo chỉ giữ phần tĩnh
(`SUPABASE_DSN`, `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_SHOP_ID`).

Chạy tay khi cần deploy ngay: `python3 scripts/shopee/run_all.py` →
`./scripts/pages/deploy.sh`.

Nếu sau này cần link **chỉ nội bộ mở được**: giữ repo private, deploy qua Cloudflare
Pages và bật Cloudflare Access giới hạn theo email công ty (miễn phí tới 50 người).
