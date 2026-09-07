import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import { syncPhantomBeforeBoot } from './lib/cloud'

/* Nạp tồn ảo từ đám mây TRƯỚC khi mount React.
   metrics.js tính STOCK_BY_SKU ngay lúc khởi tạo module, nên nếu mount trước rồi
   mới đồng bộ thì lần vẽ đầu sẽ dùng số cũ. Vì vậy import App bằng dynamic import
   để module metrics chỉ khởi tạo sau khi cache đã có số mới.
   Mất mạng thì bỏ qua, dùng cache lần trước hoặc file trong repo. */
async function boot() {
  await syncPhantomBeforeBoot()
  const { default: App } = await import('./App.jsx')
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
boot()
