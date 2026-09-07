/* Điểm truy cập duy nhất tới Master Data.
   App là trang tĩnh nên không ghi được file lên server. Khi người dùng nhập file
   Excel ở màn Cơ sở hạ tầng, bản nạp được lưu vào localStorage của chính trình
   duyệt đó và dùng thay bản đóng kèm — không ảnh hưởng người khác, và bấm
   "hoàn nguyên" là về lại bản gốc. */
import bundled from './master.json'

const KEY = 'seltd_master_override'

function readOverride() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const o = JSON.parse(raw)
    if (!o || !Array.isArray(o.skus) || !o.skus.length) return null
    return o
  } catch {
    return null
  }
}

const override = readOverride()
const master = override || bundled

export default master
export const MASTER_BUNDLED = bundled
export const MASTER_IS_OVERRIDE = !!override
export const MASTER_OVERRIDE_AT = override?.meta?.importedAt || null

export function setMasterOverride(obj) {
  localStorage.setItem(KEY, JSON.stringify(obj))
}
export function clearMasterOverride() {
  localStorage.removeItem(KEY)
}
