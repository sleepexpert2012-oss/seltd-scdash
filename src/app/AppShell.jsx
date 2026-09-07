import { useEffect, useState } from 'react'
import { NAV, PAGES, DEFAULT_PAGE } from './nav'
import Icon from './Icon'
import FilterBar, { defaultFilters } from './FilterBar'
import ErrorBoundary from './ErrorBoundary'
import { DrillProvider } from './drill'
import ClassModal from '../screens/ClassModal'
import master from '../data/master.json'
import sales from '../data/sales.json'
import stock from '../data/stock.json'
import Overview from '../screens/Overview'
import Category from '../screens/Category'
import Range from '../screens/Range'
import Matrix from '../screens/Matrix'
import Supplier from '../screens/Supplier'
import Stock from '../screens/Stock'
import Forecast from '../screens/Forecast'
import Marketing from '../screens/Marketing'
import CalendarScreen from '../screens/Calendar'
import './shell.css'

const NO_FILTER_PAGES = ['guide']

function readHash() {
  const id = window.location.hash.replace('#/', '')
  return PAGES[id] ? id : DEFAULT_PAGE
}

export default function AppShell({ onLogout }) {
  const [page, setPage] = useState(readHash)
  const [filters, setFilters] = useState(defaultFilters)
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    const h = () => setPage(readHash())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])

  /* Đổi trang phải cuộn lên đầu. Trang dài (Marketing, Tồn kho) nếu giữ nguyên
     vị trí cuộn thì sang trang mới người dùng đứng giữa/đáy trang, không thấy
     thanh lọc lẫn tiêu đề — nhìn như trang không chuyển. */
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
    document.querySelector('.content')?.scrollTo?.({ top: 0 })
  }, [page])

  function go(id) {
    window.location.hash = `#/${id}`
    setPage(id)
    setNavOpen(false)
  }

  const current = PAGES[page]
  const showFilters = !NO_FILTER_PAGES.includes(page)

  return (
    <DrillProvider>
    <div className="app">
      <aside className={'sidebar' + (navOpen ? ' open' : '')}>
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Sleep Expert" />
          <div>
            <strong>Supply Chain Dashboard</strong>
            <span>SELTD · Nội bộ</span>
          </div>
        </div>

        <nav>
          {NAV.map(sec => (
            <div className="nav-section" key={sec.label}>
              <span className="nav-section-label">{sec.label}</span>
              {sec.items.map(it => (
                <button key={it.id}
                  className={'nav-item' + (page === it.id ? ' active' : '')}
                  onClick={() => go(it.id)}>
                  <Icon name={it.icon} />
                  {it.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="side-foot">
          <strong>Phòng Supply Chain</strong>
          <span>Dữ liệu sản phẩm: Master Data · {master.meta.skuCount} SKU</span>
          <span>Bán hàng: Shopee API · {sales.meta.orders} đơn · {sales.meta.from} → {sales.meta.to}</span>
          <span>Tồn kho: Shopee 4 kho · {stock.meta.asOfDate}</span>
        </div>
      </aside>

      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="burger" onClick={() => setNavOpen(o => !o)} aria-label="Mở menu">
              <Icon name="menu" size={20} />
            </button>
            <div>
              <span className="eyebrow">SELTD · SUPPLY CHAIN</span>
              <h1>{current.label}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <span className="user-chip"><Icon name="user" size={15} /> Phòng Supply Chain</span>
            <button className="btn" onClick={() => window.print()}><Icon name="print" size={15} /> In / PDF</button>
            <button className="btn primary" onClick={onLogout}><Icon name="logout" size={15} /> Đăng xuất</button>
          </div>
        </header>

        {showFilters && (
          <FilterBar dims={master.dims} filters={filters} setFilters={setFilters} />
        )}

        <div className="page-wrap">
          <ErrorBoundary resetKey={page + JSON.stringify(filters)}>
            {page === 'overview' ? <Overview filters={filters} />
              : page === 'calendar' ? <CalendarScreen filters={filters} />
              : page === 'category' ? <Category filters={filters} setFilters={setFilters} />
              : page === 'range' ? <Range filters={filters} setFilters={setFilters} />
              : page === 'matrix' ? <Matrix filters={filters} setFilters={setFilters} />
              : page === 'marketing' ? <Marketing filters={filters} setFilters={setFilters} />
              : page === 'supplier' ? <Supplier filters={filters} setFilters={setFilters} />
              : page === 'stock' ? <Stock filters={filters} setFilters={setFilters} />
              : page === 'forecast' ? <Forecast filters={filters} />
              : <ScreenPlaceholder page={current} filters={filters} />}
          </ErrorBoundary>
        </div>
      </div>
      <ClassModal filters={filters} />
    </div>
    </DrillProvider>
  )
}

function ScreenPlaceholder({ page, filters }) {
  return (
    <>
      <div className="section-lead">
        <div>
          <span>{page.screen ? `MÀN HÌNH ${page.screen}` : 'TÀI LIỆU'}</span>
          <h2>{page.label}</h2>
          <p>Khu vực nội dung của trang này sẽ được dựng ở bước kế tiếp, sau khi anh chốt nội dung.</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Trạng thái</h2>
            <p>Màn hình 0 chỉ dựng khung: sidebar, thanh tiêu đề, bộ lọc và vùng nội dung.</p>
          </div>
        </div>
        <ul className="todo">
          <li><b>Khung ứng dụng</b> — đã dựng, đang chờ duyệt</li>
          <li>Nội dung <b>{page.label}</b> — chờ anh chốt các khối cần có</li>
          <li>Dữ liệu bán hàng &amp; tồn kho — <b>đã nối Shopee API thật</b></li>
        </ul>
        <p className="state-line">
          Bộ lọc hiện tại: {filters.from} → {filters.to}
          {filters.nganh && ` · ngành ${filters.nganh}`}
          {filters.loaiHinh && ` · loại hình ${filters.loaiHinh}`}
          {filters.supplier && ` · NCC ${filters.supplier}`}
          {filters.q && ` · tìm "${filters.q}"`}
        </p>
      </div>
    </>
  )
}
