import { Component } from 'react'

/* Một màn hình lỗi không được phép làm trắng cả ứng dụng.
   Bọc riêng vùng nội dung: sidebar và bộ lọc vẫn dùng được. */
export default class ErrorBoundary extends Component {
  state = { err: null }

  static getDerivedStateFromError(err) { return { err } }

  componentDidCatch(err, info) {
    console.error('[Màn hình lỗi]', err, info?.componentStack)
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null })
  }

  render() {
    const { err } = this.state
    if (!err) return this.props.children
    return (
      <div className="panel err-panel">
        <div className="panel-head">
          <div>
            <h2>Không hiển thị được nội dung này</h2>
            <p>Các phần khác của ứng dụng vẫn hoạt động. Đổi bộ lọc hoặc sang trang khác để tiếp tục.</p>
          </div>
          <button className="btn" onClick={() => this.setState({ err: null })}>Thử lại</button>
        </div>
        <pre className="err-detail">{String(err?.stack || err).slice(0, 900)}</pre>
      </div>
    )
  }
}
