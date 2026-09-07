"""Trích Master Data.xlsx (thư mục dự án OneDrive) -> src/data/master.json
Chỉ lấy dữ liệu SẢN PHẨM thật: SKU, ngành, loại hình, NCC, giá vốn, kho.
Chạy lại khi file Excel gốc đổi:  python3 scripts/extract_master.py
"""
import json, os, warnings
import pandas as pd
warnings.filterwarnings('ignore')

SRC = ("/Users/louisle/Library/CloudStorage/OneDrive-Personal/SE LTD/"
       "0. General Document/10. Report/SELTD Supply Chain Dashboard/Master Data.xlsx")
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'master.json')

md = pd.read_excel(SRC, sheet_name='1. Master Data', header=6)
md = md.drop(columns=[c for c in md.columns if str(c).startswith('Unnamed')], errors='ignore')
md = md.dropna(subset=['SKU'])
md = md.rename(columns={'Tên Sản Phẩm & kích thước (Cao x Rộng x Dài - cm)': 'Tên Sản Phẩm & kích thước'})

sup = pd.read_excel(SRC, sheet_name='0. Mã Supplier', header=4)
sup.columns = [str(c).split('\n')[0].strip() for c in sup.columns]
sup = sup.dropna(subset=['Supplier Code'])
wh  = pd.read_excel(SRC, sheet_name='Mã Kho').dropna(subset=['Mã kho'])
po  = pd.read_excel(SRC, sheet_name='4. Purchasing').dropna(how='all')

def num(v):
    try:
        f = float(v)
        return None if pd.isna(f) else f
    except Exception:
        return None

skus = []
for _, r in md.iterrows():
    skus.append({
        'sku': str(r['SKU']).strip(),
        'classCode': str(r['Mã sản phẩm']).strip(),
        'className': str(r['Subcategory name']).strip(),
        'name': str(r['Tên Sản Phẩm & kích thước']).strip(),
        'variant': str(r['Variation name']).strip(),
        'cat': str(r['Category']).strip(),
        'nganh': str(r['Ngành hàng']).strip(),
        'supplierCode': str(r['Supplier Code']).strip(),
        'brand': str(r['Brand']).strip(),
        'unitCost': num(r['Unit Cost (vnd)']) or 0,
        'costVat': num(r['Giá Vốn (+VAT)']) or 0,
        'salesPrice': num(r['Sales Price (vnd)']),
        'w': num(r['Rộng']) or 0,
        'l': num(r['Dài']) or 0,
        'h': (str(r['Cao']).strip() if pd.notna(r['Cao']) else ''),
        'moq': num(r['Min. Order']) or 1,
        'm3': num(r['M3']),
    })

suppliers = [{
    'code': str(r['Supplier Code']).strip(),
    'name': str(r['Supplier Name']).strip(),
    'location': (str(r['Location']).strip() if pd.notna(r['Location']) else ''),
    'paymentTerms': num(r['Payment Terms']),
} for _, r in sup.iterrows()]

warehouses = [{
    'code': str(r['Mã kho']).strip(),
    'name': str(r['Tên kho']).strip(),
    'type': str(r['Loại kho']).strip(),
} for _, r in wh.iterrows()]

pos = []
for _, r in po.iterrows():
    dt = lambda v: (v.strftime('%Y-%m-%d') if pd.notna(v) else None)
    pos.append({
        'po': str(r['PO']).strip(),
        'sku': str(r['Code']).strip(),
        'supplier': str(r['Supplier']).strip(),
        'qtyOrder': num(r['Qty order']) or 0,
        'qtyConfirm': num(r['Qty confirm']) or 0,
        'cost': num(r['Cost']) or 0,
        'totalCost': num(r['Total Cost']) or 0,
        'totalCostVat': num(r['Total Cost\n(VAT)']) or 0,
        'dateReceive': dt(r['Date Receive']),
        'invoiceDate': dt(r['Invoice Date']),
        'dueDate': dt(r['Due Date']),
        'paymentTerms': num(r['Payment Terms']),
        'daysOverdue': num(r['Days Overdue']) or 0,
        'paid': num(r['Paid Amount']) or 0,
        'paidFlag': (str(r['Payment status']).strip() if pd.notna(r['Payment status']) else ''),
        'outstanding': num(r['Outstanding Amount']) or 0,
    })

# danh mục dùng cho bộ lọc — lấy đúng thứ tự theo số SKU giảm dần
def cats(col):
    return [str(x) for x in md[col].value_counts().index.tolist()]

data = {
    'meta': {
        'source': 'Master Data.xlsx',
        'skuCount': len(skus),
        'note': 'Dữ liệu sản phẩm thật. Bán hàng & tồn kho hiện dùng dữ liệu giả.',
    },
    'dims': {
        'nganh': cats('Ngành hàng'),
        'loaiHinh': cats('Subcategory name'),
        'brand': cats('Brand'),
    },
    'skus': skus,
    'suppliers': suppliers,
    'warehouses': warehouses,
    'purchaseOrders': pos,
}

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
print(f"OK -> {len(skus)} SKU · {len(suppliers)} NCC · {len(warehouses)} kho · {len(pos)} dòng PO")
