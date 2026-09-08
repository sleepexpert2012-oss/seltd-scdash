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
      { id: 'pnl', label: 'Lãi lỗ', icon: 'scale', screen: 11 },
    ],
  },
  {
    /* Gộp "Mua hàng & Nhà cung cấp" + "Tồn kho & Kế hoạch" thành một nhóm:
       ba màn này đi liền một mạch nghiệp vụ — mua về, giữ tồn, lên kế hoạch. */
    label: 'Cung ứng & Kế hoạch',
    items: [
      { id: 'supplier', label: 'Nhà cung cấp & Mua hàng', icon: 'factory', screen: 5 },
      { id: 'stock', label: 'Tồn kho & Đặt hàng', icon: 'box', screen: 6 },
      { id: 'forecast', label: 'Forecast & Kế hoạch', icon: 'trend', screen: 7 },
    ],
  },
  {
    label: 'Tài liệu & Hệ thống',
    items: [
      { id: 'infra', label: 'Cơ sở hạ tầng', icon: 'factory', screen: 10 },
      { id: 'guide', label: 'Giới thiệu & Định nghĩa', icon: 'book', screen: null },
    ],
  },
]

export const PAGES = Object.fromEntries(
  NAV.flatMap(s => s.items).map(i => [i.id, i])
)

export const DEFAULT_PAGE = 'overview'
