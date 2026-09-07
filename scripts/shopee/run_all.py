"""Job cập nhật hằng ngày: Shopee -> Supabase -> src/data/*.json
Chạy 3 khung giờ 06:00 / 12:00 / 20:00 (launchd, xem install_schedule.sh).

Chiến lược tăng dần (incremental):
  - tồn kho      : chụp ảnh tồn hiện tại theo ngày (Shopee không có lịch sử tồn)
  - đơn mới      : quét create_time 20 ngày gần nhất
  - đơn đổi trạng thái: quét update_time 20 ngày gần nhất (bắt huỷ / hoàn muộn)
  - escrow       : đơn nào chưa có + đơn cập nhật trong 30 ngày (tiền về muộn)
  - đơn hoàn     : kéo lại toàn bộ (số lượng nhỏ)
  - ads          : 35 ngày gần nhất
Mỗi bước ghi nhật ký vào shopee.etl_run; một bước lỗi không làm chết cả job.
"""
import sys, os, traceback, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
import shopee_client as sc, db
import etl_dim, etl_order, etl_escrow, etl_return, etl_ads, etl_stock, export_app_data

VN = dt.timezone(dt.timedelta(hours=7))
LOG = os.path.join(os.path.dirname(__file__), '..', '..', 'logs')

def step(name, fn):
    t0 = dt.datetime.now()
    try:
        r = fn()
        print(f'[OK]   {name:22} {r}  ({(dt.datetime.now()-t0).seconds}s)', flush=True)
        return True
    except Exception as e:
        print(f'[LỖI]  {name:22} {e}', flush=True)
        traceback.print_exc()
        return False

def main():
    print(f'===== ETL {dt.datetime.now(VN):%Y-%m-%d %H:%M:%S} (giờ VN) =====', flush=True)
    sc.ensure_token()
    now = dt.datetime.now(VN)
    d20 = now - dt.timedelta(days=20)
    d35 = (now - dt.timedelta(days=35)).date()

    ok = []
    with db.connect() as conn:
        ok.append(step('danh mục shop', lambda: f'{etl_dim.do_shop(conn)} dòng'))

        def dims():
            n, iids = etl_dim.do_items(conn)
            return f'{n} item, {etl_dim.do_models(conn, iids)} model'
        ok.append(step('sản phẩm + biến thể', dims))

        ok.append(step('kho + ảnh chụp tồn',
                       lambda: f'{etl_stock.do_warehouse(conn)} kho, '
                               f'{etl_stock.do_snapshot(conn)} dòng tồn'))

        ok.append(step('đơn mới (create_time)',
                       lambda: f'{etl_order.backfill(conn, d20, now, "create_time")} đơn'))
        ok.append(step('đơn đổi trạng thái (update_time)',
                       lambda: f'{etl_order.backfill(conn, d20, now, "update_time")} đơn'))

        def escrow():
            sns = etl_escrow.pending(conn)                       # đơn chưa có escrow
            with conn.cursor() as cur:                           # + đơn cập nhật 30 ngày
                cur.execute("""select o.order_sn from shopee.raw_order o
                               where o.order_status not in ('CANCELLED','UNPAID','INVOICE_PENDING')
                                 and o.update_time > now() - interval '30 days'""")
                sns = sorted(set(sns) | {r[0] for r in cur.fetchall()})
            return f'{etl_escrow.run(conn, sns) if sns else 0} đơn'
        ok.append(step('escrow', escrow))

        def rets():
            return f'{etl_return.save(conn, etl_return.fetch_all())} đơn hoàn'
        ok.append(step('đơn hoàn', rets))

        def ads():
            n1 = etl_ads.do_shop(conn, d35, now.date())
            ids = etl_ads.campaign_ids()
            n0 = etl_ads.do_setting(conn, ids)          # cấu hình + item_id, cần cho Marketing Analysis
            n2 = etl_ads.do_campaign(conn, d35, now.date(), ids)
            return f'{n1} ngày shop, {n0} cấu hình CD, {n2} dòng chiến dịch'
        ok.append(step('quảng cáo', ads))

    ok.append(step('xuất JSON cho app', lambda: export_app_data.main() or 'xong'))
    print(f'===== KẾT THÚC: {sum(ok)}/{len(ok)} bước OK =====', flush=True)
    return 0 if all(ok) else 1

if __name__ == '__main__':
    os.makedirs(LOG, exist_ok=True)
    sys.exit(main())
