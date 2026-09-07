"""ETL 4: đơn hoàn/trả -> shopee.raw_return. get_return_list phân trang theo page_no."""
import sys, os, time, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
import shopee_client as sc, db

SHOP_ID = int(sc.load()['shop_id'])

def fetch_all(t0=None, t1=None):
    """Lấy hết đơn hoàn. t0/t1 (epoch) lọc theo create_time nếu cần incremental."""
    out, page = [], 0
    while True:
        p = {'page_no': page, 'page_size': 100}
        if t0: p['create_time_from'] = t0
        if t1: p['create_time_to'] = t1
        r = sc.call_ok('/api/v2/returns/get_return_list', params=p)
        resp = r.get('response') or {}
        out += resp.get('return') or []
        if not resp.get('more'):
            break
        page += 1
        time.sleep(0.25)
    return out

def save(conn, items):
    now = dt.datetime.now(dt.timezone.utc)
    rows = [(x['return_sn'], x.get('order_sn'), SHOP_ID, x.get('status'),
             db.ts(x.get('create_time')), db.ts(x.get('update_time')), db.J(x), now)
            for x in items]
    with conn.cursor() as cur:
        n = db.upsert(cur, 'shopee.raw_return',
                      ['return_sn', 'order_sn', 'shop_id', 'status',
                       'create_time', 'update_time', 'payload', 'fetched_at'],
                      rows, ['return_sn'])
    conn.commit()
    return n

if __name__ == '__main__':
    with db.connect() as conn:
        with db.Run(conn, 'fact_return') as job:
            items = fetch_all()
            job.n = save(conn, items)
        print('raw_return:', job.n, 'đơn hoàn')
