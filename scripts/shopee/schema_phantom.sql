-- ============================================================
-- TỒN ẢO ĐỒNG BỘ QUA SUPABASE
-- Đặt ở schema public vì chỉ public được phơi ra Data API — schema shopee
-- (đơn hàng, escrow, giá vốn) KHÔNG phơi ra, đã kiểm bằng REST.
--
-- Khoá anon nằm trong trang public nên ai cũng gọi được. Siết lại bằng cách:
--   1. anon CHỈ ĐỌC bảng, không ghi trực tiếp
--   2. Đường ghi duy nhất là hàm set_phantom() — luôn ghi lịch sử
--   3. Bảng lịch sử chỉ thêm, KHÔNG cho sửa/xoá -> phá thì vẫn khôi phục được
-- ============================================================

create table if not exists public.phantom_stock (
  sku        text primary key,
  qty        integer not null check (qty >= 0),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.phantom_stock_log (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  actor   text,
  action  text not null,
  items   integer not null default 0,
  units   integer not null default 0,
  payload jsonb not null
);
create index if not exists idx_phantom_log_at on public.phantom_stock_log (at desc);

alter table public.phantom_stock     enable row level security;
alter table public.phantom_stock_log enable row level security;

-- anon: chỉ đọc
drop policy if exists ph_read on public.phantom_stock;
create policy ph_read on public.phantom_stock for select to anon, authenticated using (true);
drop policy if exists ph_log_read on public.phantom_stock_log;
create policy ph_log_read on public.phantom_stock_log for select to anon, authenticated using (true);

-- Đường GHI duy nhất: thay toàn bộ danh sách trong 1 giao dịch + ghi lịch sử.
-- SECURITY DEFINER để chạy vượt RLS, nhưng chỉ làm đúng việc này.
create or replace function public.set_phantom(items jsonb, actor text default null)
returns table (n_items integer, n_units integer, saved_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  ni integer := 0;
  nu integer := 0;
begin
  if items is null or jsonb_typeof(items) <> 'object' then
    raise exception 'items phải là object dạng {"SKU": số}';
  end if;

  create temp table _ph (sku text primary key, qty integer) on commit drop;
  insert into _ph (sku, qty)
  select k, floor(v::numeric)::int
  from jsonb_each_text(items) as t(k, v)
  where k <> '' and length(k) <= 64
    and v ~ '^[0-9]+(\.[0-9]+)?$' and floor(v::numeric) > 0
  on conflict (sku) do nothing;

  select count(*), coalesce(sum(qty), 0) into ni, nu from _ph;
  if ni > 5000 then
    raise exception 'quá 5000 SKU trong một lần ghi';
  end if;

  delete from public.phantom_stock p where not exists (select 1 from _ph t where t.sku = p.sku);
  insert into public.phantom_stock (sku, qty, updated_at, updated_by)
  select sku, qty, now(), actor from _ph
  on conflict (sku) do update
    set qty = excluded.qty, updated_at = now(), updated_by = excluded.updated_by;

  insert into public.phantom_stock_log (actor, action, items, units, payload)
  values (actor, case when ni = 0 then 'clear' else 'save' end, ni, nu,
          (select coalesce(jsonb_object_agg(sku, qty), '{}'::jsonb) from _ph));

  return query select ni, nu, now();
end $$;

revoke all on function public.set_phantom(jsonb, text) from public;
grant execute on function public.set_phantom(jsonb, text) to anon, authenticated;

-- không cho anon ghi trực tiếp vào bảng
revoke insert, update, delete on public.phantom_stock     from anon, authenticated;
revoke insert, update, delete on public.phantom_stock_log  from anon, authenticated;
grant select on public.phantom_stock     to anon, authenticated;
grant select on public.phantom_stock_log to anon, authenticated;
