import { useState, useRef, useEffect } from 'react'
import './login.css'

/* Khoá truy cập phía client cho bản chạy nội bộ.
   Khi lên hạ tầng sẽ thay bằng xác thực thật ở phía server. */
const PASSWORD = 'Sleepexpert'

export default function Login({ onSuccess }) {
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function submit(e) {
    e.preventDefault()
    if (pw === PASSWORD) {
      setErr('')
      sessionStorage.setItem('seltd_auth', '1')
      onSuccess()
    } else {
      setErr('Mật khẩu không đúng. Vui lòng thử lại.')
      setPw('')
      inputRef.current?.focus()
    }
  }

  return (
    <div className="lg-wrap">
      <div className="lg-card">
        <header className="lg-head">
          <img src="/logo.png" alt="Sleep Expert" />
          <div>
            <span>SELTD · SUPPLY CHAIN</span>
            <h1>Supply Chain Dashboard</h1>
            <p>Báo cáo phân tích nội bộ — Phòng Supply Chain</p>
          </div>
        </header>

        <form className="lg-form" onSubmit={submit}>
          <div className="lg-intro">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            <div>
              <strong>Tài liệu nội bộ</strong>
              <p>Nội dung chỉ dùng trong nội bộ công ty. Không chia sẻ ra ngoài.</p>
            </div>
          </div>

          <label htmlFor="pw">Mật khẩu truy cập</label>
          <div className="lg-input">
            <input
              id="pw"
              ref={inputRef}
              type={show ? 'text' : 'password'}
              value={pw}
              onChange={(e) => { setPw(e.target.value); if (err) setErr('') }}
              placeholder="Nhập mật khẩu"
              autoComplete="current-password"
              aria-invalid={!!err}
            />
            <button type="button" className="lg-eye" onClick={() => setShow(s => !s)}
              aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
              {show ? 'Ẩn' : 'Hiện'}
            </button>
          </div>

          {err && <p className="lg-err" role="alert">{err}</p>}

          <button type="submit" className="lg-submit" disabled={!pw}>Đăng nhập</button>

          <p className="lg-help">Quên mật khẩu? Liên hệ Phòng Supply Chain.</p>
        </form>

        <footer className="lg-foot">SELTD Supply Chain Dashboard · Nội bộ · v0.1</footer>
      </div>
    </div>
  )
}
