-- BÁN HÀNG ĐẠI LÝ: danh mục khách · đơn hàng · phiếu xuất kho · thanh toán.
--
-- Mở rộng từ các bảng ar_* đã có. Ba thứ bản đối chiếu công nợ 10/11/2026 cho
-- thấy mô hình cũ còn thiếu:
--   1. VAT — phải thanh toán = giá trị chưa VAT x (1 + thuế suất). Trước đây app
--      lấy 229,2tr (chưa VAT) làm số phải thu, số đúng là 247,6tr.
--   2. Số hóa đơn GTGT của từng phiếu xuất.
--   3. Ngày + hình thức thanh toán (không chỉ số tiền).

alter table public.ar_customer add column if not exists mst       text;
alter table public.ar_customer add column if not exists addr      text;
alter table public.ar_customer add column if not exists phone     text;
alter table public.ar_customer add column if not exists email     text;
alter table public.ar_customer add column if not exists vat_rate  numeric(5,4) not null default 0.08;
alter table public.ar_customer add column if not exists note      text;
alter table public.ar_customer add column if not exists active    boolean not null default true;

alter table public.ar_delivery add column if not exists don        text;   -- thuộc đơn hàng
alter table public.ar_delivery add column if not exists invoice_no text;   -- số hóa đơn GTGT
alter table public.ar_delivery add column if not exists qty        integer;

alter table public.ar_payment  add column if not exists method  text;      -- Chuyển khoản / Tiền mặt
alter table public.ar_payment  add column if not exists doc_no  text;      -- số chứng từ

-- Đơn hàng đại lý
create table if not exists public.ar_order (
  code   text primary key,                  -- DH003-KNTH
  cust   text not null,
  d      date not null,
  note   text,
  status text not null default 'open'       -- open | done | cancel
);

-- Dòng hàng của đơn hàng (đặt) và của phiếu xuất (giao).
-- Hai bảng riêng vì SL giao thường khác SL đặt, và một đơn giao nhiều đợt.
create table if not exists public.ar_order_line (
  id    bigserial primary key,
  code  text   not null,
  sku   text   not null,
  qty   numeric not null,
  price bigint not null
);

create table if not exists public.ar_delivery_line (
  id    bigserial primary key,
  pxk   text   not null,
  sku   text   not null,
  qty   numeric not null,
  price bigint not null,                    -- đơn giá chưa VAT
  amount bigint not null,                   -- thành tiền (0 nếu hàng mẫu/quà tặng)
  note  text
);

-- Danh mục nhà cung cấp thêm trong app (ngoài danh sách từ Master Data)
create table if not exists public.supplier_extra (
  code   text primary key,
  name   text not null,
  mst    text,
  phone  text,
  email  text,
  addr   text,
  term_days integer,
  note   text,
  active boolean not null default true
);

