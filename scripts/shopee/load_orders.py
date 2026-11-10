"""Nạp ĐƠN ĐẶT HÀNG ĐẠI LÝ (biểu mẫu BM-02) từ file gốc .xlsx.

Chạy: python3 load_orders.py <mã đại lý> <file1.xlsx> [file2.xlsx ...]

Đọc sheet "DonDatHang". Bắt cột theo TÊN TIÊU ĐỀ chứ không theo vị trí, vì các
đơn không cùng số cột: DH001/DH002 có cột "% Chiết khấu", DH003 thì không.

Ngày đơn lấy từ TÊN FILE (DHxxx-KNTH-dd.mm.yyyy-R0.xlsx). Ô "Ngày:" trong file
không tin được: DH001 ghi 06/08/2026 nhưng Excel đã nuốt thành 2026-06-08 (08
tháng 6) vì lưu dưới dạng ngày kiểu Mỹ — lệch đúng 2 tháng.
"""
import sys, os, re, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db

def _n(v):
    return float(v) if isinstance(v, (int, float)) else 0.0

def ngay_tu_ten(path):
    m = re.search(r'(\d{2})\.(\d{2})\.(\d{4})', os.path.basename(path))
    if not m:
        raise SystemExit(f'Không đọc được ngày từ tên file: {path}')
    d, mth, y = (int(x) for x in m.groups())
    return dt.date(y, mth, d)

def doc(path):
    import openpyxl
    ws = openpyxl.load_workbook(path, data_only=True)['DonDatHang']
    rows = list(ws.iter_rows(values_only=True))

    code = note = None
    for r in rows[:10]:
        for i, c in enumerate(r):
            lab = str(c or '')
            if lab.startswith('Số đơn') and i + 1 < len(r):
                code = str(r[i + 1] or '').strip()
            if lab.startswith('Ghi chú') and i + 1 < len(r):
                note = (str(r[i + 1]).strip() or None) if r[i + 1] else None

    hi = next(i for i, r in enumerate(rows)
              if r and str(r[0] or '').strip() == 'STT' and any('Mã SP' in str(c or '') for c in r))
    head = [str(c or '').strip() for c in rows[hi]]
    def col(*keys):
        for k in keys:
            for i, h in enumerate(head):
                if k.lower() in h.lower():
                    return i
        return None
    c_sku, c_qty = col('Mã SP'), col('SL')
    c_price, c_disc = col('Đơn giá'), col('% Chiết khấu')
    c_amt, c_note = col('Thành tiền'), col('Ghi chú')

    lines, ghichu = [], []
    for r in rows[hi + 1:]:
        lab = str(r[0] or '').strip()
        if lab.startswith('Tổng tiền hàng'):
            break
        sku = str(r[c_sku] or '').strip() if c_sku is not None else ''
        if not sku:
            continue
        qty, price = _n(r[c_qty]), _n(r[c_price])
        disc = _n(r[c_disc]) if c_disc is not None else 0.0
        amt = _n(r[c_amt]) if c_amt is not None else qty * price * (1 - disc)
        ln = str(r[c_note] or '').strip() if c_note is not None else ''
        if ln:
            ghichu.append(ln)
        lines.append({'sku': sku, 'qty': qty, 'price': round(price),
                      'disc': disc, 'amount': round(amt), 'note': ln or None})

    tong = vat = 0.0
    for r in rows[hi:]:
        lab = str(r[0] or '').strip()
        val = next((_n(c) for c in reversed(r) if isinstance(c, (int, float))), 0.0)
        if lab.startswith('Cộng tiền hàng'):
            tong = val
        elif 'Tiền thuế GTGT' in lab:
            vat = val

    if not note and ghichu:
        note = ' · '.join(dict.fromkeys(ghichu))[:300]
    return {'code': code, 'd': ngay_tu_ten(path), 'note': note,
            'lines': lines, 'tong': tong, 'vat': vat}

def main(cust, paths):
    import json
    don = [doc(p) for p in paths]
    with db.connect() as c:
        with c.cursor() as cur:
            for o in don:
                tinh = sum(l['amount'] for l in o['lines'])
                if abs(tinh - o['tong']) > 1:
                    print(f"  ! {o['code']}: cộng dòng {tinh:,.0f} ≠ tổng trên đơn {o['tong']:,.0f}")
                cur.execute('select public.save_order(%s::jsonb, %s::jsonb, %s)', (
                    json.dumps({'code': o['code'], 'cust': cust,
                                'd': o['d'].isoformat(), 'note': o['note'], 'status': 'open'}),
                    json.dumps(o['lines']), 'load_orders'))
                print(f"  {o['code']}  {o['d']}  {len(o['lines'])} dòng  "
                      f"chưa VAT {o['tong']:,.0f}  VAT {o['vat']:,.0f}")
        c.commit()
    print(f"\nĐã nạp {len(don)} đơn · tổng chưa VAT {sum(o['tong'] for o in don):,.0f}")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2:])
