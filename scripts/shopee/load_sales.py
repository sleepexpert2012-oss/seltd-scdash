"""Nạp bảng ĐỐI CHIẾU CÔNG NỢ của đại lý -> đơn hàng · phiếu xuất · thanh toán.

Chạy: python3 load_sales.py <file.xlsx> <mã đại lý>

File có 2 sheet:
  "1. Công nợ"            -> từng phiếu xuất (ngày, số HĐ, đã trả, ghi chú) + thanh toán
  "2. Chi tiết hàng giao" -> dòng hàng của từng phiếu xuất

Khác bản nạp trước (load_receivable.py): bản này lấy cả DÒNG HÀNG, VAT, số hoá
đơn và ngày/hình thức thanh toán — ba thứ bản đối chiếu cho thấy mô hình cũ thiếu.
"""
import sys, os, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db

def _n(v):
    return float(v) if isinstance(v, (int, float)) else 0.0

def _d(v):
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if v:
        for f in ('%d/%m/%Y', '%Y-%m-%d'):
            try:
                return dt.datetime.strptime(str(v).strip()[:10], f).date()
            except ValueError:
                pass
    return None

def doc(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb['1. Công nợ']

    meta = {}
    for r in ws.iter_rows(min_row=1, max_row=11, values_only=True):
        lab = str(r[0] or '')
        if 'Thuế suất' in lab:
            meta['vat'] = _n(r[2])
        elif 'Thời hạn công nợ' in lab:
            meta['term'] = int(_n(r[2]) or 30)
        elif 'Ngày chốt' in lab:
            meta['as_of'] = _d(r[2])
        elif lab.startswith('Đại lý:'):
            # Dòng gộp "TÊN  ·  MST: 123" -> tách ra, nếu không tên khách dính MST
            raw = lab.split(':', 1)[1].strip()
            if '·' in raw and 'MST' in raw:
                ten, mst = raw.split('·', 1)
                meta['ten'] = ten.strip()
                meta['mst'] = mst.split(':', 1)[-1].strip()
            else:
                meta['ten'] = raw

    dels, pays, muc = [], [], None
    for r in ws.iter_rows(min_row=12, values_only=True):
        lab = str(r[0] or '')
        if lab.startswith('A.'): muc = 'A'; continue
        if lab.startswith('B.'): muc = 'B'; continue
        if lab.startswith('C.'): muc = 'C'; continue
        if muc == 'A' and r[1] and str(r[1]).startswith('PXK'):
            dels.append({'pxk': str(r[1]).strip(), 'd': _d(r[0]), 'don': (r[2] or '') or None,
                         'invoice_no': str(r[12]).strip() if r[12] else None,
                         'note': (r[13] or '') or None})
        elif muc == 'B' and _d(r[0]) and _n(r[6]) > 0:
            pays.append({'d': _d(r[0]), 'amount': int(_n(r[6])),
                         'method': (r[1] or '') or None, 'doc_no': (r[2] or '') or None,
                         'note': (r[13] or '') or None})

    # dòng hàng: ngày + số phiếu chỉ xuất hiện ở dòng đầu của mỗi phiếu
    ws2 = wb['2. Chi tiết hàng giao']
    lines, cur = {}, None
    for r in ws2.iter_rows(min_row=9, values_only=True):
        so = str(r[1]).strip() if r[1] else ''
        if so.startswith('PXK'):
            cur = so; lines.setdefault(cur, [])
        if not cur or not r[2]:
            continue
        lines[cur].append({'sku': str(r[2]).strip(), 'qty': _n(r[5]),
                           'price': int(_n(r[6])), 'amount': int(_n(r[7])),
                           'note': (r[8] or '') or None})
    return meta, dels, pays, lines

def main(path, code):
    meta, dels, pays, lines = doc(path)
    vat = meta.get('vat', 0.08)
    print(f"đại lý {code} · VAT {vat:.0%} · hạn {meta.get('term')} ngày · chốt {meta.get('as_of')}")
    chua = sum(sum(l['amount'] for l in lines.get(d['pxk'], [])) for d in dels)
    print(f'{len(dels)} phiếu xuất · {sum(len(v) for v in lines.values())} dòng hàng')
    print(f'  chưa VAT {chua:,.0f} · VAT {chua*vat:,.0f} · phải thanh toán {chua*(1+vat):,.0f}')
    print(f'{len(pays)} lần thanh toán · tổng {sum(p["amount"] for p in pays):,.0f}')

    with db.connect() as conn, conn.cursor() as cur:
        cur.execute('select public.save_customer(%s::jsonb, %s)',
                    (db.json.dumps({'code': code, 'name': meta.get('ten') or code,
                                    'mst': meta.get('mst'),
                                    'term_days': meta.get('term', 30), 'vat_rate': vat}), 'nap-tu-file'))
        for d in dels:
            cur.execute('select public.save_delivery(%s::jsonb, %s::jsonb, %s)',
                        (db.json.dumps({**d, 'cust': code, 'd': str(d['d'])}),
                         db.json.dumps(lines.get(d['pxk'], [])), 'nap-tu-file'))
        # Thanh toán: nạp lại từ đầu để khớp đúng bản đối chiếu
        cur.execute('delete from public.ar_payment where cust = %s', (code,))
        for p in pays:
            cur.execute('select public.add_ar_payment(%s, %s::date, %s, %s, %s)',
                        (code, str(p['d']), p['amount'],
                         ' · '.join(x for x in [p.get('method'), p.get('doc_no'), p.get('note')] if x),
                         'nap-tu-file'))
        conn.commit()
    print('đã ghi lên Supabase')
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1], sys.argv[2]))
