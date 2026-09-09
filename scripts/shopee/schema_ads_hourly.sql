-- Quảng cáo theo GIỜ, cấp toàn shop.
-- API get_all_cpc_ads_hourly_performance nhận 1 ngày mỗi lần và CHỈ trả số cấp
-- shop — không tách được theo chiến dịch / sản phẩm / ngành hàng. Vì vậy mọi
-- biểu đồ ở mức giờ đều là số toàn shop, bộ lọc ngành/SKU không áp dụng.
-- Kiểm 09/09/2026: lùi được ít nhất 120 ngày, phủ hết giai đoạn có chạy ads.
create table if not exists shopee.raw_ads_shop_hourly (
  shop_id    bigint      not null,
  stat_date  date        not null,
  hour       smallint    not null check (hour between 0 and 23),
  payload    jsonb       not null,
  fetched_at timestamptz not null default now(),
  primary key (shop_id, stat_date, hour)
);
alter table shopee.raw_ads_shop_hourly enable row level security;
revoke all on shopee.raw_ads_shop_hourly from anon, authenticated;

create index if not exists raw_ads_shop_hourly_date_idx
  on shopee.raw_ads_shop_hourly (stat_date);
