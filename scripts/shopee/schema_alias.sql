-- Bảng đối chiếu MÃ SKU CŨ -> MÃ HIỆN HÀNH.
-- Căn cứ: model_id của Shopee là ĐỊNH DANH BẤT BIẾN của biến thể; đổi tên SKU
-- không đổi model_id. Nên mã cũ và mã mới dùng chung model_id chính là cùng
-- một biến thể — không phải suy đoán theo tên.
create table if not exists shopee.sku_alias (
  model_id      bigint not null,
  sku_old       text   not null,
  sku_canonical text   not null,
  method        text   not null,          -- 'model_id' = chắc chắn | 'suy luận' = cần soát
  note          text,
  primary key (model_id, sku_old)
);
alter table shopee.sku_alias enable row level security;

-- Tự sinh: mã lạ dùng chung model_id với một mã có trong Master Data
insert into shopee.sku_alias (model_id, sku_old, sku_canonical, method)
select b.model_id, b.model_sku, g.sku_canonical, 'model_id'
from (
  select distinct s.model_id, s.model_sku
  from shopee.stg_order_item s left join shopee.dim_sku d on d.sku = s.model_sku
  where s.model_sku is not null and d.sku is null
) b
join (
  select model_id, min(model_sku) sku_canonical from (
    select s.model_id, s.model_sku from shopee.stg_order_item s
      join shopee.dim_sku d on d.sku = s.model_sku
    union
    select m.model_id, m.model_sku from shopee.raw_model m
      join shopee.dim_sku d on d.sku = m.model_sku
  ) t group by model_id
) g on g.model_id = b.model_id
on conflict (model_id, sku_old) do update
  set sku_canonical = excluded.sku_canonical, method = excluded.method;
