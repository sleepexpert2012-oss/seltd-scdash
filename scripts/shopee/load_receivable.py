"""Nạp file "Kế hoạch nhận hàng" của đại lý -> công nợ phải thu.

Chạy: python3 load_receivable.py <file.xlsx> <mã đại lý> <tên> [số ngày công nợ]

Đọc 2 sheet:
  "2. Đã giao"      -> từng phiếu xuất kho (ngày giao + thành tiền) = khoản phải thu
  "3. KH nhận hàng" -> kế hoạch giao theo tuần = phải thu DỰ KIẾN

Hạn thu = ngày giao + số ngày công nợ. Tiền đến hạn tuần nào rơi vào tuần đó
trong kế hoạch dòng tiền.
"""
import sys, os, re, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db

def _num(v):
    if isinstance(v, (int, float)):
        return float(v)
    return 0.0

def _date(v):
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if v:
        try:
            return dt.datetime.strptime(str(v).strip(), '%d/%m/%Y').date()
        except ValueError:
            return None
    return None

def doc_da_giao(wb):
    """Gộp theo phiếu xuất: ngày nằm ở dòng đầu của phiếu, các dòng sau để trống."""
    ws = wb['2. Đã giao']
    out, cur = {}, None
    for r in ws.iter_rows(min_row=9, values_only=True):
        so = (r[1] or '').strip() if r[1] else ''
        if so:
            cur = so
            out[cur] = {'pxk': so, 'd': _date(r[0]), 'amount': 0, 'note': r[2] or ''}
        if cur and r[3]:
            out[cur]['amount'] += _num(r[8])
    # Phiếu 0 đồng là hàng mẫu / chiết khấu 100% -> không phát sinh phải thu
    return [v for v in out.values() if v['d'] and v['amount'] > 0]

def doc_ke_hoach(wb):
    """Mỗi cột tuần có tiêu đề dạng 'Tuần 1\\n27/10–02/11' -> quy ra khoảng ngày."""
    ws = wb['3. KH nhận hàng']
    nam = None
    for r in ws.iter_rows(min_row=1, max_row=8, values_only=True):
        m = re.search(r'(\d{2})/(\d{2})/(\d{4})', str(r[0] or ''))
        if m:
            nam = int(m.group(3)); break
    nam = nam or dt.date.today().year

    cols = {}
    for c in range(6, 14):
        t = str(ws.cell(10, c).value or '')
        # Tháng ở ngày ĐẦU có thể bị lược khi cùng tháng với ngày cuối:
        # "27/10–02/11" nhưng cũng có "03–09/11". Thiếu thì lấy theo tháng cuối.
        m = re.search(r'(\d{1,2})(?:/(\d{1,2}))?\s*[–\-—]\s*(\d{1,2})/(\d{1,2})', t)
        if not m:
            continue
        thang_cuoi = int(m.group(4))
        thang_dau = int(m.group(2)) if m.group(2) else thang_cuoi
        d1 = dt.date(nam, thang_dau, int(m.group(1)))
        d2 = dt.date(nam, thang_cuoi, int(m.group(3)))
        if d2 < d1:                      # tuần vắt qua năm mới
            d2 = dt.date(nam + 1, int(m.group(4)), int(m.group(3)))
        cols[c] = (d1, d2)

    tong = {c: 0.0 for c in cols}
    for r in ws.iter_rows(min_row=11, values_only=True):
        ma = str(r[1] or '').strip()
        if not re.match(r'^[A-Z]{3}\d', ma):
            continue
        gia = _num(r[11])
        for c in cols:
            tong[c] += _num(r[c - 1]) * gia
    return [{'d_from': str(cols[c][0]), 'd_to': str(cols[c][1]), 'amount': round(v)}
            for c, v in tong.items() if v > 0]

def main(path, code, name, term):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    dels = doc_da_giao(wb)
    plans = doc_ke_hoach(wb)
    tong = sum(d['amount'] for d in dels)
    print(f'{len(dels)} phiếu xuất có tiền · tổng {tong:,.0f} đ')
    for d in sorted(dels, key=lambda x: x['d']):
        print(f"   {d['pxk']:22} {d['d']}  {d['amount']:>14,.0f}  hạn {d['d'] + dt.timedelta(days=term)}")
    print(f'{len(plans)} tuần kế hoạch giao · tổng {sum(p["amount"] for p in plans):,.0f} đ')

    with db.connect() as conn, conn.cursor() as cur:
        cur.execute('select * from public.set_receivable(%s::jsonb, %s::jsonb, %s::jsonb, %s::date, %s)',
                    (db.json.dumps({'code': code, 'name': name, 'term_days': term}),
                     db.json.dumps([{**d, 'd': str(d['d']), 'amount': int(d['amount'])} for d in dels]),
                     db.json.dumps(plans), dt.date.today().isoformat(),
                     f'nap-tu-file {os.path.basename(path)}'))
        print('đã ghi:', cur.fetchone())
        conn.commit()
    return 0

if __name__ == '__main__':
    f, code, name = sys.argv[1], sys.argv[2], sys.argv[3]
    term = int(sys.argv[4]) if len(sys.argv) > 4 else 30
    sys.exit(main(f, code, name, term))
