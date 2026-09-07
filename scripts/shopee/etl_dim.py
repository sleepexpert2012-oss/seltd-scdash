"""ETL 1: shop + sản phẩm (item) + biến thể (model) -> Supabase.
Nguyên tắc: payload gốc lưu NGUYÊN VẸN vào cột jsonb, không bỏ cột nào."""
import sys, time
sys.path.insert(0, __import__('os').path.dirname(__file__))
import shopee_client as sc, db

SHOP_ID = int(sc.load()['shop_id'])

# tất cả optional field mà get_item_base_info hỗ trợ
ITEM_FIELDS = ('description,brand,item_dangerous_object,gtin_code,ncd,authorised_brand_id,'
               'pre_order,size_chart_id,stock_info_v2,tax_info,complaint_policy,'
               'video_info,vehicle_info,certification_info,deboost,exclusive_price,'
               'group_item_id,is_fulfillment_by_shopee,description_info,description_type')

def do_shop(conn):
    with db.Run(conn, 'dim_shop') as run, conn.cursor() as cur:
        r = sc.call_ok('/api/v2/shop/get_shop_info')
        r.pop('request_id', None)
        run.n = db.upsert(cur, 'shopee.raw_shop', ['shop_id', 'payload', 'fetched_at'],
                          [(SHOP_ID, db.J(r), 'now()' and __import__('datetime').datetime.now(
                              __import__('datetime').timezone.utc))], ['shop_id'])
        conn.commit()
    return run.n

def item_ids():
    ids, offset = [], 0
    while True:
        r = sc.call_ok('/api/v2/product/get_item_list', params={
            'offset': offset, 'page_size': 100,
            'item_status': ['NORMAL', 'BANNED', 'UNLIST', 'REVIEWING', 'SELLER_DELETE']})
        resp = r.get('response') or {}
        ids += [(i['item_id'], i.get('item_status'), i.get('update_time')) for i in resp.get('item', [])]
        if not resp.get('has_next_page'):
            break
        offset = resp.get('next_offset', offset + 100)
        time.sleep(0.2)
    return ids

def do_items(conn):
    ids = item_ids()
    with db.Run(conn, 'dim_item') as run, conn.cursor() as cur:
        rows = []
        for i in range(0, len(ids), 50):
            chunk = ids[i:i + 50]
            r = sc.call_ok('/api/v2/product/get_item_base_info', params={
                'item_id_list': ','.join(str(x[0]) for x in chunk),
                'need_tax_info': 'true', 'need_complaint_policy': 'true'})
            for it in (r.get('response') or {}).get('item_list', []):
                rows.append((it['item_id'], SHOP_ID, it.get('item_status'),
                             db.ts(it.get('update_time')), db.J(it), db.ts(int(time.time()))))
            time.sleep(0.3)
        run.n = db.upsert(cur, 'shopee.raw_item',
                          ['item_id', 'shop_id', 'item_status', 'update_time', 'payload', 'fetched_at'],
                          rows, ['item_id'])
        conn.commit()
    return run.n, [x[0] for x in ids]

def do_models(conn, iids):
    with db.Run(conn, 'dim_model') as run, conn.cursor() as cur:
        rows = []
        for iid in iids:
            r = sc.call_ok('/api/v2/product/get_model_list', params={'item_id': iid})
            resp = r.get('response') or {}
            models = resp.get('model') or []
            if not models:                       # SP không có biến thể -> 1 dòng model_id=0
                rows.append((iid, 0, SHOP_ID, None, db.J(resp), db.ts(int(time.time()))))
            for m in models:
                rows.append((iid, m['model_id'], SHOP_ID, m.get('model_sku'),
                             db.J(m), db.ts(int(time.time()))))
            time.sleep(0.25)
        run.n = db.upsert(cur, 'shopee.raw_model',
                          ['item_id', 'model_id', 'shop_id', 'model_sku', 'payload', 'fetched_at'],
                          rows, ['item_id', 'model_id'])
        conn.commit()
    return run.n

if __name__ == '__main__':
    with db.connect() as conn:
        print('raw_shop  :', do_shop(conn), 'dòng')
        n, iids = do_items(conn)
        print('raw_item  :', n, 'dòng /', len(iids), 'item_id')
        print('raw_model :', do_models(conn, iids), 'dòng')
