/* ============================================================
   ĐỒNG BỘ TỒN ẢO QUA SUPABASE
   App là trang tĩnh nên không có server trung gian: trình duyệt gọi thẳng
   Supabase REST bằng khoá publishable.

   KHOÁ NÀY LÀ CÔNG KHAI (repo public) — đây là lựa chọn đã được duyệt để có
   đồng bộ tức thời. Vì vậy phía database đã siết:
     · chỉ schema public được phơi ra API; dữ liệu Shopee ở schema shopee KHÔNG phơi
     · anon CHỈ ĐỌC bảng phantom_stock, không ghi/xoá trực tiếp được
     · đường ghi duy nhất là hàm set_phantom(), luôn ghi lịch sử
     · bảng lịch sử chỉ thêm, không cho sửa/xoá -> nếu bị phá vẫn khôi phục được
   ============================================================ */
const URL_BASE = 'https://bgatjlriolfrxsdmxgrd.supabase.co/rest/v1'
const KEY = 'sb_publishable_Gx22nAMNn3OcAjP5NbhXIg_PM6kPtOx'

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
}

const PH_CACHE = 'seltd_phantom'          // cùng key metrics.js đọc
const PH_META = 'seltd_phantom_meta'
const DEV_KEY = 'seltd_device'

/* Tên máy để biết ai đổi số — không có đăng nhập nên tự đặt, sửa được ở màn Tồn ảo */
export function deviceName() {
  try {
    let d = localStorage.getItem(DEV_KEY)
    if (!d) {
      d = 'Máy ' + Math.random().toString(36).slice(2, 6).toUpperCase()
      localStorage.setItem(DEV_KEY, d)
    }
    return d
  } catch { return 'Máy không rõ' }
}
export function setDeviceName(v) {
  try { localStorage.setItem(DEV_KEY, String(v || '').slice(0, 40) || deviceName()) } catch { /* bỏ qua */ }
}

