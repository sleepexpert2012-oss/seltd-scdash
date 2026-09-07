const nf = (d = 0) => new Intl.NumberFormat('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d })

export const trieu = (v, d = 0) => nf(d).format((v || 0) / 1e6)
export const num = (v, d = 0) => nf(d).format(v || 0)
export const pct = (v, d = 1) => `${nf(d).format((v || 0) * 100)}%`
export const diem = (v, d = 1) => `${v >= 0 ? '+' : ''}${nf(d).format(v * 100)} đ%`
export const delta = (v, d = 1) => `${v >= 0 ? '▲ +' : '▼ '}${nf(d).format(v * 100)}%`
