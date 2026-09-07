-- Schema kho dữ liệu Shopee cho SELTD Supply Chain Dashboard
-- Nguyên tắc: lớp raw_* giữ NGUYÊN payload API (không mất cột nào),
-- lớp stg_/mart_ dựng sau bằng view từ jsonb.
create schema if not exists shopee;

create table if not exists shopee.raw_shop (
  shop_id     bigint primary key,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now()
);

create table if not exists shopee.raw_item (
  item_id     bigint primary key,
  shop_id     bigint not null,
  item_status text,
  update_time timestamptz,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now()
);

create table if not exists shopee.raw_model (
  item_id     bigint not null,
  model_id    bigint not null,
  shop_id     bigint not null,
  model_sku   text,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  primary key (item_id, model_id)
);
create index if not exists idx_raw_model_sku on shopee.raw_model (model_sku);

create table if not exists shopee.raw_order (
  order_sn     text primary key,
  shop_id      bigint not null,
  order_status text,
  create_time  timestamptz,
  update_time  timestamptz,
  payload      jsonb not null,
  fetched_at   timestamptz not null default now()
);
create index if not exists idx_raw_order_create on shopee.raw_order (create_time);
create index if not exists idx_raw_order_update on shopee.raw_order (update_time);
create index if not exists idx_raw_order_status on shopee.raw_order (order_status);

create table if not exists shopee.raw_escrow (
  order_sn   text primary key,
  shop_id    bigint not null,
  payload    jsonb not null,
  fetched_at timestamptz not null default now()
);

create table if not exists shopee.raw_escrow_release (
  order_sn            text primary key,
  shop_id             bigint not null,
  payout_amount       numeric,
  escrow_release_time timestamptz,
  fetched_at          timestamptz not null default now()
);

create table if not exists shopee.raw_return (
  return_sn   text primary key,
  order_sn    text,
  shop_id     bigint not null,
  status      text,
  create_time timestamptz,
  update_time timestamptz,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now()
);
create index if not exists idx_raw_return_order on shopee.raw_return (order_sn);

create table if not exists shopee.raw_ads_shop_daily (
  shop_id    bigint not null,
  stat_date  date not null,
  payload    jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (shop_id, stat_date)
);

create table if not exists shopee.raw_ads_campaign_daily (
  shop_id     bigint not null,
  campaign_id bigint not null,
  stat_date   date not null,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  primary key (shop_id, campaign_id, stat_date)
);

-- nhật ký mỗi lần chạy job, để biết đã kéo tới đâu và lần nào lỗi
create table if not exists shopee.etl_run (
  id          bigserial primary key,
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  window_from timestamptz,
  window_to   timestamptz,
  rows_in     integer default 0,
  ok          boolean,
  note        text
);
create index if not exists idx_etl_run_job on shopee.etl_run (job, started_at desc);

-- Khoá toàn bộ: chỉ service_role (chạy phía server) mới đọc/ghi được.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'shopee'
  loop
    execute format('alter table shopee.%I enable row level security', t.tablename);
  end loop;
end $$;
