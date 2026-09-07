-- ============================================================
-- MARKETING ANALYSIS — lớp phân tích quảng cáo
-- Nối ads (cấp chiến dịch) với đơn hàng thật (cấp item) để trả lời
-- "vì sao": phễu vỡ ở đâu, và tiền quảng cáo có sinh lời hay không.
-- Mỗi chiến dịch Shopee gắn ĐÚNG 1 item_id -> quy về sản phẩm là chính xác 1:1.
-- ============================================================

-- 1) Ads cấp chiến dịch x ngày, đã phẳng hoá + gắn item_id
create or replace view shopee.stg_ads_campaign_day as
select
  d.campaign_id, d.stat_date,
  to_char(d.stat_date,'YYYY-MM')                as ym,
  c.item_ids[1]                                 as item_id,
  c.ad_name, c.ad_type, c.campaign_status, c.bidding_method,
  c.placement, c.budget, c.roas_target,
  (d.payload->>'expense')::numeric              as expense,
  (d.payload->>'impression')::numeric           as impression,
  (d.payload->>'clicks')::numeric               as clicks,
  (d.payload->>'broad_order')::numeric          as ads_order,
  (d.payload->>'broad_gmv')::numeric            as ads_gmv,
  (d.payload->>'direct_order')::numeric         as ads_order_direct,
  (d.payload->>'direct_gmv')::numeric           as ads_gmv_direct,
  d.payload                                     as payload
from shopee.raw_ads_campaign_daily d
left join shopee.raw_ads_campaign c using (campaign_id);

-- 2) Bán hàng THẬT gom theo item x tháng (mẫu số để tính TACOS, chất lượng đơn)
create or replace view shopee.stg_sales_item_month as
select
  s.item_id, s.ym,
  min(s.item_name)                              as item_name,
  count(distinct s.order_sn)                    as o,
  sum(s.qty)                                    as u,
  sum(s.qty_net)                                as un,
  sum(s.price_paid * s.qty)                     as gmv,
  sum(s.price_paid * s.qty_cancelled)           as cx,
  sum(s.price_paid * s.qty_returned)            as rt,
  sum(coalesce(e.dc_shop,0) * case when s.qty>0 then s.qty_net::numeric/s.qty else 0 end) as dc,
  sum(s.price_paid * s.qty_net)
    - sum(coalesce(e.dc_shop,0) * case when s.qty>0 then s.qty_net::numeric/s.qty else 0 end) as rev,
  sum(coalesce(d.unit_cost,0) * s.qty_net)      as cogs
from shopee.stg_order_item s
left join shopee.dim_sku d on d.sku = s.sku
left join shopee.stg_escrow_item e
       on e.order_sn = s.order_sn and e.line_item_id = s.line_item_id
group by 1,2;

-- 3) Tỷ lệ phí sàn theo tháng — dùng để tính ROAS hoà vốn
create or replace view shopee.stg_fee_rate_month as
select ym,
       case when ban_hang > 0 then tong_phi_san / ban_hang else 0 end as fee_rate
from shopee.mart_fee_month;

-- 4) Ngành hàng của từng item (item có nhiều ngành thì chia theo doanh thu)
create or replace view shopee.stg_item_nganh as
with r as (
  select s.item_id, d.nganh, d.class_name,
         sum(s.price_paid * s.qty_net) rev,
         row_number() over (partition by s.item_id order by sum(s.price_paid*s.qty_net) desc) rn,
         sum(s.price_paid * s.qty_net) / nullif(sum(sum(s.price_paid*s.qty_net))
             over (partition by s.item_id), 0) as share
  from shopee.stg_order_item s join shopee.dim_sku d on d.sku = s.sku
  group by 1,2,3)
select item_id, nganh, class_name, rev, share, rn from r;

-- 5) MART CHÍNH: quảng cáo x sản phẩm x tháng + chẩn đoán
create or replace view shopee.mart_ads_item_month as
with a as (
  select item_id, ym,
         sum(expense) expense, sum(impression) impression, sum(clicks) clicks,
         sum(ads_order) ads_order, sum(ads_gmv) ads_gmv,
         sum(ads_order_direct) ads_order_direct, sum(ads_gmv_direct) ads_gmv_direct,
         count(distinct campaign_id) so_chien_dich
  from shopee.stg_ads_campaign_day group by 1,2)