async function req(path, { method = 'GET', body, timeout = 12000 } = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeout)
  try {
    const r = await fetch(URL_BASE + path, {
      method, headers: H, signal: ctl.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const txt = await r.text()
    if (!r.ok) throw new Error(`${r.status} ${txt.slice(0, 180)}`)
    return txt ? JSON.parse(txt) : null
  } finally { clearTimeout(t) }
}

export const cloudMeta = () => {
  try { return JSON.parse(localStorage.getItem(PH_META) || 'null') } catch { return null }
}

/* Đọc bảng tồn ảo trên đám mây */
export async function fetchPhantom() {
  const rows = await req('/phantom_stock?select=sku,qty,updated_at,updated_by&order=sku')
  const items = {}
  let at = null, by = null
  for (const r of rows || []) {
    items[r.sku] = r.qty
    if (!at || r.updated_at > at) { at = r.updated_at; by = r.updated_by }
  }
  return { items, at, by }
}

/* Ghi — thay toàn bộ danh sách trong 1 giao dịch, luôn để lại dấu trong lịch sử */
export async function pushPhantom(items, actor = deviceName()) {
  const res = await req('/rpc/set_phantom', { method: 'POST', body: { items, actor } })
  const r = Array.isArray(res) ? res[0] : res
  writeCache(items, { at: r?.saved_at || new Date().toISOString(), by: actor, ok: true })
  return r
}

export async function fetchPhantomLog(limit = 30) {
  return (await req(`/phantom_stock_log?select=id,at,actor,action,items,units,payload&order=id.desc&limit=${limit}`)) || []
}

function writeCache(items, meta) {
  try {
    localStorage.setItem(PH_CACHE, JSON.stringify(items || {}))
    localStorage.setItem(PH_META, JSON.stringify({ ...meta, syncedAt: new Date().toISOString() }))
  } catch { /* bỏ qua */ }
}

/* Gọi TRƯỚC khi mount React: nạp số mới nhất từ đám mây vào cache để
   metrics.js (đọc đồng bộ lúc khởi tạo) thấy đúng số ngay lần vẽ đầu.
   Mất mạng thì dùng cache lần trước, không có cache thì dùng file trong repo. */
export async function syncPhantomBeforeBoot() {
  try {
    const { items, at, by } = await fetchPhantom()
    writeCache(items, { at, by, ok: true })
    return { ok: true, n: Object.keys(items).length }
  } catch (e) {
    try {
      const m = cloudMeta()
      localStorage.setItem(PH_META, JSON.stringify({ ...(m || {}), ok: false, error: String(e).slice(0, 160) }))
    } catch { /* bỏ qua */ }
    return { ok: false, error: String(e) }
  }
}

/* ============================================================
   KẾ HOẠCH DÒNG TIỀN THEO TUẦN
   Cùng cơ chế với tồn ảo: anon chỉ ĐỌC bảng, mọi ghi đi qua set_cashflow().
   Khác một điểm quan trọng: hàm ghi chỉ ĐÈ những tuần được gửi, không xoá tuần
   khác — để hai người sửa hai tuần khác nhau không đạp lên nhau.
   ============================================================ */
const CF_CACHE = 'seltd_cashflow'
const CF_META = 'seltd_cashflow_meta'

export const cashflowMeta = () => {
  try { return JSON.parse(localStorage.getItem(CF_META) || 'null') } catch { return null }
}
export const cashflowCache = () => {
  try { return JSON.parse(localStorage.getItem(CF_CACHE) || 'null') } catch { return null }
}

export async function fetchCashflow() {
  const rows = await req('/cashflow_week?select=wk,data,updated_at,updated_by&order=wk')
  const weeks = {}
  let at = null, by = null
  for (const r of rows || []) {
    weeks[r.wk] = r.data || {}
    if (!at || r.updated_at > at) { at = r.updated_at; by = r.updated_by }
  }
  try {
    localStorage.setItem(CF_CACHE, JSON.stringify(weeks))
    localStorage.setItem(CF_META, JSON.stringify({ at, by, syncedAt: new Date().toISOString() }))
  } catch { /* bỏ qua */ }
  return { weeks, at, by }
}

export async function pushCashflow(weeks, actor = deviceName()) {
  const arr = Object.entries(weeks || {}).map(([wk, data]) => ({ wk, data }))
  const res = await req('/rpc/set_cashflow', { method: 'POST', body: { weeks: arr, actor } })
  const r = Array.isArray(res) ? res[0] : res
  try {
    const cur = cashflowCache() || {}
    localStorage.setItem(CF_CACHE, JSON.stringify({ ...cur, ...weeks }))
    localStorage.setItem(CF_META, JSON.stringify({
      at: r?.saved_at || new Date().toISOString(), by: actor, syncedAt: new Date().toISOString(),
    }))
  } catch { /* bỏ qua */ }
  return r
}

export async function fetchCashflowLog(limit = 30) {
  return (await req(`/cashflow_log?select=id,at,actor,action,weeks&order=id.desc&limit=${limit}`)) || []
}

/* ============================================================
   BÁN HÀNG ĐẠI LÝ — danh mục, đơn hàng, phiếu xuất, thanh toán
   Cùng cơ chế: anon chỉ ĐỌC bảng, mọi ghi đi qua hàm SECURITY DEFINER.
   ============================================================ */
const rpc = (fn, body) => req(`/rpc/${fn}`, { method: 'POST', body })

export const saveCustomer = (p, actor = deviceName()) => rpc('save_customer', { p, actor })
export const saveSupplier = (p, actor = deviceName()) => rpc('save_supplier', { p, actor })
export const saveOrder = (p, lines, actor = deviceName()) => rpc('save_order', { p, lines, actor })
export const delOrder = (code, actor = deviceName()) => rpc('del_order', { p_code: code, actor })
export const saveDelivery = (p, lines, actor = deviceName()) => rpc('save_delivery', { p, lines, actor })
export const delDelivery = (pxk, actor = deviceName()) => rpc('del_delivery', { p_pxk: pxk, actor })
export const addPayment = (cust, d, amount, note, actor = deviceName()) =>
  rpc('add_ar_payment', { p_cust: cust, d, amount, note, actor })
export const delPayment = (id, actor = deviceName()) => rpc('del_ar_payment', { row_id: id, actor })

/* Đọc lại toàn bộ khối bán hàng sau khi ghi — rẻ vì dữ liệu nhỏ, và tránh
   việc màn hình và đám mây lệch nhau do cập nhật cục bộ sai sót. */
export async function fetchSales() {
  const [customers, deliveries, deliveryLines, payments, orders, orderLines, suppliersExtra] =
    await Promise.all([
      req('/ar_customer?select=code,name,term_days,vat_rate,mst,addr,phone,email,note,active&order=code'),
      req('/ar_delivery?select=pxk,cust,d,amount,note,don,invoice_no,qty&order=d'),
      req('/ar_delivery_line?select=pxk,sku,qty,price,amount,note&order=pxk,id'),
      req('/ar_payment?select=id,cust,d,amount,method,doc_no,note&order=d,id'),
      req('/ar_order?select=code,cust,d,note,status&order=d'),
      req('/ar_order_line?select=code,sku,qty,price,disc,amount,note&order=code,id'),
      req('/supplier_extra?select=code,name,mst,phone,email,addr,term_days,note,active&order=code'),
    ])
  return { customers, deliveries, deliveryLines, payments, orders, orderLines, suppliersExtra }
}

/* ============================================================
   KẾ HOẠCH & NGÂN SÁCH (bảng fin_*)
   Cùng cơ chế: anon chỉ ĐỌC, mọi ghi qua hàm save_fin_*() và luôn ghi fin_log.
   Đọc theo trang 1.000 dòng: Supabase cắt mọi truy vấn ở 1.000 dòng mà KHÔNG
   báo lỗi — 4 phiên bản × 12 tháng × 20 khoản đã chạm ngưỡng đó.
   ============================================================ */
async function reqAll(path, page = 1000) {
  const out = []
  for (let off = 0; ; off += page) {
    const rows = (await req(`${path}&limit=${page}&offset=${off}`)) || []
    out.push(...rows)
    if (rows.length < page) return out
  }
}

export async function fetchFin() {
  const [lines, versions, plan, actual] = await Promise.all([
    req('/fin_line?select=code,name,grp,behavior,source,cap_pct,sort,active,note,updated_at,updated_by&order=sort,code'),
    req('/fin_plan_version?select=version,name,year,is_current,note,created_at,created_by&order=year.desc,created_at'),
    reqAll('/fin_plan?select=version,ym,line,amount,updated_at,updated_by&order=version,ym,line'),
    reqAll('/fin_actual?select=ym,line,amount,note,updated_at,updated_by&order=ym,line'),
  ])
  return { lines: lines || [], versions: versions || [], plan, actual }
}

const one = r => (Array.isArray(r) ? r[0] : r)

export async function saveFinLine(p, actor = deviceName()) {
  return req('/rpc/save_fin_line', { method: 'POST', body: { p, actor } })
}
export async function saveFinVersion(p, cloneFrom = null, actor = deviceName()) {
  return one(await req('/rpc/save_fin_version', { method: 'POST', body: { p, clone_from: cloneFrom, actor } }))
}
export async function setFinCurrentVersion(version, actor = deviceName()) {
  return req('/rpc/set_fin_current_version', { method: 'POST', body: { p_version: version, actor } })
}
/* cells = [{ ym, line, amount }] — amount null là xoá ô */
export async function saveFinPlan(version, cells, actor = deviceName()) {
  return one(await req('/rpc/save_fin_plan', { method: 'POST', body: { p_version: version, cells, actor } }))
}
export async function saveFinActual(cells, actor = deviceName()) {
  return one(await req('/rpc/save_fin_actual', { method: 'POST', body: { cells, actor } }))
}
export async function fetchFinLog(limit = 30) {
  return (await req(`/fin_log?select=id,at,actor,action,n,payload&order=id.desc&limit=${limit}`)) || []
}

/* ============================================================
   DÒNG TIỀN THEO THÁNG + VỐN LƯU ĐỘNG (bảng cf_setting, wc_snapshot)
   Bảng chưa tạo (chưa chạy schema_wc.sql) → hàm đọc trả về null để màn
   dùng bản lưu tại máy và nói rõ là chưa lưu chung.
   ============================================================ */
const missingTable = e => /PGRST20[25]|does not exist|Could not find|404/.test(String(e?.message || e))

export async function fetchCfSetting(key) {
  try {
    const r = await req(`/cf_setting?select=value,updated_at,updated_by&key=eq.${encodeURIComponent(key)}`)
    return { ok: true, row: r?.[0] || null }
  } catch (e) {
    if (missingTable(e)) return { ok: false, row: null }
    throw e
  }
}
export async function setCfSetting(key, value, actor = deviceName()) {
  return req('/rpc/set_cf_setting', { method: 'POST', body: { p_key: key, p_value: value, actor } })
}
export async function fetchWcSnapshots() {
  try {
    return { ok: true, rows: (await req('/wc_snapshot?select=ym,as_of,data,updated_at,updated_by&order=ym')) || [] }
  } catch (e) {
    if (missingTable(e)) return { ok: false, rows: [] }
    throw e
  }
}
export async function saveWcSnapshot(ym, asOf, data, actor = deviceName()) {
  return req('/rpc/save_wc_snapshot', { method: 'POST', body: { p_ym: ym, p_as_of: asOf, p_data: data, actor } })
}

/* ============================================================
   BẢN DỰ BÁO ĐÃ CHỐT (bảng fc_*)
   ============================================================ */
export async function fetchFcSnapshots() {
  try {
    return { ok: true, rows: (await req('/fc_snapshot?select=*&order=created_at.desc')) || [] }
  } catch (e) {
    if (missingTable(e)) return { ok: false, rows: [] }
    throw e
  }
}
export async function fetchFcLines(id) {
  return reqAll(`/fc_snapshot_line?select=sku,ym,qty_calc,qty,price,cost&snapshot_id=eq.${Number(id)}&order=sku,ym`)
}
export async function createFcSnapshot(p, lines, actor = deviceName()) {
  return req('/rpc/create_fc_snapshot', { method: 'POST', body: { p, lines, actor }, timeout: 30000 })
}
export async function saveFcLines(id, cells, actor = deviceName()) {
  return req('/rpc/save_fc_lines', { method: 'POST', body: { p_id: id, cells, actor } })
}
export async function lockFcSnapshot(id, actor = deviceName()) {
  return req('/rpc/lock_fc_snapshot', { method: 'POST', body: { p_id: id, actor } })
}
export async function cloneFcSnapshot(id, name, actor = deviceName()) {
  return req('/rpc/clone_fc_snapshot', { method: 'POST', body: { p_id: id, p_name: name, actor } })
}
export async function delFcSnapshot(id, actor = deviceName()) {
  return req('/rpc/del_fc_snapshot', { method: 'POST', body: { p_id: id, actor } })
}

/* ============================================================
   BÁO CÁO ĐIỀU HÀNH ĐÃ LƯU (bảng report_doc)
   ============================================================ */
export async function fetchReports() {
  try {
    return { ok: true, rows: (await req('/report_doc?select=id,name,period_from,period_to,compare,note_html,hidden_ids,snapshot_json,saved_by,saved_at&order=saved_at.desc')) || [] }
  } catch (e) {
    if (missingTable(e)) return { ok: false, rows: [] }
    throw e
  }
}
export async function saveReport(p, actor = deviceName()) {
  return req('/rpc/save_report_doc', { method: 'POST', body: { p, actor } })
}
export async function delReport(id, actor = deviceName()) {
  return req('/rpc/del_report_doc', { method: 'POST', body: { p_id: id, actor } })
}

/* ============================================================
   CHIẾN LƯỢC & KPI — cấp phòng ban (bảng kpi_*)
   ============================================================ */
export async function fetchKpi() {
  try {
    const [depts, objs, defs, assigns, values] = await Promise.all([
      req('/kpi_dept?select=*&order=sort,code'),
      req('/kpi_objective?select=*&order=sort,id'),
      req('/kpi_def?select=*&order=source,code'),
      req('/kpi_assign?select=*&order=id'),
      reqAll('/kpi_value?select=assign_id,ym,target,actual&order=assign_id,ym'),
    ])
    return { ok: true, depts: depts || [], objs: objs || [], defs: defs || [], assigns: assigns || [], values }
  } catch (e) {
    if (missingTable(e)) return { ok: false, depts: [], objs: [], defs: [], assigns: [], values: [] }
    throw e
  }
}
const rpcKpi = fn => (p, actor = deviceName()) => req(`/rpc/${fn}`, { method: 'POST', body: { p, actor } })
export const saveKpiDept = rpcKpi('save_kpi_dept')
export const saveKpiObjective = rpcKpi('save_kpi_objective')
export const saveKpiDef = rpcKpi('save_kpi_def')
export const saveKpiAssign = rpcKpi('save_kpi_assign')
export async function saveKpiValues(cells, actor = deviceName()) {
  return req('/rpc/save_kpi_values', { method: 'POST', body: { cells, actor } })
}
