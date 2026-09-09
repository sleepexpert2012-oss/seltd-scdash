"""ETL 5: chi phí quảng cáo Shopee -> raw_ads_shop_daily + raw_ads_campaign_daily.
Giới hạn API: mỗi lần gọi tối đa 1 tháng, ngày dạng DD-MM-YYYY."""
import sys, os, time, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
import shopee_client as sc, db

SHOP_ID = int(sc.load()['shop_id'])
F = '%d-%m-%Y'

def months(d0, d1, days=30):
    """API chỉ nhận khoảng <= 30 ngày (tháng 31 ngày sẽ bị từ chối)."""
    cur = d0
    while cur <= d1:
        end = min(cur + dt.timedelta(days=days - 1), d1)
        yield cur, end
        cur = end + dt.timedelta(days=1)

def do_shop(conn, d0, d1):
    now = dt.datetime.now(dt.timezone.utc)
    with db.Run(conn, 'ads_shop_daily', db.ts(int(dt.datetime.combine(d0, dt.time()).timestamp())),
                db.ts(int(dt.datetime.combine(d1, dt.time()).timestamp()))) as job:
        rows = []
        for a, b in months(d0, d1):
            try:
                r = sc.call_ok('/api/v2/ads/get_all_cpc_ads_daily_performance',
                               params={'start_date': a.strftime(F), 'end_date': b.strftime(F)})
            except Exception as e:
                print(f'  {a} → {b}: BỎ QUA ({str(e)[:70]})'); continue
            for x in r.get('response') or []:
                d = dt.datetime.strptime(x['date'], F).date()
                rows.append((SHOP_ID, d, db.J(x), now))
            print(f'  {a} → {b}: {len(r.get("response") or [])} ngày')
            time.sleep(0.3)
        with conn.cursor() as cur:
            job.n = db.upsert(cur, 'shopee.raw_ads_shop_daily',
                              ['shop_id', 'stat_date', 'payload', 'fetched_at'],
                              rows, ['shop_id', 'stat_date'])
        conn.commit()
    return job.n

def campaign_ids():
    out, off = [], 0
    while True:
        r = sc.call_ok('/api/v2/ads/get_product_level_campaign_id_list',
                       params={'ad_type': 'all', 'offset': off, 'limit': 100})
        resp = r['response']
        out += [c['campaign_id'] for c in resp.get('campaign_list', [])]
        if not resp.get('has_next_page'):
            break
        off += 100
        time.sleep(0.25)
    return out

def do_setting(conn, ids):
    """Cấu hình từng chiến dịch: tên, trạng thái, ngân sách, mục tiêu ROAS và
    DANH SÁCH item_id — đây là mắt nối duy nhất giữa ads và sản phẩm/ngành hàng."""
    now = dt.datetime.now(dt.timezone.utc)
    rows = []
    for i in range(0, len(ids), 50):
        r = sc.call_ok('/api/v2/ads/get_product_level_campaign_setting_info', params={
            'campaign_id_list': ','.join(map(str, ids[i:i + 50])),
            'info_type_list': '1,2,3'})
        for c in (r['response'] or {}).get('campaign_list', []):
            ci = c.get('common_info') or {}
            dur = ci.get('campaign_duration') or {}
            auto = c.get('auto_bidding_info') or {}
            rows.append((c['campaign_id'], SHOP_ID, ci.get('ad_name'), ci.get('ad_type'),
                         ci.get('campaign_status'), ci.get('bidding_method'),
                         ci.get('campaign_placement'), ci.get('campaign_budget'),
                         auto.get('roas_target'), db.ts(dur.get('start_time')),
                         db.ts(dur.get('end_time')), ci.get('item_id_list') or [],
                         db.J(c), now))
        time.sleep(0.3)
    with db.Run(conn, 'ads_campaign_setting') as job, conn.cursor() as cur:
        job.n = db.upsert(cur, 'shopee.raw_ads_campaign',
                          ['campaign_id', 'shop_id', 'ad_name', 'ad_type', 'campaign_status',
                           'bidding_method', 'placement', 'budget', 'roas_target',
                           'start_time', 'end_time', 'item_ids', 'payload', 'fetched_at'],
                          rows, ['campaign_id'])
    conn.commit()
    return job.n

def do_campaign(conn, d0, d1, ids):
    now = dt.datetime.now(dt.timezone.utc)
    with db.Run(conn, 'ads_campaign_daily') as job:
        rows = []
        for a, b in months(d0, d1):
            for i in range(0, len(ids), 100):
                chunk = ids[i:i + 100]
                try:
                    r = sc.call_ok('/api/v2/ads/get_product_campaign_daily_performance', params={
                        'campaign_id_list': ','.join(map(str, chunk)),
                        'start_date': a.strftime(F), 'end_date': b.strftime(F)})
                except Exception as e:
                    print(f'  {a}→{b} lô {i//100}: BỎ QUA ({str(e)[:70]})'); continue
                for c in (r['response'] or {}).get('campaign_list', []):
                    meta = {k: c[k] for k in c if k != 'metrics_list'}
                    for m in c.get('metrics_list') or []:
                        if not any(m.get(k) for k in ('impression', 'clicks', 'expense')):
                            continue                      # bỏ ngày không chạy ads
                        d = dt.datetime.strptime(m['date'], F).date()
                        rows.append((SHOP_ID, c['campaign_id'], d, db.J({**meta, **m}), now))
                time.sleep(0.3)
            print(f'  {a} → {b}: luỹ kế {len(rows)} dòng')
        with conn.cursor() as cur:
            job.n = db.upsert(cur, 'shopee.raw_ads_campaign_daily',
                              ['shop_id', 'campaign_id', 'stat_date', 'payload', 'fetched_at'],
                              rows, ['shop_id', 'campaign_id', 'stat_date'])
        conn.commit()
    return job.n

if __name__ == '__main__':
    a = sys.argv[1:]
    d0 = dt.date.fromisoformat(a[0]) if a else dt.date.today() - dt.timedelta(days=30)
    d1 = dt.date.fromisoformat(a[1]) if len(a) > 1 else dt.date.today()
    with db.connect() as conn:
        print(f'== Ads cấp shop {d0} → {d1}')
        print('raw_ads_shop_daily:', do_shop(conn, d0, d1), 'dòng')
        ids = campaign_ids()
        print(f'\n== Cấu hình chiến dịch: {do_setting(conn, ids)} chiến dịch')
        print(f'== Ads cấp chiến dịch ({len(ids)} chiến dịch)')
        print('raw_ads_campaign_daily:', do_campaign(conn, d0, d1, ids), 'dòng')
