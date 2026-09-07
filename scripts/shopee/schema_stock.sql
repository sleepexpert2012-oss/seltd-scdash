-- Tồn kho thật từ Shopee: kho + ảnh chụp tồn theo ngày
create table if not exists shopee.raw_warehouse (
  location_id    text primary key,
  warehouse_id   bigint,
  warehouse_name text,
  payload        jsonb not null,
  fetched_at     timestamptz not null default now()
);
alter table shopee.raw_warehouse enable row level security;

-- Ảnh chụp tồn theo NGÀY: Shopee chỉ trả tồn hiện tại, không có lịch sử.
-- Chụp mỗi lần chạy job để dần dựng được lịch sử tồn & tuổi tồn.
create table if not exists shopee.raw_stock_snapshot (
  snap_date       date   not null,
  item_id         bigint not null,
  model_id        bigint not null,
  location_id     text   not null,
  model_sku       text,
  stock           integer not null default 0,
  if_saleable     boolean,
  reserved_total  integer,
  available_total integer,
  payload         jsonb not null,
  fetched_at      timestamptz not null default now(),
  primary key (snap_date, item_id, model_id, location_id)
);
alter table shopee.raw_stock_snapshot enable row level security;
create index if not exists idx_stock_snap_sku on shopee.raw_stock_snapshot (model_sku, snap_date);

-- Tồn hiện tại theo SKU x kho (dùng ảnh chụp mới nhất)
create or replace view shopee.mart_stock_now as
select s.model_sku                        as sku,
       coalesce(w.warehouse_name, s.location_id) as wh,
       sum(s.stock)                       as qty,
       max(s.snap_date)                   as as_of
from shopee.raw_stock_snapshot s
left join shopee.raw_warehouse w using (location_id)
where s.snap_date = (select max(snap_date) from shopee.raw_stock_snapshot)
  and coalesce(s.model_sku,'') <> ''
group by 1,2;

-- Cấu hình chiến dịch quảng cáo: campaign -> item_id, ngân sách, cách đấu giá
create table if not exists shopee.raw_ads_campaign (
  campaign_id     bigint primary key,
  shop_id         bigint not null,
  ad_name         text,
  ad_type         text,
  campaign_status text,
  bidding_method  text,
  placement       text,
  budget          numeric,
  roas_target     numeric,
  start_time      timestamptz,
  end_time        timestamptz,
  item_ids        bigint[],
  payload         jsonb not null,
  fetched_at      timestamptz not null default now()
);
alter table shopee.raw_ads_campaign enable row level security;
