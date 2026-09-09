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
import sys, os, time, traceback, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
import psycopg
import shopee_client as sc, db
import etl_dim, etl_order, etl_escrow, etl_return, etl_ads, etl_stock, export_app_data

VN = dt.timezone(dt.timedelta(hours=7))
LOG = os.path.join(os.path.dirname(__file__), '..', '..', 'logs')

BROKEN = (psycopg.OperationalError, psycopg.InterfaceError)

def step(name, fn, needs_conn=True):
    """Chạy 1 bước, KHÔNG để lỗi của nó làm chết các bước sau.

    Mỗi bước tự mở kết nối riêng. Trước đây cả job dùng chung 1 connection nên
    pooler của Supabase ngắt giữa job là 7/9 bước sau đó chết theo với
    "the connection is closed" (đã xảy ra 20:00 ngày 07/09/2026).
    Mất kết nối thì thử lại 1 lần sau 5s.
    """
    t0 = dt.datetime.now()
    for attempt in (1, 2):
        try:
            if needs_conn:
                with db.connect() as conn:
                    r = fn(conn)
            else:
                r = fn()
            print(f'[OK]   {name:22} {r}  ({(dt.datetime.now()-t0).seconds}s)', flush=True)
            return True
        except Exception as e:
            if isinstance(e, BROKEN) and attempt == 1:
                print(f'[LẠI]  {name:22} mất kết nối, thử lại sau 5s: {e}', flush=True)
                time.sleep(5)
                continue
            print(f'[LỖI]  {name:22} {e}', flush=True)
            traceback.print_exc()
            return False


def wait_net(tries=10, wait=30):
    """Chờ mạng rồi mới lấy token.

    launchd bắn lượt bị trượt ngay khi máy vừa thức, lúc đó Wi-Fi chưa lên nên
    DNS fail (getaddrinfo) — trước đây ensure_token() nằm ngoài step() nên cả
    job chết ngay, không ghi được dòng nào vào etl_run (đã xảy ra 09:48 ngày
    08/09/2026). Chờ tối đa tries*wait giây.
    """
    last = None
    for i in range(1, tries + 1):
        try:
            sc.ensure_token()
            return True
        except Exception as e:
            last = e
            print(f'[CHỜ]  mạng/token chưa sẵn sàng ({i}/{tries}): {e}', flush=True)
            if i < tries:
                time.sleep(wait)
    print(f'[LỖI]  bỏ lượt này, không lấy được token: {last}', flush=True)
    traceback.print_exc()
    return False

def main():
    print(f'===== ETL {dt.datetime.now(VN):%Y-%m-%d %H:%M:%S} (giờ VN) =====', flush=True)
    if not wait_net():
        print('===== KẾT THÚC: 0/9 bước OK (không có mạng) =====', flush=True)
        return 1
    now = dt.datetime.now(VN)
    d20 = now - dt.timedelta(days=20)
    d35 = (now - dt.timedelta(days=35)).date()

    ok = []
    ok.append(step('danh mục shop', lambda conn: f'{etl_dim.do_shop(conn)} dòng'))

    def dims(conn):
        n, iids = etl_dim.do_items(conn)
        return f'{n} item, {etl_dim.do_models(conn, iids)} model'
    ok.append(step('sản phẩm + biến thể', dims))

    ok.append(step('kho + ảnh chụp tồn',
                   lambda conn: f'{etl_stock.do_warehouse(conn)} kho, '
                                f'{etl_stock.do_snapshot(conn)} dòng tồn'))

    ok.append(step('đơn mới (create_time)',
                   lambda conn: f'{etl_order.backfill(conn, d20, now, "create_time")} đơn'))
    ok.append(step('đơn đổi trạng thái (update_time)',
                   lambda conn: f'{etl_order.backfill(conn, d20, now, "update_time")} đơn'))

    def escrow(conn):
        sns = etl_escrow.pending(conn)                       # đơn chưa có escrow
        with conn.cursor() as cur:                           # + đơn cập nhật 30 ngày
            cur.execute("""select o.order_sn from shopee.raw_order o
                           where o.order_status not in ('CANCELLED','UNPAID','INVOICE_PENDING')
                             and o.update_time > now() - interval '30 days'""")
            sns = sorted(set(sns) | {r[0] for r in cur.fetchall()})
        return f'{etl_escrow.run(conn, sns) if sns else 0} đơn'
    ok.append(step('escrow', escrow))

    def rets(conn):
        return f'{etl_return.save(conn, etl_return.fetch_all())} đơn hoàn'
    ok.append(step('đơn hoàn', rets))

    def ads(conn):
        n1 = etl_ads.do_shop(conn, d35, now.date())
        ids = etl_ads.campaign_ids()
        n0 = etl_ads.do_setting(conn, ids)          # cấu hình + item_id, cần cho Marketing Analysis
        n2 = etl_ads.do_campaign(conn, d35, now.date(), ids)
        # Theo giờ: mỗi ngày là một lần gọi API nên chỉ kéo lại 10 ngày gần nhất.
        # Ngày hôm nay chỉ có các giờ đã trôi qua -> phải kéo lại nhiều lượt mới đủ.
        # Backfill cả giai đoạn làm riêng một lần bằng etl_ads.do_hourly(d0, d1).
        n3 = etl_ads.do_hourly(conn, (now - dt.timedelta(days=9)).date(), now.date())
        return f'{n1} ngày shop, {n0} cấu hình CD, {n2} dòng chiến dịch, {n3} dòng giờ'
    ok.append(step('quảng cáo', ads))

    ok.append(step('xuất JSON cho app', lambda: export_app_data.main() or 'xong',
                   needs_conn=False))
    print(f'===== KẾT THÚC: {sum(ok)}/{len(ok)} bước OK =====', flush=True)
    return 0 if all(ok) else 1

if __name__ == '__main__':
    os.makedirs(LOG, exist_ok=True)
    sys.exit(main())
