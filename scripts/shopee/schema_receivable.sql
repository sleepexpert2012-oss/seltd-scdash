-- CÔNG NỢ PHẢI THU từ khách sỉ (đại lý).
--
-- Nguồn: file "Kế hoạch nhận hàng" của từng đại lý. Mỗi phiếu xuất kho có ngày
-- giao; hạn thanh toán = ngày giao + số ngày công nợ của đại lý (KNTH: 30 ngày).
-- Tiền đến hạn tuần nào thì rơi vào tuần đó trong kế hoạch dòng tiền.
create table if not exists public.ar_customer (
  code      text    primary key,
  name      text    not null,
  term_days integer not null default 30
);

-- Phiếu xuất kho đã giao -> phát sinh khoản phải thu
create table if not exists public.ar_delivery (
  pxk      text    primary key,
  cust     text    not null,
  d        date    not null,           -- ngày giao
  amount   bigint  not null,           -- thành tiền (đồng)
  note     text
);

-- Tiền khách đã trả
create table if not exists public.ar_payment (
  id     bigserial   primary key,
  cust   text        not null,
  d      date        not null,
  amount bigint      not null check (amount > 0),
  note   text,
  at     timestamptz not null default now(),
  actor  text
);

-- Kế hoạch giao tiếp theo (chưa xuất kho) -> phải thu DỰ KIẾN
create table if not exists public.ar_plan (
  id      bigserial primary key,
  cust    text      not null,
  d_from  date      not null,          -- tuần giao dự kiến: ngày đầu tuần
  d_to    date      not null,
  amount  bigint    not null
);

create table if not exists public.ar_meta (
  id         integer     primary key default 1 check (id = 1),
  as_of      date        not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

do $$
declare t text;
begin
  foreach t in array array['ar_customer','ar_delivery','ar_payment','ar_plan','ar_meta'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Nạp lại toàn bộ dữ liệu của MỘT đại lý (phiếu xuất + kế hoạch giao).
-- Thay trọn gói vì đây là ảnh chụp từ file, trộn cũ với mới là ra số không thật.
-- KHÔNG đụng tới bảng thanh toán — tiền đã thu là sự kiện riêng, file không có.
create or replace function public.set_receivable(p_cust jsonb, deliveries jsonb, plans jsonb,
                                                 as_of date, actor text default null)
returns table (n_del integer, n_plan integer, total bigint, saved_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  it jsonb; nd integer := 0; np integer := 0; tong bigint := 0;
  v_code text := p_cust->>'code';   -- tên khác cột `code`, nếu không Postgres báo ambiguous
  now_ts timestamptz := now();
begin
  if coalesce(v_code,'') = '' then raise exception 'thiếu mã đại lý'; end if;

  insert into public.ar_customer (code, name, term_days)
  values (v_code, p_cust->>'name', coalesce((p_cust->>'term_days')::integer, 30))
  on conflict (code) do update set name = excluded.name, term_days = excluded.term_days;

  delete from public.ar_delivery where ar_delivery.cust = v_code;
  for it in select * from jsonb_array_elements(deliveries) loop
    insert into public.ar_delivery (pxk, cust, d, amount, note)
    values (it->>'pxk', v_code, (it->>'d')::date, (it->>'amount')::bigint, it->>'note');
    nd := nd + 1; tong := tong + (it->>'amount')::bigint;
  end loop;

  delete from public.ar_plan where ar_plan.cust = v_code;
  for it in select * from jsonb_array_elements(plans) loop
    insert into public.ar_plan (cust, d_from, d_to, amount)
    values (v_code, (it->>'d_from')::date, (it->>'d_to')::date, (it->>'amount')::bigint);
    np := np + 1;
  end loop;

  insert into public.ar_meta (id, as_of, updated_at, updated_by)
  values (1, as_of, now_ts, actor)
  on conflict (id) do update set as_of = excluded.as_of, updated_at = now_ts,
       updated_by = excluded.updated_by;

  insert into public.stock_log (actor, action, n, payload)
  values (actor, 'receivable', nd, jsonb_build_object('cust', v_code, 'total', tong, 'plans', np));

  return query select nd, np, tong, now_ts;
end $$;

create or replace function public.add_ar_payment(p_cust text, d date, amount bigint,
                                                 note text default null, actor text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  insert into public.ar_payment (cust, d, amount, note, actor)
  values (p_cust, d, amount, note, actor) returning id into new_id;
  insert into public.stock_log (actor, action, n, payload)
  values (actor, 'ar_payment', 1, jsonb_build_object('id', new_id, 'cust', p_cust, 'amount', amount));
  return new_id;
end $$;

create or replace function public.del_ar_payment(row_id bigint, actor text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.ar_payment where id = row_id;
  insert into public.stock_log (actor, action, n, payload)
  values (actor, 'ar_payment_del', 1, jsonb_build_object('id', row_id));
  return true;
end $$;

revoke all on function public.set_receivable(jsonb, jsonb, jsonb, date, text) from public;
revoke all on function public.add_ar_payment(text, date, bigint, text, text) from public;
revoke all on function public.del_ar_payment(bigint, text) from public;
grant execute on function public.set_receivable(jsonb, jsonb, jsonb, date, text) to anon, authenticated;
grant execute on function public.add_ar_payment(text, date, bigint, text, text) to anon, authenticated;
grant execute on function public.del_ar_payment(bigint, text) to anon, authenticated;
