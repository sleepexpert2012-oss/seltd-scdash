"""Sinh dữ liệu BÁN HÀNG GIẢ để chạy thử giao diện.
Bám theo danh mục SKU thật trong src/data/master.json (ngành, loại hình, NCC, giá vốn).
Có seed cố định -> chạy lại cho ra đúng cùng bộ số.
Thay bằng dữ liệu thật: xoá file này và nạp sales_fact thật cùng cấu trúc.

Cấu trúc mỗi dòng (1 SKU trong 1 tháng):
  sku, m (index tháng), ch (kênh: ecom|store),
  u  = số lượng đặt (gộp, gồm cả đơn sẽ huỷ)
  un = số lượng bán thuần (đã trừ huỷ & hoàn)
  o  = số đơn thuần
  gmv, cx (giá trị huỷ), dc (giảm giá), rt (hoàn trả), rev (doanh thu thuần), cogs
"""
import json, math, os, random

BASE = os.path.join(os.path.dirname(__file__), '..', 'src', 'data')
master = json.load(open(os.path.join(BASE, 'master.json'), encoding='utf-8'))

MONTHS = [f"{y}.{m:02d}" for y in (2025, 2026) for m in range(1, 13) if not (y == 2026 and m > 9)]
N = len(MONTHS)

rnd = random.Random(20260906)

# đặc tính theo ngành: sức bán nền, markup giá bán trên giá vốn, mùa vụ 12 tháng
NGANH = {
    'Nệm':        dict(vel=(2, 14),  markup=(1.35, 1.62), seas=[.85,.8,.95,1.0,1.05,1.1,1.05,1.0,.95,1.05,1.35,1.25]),
    'Chăn':       dict(vel=(6, 40),  markup=(1.50, 1.95), seas=[1.3,1.1,.9,.75,.6,.55,.6,.7,.9,1.15,1.5,1.6]),
    'Bộ Chăn ga': dict(vel=(3, 18),  markup=(1.45, 1.80), seas=[1.15,1.0,.95,.9,.85,.85,.9,.95,1.0,1.1,1.25,1.3]),
    'Gối':        dict(vel=(5, 30),  markup=(2.10, 3.10), seas=[1.0,.95,1.0,1.05,1.05,1.0,1.0,1.05,1.0,1.05,1.2,1.15]),
    'Phụ Kiện':   dict(vel=(2, 12),  markup=(1.25, 1.55), seas=[1.0,.95,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.05,1.1,1.1]),
}

# tỷ lệ vận hành theo tháng — huỷ đơn tăng dần về cuối kỳ (bám thực tế sàn TMĐT)
def op_rates(i):
    t = i / (N - 1)
    cancel = 0.20 + 0.18 * t + rnd.uniform(-0.04, 0.04)
    disc   = 0.05 + 0.05 * t + rnd.uniform(-0.015, 0.015)
    ret    = 0.010 + 0.015 * t + rnd.uniform(-0.006, 0.008)
    return max(.10, min(.45, cancel)), max(.02, min(.13, disc)), max(0, min(.05, ret))

rows = []
skus = master['skus']

# hồ sơ từng SKU
prof = {}
for s in skus:
    ng = NGANH.get(s['nganh'], NGANH['Phụ Kiện'])
    cost = s['unitCost'] or 0
    if cost <= 0:  # SKU chưa có giá vốn trong master -> gán giá vốn giả theo ngành
        cost = {'Nệm': 1_500_000, 'Chăn': 260_000, 'Bộ Chăn ga': 420_000,
                'Gối': 150_000, 'Phụ Kiện': 190_000}.get(s['nganh'], 200_000)
        cost *= rnd.uniform(.75, 1.35)
    price = s['salesPrice'] if s['salesPrice'] else cost * rnd.uniform(*ng['markup'])
    prof[s['sku']] = dict(
        cost=cost, price=price, seas=ng['seas'],
        vel=rnd.uniform(*ng['vel']),
        # quỹ đạo: 0.55 = suy giảm mạnh, 1.9 = tăng mạnh
        trend=rnd.choice([.55, .7, .85, 1.0, 1.0, 1.15, 1.35, 1.9]),
        start=rnd.choice([0, 0, 0, 0, 2, 5, 9, 13]),        # tháng bắt đầu bán
        stop=rnd.choice([N, N, N, N, N, N, N, 12, 16]),      # tháng ngừng bán
        ch='store' if rnd.random() < 0.28 else 'ecom',
        active=rnd.random() < 0.82,                          # 18% SKU không phát sinh bán
    )

for i, mm in enumerate(MONTHS):
    cancel_r, disc_r, ret_r = op_rates(i)
    mo = int(mm.split('.')[1]) - 1
    for s in skus:
        p = prof[s['sku']]
        if not p['active'] or i < p['start'] or i >= p['stop']:
            continue
        ramp = min(1.0, (i - p['start'] + 1) / 3)                  # 3 tháng ramp-up
        growth = p['trend'] ** (i / (N - 1))
        u = p['vel'] * p['seas'][mo] * growth * ramp * rnd.uniform(.65, 1.4)
        u = round(u)
        if u <= 0:
            continue
        c_r = max(.05, min(.55, cancel_r * rnd.uniform(.7, 1.3)))
        r_r = max(0.0, min(.10, ret_r * rnd.uniform(0, 2.2)))
        d_r = max(.01, min(.20, disc_r * rnd.uniform(.6, 1.5)))

        gmv = u * p['price']
        cx = gmv * c_r
        rt = (gmv - cx) * r_r
        dc = (gmv - cx) * d_r
        rev = gmv - cx - rt - dc
        un = u * (1 - c_r) * (1 - r_r)
        cogs = un * p['cost']
        orders = max(1, round(un / rnd.uniform(1.05, 1.35)))

        rows.append({
            'sku': s['sku'], 'm': i, 'ch': p['ch'],
            'u': u, 'un': round(un, 2), 'o': orders,
            'gmv': round(gmv), 'cx': round(cx), 'dc': round(dc), 'rt': round(rt),
            'rev': round(rev), 'cogs': round(cogs),
        })

out = {
    'meta': {
        'kind': 'MOCK',
        'note': 'DỮ LIỆU GIẢ — sinh bằng scripts/gen_mock_sales.py, chỉ để chạy thử giao diện.',
        'seed': 20260906, 'rows': len(rows),
    },
    'months': MONTHS,
    'rows': rows,
}
with open(os.path.join(BASE, 'sales_mock.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

tot = lambda k: sum(r[k] for r in rows)
print(f"OK -> {len(rows)} dòng · {len(MONTHS)} tháng · {len({r['sku'] for r in rows})} SKU có bán")
print(f"GMV {tot('gmv')/1e6:,.0f} tr · DT {tot('rev')/1e6:,.0f} tr · COGS {tot('cogs')/1e6:,.0f} tr"
      f" · GM {(tot('rev')-tot('cogs'))/tot('rev')*100:.1f}% · huỷ {tot('cx')/tot('gmv')*100:.1f}%")
