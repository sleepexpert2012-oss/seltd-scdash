import { useMemo } from 'react'
import Icon from './Icon'
import { MONTHS as DATA_MONTHS, TRENDS, pickRows, monthlySeries } from '../lib/metrics'

/* Danh sách tháng tạm theo phạm vi dữ liệu dự kiến (2025.01 → 2026.09).
   Khi nạp dữ liệu bán thật, danh sách này sẽ sinh từ chính dữ liệu. */
export const MONTHS = DATA_MONTHS

export const PRESETS = [
  { id: '3t', label: '3T', months: 3 },
  { id: '6t', label: '6T', months: 6 },
  { id: '12t', label: '12T', months: 12 },
  { id: 'ytd', label: 'YTD 26', months: null },
  { id: 'all', label: 'Toàn kỳ', months: null },
]

export const defaultFilters = () => ({
  preset: '6t',
  from: MONTHS[MONTHS.length - 6],
  to: MONTHS[MONTHS.length - 1],
  compare: 'prev',
  nganh: '',
  loaiHinh: '',
  supplier: '',
  kenh: '',
  q: '',
  trend: [],
})

export default function FilterBar({ dims, filters, setFilters }) {
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }))

  function applyPreset(p) {
    const last = MONTHS.length - 1
    let fromIdx = 0
    if (p.months) fromIdx = Math.max(0, last - p.months + 1)
    else if (p.id === 'ytd') fromIdx = MONTHS.indexOf('2026.01')
    setFilters(f => ({ ...f, preset: p.id, from: MONTHS[fromIdx], to: MONTHS[last] }))
  }

  const activeCount = ['nganh', 'loaiHinh', 'supplier', 'kenh', 'q']
    .filter(k => filters[k]).length + (filters.trend?.length ? 1 : 0)

  const toggleTrend = id => setFilters(f => {
    const cur = f.trend || []
    return { ...f, trend: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] }
  })

  /* Dải tháng: doanh thu từng tháng trên TOÀN BỘ lịch sử, áp mọi bộ lọc trừ khoảng thời gian */
  const strip = useMemo(() => {
    const all = [0, MONTHS.length - 1]
    const rows = pickRows({ ...filters, from: undefined, to: undefined }, all)
    const ser = monthlySeries(rows, all)
    const max = Math.max(1, ...ser.map(r => r.rev))
    const a = MONTHS.indexOf(filters.from), b = MONTHS.indexOf(filters.to)
    return ser.map((r, i) => ({
      label: MONTHS[i], rev: r.rev, h: Math.max(4, Math.round((r.rev / max) * 100)),
      inRange: i >= a && i <= b,
    }))
  }, [filters])

  return (
    <div className="filters">
      <div className="filter-head">
        <div>
          <Icon name="filter" size={14} />
          <b>Phạm vi phân tích</b>
          <span>{activeCount > 0 ? `${activeCount} bộ lọc` : 'Toàn bộ'}</span>
        </div>
        <div className="preset-row">
          {PRESETS.map(p => (
            <button key={p.id}
              className={'chip' + (filters.preset === p.id ? ' on' : '')}
              onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
          <button className="link-btn" onClick={() => setFilters(defaultFilters())}>
            <Icon name="reset" size={13} /> Đặt lại
          </button>
        </div>
      </div>

      <div className="filter-grid">
        <label>Từ tháng
          <select value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value, preset: '' }))}>
            {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>Đến tháng
          <select value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value, preset: '' }))}>
            {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>So sánh với
          <select value={filters.compare} onChange={e => set('compare', e.target.value)}>
            <option value="prev">Kỳ liền trước</option>
            <option value="yoy">Cùng kỳ năm trước</option>
            <option value="none">Không so sánh</option>
          </select>
        </label>
        <label>Ngành hàng
          <select value={filters.nganh} onChange={e => set('nganh', e.target.value)}>
            <option value="">Tất cả</option>
            {dims.nganh.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label>Loại hình
          <select value={filters.loaiHinh} onChange={e => set('loaiHinh', e.target.value)}>
            <option value="">Tất cả</option>
            {dims.loaiHinh.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label>Nhà cung cấp
          <select value={filters.supplier} onChange={e => set('supplier', e.target.value)}>
            <option value="">Tất cả</option>
            {dims.brand.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label>Kênh bán
          <select value={filters.kenh} onChange={e => set('kenh', e.target.value)}>
            <option value="">Tất cả</option>
            <option value="shopee">Shopee</option>
          </select>
        </label>
        <label className="search-label">Tìm kiếm
          <span className="search-wrap">
            <Icon name="search" size={13} />
            <input value={filters.q} onChange={e => set('q', e.target.value)}
              placeholder="SKU, tên sản phẩm..." />
          </span>
        </label>
      </div>

      <div className="trend-row">
        <div className="trend-chips">
          <span className="trend-title">Phân loại xu hướng</span>
          {TRENDS.map(t => (
            <button key={t.id}
              className={'chip' + (filters.trend?.includes(t.id) ? ' on' : '')}
              onClick={() => toggleTrend(t.id)}>{t.label}</button>
          ))}
          {filters.trend?.length > 0 && (
            <button className="link-btn" onClick={() => setFilters(f => ({ ...f, trend: [] }))}>Bỏ lọc</button>
          )}
        </div>
        <div className="strip-state">
          Kỳ chọn: <b>{filters.from} → {filters.to}</b>
          {' · '}So sánh: <b>{filters.compare === 'prev' ? 'kỳ liền trước'
            : filters.compare === 'yoy' ? 'cùng kỳ năm trước' : 'không so sánh'}</b>
        </div>
      </div>

      <div className="month-strip">
        <div className="bars">
          {strip.map(m => (
            <button key={m.label}
              className={'mbar' + (m.inRange ? ' on' : '')}
              onClick={() => setFilters(f => ({ ...f, from: m.label, to: m.label, preset: '' }))}
              title={`${m.label} · ${Math.round(m.rev / 1e6).toLocaleString('vi-VN')} triệu`}>
              <i style={{ height: `${m.h}%` }} />
              <em>{m.label.slice(2)}</em>
            </button>
          ))}
        </div>
        <div className="strip-foot">
          <span className="strip-legend">
            <i className="hist" />Ngoài kỳ
            <i className="sel" />Kỳ đang chọn
          </span>
          <span>Bấm vào một cột để xem riêng tháng đó</span>
        </div>
      </div>

      <p className="filter-note">
        Cột đậm = kỳ đang chọn · cột nhạt = ngoài kỳ. Đơn vị hiển thị: triệu đồng, trừ khi ghi khác.
        Khi hai kỳ khác số tháng, phần so sánh quy về trung bình tháng.
      </p>
    </div>
  )
}
