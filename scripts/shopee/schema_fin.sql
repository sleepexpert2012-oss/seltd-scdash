-- ============================================================
-- KẾ HOẠCH NĂM (NGÂN SÁCH) + CHI PHÍ THỰC TẾ NGOÀI SÀN
--
-- Lớp nền cho các màn Kế hoạch vs Thực đạt, Định mức chi phí, Điểm hòa vốn.
-- Bốn thứ app trước đây không có:
--   fin_line          danh mục khoản mục: nhóm, cố định/biến đổi, trần % doanh thu
--   fin_plan_version  các phiên bản ngân sách (mỗi năm một bản "hiện hành")
--   fin_plan          ngân sách theo phiên bản × tháng × khoản mục
--   fin_actual        chi phí THỰC TẾ nhập tay cho khoản app không tự có
--                     (lương, thuê nhà, kho bãi...). Khoản tự có (doanh thu,
--                     giá vốn, phí sàn, quảng cáo Shopee) KHÔNG nhập ở đây —
--                     app tự tính từ dữ liệu Shopee và phiếu xuất kho.
--   fin_log           ai sửa gì, lúc nào, giá trị cũ → mới. Chỉ thêm, không sửa/xoá.
--
-- Cùng cơ chế với cashflow_week: khoá gọi nằm trong trang công khai nên anon
-- chỉ ĐỌC bảng; mọi ghi phải đi qua các hàm SECURITY DEFINER bên dưới.
--
-- LƯU Ý BẢO MẬT: đăng nhập của app chỉ chặn ở trình duyệt. Ai có khoá
-- publishable (nằm trong bundle công khai) đều ĐỌC được các bảng này.
--
-- Quy ước:
--   ym      'YYYY-MM' (cùng định dạng với platform.json)
--   amount  đồng, số nguyên. Ô trống = KHÔNG có dòng (≠ 0). Gửi amount null
--           là xoá ô — để phân biệt "chưa nhập" với "nhập 0".
--   cap_pct trần chi phí tính theo % doanh thu, lưu dạng phần trăm (12.5 = 12,5%)
-- ============================================================

