export default async function handler(req, res) {
  // Add basic CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');

  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  let targetUrl = req.query.url;

  if (!targetUrl) {
    res.status(400).send('Missing url parameter');
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
    
    // Forward the content type if available
    const contentType = fetchResponse.headers.get('content-type') || 'text/html; charset=utf-8';
    res.setHeader('Content-Type', contentType);

    const text = await fetchResponse.text();
    res.status(fetchResponse.status).send(text);
  } catch (e) {
    res.status(500).send(e.message || 'Internal Server Error');
  }
}
