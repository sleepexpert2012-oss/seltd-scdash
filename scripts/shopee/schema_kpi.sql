-- ============================================================
-- CHIẾN LƯỢC & KPI — CẤP PHÒNG BAN (quyết định 11/11/2026)
-- KHÔNG có bảng nhân sự, KHÔNG lưu tên hay điểm cá nhân: trang công khai đọc
-- được mọi bảng bằng khoá anon (đăng nhập app chỉ chặn ở trình duyệt).
--   kpi_dept       phòng ban
--   kpi_objective  mục tiêu chiến lược theo 4 góc nhìn BSC, phòng chủ trì, mũi tên nhân–quả (parent)
--   kpi_def        thư viện KPI: đơn vị, chiều tốt, nguồn tự động / nhập tay
--   kpi_assign     giao KPI cho mục tiêu + phòng ban, có trọng số
--   kpi_value      mục tiêu và thực tế theo tháng (thực tế chỉ cho KPI nhập tay)
--   kpi_log        lịch sử sửa
-- ============================================================

create table if not exists public.kpi_dept (
  code   text    primary key check (code ~ '^[a-z][a-z0-9_]{1,29}$'),
  name   text    not null,
  sort   integer not null default 100,
  active boolean not null default true
);

create table if not exists public.kpi_objective (
  id          bigserial primary key,
  perspective text      not null check (perspective in ('tai_chinh','khach_hang','quy_trinh','hoc_hoi')),
  name        text      not null,
  dept        text      references public.kpi_dept(code),
  parent_id   bigint    references public.kpi_objective(id) on delete set null,
  sort        integer   not null default 100,
  active      boolean   not null default true
);

create table if not exists public.kpi_def (
  code      text    primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name      text    not null,
  unit      text    not null default '',
  direction text    not null default 'up' check (direction in ('up','down')),
  formula   text,
  source    text    not null default 'nhap' check (source in ('auto','nhap')),
  auto_key  text,               -- khoá hàm tự tính trong app (src/lib/kpi.js) khi source = 'auto'
  freq      text    not null default 'thang',
  active    boolean not null default true
);

create table if not exists public.kpi_assign (
  id           bigserial primary key,
  kpi          text      not null references public.kpi_def(code),
  objective_id bigint    references public.kpi_objective(id) on delete set null,
  dept         text      not null references public.kpi_dept(code),
  weight       numeric   not null default 0 check (weight >= 0 and weight <= 100),
  active       boolean   not null default true
);

