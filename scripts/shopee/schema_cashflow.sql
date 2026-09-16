-- Kế hoạch dòng tiền theo TUẦN, do người dùng tự nhập.
-- Dùng chung cho cả tổ chức: mỗi máy mở app đều thấy cùng một kế hoạch, giống
-- cách đã làm cho tồn ảo. Khoá gọi nằm trong trang public nên siết ở DB:
-- anon chỉ ĐỌC bảng, mọi ghi phải đi qua hàm set_cashflow().
create table if not exists public.cashflow_week (
  wk         text        primary key,      -- '2026-W38'
  data       jsonb       not null,         -- { open, thu:{...}, chi:{...}, note }
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.cashflow_log (
  id      bigserial   primary key,
  at      timestamptz not null default now(),
  actor   text,
  action  text        not null,
  weeks   integer,
  payload jsonb       not null
);

alter table public.cashflow_week enable row level security;
alter table public.cashflow_log  enable row level security;

drop policy if exists cf_read on public.cashflow_week;
create policy cf_read on public.cashflow_week for select to anon, authenticated using (true);
drop policy if exists cf_log_read on public.cashflow_log;
create policy cf_log_read on public.cashflow_log for select to anon, authenticated using (true);

-- RLS policy thôi CHƯA đủ: bảng mới không cấp quyền gì cho anon, nên phải
-- grant select tường minh thì trang mới đọc được (quên là đọc ra 401).
grant select on public.cashflow_week to anon, authenticated;
grant select on public.cashflow_log  to anon, authenticated;
revoke insert, update, delete on public.cashflow_week from anon, authenticated;
revoke insert, update, delete on public.cashflow_log  from anon, authenticated;

-- Đường ghi DUY NHẤT. Nhận một mảng tuần, ghi đè đúng những tuần được gửi
-- (không xoá tuần khác) để hai người sửa hai tuần khác nhau không đạp lên nhau.
create or replace function public.set_cashflow(weeks jsonb, actor text default null)
returns table (n_weeks integer, saved_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  w      jsonb;
  n      integer := 0;
  now_ts timestamptz := now();
begin
  if jsonb_typeof(weeks) <> 'array' then
    raise exception 'weeks phải là mảng';
  end if;
  if jsonb_array_length(weeks) > 260 then
    raise exception 'quá 260 tuần trong một lần ghi';
  end if;

  for w in select * from jsonb_array_elements(weeks) loop
    if (w->>'wk') !~ '^[0-9]{4}-W[0-9]{2}$' then
      raise exception 'mã tuần sai định dạng: %', w->>'wk';
    end if;
    insert into public.cashflow_week (wk, data, updated_at, updated_by)
    values (w->>'wk', w->'data', now_ts, actor)
    on conflict (wk) do update
      set data = excluded.data, updated_at = now_ts, updated_by = excluded.updated_by;
    n := n + 1;
  end loop;

  insert into public.cashflow_log (actor, action, weeks, payload)
  values (actor, 'save', n, weeks);

  return query select n, now_ts;
end $$;

revoke all on function public.set_cashflow(jsonb, text) from public;
grant execute on function public.set_cashflow(jsonb, text) to anon, authenticated;
