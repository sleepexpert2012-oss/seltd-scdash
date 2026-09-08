-- ============================================================
-- Lớp stg_ / mart_ : phẳng hoá jsonb thành số liệu cho dashboard
-- Đọc từ raw_*, KHÔNG sửa raw. Chạy lại an toàn (create or replace).
-- ============================================================

-- 1) Đơn hàng phẳng ------------------------------------------------------
create or replace view shopee.stg_order as
select
  o.order_sn,
  o.shop_id,
  o.order_status,
  (o.create_time at time zone 'Asia/Ho_Chi_Minh')::date          as order_date,
  to_char(o.create_time at time zone 'Asia/Ho_Chi_Minh','YYYY-MM') as ym,
  o.update_time,
  (p->>'pay_time')::bigint                                        as pay_epoch,
  (p->>'total_amount')::numeric                                   as buyer_total_amount,
  p->>'currency'                                                  as currency,
  (p->>'cod')::boolean                                            as cod,
  p->>'payment_method'                                            as payment_method,
  (p->>'buyer_user_id')::bigint                                   as buyer_user_id,
  p->>'buyer_username'                                            as buyer_username,
  p->>'shipping_carrier'                                          as shipping_carrier,
  p->>'fulfillment_flag'                                          as fulfillment_flag,
  (p->>'estimated_shipping_fee')::numeric                         as est_ship_fee,
  (p->>'actual_shipping_fee')::numeric                            as actual_ship_fee,
  (p->>'reverse_shipping_fee')::numeric                           as reverse_ship_fee,
  p->>'cancel_by'                                                 as cancel_by,
  p->>'cancel_reason'                                             as cancel_reason,
  p->>'buyer_cancel_reason'                                       as buyer_cancel_reason,
  p->>'message_to_seller'                                         as message_to_seller,
  p                                                               as payload
from shopee.raw_order o, lateral (select o.payload as p) x;

-- 2) Dòng hàng phẳng ------------------------------------------------------
-- Quy ước số học — GMV lấy theo GIÁ THỰC BÁN (giá niêm yết bỏ qua, chỉ là giá
-- gạch ngang marketing). Đẳng thức: gmv = rev + cx + rt + dc
--   gmv = giá thực bán x SL mua       cx = giá thực bán x SL huỷ
--   rt  = giá thực bán x SL hoàn
--   rev = gmv - cx - rt - dc  (doanh thu đã trừ cả tiền voucher shop tự chịu)
--   un  = SL hiệu lực (mua - huỷ - hoàn)
--   dc  = tiền khuyến mãi SHOP tự bỏ ra (voucher shop + xu), lấy từ escrow
create or replace view shopee.stg_order_item as
select
  o.order_sn, o.shop_id, o.order_status, o.order_date, o.ym,
  o.buyer_user_id, o.buyer_username, o.payment_method,
  (i->>'line_item_id')::bigint                as line_item_id,
  (i->>'item_id')::bigint                     as item_id,
  (i->>'model_id')::bigint                    as model_id,
  nullif(i->>'model_sku','')                  as model_sku,
  /* mã SKU đã chuẩn hoá: mã cũ được quy về mã hiện hành theo model_id */
  coalesce(al.sku_canonical, nullif(i->>'model_sku','')) as sku,
  nullif(i->>'item_sku','')                   as item_sku,
  i->>'item_name'                             as item_name,
  i->>'model_name'                            as model_name,
  coalesce((i->>'model_quantity_purchased')::int,0) as qty,
  coalesce((i->>'cancelled_qty')::int,0)      as qty_cancelled,
  coalesce((i->>'returned_qty')::int,0)       as qty_returned,
  greatest(coalesce((i->>'model_quantity_purchased')::int,0)
           - coalesce((i->>'cancelled_qty')::int,0)
           - coalesce((i->>'returned_qty')::int,0), 0) as qty_net,
  coalesce((i->>'model_original_price')::numeric,0)   as price_list,
  coalesce((i->>'model_discounted_price')::numeric,0) as price_paid,
  i->>'promotion_type'                        as promotion_type,
  (i->>'main_item')::boolean                  as main_item,
  i                                           as item_payload
from shopee.stg_order o, lateral jsonb_array_elements(o.payload->'item_list') i
left join shopee.sku_alias al
       on al.model_id = (i->>'model_id')::bigint
      and al.sku_old  = nullif(i->>'model_sku','');

