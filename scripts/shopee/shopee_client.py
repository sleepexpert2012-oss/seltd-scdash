"""Client tối thiểu cho Shopee Open API v2: ký request, lấy/refresh token."""
import hashlib, hmac, json, time, os, urllib.parse, urllib.request

HOST = 'https://partner.shopeemobile.com'
BASE = os.path.join(os.path.dirname(__file__), '..', '..', 'secrets')
CRED = os.path.join(BASE, 'shopee.json')

def _static():
    """partner_id / partner_key / shop_id: biến môi trường trước, file sau.

    Trên GitHub Actions không có file secrets/ nên lấy từ secret của repo.
    """
    e = os.environ
    if e.get('SHOPEE_PARTNER_ID') and e.get('SHOPEE_PARTNER_KEY') and e.get('SHOPEE_SHOP_ID'):
        return {'partner_id': int(e['SHOPEE_PARTNER_ID']),
                'partner_key': e['SHOPEE_PARTNER_KEY'],
                'shop_id': int(e['SHOPEE_SHOP_ID']),
                'region': e.get('SHOPEE_REGION', 'VN')}
    with open(CRED) as f:
        return json.load(f)

TOKF = ('access_token', 'refresh_token', 'token_at', 'expire_in')
_C = None          # cache trong tiến trình: call() gọi load() mỗi request

def _db_get(shop_id):
    import db
    with db.connect() as c, c.cursor() as cur:
        cur.execute('select access_token, refresh_token, token_at, expire_in '
                    'from shopee.oauth_token where shop_id = %s', (shop_id,))
        r = cur.fetchone()
    return dict(zip(TOKF, r)) if r else None

def _db_put(c, who):
    import db
    with db.connect() as cn, cn.cursor() as cur:
        cur.execute("""insert into shopee.oauth_token
            (shop_id, access_token, refresh_token, token_at, expire_in, updated_by)
            values (%s,%s,%s,%s,%s,%s)
            on conflict (shop_id) do update set
              access_token = excluded.access_token,
              refresh_token = excluded.refresh_token,
              token_at = excluded.token_at,
              expire_in = excluded.expire_in,
              updated_by = excluded.updated_by,
              updated_at = now()""",
            (int(c['shop_id']), c['access_token'], c['refresh_token'],
             int(c['token_at']), int(c.get('expire_in', 14400)), who))
        cn.commit()

def load():
    """Thông tin tĩnh từ env/file + token từ DB (DB là bản gốc).

    access_token hết hạn 4h và refresh_token tự đổi mỗi lần refresh, nên token
    không thể nằm trong secret hay trong file: máy nào chạy job cũng phải đọc
    và ghi chung một chỗ.
    """
    global _C
    if _C:
        return _C
    c = _static()
    try:
        tok = _db_get(int(c['shop_id']))
        if tok:
            c.update(tok)
    except Exception as e:
        print(f'[token] không đọc được từ DB, dùng bản trong file: {e}', flush=True)
    _C = c
    return c

def save(d):
    global _C
    _C = d
    who = os.environ.get('RUNNER_NAME') and 'github-actions' or 'may-local'
    try:
        _db_put(d, who)
    except Exception as e:
        # Ghi DB thất bại là nghiêm trọng: lượt sau sẽ dùng refresh_token cũ đã
        # bị Shopee vô hiệu -> phải báo to, không im lặng.
        print(f'[token] LỖI: không ghi được token vào DB ({e}) — '
              f'lượt chạy sau có thể mất quyền', flush=True)
    if os.path.isdir(BASE):        # máy local: giữ file khớp để chạy tay vẫn được
        with open(CRED, 'w') as f:
            json.dump(d, f, indent=1)
        os.chmod(CRED, 0o600)

def sign(path, ts, partner_id, key, access_token='', shop_id=''):
    base = f"{partner_id}{path}{ts}{access_token}{shop_id}"
    return hmac.new(key.encode(), base.encode(), hashlib.sha256).hexdigest()

def call(path, method='GET', params=None, body=None, shop=True):
    c = load()
    ts = int(time.time())
    if shop:
        s = sign(path, ts, c['partner_id'], c['partner_key'], c['access_token'], c['shop_id'])
        q = {'partner_id': c['partner_id'], 'timestamp': ts, 'sign': s,
             'access_token': c['access_token'], 'shop_id': c['shop_id']}
    else:
        s = sign(path, ts, c['partner_id'], c['partner_key'])
        q = {'partner_id': c['partner_id'], 'timestamp': ts, 'sign': s}
    q.update(params or {})
    url = f"{HOST}{path}?{urllib.parse.urlencode(q, doseq=True)}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())

def exchange_code(code, shop_id):
    c = load()
    r = call('/api/v2/auth/token/get', 'POST',
             body={'code': code, 'shop_id': int(shop_id), 'partner_id': c['partner_id']}, shop=False)
    if r.get('access_token'):
        c.update({'access_token': r['access_token'], 'refresh_token': r['refresh_token'],
                  'shop_id': int(shop_id), 'token_at': int(time.time()), 'expire_in': r.get('expire_in')})
        save(c)
    return r

def refresh():
    c = load()
    r = call('/api/v2/auth/access_token/get', 'POST',
             body={'refresh_token': c['refresh_token'], 'shop_id': int(c['shop_id']),
                   'partner_id': c['partner_id']}, shop=False)
    if r.get('access_token'):
        c.update({'access_token': r['access_token'], 'refresh_token': r['refresh_token'],
                  'token_at': int(time.time()), 'expire_in': r.get('expire_in')})
        save(c)
    return r

def ensure_token(margin=600):
    """Tự refresh access_token nếu sắp hết hạn (mặc định còn <10 phút)."""
    global _C
    _C = None          # đọc lại từ DB: máy khác có thể vừa refresh xong
    c = load()
    age = int(time.time()) - int(c.get('token_at', 0))
    if age > int(c.get('expire_in', 14400)) - margin:
        r = refresh()
        if not r.get('access_token'):
            raise RuntimeError(f"refresh token thất bại: {r}")
        return True
    return False

def call_ok(path, method='GET', params=None, body=None, retry=3):
    """call() + ensure_token + retry khi lỗi mạng/limit. Raise nếu API trả error."""
    ensure_token()
    last = None
    for i in range(retry):
        try:
            r = call(path, method, params, body)
        except Exception as e:                       # lỗi mạng / 5xx
            last = e; time.sleep(2 * (i + 1)); continue
        err = r.get('error') or ''
        if not err:
            return r
        if 'token' in err.lower():                   # token hỏng -> refresh rồi thử lại
            refresh(); time.sleep(1); continue
        raise RuntimeError(f"{path} -> {err}: {r.get('message')}")
    raise RuntimeError(f"{path} thất bại sau {retry} lần: {last}")
