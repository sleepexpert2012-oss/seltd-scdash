"""Phân bổ dữ liệu bán GIẢ từ cấp tháng xuống cấp NGÀY cho màn Calendar.
Nguyên tắc: TỔNG THEO THÁNG GIỮ NGUYÊN — mọi màn hình đã chốt không đổi số.
Trọng số ngày: thứ trong tuần (cuối tuần cao hơn) × ngày sale sàn (9/9, 10/10...) × nhiễu.
Thay bằng dữ liệu thật: nạp sales_fact cấp ngày với cùng cấu trúc {sku, d, un, rev, gmv, o}.
"""
import json, os, random, calendar

BASE = os.path.join(os.path.dirname(__file__), '..', 'src', 'data')
sales = json.load(open(os.path.join(BASE, 'sales_mock.json'), encoding='utf-8'))
MONTHS = sales['months']
rnd = random.Random(20260908)

# hệ số theo thứ trong tuần: 0=Mon ... 6=Sun
DOW = [0.85, 0.82, 0.88, 0.95, 1.15, 1.35, 1.25]
# ngày sale của sàn: trùng số ngày với số tháng, và ngày đôi giữa tháng
def sale_boost(y, m, d):
    if d == m:            # 9/9, 10/10, 11/11, 12/12...
        return 3.2
    if d == 15:           # sale giữa tháng
        return 1.9
    if d == 25:
        return 1.5
    return 1.0

rows = []
for r in sales['rows']:
    y, m = map(int, MONTHS[r['m']].split('.'))
    ndays = calendar.monthrange(y, m)[1]

    # số ngày phát sinh đơn: bán càng nhiều thì rải càng rộng
    u = max(1, int(round(r['u'])))
    n_days = max(1, min(ndays, int(round(u * rnd.uniform(0.35, 0.8)))))

    # chọn ngày theo trọng số
    weights = []
    for d in range(1, ndays + 1):
        dow = calendar.weekday(y, m, d)
        weights.append(DOW[dow] * sale_boost(y, m, d) * rnd.uniform(0.6, 1.4))
    days = rnd.choices(range(1, ndays + 1), weights=weights, k=n_days)
    days = sorted(set(days)) or [rnd.randint(1, ndays)]

    # tỷ trọng từng ngày rồi chuẩn hoá để tổng đúng bằng tháng
    parts = [DOW[calendar.weekday(y, m, d)] * sale_boost(y, m, d) * rnd.uniform(0.5, 1.6) for d in days]
    tot = sum(parts)
    share = [p / tot for p in parts]

    for i, d in enumerate(days):
        s = share[i]
        rows.append({
            'sku': r['sku'],
            'd': f"{y}-{m:02d}-{d:02d}",
            'un': round(r['un'] * s, 3),
            'u': round(r['u'] * s, 3),
            'rev': round(r['rev'] * s),
            'gmv': round(r['gmv'] * s),
            'cogs': round(r['cogs'] * s),
            'o': round(r['o'] * s, 3),
        })

out = {
    'meta': {
        'kind': 'MOCK',
        'note': 'DỮ LIỆU NGÀY GIẢ — phân bổ từ sales_mock.json, tổng theo tháng giữ nguyên.',
        'seed': 20260908, 'rows': len(rows),
    },
    'months': MONTHS,
    'rows': rows,
}
with open(os.path.join(BASE, 'sales_daily_mock.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

# đối chiếu tổng
m_rev = {}
for r in sales['rows']:
    m_rev[MONTHS[r['m']]] = m_rev.get(MONTHS[r['m']], 0) + r['rev']
d_rev = {}
for r in rows:
    k = r['d'][:7].replace('-', '.')
    d_rev[k] = d_rev.get(k, 0) + r['rev']
diff = max(abs(m_rev[k] - d_rev.get(k, 0)) / max(1, m_rev[k]) for k in m_rev)
print(f"OK -> {len(rows)} dòng ngày · lệch tổng tháng tối đa {diff*100:.4f}%")
