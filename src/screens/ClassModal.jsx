import { useEffect, useMemo } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  classDetail, MONTHS, STATUS, WAREHOUSES, BANDS, VMIN, Z_SERVICE,
  CUR_YEAR, PREV_YEAR, LAST_ACTUAL_MONTH,
} from '../lib/metrics'
import { trieu, num, pct } from '../lib/format'
import { useDrill } from '../app/drill'
import './classModal.css'

const TREND_LABEL = { new: 'Mới phát triển', up: 'Đang tăng trưởng', down: 'Đang suy giảm', flat: 'Ổn định' }
const C = { bar: '#353E99', bar2: '#5C67C4', fc: '#A9AFE0', line: '#D97706', line2: '#8E93B5', grid: '#E7E9F3', axis: '#8E93B5' }

export default function ClassModal({ filters }) {
  const { target, close } = useDrill()

  useEffect(() => {
    if (!target) return
    const onKey = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, close])

  const d = useMemo(() => (target ? classDetail(target, filters) : null), [target, filters])
  if (!target || !d) return null

  const remain = 12 - LAST_ACTUAL_MONTH
  const stt = STATUS[d.stock.worst]

  return (
    <div className="modal on" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div className="mbox">
        <div className="mhead">
          <div>
            <span>NGÀNH {d.nganh.toUpperCase()}</span>
            <h3>{d.className} <em>({d.brand})</em></h3>
          </div>
          <div className="mhead-act">
            <button className="xls-btn" onClick={() => window.print()}>🖨 In / PDF</button>
            <button className="mclose" onClick={close} aria-label="Đóng">×</button>
          </div>
        </div>

        <div className="mmeta">
          <div><b>Xu hướng</b>{TREND_LABEL[d.trend]}</div>
          <div><b>Phân khúc giá</b>{BANDS.find(x => x.id === d.band)?.label || '—'}</div>
          <div><b>Nhà cung cấp</b>{d.brand}</div>
          <div><b>Số SKU</b>{d.skuCount}</div>
          <div><b>Bán lần đầu</b>{d.firstSale}</div>
          <div><b>Tỷ trọng ngành</b>{pct(d.scopes[1].shareRev)}</div>
          <div><b>Tồn hiện có</b>{num(d.stock.ton)} u · {trieu(d.stock.value)} tr</div>
          <div><b>Tình trạng</b><i className={'pri p' + d.stock.worst}>{stt.icon} {stt.label}</i></div>
        </div>

        <div className="mgrid">
          {/* ---------------- PHẦN 1 ---------------- */}
          <div className="msec-h first">
            📊 PHẦN 1 — HIỆU QUẢ KINH DOANH
            <small>doanh thu · lợi nhuận gộp · GM% · giá bán · số lượng theo tháng</small>
          </div>

          <Card title="Doanh thu · GP · GM% theo tháng" sub="Cột = doanh thu và GP (triệu, trục trái) · đường = GM% (trục phải)">
            <Chart h={210}>
              <ComposedChart data={d.series.map(r => ({ label: r.label.slice(2), rev: r.rev / 1e6, gp: r.gp / 1e6, gm: r.gm * 100 }))}
                margin={{ top: 6, right: 4, bottom: 2, left: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 8, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }}
                  interval={1} angle={-40} textAnchor="end" height={38} />
                <YAxis yAxisId="L" tick={{ fontSize: 8, fill: C.axis }} tickLine={false} axisLine={false} width={38} />
                <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 8, fill: C.line }} tickLine={false}
                  axisLine={false} width={34} tickFormatter={v => `${Math.round(v)}%`} />
                <Tooltip contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }} />
                <Bar yAxisId="L" dataKey="rev" name="Doanh thu" fill={C.bar} maxBarSize={14} />
                <Bar yAxisId="L" dataKey="gp" name="Lợi nhuận gộp" fill={C.bar2} maxBarSize={14} />
                <Line yAxisId="R" dataKey="gm" name="GM%" stroke={C.line} strokeWidth={2} dot={false} />
              </ComposedChart>
            </Chart>
          </Card>

          <Card title="Giá bán BQ & COGS/unit theo tháng" sub="Triệu đồng trên một unit · khoảng cách hai đường chính là biên gộp">
            <Chart h={210}>
              <ComposedChart data={d.series.map(r => ({
                label: r.label.slice(2),
                asp: r.un > 0 ? r.rev / r.un / 1e6 : null,
                cogs: r.un > 0 ? r.cogs / r.un / 1e6 : null,
              }))} margin={{ top: 6, right: 4, bottom: 2, left: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 8, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }}
                  interval={1} angle={-40} textAnchor="end" height={38} />
                <YAxis tick={{ fontSize: 8, fill: C.axis }} tickLine={false} axisLine={false} width={38} />
                <Tooltip contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
                  formatter={v => (v == null ? '—' : `${num(Math.round(v * 100) / 100, 2)} tr`)} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line dataKey="asp" name="Giá bán BQ" stroke={C.bar} strokeWidth={2} dot={false} connectNulls />
                <Line dataKey="cogs" name="COGS/unit" stroke={C.line} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
              </ComposedChart>
            </Chart>
          </Card>

          <Card title="Số lượng bán theo tháng" sub="Unit bán thuần, đã trừ huỷ và hoàn">
            <Chart h={200}>
              <ComposedChart data={d.series.map(r => ({ label: r.label.slice(2), un: Math.round(r.un) }))}
                margin={{ top: 6, right: 4, bottom: 2, left: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 8, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }}
                  interval={1} angle={-40} textAnchor="end" height={38} />
                <YAxis tick={{ fontSize: 8, fill: C.axis }} tickLine={false} axisLine={false} width={34} />
                <Tooltip contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }} formatter={v => `${num(v)} unit`} />
                <Bar dataKey="un" name="Số lượng" fill={C.bar} maxBarSize={16} radius={[2, 2, 0, 0]} />
              </ComposedChart>
            </Chart>
          </Card>

          <Card title="Vị trí theo tháng — thứ hạng theo doanh thu"
            sub="Trục ĐẢO NGƯỢC: đường đi lên = thăng hạng · hạng theo doanh thu lũy kế 3 tháng trượt">
            <Chart h={200}>
              <ComposedChart data={d.rankSeries} margin={{ top: 6, right: 4, bottom: 2, left: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 8, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }}
                  interval={1} angle={-40} textAnchor="end" height={38} />
                <YAxis reversed allowDecimals={false} domain={[1, 'dataMax']} tick={{ fontSize: 8, fill: C.axis }}
                  tickLine={false} axisLine={false} width={28} />
                <Tooltip contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
                  formatter={(v, n) => [v == null ? '—' : `hạng ${v}`, n]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line dataKey="rankNganh" name="Trong ngành" stroke={C.line} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                <Line dataKey="rankAll" name="Toàn công ty" stroke={C.bar} strokeWidth={2} dot={{ r: 2 }} connectNulls />
              </ComposedChart>
            </Chart>
          </Card>

          <div className="card w2 kpi-line">
            {[
              ['Doanh thu kỳ chọn', trieu(d.cur.rev), 'triệu', d.prev && d.cur.rev - d.prev.rev],
              ['Lợi nhuận gộp', trieu(d.cur.gp), 'triệu', d.prev && d.cur.gp - d.prev.gp],
              ['GM%', pct(d.cur.gm), 'GP ÷ doanh thu', null],
              ['Số lượng bán', num(Math.round(d.cur.un)), 'unit', d.prev && d.cur.un - d.prev.un],
              ['Giá bán BQ', trieu(d.cur.un > 0 ? d.cur.rev / d.cur.un : 0, 2), 'triệu/unit', null],
              ['COGS/unit', trieu(d.cur.un > 0 ? d.cur.cogs / d.cur.un : 0, 2), 'triệu/unit', null],
            ].map(([k, v, u, delta]) => (
              <div key={k}>
                <span>{k}</span><strong>{v}</strong>
                <small>{u}{delta != null && delta !== 0 && (
                  <i className={delta > 0 ? 'up' : 'down'}> · {delta > 0 ? '+' : ''}{trieu(delta)} vs kỳ SS</i>
                )}</small>
              </div>
            ))}
          </div>

          {/* ---------------- PHẦN 2 ---------------- */}
          <div className="msec-h">
            📦 PHẦN 2 — TỒN KHO & ĐẶT HÀNG
            <small>tồn kho · logic tính điểm đặt · SKU cần đặt hiện tại</small>
          </div>

          <div className="card w2">
            <div className="stk-line">
              <div><span>Tồn TỔNG</span><strong>{num(d.stock.ton)}</strong><small>unit</small></div>
              {WAREHOUSES.map(w => (
                <div key={w.code}><span>{w.code}</span><strong>{num(d.stock.byWh[w.code] || 0)}</strong><small>{w.name}</small></div>
              ))}
              <div><span>Giá vốn tồn</span><strong>{trieu(d.stock.value)}</strong><small>triệu</small></div>
              <div><span>Tình trạng</span><strong className="statusv">{stt.icon}</strong><small>{stt.label}</small></div>
            </div>

            <div className="sop-box">
              <b>Điểm đặt hàng gợi ý (S&amp;OP)</b>
              <div className="sop-row">
                <span>Safety stock: <b>{num(d.stock.ss)}</b></span>
                <span>ROP: <b>{num(d.stock.rop)}</b></span>
                <span>Mức đặt tới: <b>{num(d.stock.oup)}</b></span>
                <span>Sức bán 3T: <b>{d.stock.vel3.toFixed(1)}</b> u/tháng</span>
              </div>
              <p>
                {d.stock.need > 0
                  ? <>📦 <b>CẦN ĐẶT {num(d.stock.need)} unit</b> — ước tính {trieu(d.stock.needValue)} triệu, cộng từ các SKU đang dưới ROP.</>
                  : <>✅ Chưa cần đặt — tồn của mọi SKU trong loại hình này vẫn trên điểm đặt lại, hoặc sức bán dưới {VMIN} u/tháng nên không replenish.</>}
              </p>
            </div>
          </div>

          <div className="card w2">
            <h4>SKU trong loại hình — tồn & điểm đặt</h4>
            <div className="mtable">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th><th>Trạng thái</th><th className="num">Bán 3T</th><th className="num">Tồn</th>
                    <th className="num">SS</th><th className="num">ROP</th><th className="num">Mức đặt</th><th className="num">Cần đặt</th>
                  </tr>
                </thead>
                <tbody>
                  {d.stock.rows.sort((a, b) => a.stt - b.stt || b.need - a.need).map(r => (
                    <tr key={r.sku}>
                      <td><b>{r.name}</b><small>{r.sku}</small></td>
                      <td><span className={'pri p' + r.stt}>{STATUS[r.stt].icon}</span></td>
                      <td className="num">{r.vel3.toFixed(1)}</td>
                      <td className="num strong">{num(r.ton)}</td>
                      <td className="num">{num(r.ss)}</td>
                      <td className="num">{num(r.rop)}</td>
                      <td className="num">{num(r.oup)}</td>
                      <td className="num">{r.need > 0 ? <b className="need">{num(r.need)}</b> : <span className="dim">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card w2">
            <h4>Nhà cung cấp của loại hình này</h4>
            {!d.po.bySup.length ? (
              <p className="none">Loại hình này chưa có dữ liệu PO trong Master Data.</p>
            ) : (
              <div className="mtable">
                <table>
                  <thead>
                    <tr><th>NCC</th><th className="num">PO value (triệu)</th><th className="num">SL nhập</th>
                      <th className="num">Giá mua BQ</th><th className="num">Chênh với COGS/unit hiện tại</th></tr>
                  </thead>
                  <tbody>
                    {d.po.bySup.map(s2 => {
                      const avg = s2.qty > 0 ? s2.value / s2.qty : 0
                      const cogsU = d.cur.un > 0 ? d.cur.cogs / d.cur.un : 0
                      const gap = avg > 0 && cogsU > 0 ? cogsU / avg - 1 : null
                      return (
                        <tr key={s2.name}>
                          <td><b>{s2.name}</b></td>
                          <td className="num strong">{trieu(s2.value)}</td>
                          <td className="num">{num(Math.round(s2.qty))}</td>
                          <td className="num">{trieu(avg, 2)}</td>
                          <td className="num">{gap == null ? <span className="dim">—</span>
                            : <span className={Math.abs(gap) < 0.02 ? 'dim' : gap > 0 ? 'down' : 'up'}>
                              {gap >= 0 ? '+' : ''}{(gap * 100).toFixed(1)}%
                            </span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p className="note">PO gần nhất: {d.po.last || '—'} · giá mua bình quân toàn kỳ {trieu(d.po.avgPrice, 2)} triệu/unit</p>
              </div>
            )}
          </div>

          {/* ---------------- PHẦN 3 ---------------- */}
          <div className="msec-h">
            📉 PHẦN 3 — DEMAND PLANNING & DỰ BÁO CUNG ỨNG
            <small>dự báo bán · doanh thu và giá vốn nhập dự kiến · chi tiết theo SKU</small>
          </div>

          <div className="card w2">
            <h4>Doanh thu bán theo tháng — cả năm {CUR_YEAR}</h4>
            <p className="sub">Cột đậm = thực tế T1–T{LAST_ACTUAL_MONTH} · cột nhạt = dự báo {remain} tháng cuối · đường xám = cùng kỳ {PREV_YEAR}</p>
            <Chart h={220}>
              <ComposedChart data={buildYearSeries(d)} margin={{ top: 6, right: 4, bottom: 2, left: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 8, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />
                <YAxis tick={{ fontSize: 8, fill: C.axis }} tickLine={false} axisLine={false} width={40} />
                <Tooltip contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
                  formatter={v => (v == null ? '—' : `${num(Math.round(v))} triệu`)} />
                <Bar dataKey="actual" name="Thực tế" stackId="a" fill={C.bar} maxBarSize={22} radius={[2, 2, 0, 0]} />
                <Bar dataKey="forecast" name="Dự báo" stackId="a" fill={C.fc} maxBarSize={22} radius={[2, 2, 0, 0]} />
                <Line dataKey="prev" name={`Cùng kỳ ${PREV_YEAR}`} stroke={C.line2} strokeWidth={1.6}
                  strokeDasharray="5 4" dot={{ r: 2 }} />
              </ComposedChart>
            </Chart>
            <p className="note">
              Hệ số YoY đang dùng: <b>{d.fcYear.useYoY ? d.fcYear.gY.toFixed(2) : '—'}</b> ({d.fcYear.source}) ·
              sản lượng dự báo {remain} tháng cuối: <b>{num(d.fcYear.months.reduce((a, x) => a + x.un, 0))} unit</b> ·
              doanh thu tương ứng khoảng <b>{trieu(d.fcYear.months.reduce((a, x) => a + x.un, 0) * d.ecoYear.asp)} triệu</b>
            </p>
          </div>

          <div className="card w2">
            <h4>Dự báo bán 6 tháng tới — theo SKU</h4>
            <p className="sub">
              Sản lượng = sản lượng tháng tương ứng 12 tháng gần nhất × (1 + đà tăng trưởng), đà kẹp trong −40% đến +60%
            </p>
            {!d.fcSku.length ? <p className="none">Chưa đủ lịch sử để dự báo cho loại hình này.</p> : (
              <div className="mtable">
                <table>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      {d.fcSku[0].labels.map(l => <th key={l} className="num">{l}</th>)}
                      <th className="num">Tổng 6T</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.fcSku.map(r => (
                      <tr key={r.sku}>
                        <td><b>{r.name}</b><small>{r.sku}</small></td>
                        {r.values.map((v, i) => <td key={i} className="num">{num(v)}</td>)}
                        <td className="num strong">{num(r.total)}</td>
                      </tr>
                    ))}
                    <tr className="tot">
                      <td><b>Tổng dự báo</b></td>
                      {d.fcSku[0].labels.map((_, i) => (
                        <td key={i} className="num strong">{num(d.fcSku.reduce((a, r) => a + (r.values[i] || 0), 0))}</td>
                      ))}
                      <td className="num strong">{num(d.fcSku.reduce((a, r) => a + r.total, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ---------------- PHẦN 4 ---------------- */}
          <div className="msec-h">
            📈 PHẦN 4 — VỊ TRÍ THỊ TRƯỜNG & PHÂN RÃ BIÊN
            <small>thứ hạng &amp; tỷ trọng theo phạm vi · SKU chủ lực · nguyên nhân thay đổi GM</small>
          </div>

          <div className="card w2">
            <h4>Vị trí &amp; tỷ trọng theo phạm vi so sánh</h4>
            <p className="sub">Kỳ {filters.from} → {filters.to} · doanh thu loại hình {trieu(d.cur.rev)} triệu · GM {pct(d.cur.gm)}</p>
            <div className="mtable">
              <table>
                <thead>
                  <tr>
                    <th>Phạm vi</th><th className="num">Tổng DT phạm vi</th><th className="num">% DT của loại hình</th>
                    <th className="num">Tổng GP</th><th className="num">% GP</th>
                    <th className="num">GM TB phạm vi (Δ)</th><th className="num">Hạng DT</th>
                  </tr>
                </thead>
                <tbody>
                  {d.scopes.map(s2 => (
                    <tr key={s2.label}>
                      <td><b>{s2.label}</b></td>
                      <td className="num">{trieu(s2.rev)}</td>
                      <td className="num strong">{pct(s2.shareRev)}</td>
                      <td className="num">{trieu(s2.gp)}</td>
                      <td className="num">{pct(s2.shareGp)}</td>
                      <td className="num">
                        {pct(s2.gm)}
                        <i className={d.cur.gm - s2.gm >= 0 ? 'up' : 'down'}>
                          {' '}({d.cur.gm - s2.gm >= 0 ? '+' : ''}{((d.cur.gm - s2.gm) * 100).toFixed(1)}đ%)
                        </i>
                      </td>
                      <td className="num strong">{s2.rank ? `#${s2.rank}/${s2.total}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card w2">
            <h4>Hai SKU chủ lực — giá bán và giá vốn</h4>
            <p className="sub">So cùng một SKU giữa hai kỳ để loại nhiễu do đổi cơ cấu kích thước</p>
            {!d.topSku.length ? <p className="none">Không có SKU nào phát sinh bán trong kỳ.</p> : (
              <div className="sku-cmp">
                {d.topSku.map(s2 => {
                  const p = d.bySkuPrev[s2.key]
                  const aspC = s2.un > 0 ? s2.rev / s2.un : 0
                  const aspP = p && p.un > 0 ? p.rev / p.un : 0
                  const cC = s2.un > 0 ? s2.cogs / s2.un : 0
                  const cP = p && p.un > 0 ? p.cogs / p.un : 0
                  const pcs = (a, b) => (b > 0 ? `${a >= b ? '+' : ''}${((a / b - 1) * 100).toFixed(1)}%` : '—')
                  return (
                    <div key={s2.key} className="cmp-item">
                      <b>{d.skus.find(x => x.sku === s2.key)?.name || s2.key}</b>
                      <div><span>Giá bán</span>{trieu(aspP, 2)} → <strong>{trieu(aspC, 2)}</strong>
                        <i className={aspC >= aspP ? 'up' : 'down'}> {pcs(aspC, aspP)}</i></div>
                      <div><span>COGS/unit</span>{trieu(cP, 2)} → <strong>{trieu(cC, 2)}</strong>
                        <i className={cC <= cP ? 'up' : 'down'}> {pcs(cC, cP)}</i></div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {d.gmDec && (
            <div className="decomp">
              <span>Phân rã ΔGM — kỳ chọn vs kỳ so sánh</span>
              <p className="big">
                ΔGM = {(d.gmDec.dGm * 100).toFixed(1)} điểm % = hiệu ứng GIÁ VỐN {(d.gmDec.costEffect * 100).toFixed(1)} đ%
                {' '}+ hiệu ứng GIÁ BÁN &amp; khác {(d.gmDec.priceEffect * 100).toFixed(1)} đ%
              </p>
              <p>
                {Math.abs(d.gmDec.costEffect) > Math.abs(d.gmDec.priceEffect)
                  ? <>Biên thay đổi <b>chủ yếu do giá vốn</b> — giá mua vào là chỗ cần xem trước.</>
                  : <>Biên thay đổi <b>chủ yếu do giá bán và cơ cấu</b> — cần rà lại chính sách giá, khuyến mãi và mix kích thước.</>}
                {' '}Giá bán BQ {trieu(d.gmDec.aspP, 2)} → {trieu(d.gmDec.aspC, 2)} triệu ·
                COGS/unit {trieu(d.gmDec.cogsP, 2)} → {trieu(d.gmDec.cogsC, 2)} triệu.
              </p>
            </div>
          )}

          <div className="decomp">
            <span>Kết luận kỳ gần nhất</span>
            <p>
              Kỳ {filters.from} → {filters.to}: doanh thu <b>{trieu(d.cur.rev)} triệu</b>
              {d.prev && <> — so kỳ trước {d.prev.rev > 0 ? `${d.cur.rev >= d.prev.rev ? '+' : ''}${((d.cur.rev / d.prev.rev - 1) * 100).toFixed(1)}%` : '—'}</>}
              {' '}· GM <b>{pct(d.cur.gm)}</b>
              {d.prev && <> (kỳ trước {pct(d.prev.gm)})</>}
              {' '}· vị trí <b>{d.scopes[1].rank ? `#${d.scopes[1].rank}/${d.scopes[1].total}` : '—'}</b> trong ngành {d.nganh},
              chiếm {pct(d.scopes[1].shareRev)} doanh thu ngành · phân loại <b>{TREND_LABEL[d.trend]}</b>.
            </p>
            <p className="action">
              <b>Gợi ý hành động:</b> {suggest(d)}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function buildYearSeries(d) {
  const out = []
  for (let mo = 1; mo <= 12; mo++) {
    const a = d.fcYear.actual[mo]
    const p = d.fcYear.prevYear[mo]
    const f = d.fcYear.months.find(x => x.mo === mo)
    out.push({
      label: `T${mo}`,
      actual: a ? a.rev / 1e6 : null,
      forecast: f ? (f.un * d.ecoYear.asp) / 1e6 : null,
      prev: p ? p.rev / 1e6 : null,
    })
  }
  return out
}

function suggest(d) {
  const g = d.prev && d.prev.rev > 0 ? d.cur.rev / d.prev.rev - 1 : null
  if (d.stock.worst === 0) return 'Tồn đã dưới ngưỡng khẩn — lên PO gấp trước khi mất doanh thu.'
  if (d.stock.need > 0) return `Gộp ${num(d.stock.need)} unit vào PO kỳ này (ước ${trieu(d.stock.needValue)} triệu).`
  if (d.stock.worst >= 4) return 'Tồn quay vòng chậm — cân nhắc khuyến mãi, điều chuyển kho hoặc dừng nhập.'
  if (d.cur.gm < 0.15) return 'Biên gộp dưới 15% — đàm phán lại giá mua hoặc điều chỉnh giá bán.'
  if (d.gmDec && d.gmDec.dGm <= -0.03) return 'Biên giảm trên 3 điểm % — xem khối phân rã ΔGM ở trên để biết do giá vốn hay giá bán.'
  if (g != null && g <= -0.05) return 'Doanh thu giảm so kỳ trước — kiểm tra cạnh tranh, tồn kho và trưng bày.'
  if (d.trend === 'new') return 'Sản phẩm mới — theo dõi tốc độ ramp-up và độ phủ trước khi tăng nhập.'
  if (g != null && g >= 0.15) return 'Đang tăng tốt — cân nhắc tăng phân bổ và bảo đảm nguồn cung.'
  return 'Duy trì — chưa có tín hiệu bất thường trong kỳ.'
}

function Card({ title, sub, children, wide }) {
  return (
    <div className={'card' + (wide ? ' w2' : '')}>
      <h4>{title}</h4>
      {sub && <p className="sub">{sub}</p>}
      {children}
    </div>
  )
}

function Chart({ h, children }) {
  return (
    <div style={{ width: '100%', height: h }}>
      <ResponsiveContainer>{children}</ResponsiveContainer>
    </div>
  )
}
