-- ============================================================
-- BẢN DỰ BÁO ĐÃ CHỐT — để đo dự báo đúng hay sai
--   fc_snapshot       một bản: kịch bản, khoảng tháng, trạng thái nháp/đã chốt
--   fc_snapshot_line  số lượng & giá theo SKU × tháng; qty_calc = số máy tính lúc tạo
-- Bản ĐÃ CHỐT là chỉ đọc vĩnh viễn — khoá ở DATABASE (trigger), không chỉ ở giao diện.
-- Muốn đổi thì nhân bản thành bản nháp mới.
-- ============================================================

create table if not exists public.fc_snapshot (
  id         bigserial   primary key,
  name       text        not null,
  scenario   text        not null check (scenario in ('thap','co_so','cao')),
  factor     numeric     not null default 1 check (factor > 0 and factor <= 5),
  from_ym    text        not null check (from_ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  to_ym      text        not null check (to_ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status     text        not null default 'draft' check (status in ('draft','locked')),
  note       text,
  created_at timestamptz not null default now(),
  created_by text,
  locked_at  timestamptz,
  locked_by  text
);

create table if not exists public.fc_snapshot_line (
  snapshot_id bigint  not null references public.fc_snapshot(id) on delete cascade,
  sku         text    not null,
  ym          text    not null check (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  qty_calc    numeric not null default 0,
  qty         numeric not null default 0 check (qty >= 0),
  price       numeric not null default 0 check (price >= 0),   -- giá bán thuần dự kiến / sp
  cost        numeric not null default 0 check (cost >= 0),    -- giá vốn / sp lúc tạo bản
  primary key (snapshot_id, sku, ym)
);

create table if not exists public.fc_log (
  id      bigserial   primary key,
  at      timestamptz not null default now(),
  actor   text,
  action  text        not null,
  snapshot_id bigint,
  payload jsonb
);

do $$
declare t text;
begin
  foreach t in array array['fc_snapshot','fc_snapshot_line','fc_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Khoá cứng: mọi sửa/xoá dòng của bản đã chốt đều bị từ chối, kể cả qua hàm.
create or replace function public.fc_guard_line() returns trigger
language plpgsql as $$
declare st text;
begin
  select status into st from public.fc_snapshot
   where id = coalesce(new.snapshot_id, old.snapshot_id);
  if st = 'locked' then raise exception 'bản dự báo % đã chốt — chỉ đọc', coalesce(new.snapshot_id, old.snapshot_id); end if;
  return coalesce(new, old);
end $$;
drop trigger if exists fc_guard_line on public.fc_snapshot_line;
create trigger fc_guard_line before insert or update or delete on public.fc_snapshot_line
  for each row execute function public.fc_guard_line();

create or replace function public.fc_guard_head() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'locked' then raise exception 'không xoá được bản đã chốt'; end if;
    return old;
  end if;
  if old.status = 'locked' then raise exception 'bản dự báo % đã chốt — chỉ đọc', old.id; end if;
  return new;
end $$;
drop trigger if exists fc_guard_head on public.fc_snapshot;
create trigger fc_guard_head before update or delete on public.fc_snapshot
  for each row execute function public.fc_guard_head();

-- Tạo bản nháp kèm toàn bộ dòng. lines = [{sku, ym, qty_calc, qty, price, cost}]
create or replace function public.create_fc_snapshot(p jsonb, lines jsonb, actor text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare new_id bigint; n integer;
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'thiếu tên bản dự báo'; end if;
  if jsonb_typeof(lines) <> 'array' then raise exception 'lines phải là mảng'; end if;
  if jsonb_array_length(lines) > 20000 then raise exception 'quá nhiều dòng'; end if;
  insert into public.fc_snapshot (name, scenario, factor, from_ym, to_ym, note, created_by)
  values (trim(p->>'name'), p->>'scenario', coalesce((p->>'factor')::numeric, 1),
          p->>'from_ym', p->>'to_ym', nullif(p->>'note', ''), actor)
  returning id into new_id;
  insert into public.fc_snapshot_line (snapshot_id, sku, ym, qty_calc, qty, price, cost)
  select new_id, x->>'sku', x->>'ym', coalesce((x->>'qty_calc')::numeric, 0),
         coalesce((x->>'qty')::numeric, 0), coalesce((x->>'price')::numeric, 0), coalesce((x->>'cost')::numeric, 0)
  from jsonb_array_elements(lines) x;
  get diagnostics n = row_count;
  insert into public.fc_log (actor, action, snapshot_id, payload) values (actor, 'create', new_id, jsonb_build_object('lines', n, 'p', p));
  return new_id;
end $$;

-- Sửa ô của bản nháp. cells = [{sku, ym, qty?, price?}] (price áp cho mọi tháng của SKU nếu không có ym)
create or replace function public.save_fc_lines(p_id bigint, cells jsonb, actor text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare c jsonb; n integer := 0; k integer;
begin
  if (select status from public.fc_snapshot where id = p_id) is distinct from 'draft' then
    raise exception 'chỉ sửa được bản nháp';
  end if;
  for c in select * from jsonb_array_elements(cells) loop
    if c ? 'qty' then
      update public.fc_snapshot_line set qty = (c->>'qty')::numeric
       where snapshot_id = p_id and sku = c->>'sku' and ym = c->>'ym';
      get diagnostics k = row_count; n := n + k;
    end if;
    if c ? 'price' then
      update public.fc_snapshot_line set price = (c->>'price')::numeric
       where snapshot_id = p_id and sku = c->>'sku' and (c->>'ym' is null or ym = c->>'ym');
      get diagnostics k = row_count; n := n + k;
    end if;
  end loop;
  insert into public.fc_log (actor, action, snapshot_id, payload) values (actor, 'edit', p_id, jsonb_build_object('n', n, 'cells', cells));
  return n;
end $$;

create or replace function public.lock_fc_snapshot(p_id bigint, actor text default null)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare ts timestamptz := now();
begin
  update public.fc_snapshot set status = 'locked', locked_at = ts, locked_by = actor
   where id = p_id and status = 'draft';
  if not found then raise exception 'không có bản nháp %', p_id; end if;
  insert into public.fc_log (actor, action, snapshot_id) values (actor, 'lock', p_id);
  return ts;
end $$;

create or replace function public.clone_fc_snapshot(p_id bigint, p_name text, actor text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare new_id bigint; s public.fc_snapshot;
begin
  select * into s from public.fc_snapshot where id = p_id;
  if s.id is null then raise exception 'không có bản %', p_id; end if;
  insert into public.fc_snapshot (name, scenario, factor, from_ym, to_ym, note, created_by)
  values (coalesce(nullif(trim(p_name), ''), s.name || ' (bản sao)'), s.scenario, s.factor, s.from_ym, s.to_ym, s.note, actor)
  returning id into new_id;
  insert into public.fc_snapshot_line (snapshot_id, sku, ym, qty_calc, qty, price, cost)
  select new_id, sku, ym, qty_calc, qty, price, cost from public.fc_snapshot_line where snapshot_id = p_id;
  insert into public.fc_log (actor, action, snapshot_id, payload) values (actor, 'clone', new_id, jsonb_build_object('from', p_id));
  return new_id;
end $$;

create or replace function public.del_fc_snapshot(p_id bigint, actor text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.fc_snapshot where id = p_id;   -- trigger chặn nếu đã chốt
  insert into public.fc_log (actor, action, snapshot_id) values (actor, 'delete', p_id);
  return true;
end $$;

revoke all on function public.create_fc_snapshot(jsonb, jsonb, text) from public;
revoke all on function public.save_fc_lines(bigint, jsonb, text) from public;
revoke all on function public.lock_fc_snapshot(bigint, text) from public;
revoke all on function public.clone_fc_snapshot(bigint, text, text) from public;
revoke all on function public.del_fc_snapshot(bigint, text) from public;
grant execute on function public.create_fc_snapshot(jsonb, jsonb, text) to anon, authenticated;
grant execute on function public.save_fc_lines(bigint, jsonb, text) to anon, authenticated;
grant execute on function public.lock_fc_snapshot(bigint, text) to anon, authenticated;
grant execute on function public.clone_fc_snapshot(bigint, text, text) to anon, authenticated;
grant execute on function public.del_fc_snapshot(bigint, text) to anon, authenticated;
