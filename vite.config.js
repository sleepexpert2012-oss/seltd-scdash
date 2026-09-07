import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages phục vụ ở /<tên-repo>/ nên khi build cho Pages phải đặt base,
// không thì toàn bộ file js/css 404. Chạy local vẫn dùng '/'.
const base = process.env.PAGES_BASE || '/'

export default defineConfig({
  base,
  plugins: [react()],
  // recharts kéo theo react qua nhiều nhánh phụ -> ép dùng chung một bản react
  resolve: { dedupe: ['react', 'react-dom', 'react-is'] },
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'recharts'] },
})
