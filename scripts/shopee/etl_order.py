"""ETL 2: đơn hàng Shopee -> shopee.raw_order (payload jsonb NGUYÊN VẸN).
Cửa sổ tối đa 15 ngày/lần theo giới hạn của get_order_list."""
import sys, os, time, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
import shopee_client as sc, db

SHOP_ID = int(sc.load()['shop_id'])
VN = dt.timezone(dt.timedelta(hours=7))

# TẤT CẢ optional field của get_order_detail (đã bỏ international_label: chỉ hỗ trợ ở BR)
DETAIL_FIELDS = ','.join([
    'buyer_user_id', 'buyer_username', 'estimated_shipping_fee', 'recipient_address',
    'actual_shipping_fee', 'goods_to_declare', 'note', 'note_update_time', 'item_list',
    'pay_time', 'dropshipper', 'dropshipper_phone', 'split_up', 'buyer_cancel_reason',
    'cancel_by', 'cancel_reason', 'actual_shipping_fee_confirmed', 'buyer_cpf_id',
    'fulfillment_flag', 'pickup_done_time', 'package_list', 'shipping_carrier',
    'payment_method', 'total_amount', 'invoice_data', 'no_plastic_packing',
    'order_chargeable_weight_gram', 'return_request_due_date', 'edt', 'payment_info',
    'advance_package',
])

def windows(d_from, d_to, days=15):
    """Chia [d_from, d_to] thành các cửa sổ <= 15 ngày (epoch giây, giờ VN)."""
    cur = d_from
    while cur < d_to:
        nxt = min(cur + dt.timedelta(days=days) - dt.timedelta(seconds=1), d_to)
        yield int(cur.timestamp()), int(nxt.timestamp())
        cur = nxt + dt.timedelta(seconds=1)

def list_orders(t0, t1, field='create_time'):
    """Trả về list order_sn trong cửa sổ."""
    sns, cursor = [], ''
    while True:
        r = sc.call_ok('/api/v2/order/get_order_list', params={
            'time_range_field': field, 'time_from': t0, 'time_to': t1,
            'page_size': 100, 'cursor': cursor,
            'response_optional_fields': 'order_status'})
        resp = r.get('response') or {}
        sns += [o['order_sn'] for o in resp.get('order_list', [])]
        if not resp.get('more'):
            break
        cursor = resp.get('next_cursor', '')
        time.sleep(0.2)
    return sns

def fetch_detail(sns):
    out = []
    for i in range(0, len(sns), 50):
        r = sc.call_ok('/api/v2/order/get_order_detail', params={
            'order_sn_list': ','.join(sns[i:i + 50]),
            'response_optional_fields': DETAIL_FIELDS})
        out += (r.get('response') or {}).get('order_list', [])
        time.sleep(0.3)
    return out

def save(conn, orders):
    now = dt.datetime.now(dt.timezone.utc)
    rows = [(o['order_sn'], SHOP_ID, o.get('order_status'), db.ts(o.get('create_time')),
             db.ts(o.get('update_time')), db.J(o), now) for o in orders]
    with conn.cursor() as cur:
        n = db.upsert(cur, 'shopee.raw_order',
                      ['order_sn', 'shop_id', 'order_status', 'create_time',
                       'update_time', 'payload', 'fetched_at'], rows, ['order_sn'])
    conn.commit()
    return n

def backfill(conn, d_from, d_to, field='create_time'):
    total = 0
    for t0, t1 in windows(d_from, d_to):
        lo = dt.datetime.fromtimestamp(t0, VN).date()
        hi = dt.datetime.fromtimestamp(t1, VN).date()
        with db.Run(conn, f'fact_order[{field}]', db.ts(t0), db.ts(t1)) as run:
            sns = list_orders(t0, t1, field)
            run.n = save(conn, fetch_detail(sns)) if sns else 0
            total += run.n
        print(f'  {lo} → {hi}: {run.n:>4} đơn')
    return total

if __name__ == '__main__':
    a = sys.argv[1:]
    d0 = dt.datetime.fromisoformat(a[0]).replace(tzinfo=VN) if a else dt.datetime.now(VN) - dt.timedelta(days=15)
    d1 = dt.datetime.fromisoformat(a[1]).replace(tzinfo=VN) if len(a) > 1 else dt.datetime.now(VN)
    with db.connect() as conn:
        print(f'Kéo đơn {d0.date()} → {d1.date()} ...')
        print('Tổng:', backfill(conn, d0, d1), 'đơn')
