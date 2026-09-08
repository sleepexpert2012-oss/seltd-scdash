"""Kết nối Supabase Postgres (session pooler, IPv4) + helper upsert jsonb."""
import json, os, datetime as dt
import psycopg
from psycopg.types.json import Jsonb

CRED = os.path.join(os.path.dirname(__file__), '..', '..', 'secrets', 'supabase.json')

def dsn():
    """Chuỗi kết nối: biến môi trường trước, file secrets sau.

    Trên GitHub Actions không có file secrets/ (đã gitignore) nên phải lấy từ
    secret SUPABASE_DSN; ở máy local vẫn đọc file như cũ.
    """
    env = os.environ.get('SUPABASE_DSN')
    if env:
        return env
    with open(CRED) as f:
        return json.load(f)['dsn']

def connect():
    return psycopg.connect(dsn(), connect_timeout=20)

def ts(v):
    """epoch giây -> timestamptz; None/0 -> None."""
    if not v:
        return None
    return dt.datetime.fromtimestamp(int(v), dt.timezone.utc)

def J(v):
    return Jsonb(v)

def upsert(cur, table, cols, rows, key):
    """INSERT ... ON CONFLICT (key) DO UPDATE — ghi đè toàn bộ cột còn lại."""
    if not rows:
        return 0
    ph = '(' + ','.join(['%s'] * len(cols)) + ')'
    upd = ','.join(f'{c}=excluded.{c}' for c in cols if c not in key)
    sql = (f"insert into {table} ({','.join(cols)}) values {ph} "
           f"on conflict ({','.join(key)}) do update set {upd}")
    cur.executemany(sql, rows)
    return len(rows)

class Run:
    """Ghi nhật ký 1 lần chạy job vào shopee.etl_run."""
    def __init__(self, conn, job, w_from=None, w_to=None):
        self.c, self.job, self.f, self.t, self.n = conn, job, w_from, w_to, 0
    def __enter__(self):
        with self.c.cursor() as cur:
            cur.execute("insert into shopee.etl_run (job, window_from, window_to) "
                        "values (%s,%s,%s) returning id", (self.job, self.f, self.t))
            self.id = cur.fetchone()[0]
        self.c.commit()
        return self
    def __exit__(self, et, ev, tb):
        with self.c.cursor() as cur:
            cur.execute("update shopee.etl_run set finished_at=now(), rows_in=%s, ok=%s, note=%s "
                        "where id=%s", (self.n, et is None, None if et is None else str(ev)[:500], self.id))
        self.c.commit()
        return False
