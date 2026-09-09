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
    """Ghi đơn hoàn + ghi nhật ký vào shopee.etl_run.

    db.Run PHẢI nằm trong hàm này, không phải trong khối __main__: run_all.py gọi
    save() trực tiếp nên nếu để ở __main__ thì job chạy đủ mỗi lượt mà nhật ký
    đứng im. Đã xảy ra thật — 08/09/2026 anh Louis thấy fact_return "lần cuối
    07/09" trong khi dữ liệu vẫn được kéo mỗi lượt.
    """
    now = dt.datetime.now(dt.timezone.utc)
    rows = [(x['return_sn'], x.get('order_sn'), SHOP_ID, x.get('status'),
             db.ts(x.get('create_time')), db.ts(x.get('update_time')), db.J(x), now)
            for x in items]
    with db.Run(conn, 'fact_return') as job, conn.cursor() as cur:
        job.n = db.upsert(cur, 'shopee.raw_return',
                          ['return_sn', 'order_sn', 'shop_id', 'status',
                           'create_time', 'update_time', 'payload', 'fetched_at'],
                          rows, ['return_sn'])
    conn.commit()
    return job.n

if __name__ == '__main__':
    with db.connect() as conn:
        n = save(conn, fetch_all())
    print('raw_return:', n, 'đơn hoàn')