create table if not exists public.kpi_value (
  assign_id bigint  not null references public.kpi_assign(id) on delete cascade,
  ym        text    not null check (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  target    numeric,
  actual    numeric,
  primary key (assign_id, ym)
);

create table if not exists public.kpi_log (
  id      bigserial   primary key,
  at      timestamptz not null default now(),
  actor   text,
  action  text        not null,
  payload jsonb
);

do $$
declare t text;
begin
  foreach t in array array['kpi_dept','kpi_objective','kpi_def','kpi_assign','kpi_value','kpi_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Thư viện KPI tự động (nối vào số app đã tính — không cho nhập tay trùng)
insert into public.kpi_def (code, name, unit, direction, formula, source, auto_key) values
  ('dt_cty',     'Doanh thu thuần toàn công ty',      'đ',   'up',   'Doanh thu thuần Shopee + bán ngoài sàn (chưa VAT)', 'auto', 'dt_cty'),
  ('bien_gop',   'Biên lợi nhuận gộp',                '%',   'up',   '(Doanh thu − giá vốn) ÷ doanh thu', 'auto', 'bien_gop'),
  ('roas',       'ROAS thật Shopee Ads',              'lần', 'up',   'GMV quảng cáo × (thuần ÷ GMV) ÷ chi quảng cáo', 'auto', 'roas'),
  ('phi_san_pct','Phí sàn / doanh thu Shopee',        '%',   'down', '6 khoản phí sàn ÷ doanh thu thuần Shopee', 'auto', 'phi_san_pct'),
  ('ty_le_hoan', 'Tỷ lệ hoàn hàng',                   '%',   'down', 'Tiền hàng hoàn ÷ GMV', 'auto', 'ty_le_hoan'),
  ('don_shopee', 'Số đơn Shopee (thuần)',             'đơn', 'up',   'Số đơn sau huỷ/hoàn', 'auto', 'don_shopee'),
  ('dso_ngoai',  'Số ngày thu tiền khách ngoài sàn',  'ngày','down', 'Phải thu ÷ bán chịu 90 ngày × 90', 'auto', 'dso_ngoai')
on conflict (code) do nothing;

-- Không tạo sẵn phòng ban hay mục tiêu mẫu: tên phòng ban là của công ty, người dùng tự khai.

-- ---------- GHI ----------
create or replace function public.save_kpi_dept(p jsonb, actor text default null)
returns text language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'thiếu tên phòng ban'; end if;
  insert into public.kpi_dept (code, name, sort, active)
  values (lower(trim(p->>'code')), trim(p->>'name'), coalesce((p->>'sort')::int, 100), coalesce((p->>'active')::boolean, true))
  on conflict (code) do update set name = excluded.name, sort = excluded.sort, active = excluded.active;
  insert into public.kpi_log (actor, action, payload) values (actor, 'dept', p);
  return lower(trim(p->>'code'));
end $$;

create or replace function public.save_kpi_objective(p jsonb, actor text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p->>'id', '')::bigint;
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'thiếu tên mục tiêu'; end if;
  if v_id is not null and nullif(p->>'parent_id', '')::bigint = v_id then raise exception 'mục tiêu không phục vụ chính nó'; end if;
  if v_id is null then
    insert into public.kpi_objective (perspective, name, dept, parent_id, sort, active)
    values (p->>'perspective', trim(p->>'name'), nullif(p->>'dept', ''), nullif(p->>'parent_id', '')::bigint,
            coalesce((p->>'sort')::int, 100), coalesce((p->>'active')::boolean, true))
    returning id into v_id;
  else
    update public.kpi_objective set perspective = p->>'perspective', name = trim(p->>'name'), dept = nullif(p->>'dept', ''),
      parent_id = nullif(p->>'parent_id', '')::bigint, sort = coalesce((p->>'sort')::int, 100),
      active = coalesce((p->>'active')::boolean, true) where id = v_id;
  end if;
  insert into public.kpi_log (actor, action, payload) values (actor, 'objective', p || jsonb_build_object('id', v_id));
  return v_id;
end $$;

create or replace function public.save_kpi_def(p jsonb, actor text default null)
returns text language plpgsql security definer set search_path = public as $$
declare cu public.kpi_def;
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'thiếu tên KPI'; end if;
  select * into cu from public.kpi_def where code = lower(trim(p->>'code'));
  -- KPI tự động: không đổi nguồn / khoá hàm (app đang tính đúng theo khoá đó)
  insert into public.kpi_def (code, name, unit, direction, formula, source, auto_key, freq, active)
  values (lower(trim(p->>'code')), trim(p->>'name'), coalesce(p->>'unit', ''), coalesce(p->>'direction', 'up'),
          nullif(p->>'formula', ''), coalesce(cu.source, 'nhap'), cu.auto_key, coalesce(p->>'freq', 'thang'),
          coalesce((p->>'active')::boolean, true))
  on conflict (code) do update set name = excluded.name, unit = excluded.unit, direction = excluded.direction,
    formula = excluded.formula, freq = excluded.freq, active = excluded.active;
  insert into public.kpi_log (actor, action, payload) values (actor, 'def', p);
  return lower(trim(p->>'code'));
end $$;

create or replace function public.save_kpi_assign(p jsonb, actor text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p->>'id', '')::bigint;
begin
  if v_id is null then
    insert into public.kpi_assign (kpi, objective_id, dept, weight, active)
    values (p->>'kpi', nullif(p->>'objective_id', '')::bigint, p->>'dept', coalesce((p->>'weight')::numeric, 0),
            coalesce((p->>'active')::boolean, true))
    returning id into v_id;
  else
    update public.kpi_assign set kpi = p->>'kpi', objective_id = nullif(p->>'objective_id', '')::bigint, dept = p->>'dept',
      weight = coalesce((p->>'weight')::numeric, 0), active = coalesce((p->>'active')::boolean, true) where id = v_id;
  end if;
  insert into public.kpi_log (actor, action, payload) values (actor, 'assign', p || jsonb_build_object('id', v_id));
  return v_id;
end $$;

-- Ô mục tiêu / thực tế: cells = [{assign_id, ym, target?, actual?}] — null là xoá
-- Thực tế của KPI tự động bị từ chối: số đó do app tính.
create or replace function public.save_kpi_values(cells jsonb, actor text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare c jsonb; n integer := 0; src text;
begin
  for c in select * from jsonb_array_elements(cells) loop
    if (c->>'ym') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'tháng sai: %', c->>'ym'; end if;
    select d.source into src from public.kpi_assign a join public.kpi_def d on d.code = a.kpi where a.id = (c->>'assign_id')::bigint;
    if src is null then raise exception 'không có KPI được giao %', c->>'assign_id'; end if;
    if c ? 'actual' and src = 'auto' and c->'actual' <> 'null'::jsonb then raise exception 'KPI tự động — thực tế do app tính, không nhập tay'; end if;
    insert into public.kpi_value (assign_id, ym, target, actual)
    values ((c->>'assign_id')::bigint, c->>'ym',
            case when c ? 'target' then nullif(c->>'target', '')::numeric end,
            case when c ? 'actual' then nullif(c->>'actual', '')::numeric end)
    on conflict (assign_id, ym) do update set
      target = case when c ? 'target' then excluded.target else kpi_value.target end,
      actual = case when c ? 'actual' then excluded.actual else kpi_value.actual end;
    n := n + 1;
  end loop;
  insert into public.kpi_log (actor, action, payload) values (actor, 'values', jsonb_build_object('n', n, 'cells', cells));
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array['save_kpi_dept(jsonb,text)','save_kpi_objective(jsonb,text)','save_kpi_def(jsonb,text)',
                           'save_kpi_assign(jsonb,text)','save_kpi_values(jsonb,text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
