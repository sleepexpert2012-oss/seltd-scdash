"""Nạp danh mục SKU từ Master Data (master.json) vào shopee.dim_sku
để các view mart tự tính được COGS/ngành hàng ngay trong SQL."""
import sys, os, json, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
import db

MASTER = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'data', 'master.json')

DDL = """
create table if not exists shopee.dim_sku (
  sku           text primary key,
  class_code    text,
  class_name    text,
  name          text,
  variant       text,
  cat           text,
  nganh         text,
  supplier_code text,
  brand         text,
  unit_cost     numeric,
  cost_vat      numeric,
  sales_price   numeric,
  w text, l text, h text,   -- Master Data có giá trị dạng '8/10' nên để text
  loaded_at     timestamptz not null default now()
);
alter table shopee.dim_sku enable row level security;
"""

COLS = ['sku', 'class_code', 'class_name', 'name', 'variant', 'cat', 'nganh',
        'supplier_code', 'brand', 'unit_cost', 'cost_vat', 'sales_price',
        'w', 'l', 'h', 'loaded_at']

def main():
    m = json.load(open(MASTER))
    now = dt.datetime.now(dt.timezone.utc)
    rows = [(s['sku'], s.get('classCode'), s.get('className'), s.get('name'),
             s.get('variant'), s.get('cat'), s.get('nganh'), s.get('supplierCode'),
             s.get('brand'), s.get('unitCost'), s.get('costVat'), s.get('salesPrice'),
             s.get('w'), s.get('l'), s.get('h'), now) for s in m['skus']]
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(DDL)
        n = db.upsert(cur, 'shopee.dim_sku', COLS, rows, ['sku'])
        conn.commit()
    print('dim_sku:', n, 'SKU')

if __name__ == '__main__':
    main()