create table if not exists public.fin_line (
  code       text        primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name       text        not null,
  grp        text        not null check (grp in
               ('doanh_thu','gia_von','phi_san','marketing','opex','tai_chinh','thue')),
  -- null cho doanh thu và thuế: hai nhóm này không phải chi phí hoạt động
  behavior   text        check (behavior in ('bien_doi','co_dinh')),
  source     text        not null check (source in ('auto','nhap')),
  cap_pct    numeric     check (cap_pct is null or (cap_pct >= 0 and cap_pct <= 100)),
  sort       integer     not null default 100,
  active     boolean     not null default true,
  note       text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.fin_plan_version (
  version    text        primary key check (version ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  name       text        not null,
  year       integer     not null check (year between 2020 and 2100),
  is_current boolean     not null default false,
  note       text,
  created_at timestamptz not null default now(),
  created_by text
);
-- Mỗi năm chỉ một phiên bản hiện hành
create unique index if not exists fin_plan_version_one_current
  on public.fin_plan_version (year) where is_current;

create table if not exists public.fin_plan (
  version    text        not null references public.fin_plan_version(version),
  ym         text        not null check (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  line       text        not null references public.fin_line(code),
  amount     bigint      not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (version, ym, line)
);

create table if not exists public.fin_actual (
  ym         text        not null check (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  line       text        not null references public.fin_line(code),
  amount     bigint      not null,
  note       text,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (ym, line)
);

create table if not exists public.fin_log (
  id      bigserial   primary key,
  at      timestamptz not null default now(),
  actor   text,
  action  text        not null,
  n       integer,
  payload jsonb       not null
);

do $$
declare t text;
begin
  foreach t in array array['fin_line','fin_plan_version','fin_plan','fin_actual','fin_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
    -- RLS policy thôi chưa đủ: phải grant select tường minh, quên là đọc ra 401
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- Danh mục khoản mục ban đầu.
-- · Khoản 'auto': app tự tính, mã khớp đúng tên cột trong platform.json
--   (phí sàn = đúng 6 khoản đang dùng ở màn Lãi lỗ).
-- · Khoản 'nhap': mã và tên lấy từ CHI_KHAC của màn Dòng tiền để hai nơi
--   gọi cùng một tên. Riêng 'ads' bên Dòng tiền gộp cả quảng cáo Shopee lẫn
--   tiếp thị ngoài sàn → ở đây tách: quảng cáo Shopee là 'ads_shopee' (auto),
--   còn 'ads' chỉ còn phần NGOÀI Shopee (nhập tay). Không tách là đếm hai lần.
-- · cố định/biến đổi là GIẢ ĐỊNH mặc định, người dùng sửa ở tab Khoản mục.
-- on conflict do nothing: chạy lại file không đè lên chỗ người dùng đã sửa.
-- ------------------------------------------------------------
insert into public.fin_line (code, name, grp, behavior, source, sort, note) values
  ('dt_san',        'Doanh thu thuần trên Shopee',              'doanh_thu', null,       'auto', 10,
     'GMV − huỷ − hoàn − giảm giá & voucher shop. Cùng số với màn Lãi lỗ.'),
  ('dt_ngoai',      'Doanh thu bán ngoài sàn (chưa VAT)',       'doanh_thu', null,       'auto', 20,
     'Tổng thành tiền phiếu xuất kho, theo tháng của ngày giao.'),
  ('gv_san',        'Giá vốn hàng bán trên Shopee',             'gia_von',   'bien_doi', 'auto', 30,
     'Giá vốn 1 đơn vị (Master Data) × SL thuần. SKU thiếu giá vốn được tính 0.'),
  ('gv_ngoai',      'Giá vốn hàng bán ngoài sàn',               'gia_von',   'bien_doi', 'auto', 40,
     'SL trên phiếu xuất × giá vốn Master Data, gồm cả hàng tặng/hàng mẫu.'),
  ('phi_hoa_hong',  'Phí sàn · Hoa hồng',                       'phi_san',   'bien_doi', 'auto', 50, null),
  ('phi_dich_vu',   'Phí sàn · Phí dịch vụ',                    'phi_san',   'bien_doi', 'auto', 51, null),
  ('phi_giao_dich', 'Phí sàn · Phí giao dịch',                  'phi_san',   'bien_doi', 'auto', 52, null),
  ('phi_ams',       'Phí sàn · Phí AMS (affiliate)',            'phi_san',   'bien_doi', 'auto', 53, null),
  ('phi_campaign',  'Phí sàn · Phí chiến dịch sàn',             'phi_san',   'bien_doi', 'auto', 54, null),
  ('phi_ads_ktkt',  'Phí sàn · Phí hỗ trợ kỹ thuật',            'phi_san',   'bien_doi', 'auto', 55, null),
  ('ads_shopee',    'Quảng cáo Shopee (Shopee Ads)',            'marketing', 'bien_doi', 'auto', 60,
     'API ads Shopee chỉ lưu khoảng 5 tháng — tháng cũ hơn là CHƯA CÓ SỐ, không phải 0.'),
  ('ads',           'Quảng cáo, tiếp thị NGOÀI Shopee (website, tên miền, hosting…)',
                                                                'marketing', 'co_dinh',  'nhap', 70,
     'Giả định cố định: chi theo quyết định từng tháng, không tự tăng theo doanh thu.'),
  ('luong',         'Chi trả tiền lương và các phụ cấp hàng tháng cho NLĐ',
                                                                'opex',      'co_dinh',  'nhap', 80, null),
  ('khobai',        'Chi phí kho bãi FBS, ACE, vận chuyển',     'opex',      'bien_doi', 'nhap', 81,
     'Giả định biến đổi: tăng theo lượng hàng đi. Đổi sang cố định nếu hợp đồng kho là giá khoán.'),
  ('dichvu',        'Chi trả các dịch vụ mua ngoài (tư vấn, bảo hiểm, thuế…)',
                                                                'opex',      'co_dinh',  'nhap', 82, null),
  ('thuenha',       'Tiền thuê nhà, tiền điện nước',             'opex',      'co_dinh',  'nhap', 83, null),
  ('vattu',         'Chi mua vật tư, trang thiết bị văn phòng, mua mẫu',
                                                                'opex',      'co_dinh',  'nhap', 84, null),
  ('lai_vay',       'Lãi vay và phí ngân hàng',                  'tai_chinh', 'co_dinh',  'nhap', 90, null),
  ('thue_tndn',     'Thuế thu nhập doanh nghiệp',                'thue',      null,       'nhap', 95, null)
on conflict (code) do nothing;

-- ------------------------------------------------------------
-- GHI: khoản mục (thêm mới hoặc sửa một dòng)
-- Khoản 'auto' chỉ sửa được tên, cố định/biến đổi, trần %, thứ tự, bật/tắt —
-- KHÔNG đổi được nhóm hay nguồn (app đang tính số cho nó theo đúng mã).
-- Khoản thêm mới luôn là 'nhap'.
-- ------------------------------------------------------------
create or replace function public.save_fin_line(p jsonb, actor text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text := lower(trim(p->>'code'));
  cu     public.fin_line;
  v_grp  text;
begin
  if coalesce(v_code, '') !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'mã khoản mục sai: chỉ chữ thường không dấu, số, gạch dưới (2–40 ký tự)';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'thiếu tên khoản mục'; end if;

  select * into cu from public.fin_line where code = v_code;
  v_grp := case when cu.source = 'auto' then cu.grp else p->>'grp' end;
  if v_grp is null then raise exception 'thiếu nhóm khoản mục'; end if;
  if v_grp in ('doanh_thu', 'thue') and nullif(p->>'behavior', '') is not null then
    raise exception 'doanh thu và thuế không xếp loại cố định/biến đổi';
  end if;

  insert into public.fin_line (code, name, grp, behavior, source, cap_pct, sort, active, note,
                               updated_at, updated_by)
  values (v_code, trim(p->>'name'), v_grp, nullif(p->>'behavior', ''),
          coalesce(cu.source, 'nhap'), nullif(p->>'cap_pct', '')::numeric,
          coalesce(nullif(p->>'sort', '')::integer, 100),
          coalesce((p->>'active')::boolean, true), nullif(p->>'note', ''), now(), actor)
  on conflict (code) do update set
    name = excluded.name, grp = excluded.grp, behavior = excluded.behavior,
    cap_pct = excluded.cap_pct, sort = excluded.sort, active = excluded.active,
    note = excluded.note, updated_at = now(), updated_by = excluded.updated_by;

  insert into public.fin_log (actor, action, n, payload)
  values (actor, case when cu.code is null then 'line_new' else 'line_edit' end, 1,
          jsonb_build_object('code', v_code, 'old', to_jsonb(cu), 'new', p));
  return v_code;
end $$;

-- ------------------------------------------------------------
-- GHI: phiên bản ngân sách. clone_from = nhân bản số từ một phiên bản khác
-- (khác năm thì giữ nguyên tháng, đổi năm). Chỉ nhân bản khi phiên bản mới.
-- ------------------------------------------------------------
create or replace function public.save_fin_version(p jsonb, clone_from text default null,
                                                   actor text default null)
returns table (saved_version text, n_cloned integer)
language plpgsql security definer set search_path = public as $$
declare
  v_ver  text := lower(trim(p->>'version'));
  v_year integer := (p->>'year')::integer;
  is_new boolean;
  n      integer := 0;
begin
  if coalesce(v_ver, '') !~ '^[a-z0-9][a-z0-9_-]{1,39}$' then
    raise exception 'mã phiên bản sai: chữ thường không dấu, số, - hoặc _';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'thiếu tên phiên bản'; end if;
  is_new := not exists (select 1 from public.fin_plan_version v where v.version = v_ver);
  if not is_new and exists (select 1 from public.fin_plan_version v
                            where v.version = v_ver and v.year <> v_year) then
    raise exception 'không đổi năm của phiên bản đã có — hãy nhân bản sang phiên bản mới';
  end if;

  insert into public.fin_plan_version (version, name, year, note, created_by)
  values (v_ver, trim(p->>'name'), v_year, nullif(p->>'note', ''), actor)
  on conflict on constraint fin_plan_version_pkey do update
    set name = excluded.name, note = excluded.note;

  if is_new and clone_from is not null then
    insert into public.fin_plan (version, ym, line, amount, updated_at, updated_by)
    select v_ver, v_year::text || substr(fp.ym, 5), fp.line, fp.amount, now(), actor
    from public.fin_plan fp where fp.version = clone_from;
    get diagnostics n = row_count;
  end if;

  insert into public.fin_log (actor, action, n, payload)
  values (actor, case when is_new then 'version_new' else 'version_edit' end, n,
          jsonb_build_object('version', v_ver, 'p', p, 'clone_from', clone_from));
  return query select v_ver, n;
end $$;

create or replace function public.set_fin_current_version(p_version text, actor text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_year integer;
begin
  select year into v_year from public.fin_plan_version where version = p_version;
  if v_year is null then raise exception 'không có phiên bản %', p_version; end if;
  update public.fin_plan_version set is_current = false where year = v_year and is_current;
  update public.fin_plan_version set is_current = true where version = p_version;
  insert into public.fin_log (actor, action, n, payload)
  values (actor, 'version_current', 1, jsonb_build_object('version', p_version, 'year', v_year));
  return true;
end $$;

-- ------------------------------------------------------------
-- GHI: ô ngân sách. cells = [{ym, line, amount}], amount null = xoá ô.
-- Chỉ ghi lịch sử những ô THỰC SỰ đổi giá trị.
-- ------------------------------------------------------------
create or replace function public.save_fin_plan(p_version text, cells jsonb, actor text default null)
returns table (n_changed integer, saved_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  c      jsonb;
  v_year integer;
  v_ym   text;
  v_line text;
  v_amt  bigint;
  v_old  bigint;
  n      integer := 0;
  diff   jsonb := '[]'::jsonb;
  now_ts timestamptz := now();
begin
  select year into v_year from public.fin_plan_version where version = p_version;
  if v_year is null then raise exception 'không có phiên bản %', p_version; end if;
  if jsonb_typeof(cells) <> 'array' then raise exception 'cells phải là mảng'; end if;
  if jsonb_array_length(cells) > 5000 then raise exception 'quá 5.000 ô trong một lần ghi'; end if;

  for c in select * from jsonb_array_elements(cells) loop
    v_ym := c->>'ym'; v_line := c->>'line';
    v_amt := nullif(c->>'amount', '')::bigint;
    if v_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'tháng sai định dạng: %', v_ym; end if;
    if left(v_ym, 4)::integer <> v_year then
      raise exception 'tháng % không thuộc năm % của phiên bản', v_ym, v_year;
    end if;
    if not exists (select 1 from public.fin_line where code = v_line) then
      raise exception 'không có khoản mục %', v_line;
    end if;
    if v_amt is not null and abs(v_amt) > 10000000000000 then
      raise exception 'số tiền quá lớn ở % / %', v_ym, v_line;
    end if;

    select amount into v_old from public.fin_plan
      where version = p_version and ym = v_ym and line = v_line;
    if v_old is not distinct from v_amt then continue; end if;

    if v_amt is null then
      delete from public.fin_plan where version = p_version and ym = v_ym and line = v_line;
    else
      insert into public.fin_plan (version, ym, line, amount, updated_at, updated_by)
      values (p_version, v_ym, v_line, v_amt, now_ts, actor)
      on conflict (version, ym, line) do update
        set amount = excluded.amount, updated_at = now_ts, updated_by = excluded.updated_by;
    end if;
    n := n + 1;
    diff := diff || jsonb_build_object('ym', v_ym, 'line', v_line, 'old', v_old, 'new', v_amt);
  end loop;

  if n > 0 then
    insert into public.fin_log (actor, action, n, payload)
    values (actor, 'plan', n, jsonb_build_object('version', p_version, 'cells', diff));
  end if;
  return query select n, now_ts;
end $$;

-- ------------------------------------------------------------
-- GHI: chi phí thực tế nhập tay. Chỉ nhận khoản 'nhap' và tháng đã bắt đầu
-- (giờ Việt Nam) — tháng chưa tới thì chưa thể có số thực tế.
-- ------------------------------------------------------------
create or replace function public.save_fin_actual(cells jsonb, actor text default null)
returns table (n_changed integer, saved_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  c      jsonb;
  v_ym   text;
  v_line text;
  v_amt  bigint;
  v_old  bigint;
  v_src  text;
  cur_ym text := to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM');
  n      integer := 0;
  diff   jsonb := '[]'::jsonb;
  now_ts timestamptz := now();
begin
  if jsonb_typeof(cells) <> 'array' then raise exception 'cells phải là mảng'; end if;
  if jsonb_array_length(cells) > 5000 then raise exception 'quá 5.000 ô trong một lần ghi'; end if;

  for c in select * from jsonb_array_elements(cells) loop
    v_ym := c->>'ym'; v_line := c->>'line';
    v_amt := nullif(c->>'amount', '')::bigint;
    if v_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'tháng sai định dạng: %', v_ym; end if;
    if v_ym > cur_ym then raise exception 'tháng % chưa tới, chưa thể có chi phí thực tế', v_ym; end if;
    select source into v_src from public.fin_line where code = v_line;
    if v_src is null then raise exception 'không có khoản mục %', v_line; end if;
    if v_src <> 'nhap' then
      raise exception 'khoản % do app tự tính từ dữ liệu, không nhập tay', v_line;
    end if;
    if v_amt is not null and abs(v_amt) > 10000000000000 then
      raise exception 'số tiền quá lớn ở % / %', v_ym, v_line;
    end if;

    select amount into v_old from public.fin_actual where ym = v_ym and line = v_line;
    if v_old is not distinct from v_amt then continue; end if;

    if v_amt is null then
      delete from public.fin_actual where ym = v_ym and line = v_line;
    else
      insert into public.fin_actual (ym, line, amount, note, updated_at, updated_by)
      values (v_ym, v_line, v_amt, nullif(c->>'note', ''), now_ts, actor)
      on conflict (ym, line) do update
        set amount = excluded.amount, note = excluded.note,
            updated_at = now_ts, updated_by = excluded.updated_by;
    end if;
    n := n + 1;
    diff := diff || jsonb_build_object('ym', v_ym, 'line', v_line, 'old', v_old, 'new', v_amt);
  end loop;

  if n > 0 then
    insert into public.fin_log (actor, action, n, payload)
    values (actor, 'actual', n, jsonb_build_object('cells', diff));
  end if;
  return query select n, now_ts;
end $$;

revoke all on function public.save_fin_line(jsonb, text)                 from public;
revoke all on function public.save_fin_version(jsonb, text, text)        from public;
revoke all on function public.set_fin_current_version(text, text)        from public;
revoke all on function public.save_fin_plan(text, jsonb, text)           from public;
revoke all on function public.save_fin_actual(jsonb, text)               from public;
grant execute on function public.save_fin_line(jsonb, text)              to anon, authenticated;
grant execute on function public.save_fin_version(jsonb, text, text)     to anon, authenticated;
grant execute on function public.set_fin_current_version(text, text)     to anon, authenticated;
grant execute on function public.save_fin_plan(text, jsonb, text)        to anon, authenticated;
grant execute on function public.save_fin_actual(jsonb, text)            to anon, authenticated;
