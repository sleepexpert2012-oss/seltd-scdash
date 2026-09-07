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
