import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy Motive API requests to bypass CORS
      '/api/motive': {
        target: 'https://api.gomotive.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/motive/, ''),
        secure: true,
      },
    },
  },
})
