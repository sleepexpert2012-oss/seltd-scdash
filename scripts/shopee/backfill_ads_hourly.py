"""Backfill quảng cáo theo GIỜ cho cả giai đoạn có chạy ads.

Chạy: python3 backfill_ads_hourly.py [từ-ngày] [đến-ngày]     (mặc định 2026-04-01 -> hôm nay)

Vì sao chia khối: mỗi ngày là một lần gọi API (~1,1s) nên cả giai đoạn mất
~4 phút. Giữ MỘT kết nối suốt thời gian đó thì session pooler của Supabase ngắt
giữa đường và mất sạch (đã xảy ra 09/09/2026: chạy 12 phút rồi
"the connection is closed", rollback về 0 dòng). Mỗi khối mở kết nối riêng và
commit ngay, nên đứt ở đâu chỉ mất khối đó và chạy lại là tiếp được.
"""
import sys, os, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db, etl_ads

CHUNK = 20        # ngày mỗi khối -> ~22s/khối, an toàn với pooler

def main(d0, d1):
    print(f'backfill theo giờ {d0} -> {d1} ({(d1 - d0).days + 1} ngày, khối {CHUNK} ngày)',
          flush=True)
    tong, loi = 0, 0
    cur = d0
    while cur <= d1:
        end = min(cur + dt.timedelta(days=CHUNK - 1), d1)
        try:
            with db.connect() as conn:
                n = etl_ads.do_hourly(conn, cur, end)
            tong += n
            print(f'  {cur} → {end}: {n} dòng   (luỹ kế {tong})', flush=True)
        except Exception as e:
            loi += 1
            print(f'  {cur} → {end}: LỖI {str(e)[:90]}', flush=True)
        cur = end + dt.timedelta(days=1)
    print(f'xong: {tong} dòng, {loi} khối lỗi', flush=True)
    return 0 if loi == 0 else 1

if __name__ == '__main__':
    a = dt.date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else dt.date(2026, 4, 1)
    b = dt.date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else dt.date.today()
    sys.exit(main(a, b))
