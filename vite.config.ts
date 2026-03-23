import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  plugins: [
    react(),
    {
      name: 'local-cors-proxy',
      configureServer(server) {
        server.middlewares.use('/api/proxy', async (req: any, res: any) => {
          // Add basic CORS headers
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');

          // Handle OPTIONS preflight request
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }

          // Dùng req.originalUrl để chắc chắn lấy đúng url parameter
          const urlStr = req.originalUrl || req.url || '';
          let targetUrl = new URL(urlStr, 'http://localhost').searchParams.get('url');
          if (!targetUrl) {
            res.statusCode = 400;
            res.end('Missing url parameter');
            return;
          }
          
          try {
            // Tự động thêm https:// nếu thiếu (thường bị thiếu khi copy từ address bar)
            if (targetUrl.indexOf('http://') !== 0 && targetUrl.indexOf('https://') !== 0) {
              targetUrl = 'https://' + targetUrl;
            }

            // Tối ưu Google Docs sang giao diện mobile basic để lấy text
            if (targetUrl.indexOf('docs.google.com/document/d/') !== -1) {
              try {
                const urlObj = new URL(targetUrl);
                // Xoá /edit, /view, /preview
                urlObj.pathname = urlObj.pathname.replace(/\/(edit|view|preview).*$/, '');
                // Thêm /mobilebasic
                if (!/\/mobilebasic$/.test(urlObj.pathname)) {
                  urlObj.pathname = urlObj.pathname.replace(/\/$/, '') + '/mobilebasic';
                }
                targetUrl = urlObj.toString();
              } catch (e) {
                // Ignore URL parsing errors and try with original
              }
            }

            // Giả lập trình duyệt để vượt qua một số rào cản bot cơ bản
            const fetchResponse = await fetch(targetUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'vi-VN,vi;q=0.8,en-US;q=0.5,en;q=0.3',
              }
            });
            
            res.statusCode = fetchResponse.status;
            
            // Forward the content type if available
            const contentType = fetchResponse.headers.get('content-type');
            if (contentType) {
              res.setHeader('Content-Type', contentType);
            } else {
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
            }

            const text = await fetchResponse.text();
            res.end(text);
          } catch (e: any) {
            res.statusCode = 500;
            res.end(e.message);
          }
        })
      }
    }
  ],
})
