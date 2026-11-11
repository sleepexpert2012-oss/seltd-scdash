-- ============================================================
-- BÁO CÁO ĐIỀU HÀNH ĐÃ LƯU
-- snapshot_json giữ NGUYÊN các phát hiện tại lúc lưu, để báo cáo cũ không đổi
-- khi dữ liệu mới về. note_html là nhận định người viết (đã làm sạch ở trình duyệt,
-- làm sạch lại ở đây: chỉ giữ thẻ b,i,u,ul,ol,li,p,br).
-- ============================================================
create table if not exists public.report_doc (
  id            bigserial   primary key,
  name          text        not null,
  period_from   text        not null check (period_from ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  period_to     text        not null check (period_to ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  compare       text        not null check (compare in ('prev','yoy','kh')),
  note_html     text,
  hidden_ids    text[]      not null default '{}',
  snapshot_json jsonb       not null,
  saved_by      text,
  saved_at      timestamptz not null default now()
);

alter table public.report_doc enable row level security;
drop policy if exists report_doc_read on public.report_doc;
create policy report_doc_read on public.report_doc for select to anon, authenticated using (true);
grant select on public.report_doc to anon, authenticated;
revoke insert, update, delete on public.report_doc from anon, authenticated;

create or replace function public.save_report_doc(p jsonb, actor text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint := nullif(p->>'id', '')::bigint;
  -- bỏ mọi thẻ không nằm trong danh sách cho phép và mọi thuộc tính của thẻ (\y = ranh giới từ trong regex Postgres; \b là ký tự backspace)
  v_note text := regexp_replace(
                   regexp_replace(coalesce(p->>'note_html', ''), '<(?!/?(b|i|u|ul|ol|li|p|br)\y)[^>]*>', '', 'gi'),
                   '<(/?)(b|i|u|ul|ol|li|p|br)\y[^>]*>', '<\1\2>', 'gi');
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'thiếu tên báo cáo'; end if;
  if length(v_note) > 50000 then raise exception 'nhận định quá dài'; end if;
  if v_id is null then
    insert into public.report_doc (name, period_from, period_to, compare, note_html, hidden_ids, snapshot_json, saved_by)
    values (trim(p->>'name'), p->>'period_from', p->>'period_to', p->>'compare', v_note,
            coalesce(array(select jsonb_array_elements_text(p->'hidden_ids')), '{}'), p->'snapshot_json', actor)
    returning id into v_id;
  else
    update public.report_doc set name = trim(p->>'name'), period_from = p->>'period_from', period_to = p->>'period_to',
      compare = p->>'compare', note_html = v_note,
      hidden_ids = coalesce(array(select jsonb_array_elements_text(p->'hidden_ids')), '{}'),
      snapshot_json = p->'snapshot_json', saved_by = actor, saved_at = now()
    where id = v_id;
    if not found then raise exception 'không có báo cáo %', v_id; end if;
  end if;
  return v_id;
end $$;

create or replace function public.del_report_doc(p_id bigint, actor text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.report_doc where id = p_id;
  return found;
end $$;

revoke all on function public.save_report_doc(jsonb, text) from public;
revoke all on function public.del_report_doc(bigint, text) from public;
grant execute on function public.save_report_doc(jsonb, text) to anon, authenticated;
grant execute on function public.del_report_doc(bigint, text) to anon, authenticated;
