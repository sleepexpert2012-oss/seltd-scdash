-- TỒN ĐẦU KỲ khai tay + ĐƠN BÁN NGOÀI SÀN.
--
-- Vì sao cần: tồn Shopee API trả về SAI (08/11/2026 anh Louis đối chiếu: app
-- 949 unit, kiểm kho thực tế 827). Từ đây tồn không lấy từ Shopee nữa mà tính:
--     tồn hiện tại = tồn đầu kỳ − SL bán trên Shopee sau mốc − SL bán ngoài sàn
-- Tồn đầu kỳ cập nhật bằng cách tải lại file kiểm kho; mốc thời gian lưu kèm.
create table if not exists public.stock_baseline (
  sku        text    not null,
  wh         text    not null,          -- WH001..WH005 theo file kiểm kho
  qty        integer not null check (qty >= 0),
  primary key (sku, wh)
);

-- Mốc đầu kỳ + ai cập nhật. Luôn chỉ có MỘT dòng id = 1.
create table if not exists public.stock_baseline_meta (
  id         integer     primary key default 1 check (id = 1),
  as_of      date        not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  n_sku      integer,
  n_unit     integer
);

-- Đơn bán KHÔNG qua Shopee, khai tay. Trừ thêm vào tồn sau mốc đầu kỳ.
create table if not exists public.offline_sale (
  id      bigserial   primary key,
  d       date        not null,
  sku     text        not null,
  qty     integer     not null check (qty <> 0),
  note    text,
  at      timestamptz not null default now(),
  actor   text
);

create table if not exists public.stock_log (
  id      bigserial   primary key,
  at      timestamptz not null default now(),
  actor   text,
  action  text        not null,
  n       integer,
  payload jsonb
);

alter table public.stock_baseline      enable row level security;
alter table public.stock_baseline_meta enable row level security;
alter table public.offline_sale        enable row level security;
alter table public.stock_log           enable row level security;

do $$
declare t text;
begin
  foreach t in array array['stock_baseline','stock_baseline_meta','offline_sale','stock_log'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
    -- RLS policy KHÔNG đủ: bảng mới không cấp quyền gì cho anon, phải grant tường minh
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Ghi tồn đầu kỳ: thay TOÀN BỘ trong một giao dịch, vì đây là ảnh chụp kiểm kho
-- tại một thời điểm — trộn ảnh cũ với ảnh mới là ra số không có thật.
create or replace function public.set_stock_baseline(items jsonb, as_of date, actor text default null)
returns table (n_sku integer, n_unit integer, saved_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  it     jsonb;
  ns     integer := 0;
  nu     integer := 0;
  now_ts timestamptz := now();
begin
  if jsonb_typeof(items) <> 'array' then raise exception 'items phải là mảng'; end if;
  if jsonb_array_length(items) > 5000 then raise exception 'quá 5000 dòng'; end if;

  delete from public.stock_baseline;
  for it in select * from jsonb_array_elements(items) loop
    if coalesce(it->>'sku','') = '' or coalesce(it->>'wh','') = '' then continue; end if;
    if (it->>'qty')::integer <= 0 then continue; end if;
    insert into public.stock_baseline (sku, wh, qty)
    values (it->>'sku', it->>'wh', (it->>'qty')::integer)
    on conflict (sku, wh) do update set qty = excluded.qty;
    nu := nu + (it->>'qty')::integer;
  end loop;
  select count(distinct sku) into ns from public.stock_baseline;

  insert into public.stock_baseline_meta (id, as_of, updated_at, updated_by, n_sku, n_unit)
  values (1, as_of, now_ts, actor, ns, nu)
  on conflict (id) do update set as_of = excluded.as_of, updated_at = now_ts,
       updated_by = excluded.updated_by, n_sku = excluded.n_sku, n_unit = excluded.n_unit;

  insert into public.stock_log (actor, action, n, payload)
  values (actor, 'baseline', ns, jsonb_build_object('as_of', as_of, 'n_unit', nu));

  return query select ns, nu, now_ts;
end $$;

-- Thêm / xoá đơn bán ngoài sàn
create or replace function public.add_offline_sale(d date, sku text, qty integer,
                                                   note text default null, actor text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if qty = 0 then raise exception 'số lượng phải khác 0'; end if;
  insert into public.offline_sale (d, sku, qty, note, actor)
  values (d, sku, qty, note, actor) returning id into new_id;
  insert into public.stock_log (actor, action, n, payload)
  values (actor, 'offline_sale', qty, jsonb_build_object('id', new_id, 'd', d, 'sku', sku, 'qty', qty));
  return new_id;
end $$;

create or replace function public.del_offline_sale(row_id bigint, actor text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.offline_sale where id = row_id;
  insert into public.stock_log (actor, action, n, payload)
  values (actor, 'offline_sale_del', 1, jsonb_build_object('id', row_id));
  return true;
end $$;

revoke all on function public.set_stock_baseline(jsonb, date, text) from public;
revoke all on function public.add_offline_sale(date, text, integer, text, text) from public;
revoke all on function public.del_offline_sale(bigint, text) from public;
grant execute on function public.set_stock_baseline(jsonb, date, text) to anon, authenticated;
grant execute on function public.add_offline_sale(date, text, integer, text, text) to anon, authenticated;
grant execute on function public.del_offline_sale(bigint, text) to anon, authenticated;
