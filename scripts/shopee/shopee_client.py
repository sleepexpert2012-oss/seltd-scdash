"""Client tối thiểu cho Shopee Open API v2: ký request, lấy/refresh token."""
import hashlib, hmac, json, time, os, urllib.parse, urllib.request

HOST = 'https://partner.shopeemobile.com'
BASE = os.path.join(os.path.dirname(__file__), '..', '..', 'secrets')
CRED = os.path.join(BASE, 'shopee.json')

def load():
    with open(CRED) as f:
        return json.load(f)

def save(d):
    os.makedirs(BASE, exist_ok=True)
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
