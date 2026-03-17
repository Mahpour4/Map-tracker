import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      // Proxy Motive API requests to bypass CORS
      '/api/motive': {
        target: 'https://api.gomotive.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/motive/, ''),
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log('[Motive Proxy] →', req.method, req.url, '→', proxyReq.path);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('[Motive Proxy] ←', proxyRes.statusCode, req.url);
          });
          proxy.on('error', (err, req) => {
            console.error('[Motive Proxy] ERROR', req.url, err.message);
          });
        },
      },
      '/api/whatsapp': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/globalworx': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/proxy-image': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
