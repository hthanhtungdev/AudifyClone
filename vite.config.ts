import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-cors-proxy',
      configureServer(server) {
        server.middlewares.use('/api/proxy', async (req: any, res: any) => {
          // Lấy URL từ query string
          const targetUrl = new URL(req.url || '', 'http://localhost').searchParams.get('url');
          if (!targetUrl) {
            res.statusCode = 400;
            res.end('Missing url parameter');
            return;
          }
          
          try {
            // Giả lập trình duyệt để vượt qua một số rào cản bot cơ bản
            const fetchResponse = await fetch(targetUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
              }
            });
            const text = await fetchResponse.text();
            
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*');
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
