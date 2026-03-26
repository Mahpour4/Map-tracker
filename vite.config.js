import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const BOT_URL = env.VITE_API_URL || 'http://localhost:3001'

  return {
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
        '/api/whatsapp': { target: BOT_URL, changeOrigin: true },
        '/api/globalworx': { target: BOT_URL, changeOrigin: true },
        '/api/proxy-image': { target: BOT_URL, changeOrigin: true },
        '/api/admin':      { target: BOT_URL, changeOrigin: true },
        '/api/local':      { target: BOT_URL, changeOrigin: true },
      },
    },
  }
})
