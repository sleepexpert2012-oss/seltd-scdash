import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts'
import {
  dailyOfMonth, byDayOfWeek, topSkuOfDay, DAILY_MONTHS, DOW_LABEL, DAILY_IS_MOCK,
} from '../lib/metrics'
import { trieu, num, pct } from '../lib/format'
import { useDrill } from '../app/drill'
import { SKU_MAP } from '../lib/metrics'
import './calendar.css'

const METRICS = [
  { id: 'rev', label: 'Doanh thu', unit: 'triệu', fmt: v => trieu(v), short: v => trieu(v, v / 1e6 < 10 ? 1 : 0) },
  { id: 'gmv', label: 'GMV', unit: 'triệu', fmt: v => trieu(v), short: v => trieu(v, v / 1e6 < 10 ? 1 : 0) },
  { id: 'un', label: 'Số lượng', unit: 'unit', fmt: v => num(Math.round(v)), short: v => num(Math.round(v)) },
  { id: 'o', label: 'Số đơn', unit: 'đơn', fmt: v => num(Math.round(v)), short: v => num(Math.round(v)) },
]

const LEG = {
  verticalAlign: 'top', align: 'left', height: 26, iconSize: 10,
  wrapperStyle: { fontSize: 10.5, color: '#6E739B', paddingLeft: 24, lineHeight: '15px' },
}

