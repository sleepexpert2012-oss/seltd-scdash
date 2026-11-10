-- Dòng đơn hàng cần CHIẾT KHẤU và THÀNH TIỀN riêng: đơn DH001 có 71 cái chăn
-- đơn giá 480.000/720.000 nhưng chiết khấu 100% nên thành tiền 0. Nếu chỉ lưu
-- đơn giá thì giá trị đơn bị thổi lên 38,6tr tiền quà tặng.
alter table public.ar_order_line add column if not exists disc   numeric not null default 0;
alter table public.ar_order_line add column if not exists amount bigint;
alter table public.ar_order_line add column if not exists note   text;
update public.ar_order_line set amount = round(qty * price) where amount is null;

create or replace function public.save_order(p jsonb, lines jsonb, actor text default 'app')
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
    insert into public.ar_order_line (code, sku, qty, price, disc, amount, note)
    values (v_code, it->>'sku', (it->>'qty')::numeric, (it->>'price')::bigint,
            coalesce((it->>'disc')::numeric, 0),
            coalesce((it->>'amount')::bigint,
                     round((it->>'qty')::numeric * (it->>'price')::bigint
                           * (1 - coalesce((it->>'disc')::numeric,0)))),
            it->>'note');
  end loop;
  insert into public.stock_log (actor, action, n, payload)
  values (actor, 'order', jsonb_array_length(lines), p);
  return v_code;
end $$;
revoke all on function public.save_order(jsonb, jsonb, text) from public;
grant execute on function public.save_order(jsonb, jsonb, text) to anon, authenticated;
