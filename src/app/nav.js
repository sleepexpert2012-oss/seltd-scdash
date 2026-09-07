/* Cấu trúc menu — ánh xạ từ bản đồ trang của báo cáo mẫu 2,
   đã lược theo phạm vi đã chốt (7 màn hình + màn phụ Class Dashboard). */
export const NAV = [
  {
    label: 'Phân tích kinh doanh',
    items: [
      { id: 'overview', label: 'Tổng quan', icon: 'chart', screen: 1 },
      { id: 'calendar', label: 'Lịch bán hàng', icon: 'calendar', screen: 8 },
      { id: 'category', label: 'Ngành hàng', icon: 'layers', screen: 2 },
      { id: 'range', label: 'Range Review', icon: 'grid', screen: 3 },
      { id: 'matrix', label: 'Ma trận sản phẩm', icon: 'layers', screen: 4 },
      { id: 'marketing', label: 'Marketing Analysis', icon: 'trend', screen: 9 },
    ],
  },
  {
    label: 'Mua hàng & Nhà cung cấp',
    items: [
      { id: 'supplier', label: 'Nhà cung cấp & Mua hàng', icon: 'factory', screen: 5 },
    ],
  },
  {
    label: 'Tồn kho & Kế hoạch',
    items: [
      { id: 'stock', label: 'Tồn kho & Đặt hàng', icon: 'box', screen: 6 },
      { id: 'forecast', label: 'Forecast & Kế hoạch', icon: 'trend', screen: 7 },
    ],
  },
  {
    label: 'Tài liệu',
    items: [
      { id: 'guide', label: 'Giới thiệu & Định nghĩa', icon: 'book', screen: null },
    ],
  },
]

export const PAGES = Object.fromEntries(
  NAV.flatMap(s => s.items).map(i => [i.id, i])
)

export const DEFAULT_PAGE = 'overview'
