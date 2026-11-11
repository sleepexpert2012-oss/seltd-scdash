-- ============================================================
-- DÒNG TIỀN THEO THÁNG + VỐN LƯU ĐỘNG
--   cf_setting   tham số dùng chung của màn Dòng tiền (hiện chỉ có quỹ tối thiểu)
--   wc_snapshot  ảnh chụp vốn lưu động mỗi tháng — để có lịch sử CCC thật.
--                Tồn kho và công nợ nhà cung cấp KHÔNG dựng lại được cho quá khứ
--                (chỉ có số hiện tại), nên phải chụp dần từ nay.
-- Cùng cơ chế các bảng khác: anon chỉ ĐỌC, ghi qua hàm SECURITY DEFINER.
-- ============================================================

create table if not exists public.cf_setting (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.wc_snapshot (
  ym         text        primary key check (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  as_of      date        not null,
  data       jsonb       not null,   -- { inv, ar, ap, cogs90, revSan, credit, dio, dso, dpo, ccc, ... }
  updated_at timestamptz not null default now(),
  updated_by text
);

do $$
declare t text;
begin
  foreach t in array array['cf_setting','wc_snapshot'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Ghi tham số. Chỉ nhận khoá trong danh sách, giá trị là số không âm.
create or replace function public.set_cf_setting(p_key text, p_value jsonb, actor text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare cu jsonb;
begin
  if p_key not in ('quy_toi_thieu') then raise exception 'khoá % không được phép', p_key; end if;
  if jsonb_typeof(p_value) <> 'number' or (p_value::text)::numeric < 0 then
    raise exception 'giá trị phải là số không âm';
  end if;
  select value into cu from public.cf_setting where key = p_key;
  insert into public.cf_setting (key, value, updated_at, updated_by) values (p_key, p_value, now(), actor)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  insert into public.cashflow_log (actor, action, weeks, payload)
  values (actor, 'setting', 0, jsonb_build_object('key', p_key, 'old', cu, 'new', p_value));
  return true;
end $$;

-- Ghi ảnh chụp vốn lưu động. Chỉ được ghi THÁNG HIỆN TẠI (giờ Việt Nam):
-- tháng đã qua là lịch sử, không cho sửa — lần ghi cuối cùng trong tháng
-- chính là số chốt cuối tháng.
create or replace function public.save_wc_snapshot(p_ym text, p_as_of date, p_data jsonb, actor text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare cur_ym text := to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM');
begin
  if p_ym is distinct from cur_ym then
    raise exception 'chỉ ghi được tháng hiện tại (%), không ghi %', cur_ym, p_ym;
  end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'data phải là object'; end if;
  insert into public.wc_snapshot (ym, as_of, data, updated_at, updated_by)
  values (p_ym, p_as_of, p_data, now(), actor)
  on conflict (ym) do update set as_of = excluded.as_of, data = excluded.data,
    updated_at = now(), updated_by = excluded.updated_by;
  return true;
end $$;

revoke all on function public.set_cf_setting(text, jsonb, text) from public;
revoke all on function public.save_wc_snapshot(text, date, jsonb, text) from public;
grant execute on function public.set_cf_setting(text, jsonb, text) to anon, authenticated;
grant execute on function public.save_wc_snapshot(text, date, jsonb, text) to anon, authenticated;