export default function Calendar({ filters }) {
  const [ym, setYm] = useState(DAILY_MONTHS[DAILY_MONTHS.length - 1])
  const [metric, setMetric] = useState('rev')
  const [pick, setPick] = useState(null)

  const M = METRICS.find(m => m.id === metric)

  const d = useMemo(() => {
    const days = dailyOfMonth(ym, filters)
    const vals = days.map(x => x[metric] || 0)
    const active = days.filter(x => (x[metric] || 0) > 0)
    const max = Math.max(0, ...vals)
    const total = vals.reduce((a, b) => a + b, 0)
    const best = [...active].sort((a, b) => b[metric] - a[metric])[0] || null
    const worst = [...active].sort((a, b) => a[metric] - b[metric])[0] || null

    // gộp theo thứ trong tuần: riêng tháng này và toàn bộ lịch sử
    const dowMonth = byDayOfWeek(filters, ym)
    const dowAll = byDayOfWeek(filters)

    return {
      days, max, total, active: active.length, best, worst, dowMonth, dowAll,
      avg: active.length ? total / active.length : 0,
      top: [...active].sort((a, b) => b[metric] - a[metric]).slice(0, 8),
    }
  }, [ym, filters, metric])

  const idx = DAILY_MONTHS.indexOf(ym)
  const move = step => {
    const n = idx + step
    if (n >= 0 && n < DAILY_MONTHS.length) { setYm(DAILY_MONTHS[n]); setPick(null) }
  }

  const [yy, mm] = ym.split('-')
  const firstDow = d.days[0]?.dow || 0
  const bestDow = [...d.dowAll].sort((a, b) => b.avgRev - a.avgRev)[0]

  return (
    <>
      <div className="m2-title">
        <span>Nhịp bán theo ngày</span>
        <h2>Lịch bán hàng</h2>
        <p>
          Mỗi ô là một ngày, ô càng đậm càng bán tốt · dùng để tìm ngày mạnh trong tháng và nhịp theo thứ
          {DAILY_IS_MOCK && ' · số liệu bán hàng hiện là dữ liệu giả'}
        </p>
      </div>

      <div className="cal-bar">
        <div className="cal-nav">
          <button className="xls-btn" onClick={() => move(-1)} disabled={idx <= 0}>‹</button>
          <select value={ym} onChange={e => { setYm(e.target.value); setPick(null) }}>
            {DAILY_MONTHS.map(m => <option key={m} value={m}>{m.replace('-', '.')}</option>)}
          </select>
          <button className="xls-btn" onClick={() => move(1)} disabled={idx >= DAILY_MONTHS.length - 1}>›</button>
        </div>
        <div className="cal-metric">
          <span>Chỉ số hiển thị</span>
          {METRICS.map(m => (
            <button key={m.id} className={'chip' + (metric === m.id ? ' on' : '')} onClick={() => setMetric(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="m2-kpis" style={{ gridTemplateColumns: 'repeat(5,minmax(0,1fr))' }}>
        <div>
          <span>Tổng tháng {ym.replace('-', '.')}</span>
          <strong>{M.fmt(d.total)}</strong><small>{M.unit}</small>
        </div>
        <div>
          <span>Ngày có phát sinh</span>
          <strong>{d.active}</strong><small>trên {d.days.length} ngày</small>
        </div>
        <div>
          <span>Bình quân ngày có bán</span>
          <strong>{M.fmt(d.avg)}</strong><small>{M.unit}/ngày</small>
        </div>
        <div className="warn">
          <span>Ngày cao nhất</span>
          <strong>{d.best ? `${d.best.day}/${+mm}` : '—'}</strong>
          <small>{d.best ? `${M.fmt(d.best[metric])} ${M.unit} · ${DOW_LABEL[d.best.dow]}` : '—'}</small>
        </div>
        <div>
          <span>Thứ mạnh nhất</span>
          <strong>{bestDow ? bestDow.label : '—'}</strong>
          <small>{bestDow ? `TB ${trieu(bestDow.avgRev)} triệu/ngày · toàn kỳ` : '—'}</small>
        </div>
      </div>

      <div className="cal-layout">
        <div className="m2-panel cal-panel">
          <div className="m2-head">
            <div>
              <h3>{M.label} theo ngày — tháng {+mm}/{yy}</h3>
              <p>Nền đậm nhạt theo {M.label.toLowerCase()} · bấm một ngày để xem sản phẩm bán trong ngày đó</p>
            </div>
            <div className="tools cal-scale">
              <span>Thấp</span><i className="s1" /><i className="s2" /><i className="s3" /><i className="s4" /><i className="s5" /><span>Cao</span>
            </div>
          </div>

          <div className="cal-grid">
            {DOW_LABEL.map(l => <div key={l} className="cal-dow">{l}</div>)}
            {Array.from({ length: firstDow }).map((_, i) => <div key={'e' + i} className="cal-cell empty" />)}
            {d.days.map(x => {
              const v = x[metric] || 0
              const ratio = d.max > 0 ? v / d.max : 0
              const lvl = v <= 0 ? 0 : ratio > 0.8 ? 5 : ratio > 0.6 ? 4 : ratio > 0.4 ? 3 : ratio > 0.2 ? 2 : 1
              const isBest = d.best && x.date === d.best.date
              return (
                <button key={x.date}
                  className={'cal-cell l' + lvl + (isBest ? ' best' : '') + (pick === x.date ? ' on' : '')}
                  onClick={() => setPick(pick === x.date ? null : x.date)}
                  title={`${x.day}/${+mm} · ${DOW_LABEL[x.dow]}`}>
                  <em>{x.day}</em>
                  {v > 0 ? <b>{M.short(v)}</b> : <b className="zero">—</b>}
                  {v > 0 && metric !== 'o' && <u>{num(Math.round(x.o))} đơn</u>}
                </button>
              )
            })}
          </div>

          <p className="cal-note">
            {d.best && <>Ngày mạnh nhất tháng: <b>{d.best.day}/{+mm} ({DOW_LABEL[d.best.dow]})</b> với {M.fmt(d.best[metric])} {M.unit}
              {d.avg > 0 && <> — gấp {(d.best[metric] / d.avg).toFixed(1)} lần ngày trung bình</>}.</>}
            {d.worst && d.active > 1 && <> Ngày yếu nhất: {d.worst.day}/{+mm} với {M.fmt(d.worst[metric])} {M.unit}.</>}
          </p>
        </div>

        <div className="cal-side">
          <div className="m2-panel">
            <div className="m2-head">
              <div>
                <h3>Nhịp bán theo thứ</h3>
                <p>Doanh thu bình quân một ngày của từng thứ · cột đậm = tháng đang xem, số bên phải = toàn kỳ</p>
              </div>
            </div>
            <div className="chart" style={{ height: 236 }}>
              <ResponsiveContainer>
                <BarChart data={d.dowMonth.map((x, i) => ({
                  label: x.label.replace('Thứ ', 'T').replace('Chủ nhật', 'CN'),
                  avg: x.avgRev / 1e6,
                  all: d.dowAll[i].avgRev / 1e6,
                }))} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="#E7E9F3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8E93B5' }} tickLine={false} axisLine={{ stroke: '#E7E9F3' }} />
                  <YAxis tick={{ fontSize: 9, fill: '#8E93B5' }} tickLine={false} axisLine={false} width={40}
                    tickFormatter={v => num(Math.round(v))} />
                  <Tooltip contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
                    formatter={(v, n) => [`${num(Math.round(v))} triệu/ngày`, n === 'avg' ? 'Tháng này' : 'Toàn kỳ']} />
                  <Legend {...LEG} payload={[
                    { value: 'Toàn kỳ', type: 'square', color: '#D5D8E8' },
                    { value: 'Kỳ đang chọn', type: 'square', color: '#353E99' },
                  ]} />
                  <Bar dataKey="all" name="Toàn kỳ" fill="#D5D8E8" radius={[3, 3, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="avg" name="Kỳ đang chọn" radius={[3, 3, 0, 0]} maxBarSize={26}>
                    {d.dowMonth.map((x, i) => (
                      <Cell key={i} fill={i >= 4 ? '#D97706' : '#353E99'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="cal-note">Cột cam = thứ 6, thứ 7, chủ nhật — nhóm cuối tuần.</p>
          </div>

          <div className="m2-panel">
            <div className="m2-head">
              <div>
                <h3>{pick ? `Sản phẩm bán ngày ${pick.slice(8)}/${+mm}` : `Top ngày mạnh nhất tháng ${+mm}`}</h3>
                <p>{pick ? 'Xếp theo doanh thu trong ngày · bấm để mở phân tích sâu' : 'Bấm một ngày trên lịch để xem sản phẩm bán trong ngày đó'}</p>
              </div>
              {pick && <div className="tools"><button className="link-btn" onClick={() => setPick(null)}>Bỏ chọn</button></div>}
            </div>
            {pick ? <DaySkus date={pick} filters={filters} /> : <TopDays rows={d.top} metric={metric} M={M} mm={+mm} />}
          </div>
        </div>
      </div>
    </>
  )
}

function TopDays({ rows, metric, M, mm }) {
  if (!rows.length) return <p className="empty">Tháng này chưa có phát sinh bán.</p>
  const max = Math.max(...rows.map(r => r[metric]))
  return (
    <div className="day-list">
      {rows.map((r, i) => (
        <div key={r.date} className="day-row">
          <span className="dr-rank">{i + 1}</span>
          <div className="dr-name">
            <b>{r.day}/{mm}</b>
            <small>{DOW_LABEL[r.dow]}</small>
          </div>
          <div className="dr-bar"><i style={{ width: `${(r[metric] / max) * 100}%` }} /></div>
          <div className="dr-val">
            <b>{M.short(r[metric])}</b>
            <small>{M.unit}</small>
          </div>
        </div>
      ))}
    </div>
  )
}

function DaySkus({ date, filters }) {
  const { open: drill } = useDrill()
  const rows = useMemo(() => topSkuOfDay(date, filters, 10), [date, filters])
  if (!rows.length) return <p className="empty">Ngày này không có đơn nào trong phạm vi lọc.</p>
  const max = Math.max(...rows.map(r => r.rev))
  return (
    <div className="day-list">
      {rows.map((r, i) => (
        <div key={r.sku} className="day-row clickable"
          onClick={() => { const cn = SKU_MAP[r.sku]?.className; if (cn) drill(cn) }}>
          <span className="dr-rank">{i + 1}</span>
          <div className="dr-name">
            <b>{r.name}</b>
            <small>{r.sku} · {r.nganh}</small>
          </div>
          <div className="dr-bar"><i style={{ width: `${(r.rev / max) * 100}%` }} /></div>
          <div className="dr-val">
            <b>{trieu(r.rev, r.rev / 1e6 < 10 ? 1 : 0)}</b>
            <small>{num(Math.round(r.un))} u</small>
          </div>
        </div>
      ))}
    </div>
  )
}
