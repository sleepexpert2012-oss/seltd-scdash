"""ETL 6: tồn kho THẬT từ Shopee.
Nguồn: stock_info_v2 trong get_model_list (đã có trong raw_model) + danh sách kho.
Shopee KHÔNG trả lịch sử tồn, chỉ trả tồn hiện tại -> chụp ảnh theo ngày."""
import sys, os, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
import shopee_client as sc, db

def do_warehouse(conn):
    now = dt.datetime.now(dt.timezone.utc)
    r = sc.call_ok('/api/v2/shop/get_warehouse_detail')
    rows = [(w['location_id'], w.get('warehouse_id'), w.get('warehouse_name'), db.J(w), now)
            for w in r['response']]
    with db.Run(conn, 'dim_warehouse') as job, conn.cursor() as cur:
        job.n = db.upsert(cur, 'shopee.raw_warehouse',
                          ['location_id', 'warehouse_id', 'warehouse_name', 'payload', 'fetched_at'],
                          rows, ['location_id'])
    conn.commit()
    return job.n

def do_snapshot(conn, snap=None):
    """Đọc stock_info_v2 từ raw_model (đã kéo ở etl_dim) và chụp ảnh tồn hôm nay."""
    snap = snap or dt.datetime.now(dt.timezone(dt.timedelta(hours=7))).date()
    now = dt.datetime.now(dt.timezone.utc)
    with conn.cursor() as cur:
        cur.execute("""select item_id, model_id, model_sku, payload->'stock_info_v2' si
                       from shopee.raw_model where payload->'stock_info_v2' is not null""")
        src = cur.fetchall()
    rows = []
    for item_id, model_id, sku, si in src:
        summ = (si or {}).get('summary_info') or {}
        res, avail = summ.get('total_reserved_stock'), summ.get('total_available_stock')
        for s in (si or {}).get('seller_stock') or []:
            rows.append((snap, item_id, model_id, s.get('location_id') or '', sku,
                         int(s.get('stock') or 0), s.get('if_saleable'), res, avail,
                         db.J({**s, 'summary_info': summ,
                               'shopee_stock': (si or {}).get('shopee_stock'),
                               'advance_stock': (si or {}).get('advance_stock')}), now))
    with db.Run(conn, 'stock_snapshot') as job, conn.cursor() as cur:
        job.n = db.upsert(cur, 'shopee.raw_stock_snapshot',
                          ['snap_date', 'item_id', 'model_id', 'location_id', 'model_sku',
                           'stock', 'if_saleable', 'reserved_total', 'available_total',
                           'payload', 'fetched_at'],
                          rows, ['snap_date', 'item_id', 'model_id', 'location_id'])
        conn.commit()
    return job.n

if __name__ == '__main__':
    import pathlib
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(pathlib.Path(os.path.join(os.path.dirname(__file__), 'schema_stock.sql')).read_text())
        conn.commit()
        print('kho          :', do_warehouse(conn), 'kho')
        print('ảnh chụp tồn :', do_snapshot(conn), 'dòng')
        with conn.cursor() as cur:
            cur.execute("select wh, sum(qty) from shopee.mart_stock_now group by 1 order by 1")
            for w, q in cur.fetchall():
                print(f'  {w:8} {int(q):>6} unit')
            cur.execute("select count(*), sum(qty) from shopee.mart_stock_now where qty>0")
            print('SKU-kho còn tồn / tổng unit:', cur.fetchone())