-- 2b) Dòng hàng trong escrow: tiền khuyến mãi SHOP tự bỏ ra ------------
-- dc_shop = voucher của shop + xu shop hoàn lại (KHÔNG tính voucher Shopee tài trợ,
-- cũng KHÔNG tính chênh giá niêm yết vì đó chỉ là giá gạch ngang).
create or replace view shopee.stg_escrow_item as
select
  r.order_sn,
  (i->>'line_item_id')::bigint                          as line_item_id,
  nullif(i->>'model_sku','')                            as model_sku,
  coalesce((i->>'quantity_purchased')::int,0)           as qty,
  coalesce((i->>'original_price')::numeric,0)           as price_original,
  coalesce((i->>'selling_price')::numeric,0)            as price_selling,
  coalesce((i->>'discounted_price')::numeric,0)         as price_discounted,
  coalesce((i->>'seller_discount')::numeric,0)          as seller_discount,
  coalesce((i->>'shopee_discount')::numeric,0)          as shopee_discount,
  coalesce((i->>'discount_from_voucher_seller')::numeric,0) as voucher_shop,
  coalesce((i->>'discount_from_voucher_shopee')::numeric,0) as voucher_shopee,
  coalesce((i->>'discount_from_coin')::numeric,0)       as xu,
  coalesce((i->>'ams_commission_fee')::numeric,0)       as ams_fee,
  coalesce((i->>'discount_from_voucher_seller')::numeric,0)
    + coalesce((i->>'discount_from_coin')::numeric,0)   as dc_shop,
  i                                                     as item_payload
from shopee.raw_escrow r, lateral jsonb_array_elements(r.payload->'order_income'->'items') i;

-- 3) Mart bán hàng theo SKU x tháng (đúng shape app đang dùng) ------------
create or replace view shopee.mart_sales_sku_month as
select
  s.sku,
  s.ym,
  count(distinct s.order_sn)                     as o,
  sum(s.qty)                                     as u,
  sum(s.qty_net)                                 as un,
  sum(s.price_paid * s.qty)                      as gmv,
  sum(s.price_paid * s.qty_cancelled)            as cx,
  sum(s.price_paid * s.qty_returned)             as rt,
  /* voucher chỉ tính trên phần THỰC BÁN: đơn/dòng bị huỷ hay hoàn thì shop
     không mất tiền voucher, nên chia theo tỷ lệ SL hiệu lực / SL mua. */
  sum(coalesce(e.dc_shop,0) * case when s.qty > 0 then s.qty_net::numeric / s.qty else 0 end) as dc,
  sum(s.price_paid * s.qty_net)
    - sum(coalesce(e.dc_shop,0) * case when s.qty > 0 then s.qty_net::numeric / s.qty else 0 end) as rev,
  sum(coalesce(d.unit_cost,0) * s.qty_net)       as cogs
from shopee.stg_order_item s
left join shopee.dim_sku d on d.sku = s.sku
left join shopee.stg_escrow_item e
       on e.order_sn = s.order_sn and e.line_item_id = s.line_item_id
where s.sku is not null
group by 1,2;

-- 4) Mart bán hàng theo SKU x ngày ----------------------------------------
create or replace view shopee.mart_sales_sku_day as
select
  s.sku,
  s.order_date                                   as d,
  count(distinct s.order_sn)                     as o,
  sum(s.qty)                                     as u,
  sum(s.qty_net)                                 as un,
  sum(s.price_paid * s.qty)                      as gmv,
  /* PHẢI trừ voucher shop đúng như mart_sales_sku_month, nếu không màn Lịch
     bán hàng báo doanh thu cao hơn các màn khác. Lỗi này đã có thật: lệch
     +105,6tr toàn kỳ (+5,6%), riêng 2025-03 lệch +34%. */
  sum(s.price_paid * s.qty_net)
    - sum(coalesce(e.dc_shop,0) * case when s.qty > 0 then s.qty_net::numeric / s.qty else 0 end) as rev,
  sum(coalesce(d.unit_cost,0) * s.qty_net)       as cogs,
  /* thêm cột mới phải để CUỐI: create or replace view không cho đổi tên cột đã có */
  sum(coalesce(e.dc_shop,0) * case when s.qty > 0 then s.qty_net::numeric / s.qty else 0 end) as dc
from shopee.stg_order_item s
left join shopee.dim_sku d on d.sku = s.sku
left join shopee.stg_escrow_item e
       on e.order_sn = s.order_sn and e.line_item_id = s.line_item_id
where s.sku is not null
group by 1,2;

