"""Nạp file kiểm kho (Excel) làm TỒN ĐẦU KỲ vào Supabase.

Chạy: python3 load_stock_baseline.py <file.xlsx> [ngày-đầu-kỳ YYYY-MM-DD]

File kiểm kho có 5 kho WH001..WH005, khác mã kho Shopee (WH01..WH04) — giữ
NGUYÊN mã trong file, không đổi tên, để lần sau tải lại vẫn khớp.
"""
import sys, os, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db

HEADER_ROW, FIRST_ROW = 6, 8
WH_COLS = {6: 'WH001', 7: 'WH002', 8: 'WH003', 9: 'WH004', 10: 'WH005'}

# Kho nào tính là HÀNG BÁN ĐƯỢC. Anh Louis chốt 08/11/2026: WH004 (trưng bày +
# hàng lỗi) không bán được nhưng VẪN tính vào giá trị tồn kho; 4 kho còn lại
# bán được. Sửa ở đây nếu phân loại kho thay đổi.
KHONG_BAN = {'WH004'}

def doc(path):
    import openpyxl
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    num = lambda v: int(float(v)) if v not in (None, '') and str(v).strip() not in ('', '-') else 0
    rows, tong = [], 0
    for r in ws.iter_rows(min_row=FIRST_ROW, values_only=True):
        sku = (r[2] or '').strip() if r[2] else ''
        if not sku:
            continue
        khai = num(r[4])                     # cột "Tổng tồn kho (pcs)" trong file
        cong = sum(num(r[c - 1]) for c in WH_COLS)
        if khai != cong:
            print(f'  [CẢNH BÁO] {sku}: cột tổng {khai} != cộng các kho {cong} — lấy theo từng kho')
        for c, wh in WH_COLS.items():
            q = num(r[c - 1])
            if q > 0:
                rows.append({'sku': sku, 'wh': wh, 'qty': q})
                tong += q
    whs = [{'code': wh, 'name': (ws.cell(HEADER_ROW, c).value or wh).strip(),
            'sell': wh not in KHONG_BAN} for c, wh in WH_COLS.items()]
    return rows, tong, whs

def main(path, as_of):
    rows, tong, whs = doc(path)
    sku = len({r['sku'] for r in rows})
    print(f'đọc được {len(rows)} dòng · {sku} SKU có tồn · {tong} unit · mốc {as_of}')
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute('select public.set_stock_baseline(%s::jsonb, %s::date, %s)',
                    (db.json.dumps(rows), as_of, f'nap-tu-file {os.path.basename(path)}'))
        conn.commit()
        cur.execute('update public.stock_baseline_meta set warehouses = %s::jsonb where id = 1',
                    (db.json.dumps(whs),))
        conn.commit()
        cur.execute('select n_sku, n_unit, as_of from public.stock_baseline_meta where id = 1')
        print('đã ghi lên Supabase:', cur.fetchone())
        print('kho:', ' · '.join(f"{w['code']} {w['name']}" + ('' if w['sell'] else ' [không bán]')
                                 for w in whs))
    return 0

if __name__ == '__main__':
    f = sys.argv[1]
    d = sys.argv[2] if len(sys.argv) > 2 else dt.date.today().isoformat()
    sys.exit(main(f, d))
