"""Xuất dữ liệu THẬT từ Supabase ra src/data/*.json đúng shape app đang dùng.
App vẫn là SPA tĩnh nên không nối trực tiếp DB — dữ liệu private, không phơi ra
publishable key. Chạy lại sau mỗi lần ETL."""
import sys, os, json, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
import db

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'data')

def rd(cur, sql):
    cur.execute(sql)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]

def num(v):
    if v is None: return 0
    f = float(v)
    return int(f) if f == int(f) else round(f, 2)

def main():
    with db.connect() as conn, conn.cursor() as cur:
        # chỉ lấy SKU có trong Master Data — SKU lạ sẽ làm vỡ tra cứu ở app
        m = rd(cur, """
            select s.ym, s.sku, s.o, s.u, s.un, s.gmv, s.cx, s.rt, s.dc, s.rev, s.cogs
            from shopee.mart_sales_sku_month s
            join shopee.dim_sku d on d.sku = s.sku
            order by s.ym, s.sku""")
        d = rd(cur, """
            select to_char(s.d,'YYYY-MM-DD') d, s.sku, s.o, s.u, s.un, s.gmv, s.rev, s.cogs
            from shopee.mart_sales_sku_day s
            join shopee.dim_sku dd on dd.sku = s.sku
            order by s.d, s.sku""")
        bo = rd(cur, """
            select coalesce(sum(s.price_paid*s.qty_net),0) rev_bo, count(distinct s.model_sku) sku_bo
            from shopee.stg_order_item s
            left join shopee.dim_sku d on d.sku = s.model_sku
            where s.model_sku is not null and d.sku is null""")[0]
        stk = rd(cur, "select sku, wh, qty::int qty, as_of from shopee.mart_stock_now where qty <> 0 order by sku, wh")
        whs = rd(cur, """select warehouse_name code, location_id,
                                 payload->>'state' tinh, payload->>'address' dia_chi
                          from shopee.raw_warehouse order by warehouse_name""")
        # --- Marketing Analysis ---
        mk_month = rd(cur, """
            select a.ym,
                   a.chi_phi_ads ads_shop, a.hien_thi, a.click, a.roas_rong, a.cpc, a.ctr,
                   a.don_ads_rong, a.gmv_ads_rong,
                   coalesce(k.ads_camp,0) ads_camp,
                   a.chi_phi_ads - coalesce(k.ads_camp,0) ads_khac
            from shopee.mart_ads_month a
            left join (select ym, sum(expense) ads_camp from shopee.stg_ads_campaign_day group by 1) k
                   using (ym)
            order by a.ym""")
        # Chuỗi theo NGÀY và theo GIỜ, cấp toàn shop — để màn Marketing đổi được
        # mức thời gian (giờ/ngày/tuần/tháng/năm). Ngày gộp lên được tuần/tháng/năm
        # ngay tại app; giờ thì chỉ có ở cấp shop nên không lọc theo ngành/SKU.
        mk_shop_day = rd(cur, """
            select stat_date::text d,
                   (payload->>'expense')::numeric        expense,
                   (payload->>'impression')::numeric     impression,
                   (payload->>'clicks')::numeric         clicks,
                   (payload->>'broad_order')::numeric    ads_order,
                   (payload->>'broad_gmv')::numeric      ads_gmv,
                   (payload->>'direct_order')::numeric   ads_order_tt,
                   (payload->>'direct_gmv')::numeric     ads_gmv_tt
            from shopee.raw_ads_shop_daily order by stat_date""")
        mk_shop_hour = rd(cur, """
            select stat_date::text d, hour h,
                   (payload->>'expense')::numeric        expense,
                   (payload->>'impression')::numeric     impression,
                   (payload->>'clicks')::numeric         clicks,
                   (payload->>'broad_order')::numeric    ads_order,
                   (payload->>'broad_gmv')::numeric      ads_gmv
            from shopee.raw_ads_shop_hourly
            -- bỏ các giờ không có gì xảy ra: phần lớn giờ đêm rỗng, giữ lại chỉ
            -- làm file to mà không thêm thông tin. App tự hiểu giờ thiếu = 0.
            where (payload->>'impression')::numeric > 0
               or (payload->>'expense')::numeric > 0
            order by stat_date, hour""")
        mk_item = rd(cur, """
            select item_id::text, ym, item_name, nganh, class_name, so_chien_dich,
                   expense, impression, clicks, ads_order, ads_gmv,
                   gmv, rev, cx, rt, dc, cogs, u, un, o,
                   ctr, cr, cpc, cpo, roas_shopee, acos, net_rate, roas_thuc,
                   tacos, ads_share, gm, fee_rate, roas_hoa_von, ln_sau_ads
            from shopee.mart_ads_item_month order by ym, expense desc nulls last""")
        mk_nganh = rd(cur, "select * from shopee.mart_ads_nganh_month order by ym, expense desc")
        mk_camp_m = rd(cur, """
            select campaign_id::text, ym,
                   sum(expense) expense, sum(impression) impression, sum(clicks) clicks,
                   sum(ads_order) ads_order, sum(ads_gmv) ads_gmv, count(*) so_ngay
            from shopee.stg_ads_campaign_day group by 1,2 order by 2, 3 desc""")
        mk_camp = rd(cur, """
            select campaign_id::text, item_id::text, ad_name, ad_type, campaign_status,
                   bidding_method, placement, budget, roas_target,
                   tu_ngay::text, den_ngay::text, so_ngay,
                   expense, impression, clicks, ads_order, ads_gmv,
                   ctr, cr, cpc, cpo, roas_shopee, net_rate, roas_thuc
            from shopee.mart_ads_campaign_full order by expense desc nulls last""")
        fee = rd(cur, "select * from shopee.mart_fee_month order by ym")
        ads = rd(cur, "select * from shopee.mart_ads_month order by ym")
        ret = rd(cur, "select * from shopee.mart_return_month order by ym")
        # --- Cơ sở hạ tầng: trạng thái từng bảng + nhật ký ETL ---
        infra_tables = rd(cur, """
            select 'raw_order' t, count(*)::int n,
                   min(create_time)::text lo, max(create_time)::text hi, max(fetched_at)::text pulled
              from shopee.raw_order
            union all select 'raw_escrow', count(*)::int, null, null, max(fetched_at)::text from shopee.raw_escrow
            union all select 'raw_return', count(*)::int, min(create_time)::text, max(create_time)::text,
                   max(fetched_at)::text from shopee.raw_return
            union all select 'raw_item', count(*)::int, null, null, max(fetched_at)::text from shopee.raw_item
            union all select 'raw_model', count(*)::int, null, null, max(fetched_at)::text from shopee.raw_model
            union all select 'raw_stock_snapshot', count(*)::int, min(snap_date)::text, max(snap_date)::text,
                   max(fetched_at)::text from shopee.raw_stock_snapshot
            union all select 'raw_ads_shop_daily', count(*)::int, min(stat_date)::text, max(stat_date)::text,
                   max(fetched_at)::text from shopee.raw_ads_shop_daily
            union all select 'raw_ads_campaign_daily', count(*)::int, min(stat_date)::text, max(stat_date)::text,
                   max(fetched_at)::text from shopee.raw_ads_campaign_daily
            union all select 'raw_ads_campaign', count(*)::int, null, null, max(fetched_at)::text from shopee.raw_ads_campaign
            union all select 'raw_warehouse', count(*)::int, null, null, max(fetched_at)::text from shopee.raw_warehouse
            union all select 'raw_shop', count(*)::int, null, null, max(fetched_at)::text from shopee.raw_shop
            union all select 'sku_alias', count(*)::int, null, null, null from shopee.sku_alias
            union all select 'dim_sku', count(*)::int, null, null, max(loaded_at)::text from shopee.dim_sku
            order by 1""")
        infra_runs = rd(cur, """
            select id, job, started_at::text, finished_at::text, rows_in, ok, note,
                   window_from::text, window_to::text,
                   round(extract(epoch from (finished_at - started_at))::numeric, 1) secs
            from shopee.etl_run order by id desc limit 300""")
        infra_jobs = rd(cur, """
            select job,
                   max(started_at)::text last_run,
                   max(started_at) filter (where ok) ::text last_ok,
                   count(*)::int runs,
                   count(*) filter (where ok = false)::int fails,
                   sum(rows_in)::int rows_total
            from shopee.etl_run group by 1 order by 2 desc""")
        span = rd(cur, """select min(create_time at time zone 'Asia/Ho_Chi_Minh')::date a,
                                 max(create_time at time zone 'Asia/Ho_Chi_Minh')::date b,
                                 count(*) n from shopee.raw_order""")[0]

    months = sorted({r['ym'].replace('-', '.') for r in m})
    mi = {v: i for i, v in enumerate(months)}
    # Phải ghi kèm múi giờ +07:00. Trước đây ghi giờ máy không có múi: chạy trên
    # laptop thì tình cờ đúng, nhưng chạy trên GitHub Actions (UTC) thì app đọc
    # thành giờ VN và lệch 7 tiếng -> báo "trang đang xem số cũ" oan.
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=7))).isoformat(timespec='seconds')

    meta = {'kind': 'REAL', 'source': 'Shopee Open API v2 -> Supabase (schema shopee)',
            'shop': 'Tuft & Needle by Sleep Expert (1448395105)',
            'orders': span['n'], 'from': str(span['a']), 'to': str(span['b']),
            'exportedAt': now,
            'note': ('GMV theo GIÁ THỰC BÁN (giá niêm yết bỏ qua). '
                     'dc = tiền khuyến mãi shop tự bỏ ra (voucher shop + xu), lấy từ escrow. '
                     f"Đã loại {bo['sku_bo']} SKU không có trong Master Data "
                     f"({num(bo['rev_bo'])/1e6:.1f}tr doanh thu, ~0.9%).")}

    sales = {'meta': meta, 'months': months, 'rows': [
        {'sku': r['sku'], 'm': mi[r['ym'].replace('-', '.')], 'ch': 'shopee',
         'u': num(r['u']), 'un': num(r['un']), 'o': num(r['o']),
         'gmv': num(r['gmv']), 'cx': num(r['cx']), 'dc': num(r['dc']),
         'rt': num(r['rt']), 'rev': num(r['rev']), 'cogs': num(r['cogs'])} for r in m]}

    daily = {'meta': {**meta, 'note': 'Doanh thu theo NGÀY, dựng từ create_time đơn hàng (giờ VN).'},
             'months': months, 'rows': [
        {'sku': r['sku'], 'd': r['d'], 'u': num(r['u']), 'un': num(r['un']),
         'o': num(r['o']), 'gmv': num(r['gmv']), 'rev': num(r['rev']),
         'cogs': num(r['cogs'])} for r in d]}

    plat = {'meta': {**meta, 'note': 'Phí sàn & quảng cáo Shopee. Ads chỉ có từ 2026-04 (API giới hạn lịch sử).'},
            'fees': [{k: (v if isinstance(v, str) else num(v)) for k, v in r.items()} for r in fee],
            'ads': [{k: (v if isinstance(v, str) else num(v)) for k, v in r.items()} for r in ads],
            'returns': [{k: (v if isinstance(v, (str, type(None))) else num(v)) for k, v in r.items()} for r in ret]}

    as_of = str(stk[0]['as_of']) if stk else str(dt.date.today())
    # tên & loại kho lấy theo Master Data (nghĩa nghiệp vụ), địa chỉ lấy theo Shopee
    mwh = {w['code']: w for w in json.load(open(os.path.join(OUT, 'master.json')))['warehouses']}
    warehouses = [{'code': w['code'],
                   'name': mwh.get(w['code'], {}).get('name') or w['code'],
                   'type': mwh.get(w['code'], {}).get('type') or 'Kho bán hàng',
                   'locationId': w['location_id'], 'tinh': w['tinh'],
                   'diaChi': w['dia_chi']} for w in whs]
    stock = {'meta': {'kind': 'REAL', 'source': 'Shopee stock_info_v2 (seller_stock theo location_id)',
                      'asOf': as_of[:7].replace('-', '.'), 'asOfDate': as_of,
                      'exportedAt': now,
                      'note': ('Tồn kho Shopee theo kho VNZ/VN019XF0Z/VN019ZLCZ/VN01A1IOZ '
                               '= WH01/WH02/WH03/WH04. Shopee KHÔNG trả lịch sử tồn nên '
                               'bảng ảnh chụp theo ngày mới bắt đầu tích luỹ từ 2026-09-07.')},
             'warehouses': warehouses,
             'rows': [{'sku': r['sku'], 'wh': r['wh'], 'qty': int(r['qty'])} for r in stk]}

    # các chỉ số tỷ lệ phải giữ đủ số lẻ, làm tròn 2 chữ số sẽ mất sạch (CTR 3,4% -> 0,03)
    RATE = {'ctr', 'cr', 'net_rate', 'tacos', 'ads_share', 'gm', 'fee_rate', 'acos'}
    def clean(rows):
        out = []
        for r in rows:
            o = {}
            for k, v in r.items():
                if isinstance(v, (str, type(None), bool)):
                    o[k] = v
                elif k in RATE:
                    o[k] = round(float(v), 6)
                else:
                    o[k] = num(v)
            out.append(o)
        return out
    mkt = {'meta': {**meta,
                    'note': ('Quảng cáo Shopee. API chỉ trả lịch sử ~5 tháng nên dữ liệu ads '
                             'bắt đầu từ 2026-04; các tháng trước để trống, không phải bằng 0. '
                             'Mỗi chiến dịch gắn đúng 1 sản phẩm nên quy chi phí về sản phẩm là 1:1. '
                             'ROAS thật = GMV ads × chất lượng đơn của chính sản phẩm ÷ chi phí ads.')},
           'months': clean(mk_month), 'items': clean(mk_item),
           'nganh': clean(mk_nganh), 'campaigns': clean(mk_camp),
           'campaignMonths': clean(mk_camp_m),
           'shopDay': clean(mk_shop_day), 'shopHour': clean(mk_shop_hour)}

    # nhật ký phiên bản app lấy từ git log — để màn Cơ sở hạ tầng xem app đổi gì khi nào
    def git_log(n=60):
        import subprocess
        root = os.path.abspath(os.path.join(OUT, '..', '..'))
        try:
            out = subprocess.run(
                ['git', '-C', root, 'log', f'-{n}', '--date=iso-strict',
                 '--pretty=%H%x1f%ad%x1f%an%x1f%s%x1f%b%x1e'],
                capture_output=True, text=True, timeout=20, check=True).stdout
        except Exception:
            return []
        rows = []
        for rec in out.split('\x1e'):
            rec = rec.strip('\n')
            if not rec.strip():
                continue
            f = rec.split('\x1f')
            if len(f) < 4:
                continue
            rows.append({'sha': f[0][:8], 'date': f[1], 'author': f[2],
                         'subject': f[3], 'body': (f[4].strip() if len(f) > 4 else '')})
        return rows

    infra = {'meta': {**meta, 'note': ('Trạng thái kho dữ liệu và nhật ký ETL, chụp tại thời điểm '
                                       'kết xuất. App là trang tĩnh nên số liệu ở đây phản ánh '
                                       'lần kết xuất/deploy gần nhất, không phải thời gian thực.')},
             'exportedAt': now,
             'tables': clean(infra_tables), 'runs': clean(infra_runs),
             'jobs': clean(infra_jobs), 'commits': git_log(),
             'schedule': ['06:00', '12:00', '20:00'],
             'master': {'skus': len(json.load(open(os.path.join(OUT, 'master.json')))['skus'])}}

    for name, obj in (('sales', sales), ('sales_daily', daily), ('platform', plat),
                      ('stock', stock), ('marketing', mkt), ('infra', infra)):
        p = os.path.join(OUT, name + '.json')
        with open(p, 'w') as f:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        print(f'{name+".json":20} {len(obj.get("rows") or obj.get("fees") or obj.get("items") or obj.get("runs") or []):>6} dòng  '
              f'{os.path.getsize(p)/1024:>7.0f} KB')
    print(f'\n{len(months)} tháng: {months[0]} → {months[-1]} | {span["n"]} đơn')

if __name__ == '__main__':
    main()