-- 5) Mart phí sàn theo tháng (từ escrow) — thứ dữ liệu giả KHÔNG có ------
create or replace view shopee.mart_fee_month as
with e as (
  select r.order_sn,
         o.ym,
         (r.payload->'order_income') as oi
  from shopee.raw_escrow r
  join shopee.stg_order o using (order_sn)
)
select
  ym,
  count(*)                                                          as don,
  sum((oi->>'order_selling_price')::numeric)                        as ban_hang,
  sum((oi->>'escrow_amount')::numeric)                              as tien_thuc_nhan,
  sum((oi->>'commission_fee')::numeric)                             as phi_hoa_hong,
  sum((oi->>'service_fee')::numeric)                                as phi_dich_vu,
  -- LƯU Ý: seller_transaction_fee và credit_card_transaction_fee bằng nhau ở
  -- 100% đơn (1518/1518) — CÙNG MỘT khoản, Shopee trả 2 tên. Chỉ lấy 1 lần.
  sum((oi->>'seller_transaction_fee')::numeric)                     as phi_giao_dich,
  sum((oi->>'order_ams_commission_fee')::numeric)                   as phi_ams,
  sum((oi->>'campaign_fee')::numeric)                               as phi_campaign,
  sum((oi->>'ads_escrow_top_up_fee_or_technical_support_fee')::numeric) as phi_ads_ktkt,
  sum((oi->>'voucher_from_seller')::numeric)                        as voucher_shop,
  sum((oi->>'voucher_from_shopee')::numeric)                        as voucher_shopee,
  sum((oi->>'seller_coin_cash_back')::numeric)                      as xu_shop,
  sum((oi->>'actual_shipping_fee')::numeric)                        as phi_van_chuyen,
  sum((oi->>'shopee_shipping_rebate')::numeric)                     as tro_gia_vc_shopee,
  sum((oi->>'withholding_tax')::numeric
    + (oi->>'withholding_vat_tax')::numeric
    + (oi->>'withholding_pit_tax')::numeric
    + (oi->>'withholding_cit_tax')::numeric)                        as thue_giu_lai,
  sum((oi->>'commission_fee')::numeric
    + (oi->>'service_fee')::numeric
    + (oi->>'seller_transaction_fee')::numeric
    + (oi->>'order_ams_commission_fee')::numeric
    + (oi->>'campaign_fee')::numeric
    + (oi->>'ads_escrow_top_up_fee_or_technical_support_fee')::numeric
    + (oi->>'fbs_fee')::numeric
    + (oi->>'seller_order_processing_fee')::numeric)                 as tong_phi_san
from e group by 1;

-- 6) Mart đơn hoàn theo tháng ---------------------------------------------
create or replace view shopee.mart_return_month as
select
  to_char(create_time at time zone 'Asia/Ho_Chi_Minh','YYYY-MM') as ym,
  status,
  payload->>'reason'            as reason,
  count(*)                      as don,
  sum((payload->>'refund_amount')::numeric) as tien_hoan
from shopee.raw_return
group by 1,2,3;

-- 7) Mart quảng cáo theo tháng (cấp shop) --------------------------------
-- API chỉ cho lấy lùi ~5 tháng nên bảng này KHÔNG có dữ liệu trước 2026-04.
create or replace view shopee.mart_ads_month as
select
  to_char(stat_date,'YYYY-MM')                     as ym,
  count(*)                                         as so_ngay,
  sum((payload->>'expense')::numeric)              as chi_phi_ads,
  sum((payload->>'impression')::numeric)           as hien_thi,
  sum((payload->>'clicks')::numeric)               as click,
  sum((payload->>'broad_gmv')::numeric)            as gmv_ads_rong,
  sum((payload->>'direct_gmv')::numeric)           as gmv_ads_truc_tiep,
  sum((payload->>'broad_order')::numeric)          as don_ads_rong,
  sum((payload->>'direct_order')::numeric)         as don_ads_truc_tiep,
  sum((payload->>'broad_item_sold')::numeric)      as sl_ads_rong,
  case when sum((payload->>'expense')::numeric) > 0
       then sum((payload->>'broad_gmv')::numeric) / sum((payload->>'expense')::numeric) end as roas_rong,
  case when sum((payload->>'clicks')::numeric) > 0
       then sum((payload->>'expense')::numeric) / sum((payload->>'clicks')::numeric) end     as cpc,
  case when sum((payload->>'impression')::numeric) > 0
       then sum((payload->>'clicks')::numeric) / sum((payload->>'impression')::numeric) end  as ctr
from shopee.raw_ads_shop_daily group by 1;

-- 8) Mart quảng cáo theo chiến dịch --------------------------------------
create or replace view shopee.mart_ads_campaign as
select
  campaign_id,
  min(payload->>'ad_name')                     as ten_chien_dich,
  min(payload->>'ad_type')                     as loai,
  min(payload->>'campaign_placement')          as vi_tri,
  min(stat_date)                               as tu_ngay,
  max(stat_date)                               as den_ngay,
  count(*)                                     as so_ngay_chay,
  sum((payload->>'expense')::numeric)          as chi_phi,
  sum((payload->>'impression')::numeric)       as hien_thi,
  sum((payload->>'clicks')::numeric)           as click,
  sum((payload->>'broad_gmv')::numeric)        as gmv_rong,
  sum((payload->>'broad_order')::numeric)      as don_rong,
  case when sum((payload->>'expense')::numeric) > 0
       then sum((payload->>'broad_gmv')::numeric) / sum((payload->>'expense')::numeric) end as roas
from shopee.raw_ads_campaign_daily group by 1;