select
  coalesce(a.item_id, s.item_id)                as item_id,
  coalesce(a.ym, s.ym)                          as ym,
  s.item_name,
  n.nganh, n.class_name,
  coalesce(a.expense,0)                         as expense,
  coalesce(a.impression,0)                      as impression,
  coalesce(a.clicks,0)                          as clicks,
  coalesce(a.ads_order,0)                       as ads_order,
  coalesce(a.ads_gmv,0)                         as ads_gmv,
  coalesce(a.ads_gmv_direct,0)                  as ads_gmv_direct,
  coalesce(a.so_chien_dich,0)                   as so_chien_dich,
  coalesce(s.gmv,0) gmv, coalesce(s.rev,0) rev, coalesce(s.cx,0) cx,
  coalesce(s.rt,0) rt, coalesce(s.dc,0) dc, coalesce(s.cogs,0) cogs,
  coalesce(s.u,0) u, coalesce(s.un,0) un, coalesce(s.o,0) o,
  -- phễu
  case when a.impression > 0 then a.clicks / a.impression end            as ctr,
  case when a.clicks > 0 then a.ads_order / a.clicks end                 as cr,
  case when a.clicks > 0 then a.expense / a.clicks end                   as cpc,
  case when a.ads_order > 0 then a.expense / a.ads_order end             as cpo,
  case when a.expense > 0 then a.ads_gmv / a.expense end                 as roas_shopee,
  case when a.ads_gmv > 0 then a.expense / a.ads_gmv end                 as acos,
  -- CHẤT LƯỢNG ĐƠN: sau huỷ / hoàn / giảm giá còn lại bao nhiêu phần GMV
  case when s.gmv > 0 then s.rev / s.gmv end                             as net_rate,
  -- ROAS THẬT: quy GMV ads về doanh thu thật bằng chất lượng đơn của chính SP đó
  case when a.expense > 0 and s.gmv > 0
       then a.ads_gmv * (s.rev / s.gmv) / a.expense end                  as roas_thuc,
  -- TACOS: ads chiếm bao nhiêu % doanh thu THẬT của sản phẩm (mức phụ thuộc ads)
  case when s.rev > 0 then a.expense / s.rev end                         as tacos,
  case when s.gmv > 0 then a.ads_gmv / s.gmv end                         as ads_share,
  case when s.rev > 0 then (s.rev - s.cogs) / s.rev end                  as gm,
  f.fee_rate,
  -- ROAS HOÀ VỐN: phải vượt mức này ads mới có lãi
  case when s.rev > 0 and ((s.rev - s.cogs)/s.rev - coalesce(f.fee_rate,0)) > 0
       then 1 / ((s.rev - s.cogs)/s.rev - coalesce(f.fee_rate,0)) end     as roas_hoa_von,
  -- LỢI NHUẬN sau giá vốn, phí sàn và ads
  coalesce(s.rev,0) - coalesce(s.cogs,0)
    - coalesce(s.rev,0) * coalesce(f.fee_rate,0) - coalesce(a.expense,0)  as ln_sau_ads
from a
full join shopee.stg_sales_item_month s on s.item_id = a.item_id and s.ym = a.ym
left join shopee.stg_item_nganh n on n.item_id = coalesce(a.item_id, s.item_id) and n.rn = 1
left join shopee.stg_fee_rate_month f on f.ym = coalesce(a.ym, s.ym);

-- 6) Quảng cáo theo NGÀNH HÀNG (chia chi phí theo tỷ trọng doanh thu nếu item đa ngành)
create or replace view shopee.mart_ads_nganh_month as
select
  n.nganh, m.ym,
  sum(m.expense   * n.share)                    as expense,
  sum(m.impression * n.share)                   as impression,
  sum(m.clicks    * n.share)                    as clicks,
  sum(m.ads_order * n.share)                    as ads_order,
  sum(m.ads_gmv   * n.share)                    as ads_gmv,
  sum(m.gmv  * n.share)                         as gmv,
  sum(m.rev  * n.share)                         as rev,
  sum(m.cogs * n.share)                         as cogs,
  sum(m.ln_sau_ads * n.share)                   as ln_sau_ads
from shopee.mart_ads_item_month m
join shopee.stg_item_nganh n on n.item_id = m.item_id
group by 1,2;

-- 7) Quảng cáo theo CHIẾN DỊCH (toàn kỳ) + chẩn đoán
create or replace view shopee.mart_ads_campaign_full as
with perf as (
  select campaign_id,
         min(stat_date) tu_ngay, max(stat_date) den_ngay, count(*) so_ngay,
         sum(expense) expense, sum(impression) impression, sum(clicks) clicks,
         sum(ads_order) ads_order, sum(ads_gmv) ads_gmv
  from shopee.stg_ads_campaign_day group by 1),
d as (
  /* lấy TOÀN BỘ 64 chiến dịch, kể cả chiến dịch chưa tiêu đồng nào */
  select c.campaign_id, c.item_ids[1] item_id, c.ad_name, c.ad_type,
         c.campaign_status, c.bidding_method, c.placement, c.budget, c.roas_target,
         p.tu_ngay, p.den_ngay, coalesce(p.so_ngay,0) so_ngay,
         coalesce(p.expense,0) expense, coalesce(p.impression,0) impression,
         coalesce(p.clicks,0) clicks, coalesce(p.ads_order,0) ads_order,
         coalesce(p.ads_gmv,0) ads_gmv
  from shopee.raw_ads_campaign c left join perf p using (campaign_id)),
q as (
  select item_id, sum(rev) rev, sum(gmv) gmv, sum(cogs) cogs
  from shopee.stg_sales_item_month group by 1)
select d.*,
  case when d.impression>0 then d.clicks/d.impression end          as ctr,
  case when d.clicks>0 then d.ads_order/d.clicks end               as cr,
  case when d.clicks>0 then d.expense/d.clicks end                 as cpc,
  case when d.ads_order>0 then d.expense/d.ads_order end           as cpo,
  case when d.expense>0 then d.ads_gmv/d.expense end               as roas_shopee,
  case when q.gmv>0 then q.rev/q.gmv end                           as net_rate,
  case when d.expense>0 and q.gmv>0 then d.ads_gmv*(q.rev/q.gmv)/d.expense end as roas_thuc
from d left join q on q.item_id = d.item_id;
