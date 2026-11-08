-- CÔNG NỢ NHÀ CUNG CẤP khai tay, lấy từ phần mềm kế toán.
--
-- Vì sao cần: app tự cộng `outstanding` của mọi PO chưa đánh dấu đã trả trong
-- Master Data ra 1.379,6tr, trong khi số thật trên phần mềm là 779,2tr — lệch
-- 600tr vì Master Data không cập nhật các khoản đã thanh toán. Số khai tay này
-- là số dùng để lập kế hoạch chi tiền; số tính từ PO giữ lại để đối chiếu.
create table if not exists public.supplier_debt (
  code  text    primary key,            -- mã NCC, khớp master.suppliers
  name  text,
  debt  bigint  not null check (debt >= 0)
);

create table if not exists public.supplier_debt_meta (
  id         integer     primary key default 1 check (id = 1),
  as_of      date        not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  total      bigint
);

alter table public.supplier_debt      enable row level security;
alter table public.supplier_debt_meta enable row level security;

do $$
declare t text;
begin
  foreach t in array array['supplier_debt','supplier_debt_meta'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Thay TOÀN BỘ trong một giao dịch: đây là ảnh chụp công nợ tại một thời điểm,
-- trộn ảnh cũ với ảnh mới là ra số không có thật.
create or replace function public.set_supplier_debt(items jsonb, as_of date, actor text default null)
returns table (n integer, total bigint, saved_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  it     jsonb;
  cnt    integer := 0;
  tong   bigint  := 0;
  now_ts timestamptz := now();
begin
  if jsonb_typeof(items) <> 'array' then raise exception 'items phải là mảng'; end if;
  if jsonb_array_length(items) > 500 then raise exception 'quá 500 nhà cung cấp'; end if;

  delete from public.supplier_debt;
  for it in select * from jsonb_array_elements(items) loop
    if coalesce(it->>'code','') = '' then continue; end if;
    insert into public.supplier_debt (code, name, debt)
    values (it->>'code', it->>'name', greatest(0, (it->>'debt')::bigint))
    on conflict (code) do update set name = excluded.name, debt = excluded.debt;
    cnt := cnt + 1;
    tong := tong + greatest(0, (it->>'debt')::bigint);
  end loop;

  insert into public.supplier_debt_meta (id, as_of, updated_at, updated_by, total)
  values (1, as_of, now_ts, actor, tong)
  on conflict (id) do update set as_of = excluded.as_of, updated_at = now_ts,
       updated_by = excluded.updated_by, total = excluded.total;

  insert into public.stock_log (actor, action, n, payload)
  values (actor, 'supplier_debt', cnt, jsonb_build_object('as_of', as_of, 'total', tong));

  return query select cnt, tong, now_ts;
end $$;

revoke all on function public.set_supplier_debt(jsonb, date, text) from public;
grant execute on function public.set_supplier_debt(jsonb, date, text) to anon, authenticated;
