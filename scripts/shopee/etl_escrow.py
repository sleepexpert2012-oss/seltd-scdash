"""ETL 3: escrow (tiền thực nhận + toàn bộ phí sàn) -> shopee.raw_escrow.
get_escrow_detail_batch là POST, body {"order_sn_list": [...]}, tối đa 50 đơn/lần."""
import sys, os, time, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
import shopee_client as sc, db

SHOP_ID = int(sc.load()['shop_id'])

def pending(conn, only_missing=True):
    """Danh sách order_sn cần lấy escrow. Đơn CANCELLED/UNPAID không phát sinh escrow."""
    sql = """select o.order_sn from shopee.raw_order o
             left join shopee.raw_escrow e using (order_sn)
             where o.order_status not in ('CANCELLED','UNPAID','INVOICE_PENDING')
               and (%s = false or e.order_sn is null)
             order by o.create_time"""
    with conn.cursor() as cur:
        cur.execute(sql, (only_missing,))
        return [r[0] for r in cur.fetchall()]

def run(conn, sns):
    now = dt.datetime.now(dt.timezone.utc)
    total = 0
    with db.Run(conn, 'fact_order_income') as job:
        for i in range(0, len(sns), 50):
            chunk = sns[i:i + 50]
            r = sc.call_ok('/api/v2/payment/get_escrow_detail_batch', 'POST',
                           body={'order_sn_list': chunk})
            rows = []
            for e in (r.get('response') or []):
                d = e.get('escrow_detail') or {}
                sn = d.get('order_sn')
                if sn:
                    rows.append((sn, SHOP_ID, db.J(d), now))
            with conn.cursor() as cur:
                total += db.upsert(cur, 'shopee.raw_escrow',
                                   ['order_sn', 'shop_id', 'payload', 'fetched_at'],
                                   rows, ['order_sn'])
            conn.commit()
            print(f'  {i + len(chunk):>5}/{len(sns)} đơn — đã lưu {total}')
            time.sleep(0.3)
        job.n = total
    return total

if __name__ == '__main__':
    with db.connect() as conn:
        sns = pending(conn)
        print(f'Cần lấy escrow: {len(sns)} đơn')
        print('Tổng:', run(conn, sns), 'đơn')
