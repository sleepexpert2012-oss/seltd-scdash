"""Sinh TỒN KHO GIẢ (snapshot cuối kỳ) để chạy thử màn Tồn kho & Đặt hàng.
Bám 4 kho thật trong Master Data và sức bán từ sales_mock.
Cố ý tạo đủ mọi trạng thái báo động: hết hàng, dưới điểm đặt, đủ, tồn cao, bán chậm, tồn chết.
Thay bằng tồn thật: giữ nguyên cấu trúc {sku, wh, qty} là app chạy được ngay.
"""
import json, os, random

BASE = os.path.join(os.path.dirname(__file__), '..', 'src', 'data')
master = json.load(open(os.path.join(BASE, 'master.json'), encoding='utf-8'))
sales = json.load(open(os.path.join(BASE, 'sales_mock.json'), encoding='utf-8'))

rnd = random.Random(20260907)
N = len(sales['months'])

# sức bán trung bình 3 tháng gần nhất theo SKU
vel3 = {}
for r in sales['rows']:
    if r['m'] > N - 4:
        vel3[r['sku']] = vel3.get(r['sku'], 0) + r['un']
vel3 = {k: v / 3 for k, v in vel3.items()}

# kho bán hàng nhận phần lớn tồn; kho lỗi chỉ giữ lượng nhỏ
WH = [w['code'] for w in master['warehouses']]
SPLIT = {'WH01': .62, 'WH02': .20, 'WH03': .16, 'WH04': .02}

rows = []
for s in master['skus']:
    v = vel3.get(s['sku'], 0)
    if v <= 0:
        # SKU không còn bán: đa số đã hết tồn, một ít còn tồn chết
        if rnd.random() < 0.30:
            total = rnd.randint(3, 40)
        else:
            continue
    else:
        # số tháng tồn mong muốn -> tạo đủ dải trạng thái
        # phân bố thực tế: phần lớn nằm quanh 1-3 tháng, thiểu số tồn cao
        cover = rnd.choices(
            [0.2, 0.6, 1.0, 1.4, 2.0, 2.6, 3.5, 5.0, 8.0],
            weights=[6, 12, 18, 18, 15, 12, 9, 6, 4], k=1)[0]
        total = max(0, round(v * cover * rnd.uniform(.8, 1.25)))
        if rnd.random() < 0.07:
            total = 0                      # hết hàng hẳn
    if total <= 0:
        continue

    left = total
    for i, w in enumerate(WH):
        q = left if i == len(WH) - 1 else round(total * SPLIT[w] * rnd.uniform(.7, 1.3))
        q = max(0, min(q, left))
        if q > 0:
            rows.append({'sku': s['sku'], 'wh': w, 'qty': q})
        left -= q
    if left > 0:
        rows.append({'sku': s['sku'], 'wh': 'WH01', 'qty': left})

out = {
    'meta': {
        'kind': 'MOCK',
        'note': 'TỒN KHO GIẢ — sinh bằng scripts/gen_mock_stock.py, chỉ để chạy thử giao diện.',
        'asOf': sales['months'][-1], 'seed': 20260907,
    },
    'warehouses': master['warehouses'],
    'rows': rows,
}
with open(os.path.join(BASE, 'stock_mock.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

tot = sum(r['qty'] for r in rows)
cost = sum(r['qty'] * next((x['unitCost'] for x in master['skus'] if x['sku'] == r['sku']), 0) for r in rows)
print(f"OK -> {len(rows)} dòng · {len({r['sku'] for r in rows})} SKU có tồn · {tot:,} unit · giá vốn {cost/1e6:,.0f} triệu")