do $$
declare t text;
begin
  foreach t in array array['ar_order','ar_order_line','ar_delivery_line','supplier_extra'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---- Ghi: mỗi nghiệp vụ một hàm, luôn để lại dấu trong stock_log ----

create or replace function public.save_customer(p jsonb, actor text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text := p->>'code';
begin
  if coalesce(v_code,'') = '' then raise exception 'thiếu mã khách'; end if;
  insert into public.ar_customer (code, name, term_days, mst, addr, phone, email, vat_rate, note, active)
  values (v_code, p->>'name', coalesce((p->>'term_days')::integer, 30), p->>'mst', p->>'addr',
          p->>'phone', p->>'email', coalesce((p->>'vat_rate')::numeric, 0.08), p->>'note',
          coalesce((p->>'active')::boolean, true))
  on conflict (code) do update set
    name = excluded.name, term_days = excluded.term_days, mst = excluded.mst, addr = excluded.addr,
    phone = excluded.phone, email = excluded.email, vat_rate = excluded.vat_rate,
    note = excluded.note, active = excluded.active;
  insert into public.stock_log (actor, action, n, payload) values (actor, 'customer', 1, p);
  return v_code;
end $$;

create or replace function public.save_supplier(p jsonb, actor text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text := p->>'code';
begin
  if coalesce(v_code,'') = '' then raise exception 'thiếu mã NCC'; end if;
  insert into public.supplier_extra (code, name, mst, phone, email, addr, term_days, note, active)
  values (v_code, p->>'name', p->>'mst', p->>'phone', p->>'email', p->>'addr',
          (p->>'term_days')::integer, p->>'note', coalesce((p->>'active')::boolean, true))
  on conflict (code) do update set
    name = excluded.name, mst = excluded.mst, phone = excluded.phone, email = excluded.email,
    addr = excluded.addr, term_days = excluded.term_days, note = excluded.note, active = excluded.active;
  insert into public.stock_log (actor, action, n, payload) values (actor, 'supplier', 1, p);
  return v_code;
end $$;

-- Đơn hàng: ghi đè trọn gói cả phần dòng hàng của đúng đơn đó
create or replace function public.save_order(p jsonb, lines jsonb, actor text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text := p->>'code'; it jsonb;
begin
  if coalesce(v_code,'') = '' then raise exception 'thiếu mã đơn hàng'; end if;
  insert into public.ar_order (code, cust, d, note, status)
  values (v_code, p->>'cust', (p->>'d')::date, p->>'note', coalesce(p->>'status','open'))
  on conflict (code) do update set cust = excluded.cust, d = excluded.d,
       note = excluded.note, status = excluded.status;
  delete from public.ar_order_line where ar_order_line.code = v_code;
  for it in select * from jsonb_array_elements(lines) loop
    insert into public.ar_order_line (code, sku, qty, price)
    values (v_code, it->>'sku', (it->>'qty')::numeric, (it->>'price')::bigint);
  end loop;
  insert into public.stock_log (actor, action, n, payload)
  values (actor, 'order', jsonb_array_length(lines), p);
  return v_code;
end $$;

-- Phiếu xuất kho: ghi đè trọn gói, tự cộng lại `amount` và `qty` từ dòng hàng
create or replace function public.save_delivery(p jsonb, lines jsonb, actor text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_pxk text := p->>'pxk'; it jsonb; tong bigint := 0; sl numeric := 0;
begin
  if coalesce(v_pxk,'') = '' then raise exception 'thiếu số phiếu xuất'; end if;
  delete from public.ar_delivery_line where ar_delivery_line.pxk = v_pxk;
  for it in select * from jsonb_array_elements(lines) loop
    insert into public.ar_delivery_line (pxk, sku, qty, price, amount, note)
    values (v_pxk, it->>'sku', (it->>'qty')::numeric, (it->>'price')::bigint,
            (it->>'amount')::bigint, it->>'note');
    tong := tong + (it->>'amount')::bigint;
    sl := sl + (it->>'qty')::numeric;
  end loop;
  insert into public.ar_delivery (pxk, cust, d, amount, note, don, invoice_no, qty)
  values (v_pxk, p->>'cust', (p->>'d')::date, tong, p->>'note', p->>'don', p->>'invoice_no', sl::integer)
  on conflict (pxk) do update set cust = excluded.cust, d = excluded.d, amount = excluded.amount,
       note = excluded.note, don = excluded.don, invoice_no = excluded.invoice_no, qty = excluded.qty;
  insert into public.stock_log (actor, action, n, payload)
  values (actor, 'delivery', jsonb_array_length(lines), p);
  return v_pxk;
end $$;

create or replace function public.del_delivery(p_pxk text, actor text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from public.ar_delivery_line where ar_delivery_line.pxk = p_pxk;
  delete from public.ar_delivery where ar_delivery.pxk = p_pxk;
  insert into public.stock_log (actor, action, n, payload)
  values (actor, 'delivery_del', 1, jsonb_build_object('pxk', p_pxk));
  return true;
end $$;

create or replace function public.del_order(p_code text, actor text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from public.ar_order_line where ar_order_line.code = p_code;
  delete from public.ar_order where ar_order.code = p_code;
  insert into public.stock_log (actor, action, n, payload)
  values (actor, 'order_del', 1, jsonb_build_object('code', p_code));
  return true;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'save_customer(jsonb,text)', 'save_supplier(jsonb,text)',
    'save_order(jsonb,jsonb,text)', 'save_delivery(jsonb,jsonb,text)',
    'del_delivery(text,text)', 'del_order(text,text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
