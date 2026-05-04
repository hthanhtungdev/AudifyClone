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
    // Tự động thêm https:// nếu thiếu
    if (targetUrl.indexOf('http://') !== 0 && targetUrl.indexOf('https://') !== 0) {
      targetUrl = 'https://' + targetUrl;
    }

    // Tối ưu Google Docs sang giao diện mobile basic để lấy text
    if (targetUrl.indexOf('docs.google.com/document/d/') !== -1) {
      try {
        const urlObj = new URL(targetUrl);
        urlObj.pathname = urlObj.pathname.replace(/\/(edit|view|preview).*$/, '');
        if (!/\/mobilebasic$/.test(urlObj.pathname)) {
          urlObj.pathname = urlObj.pathname.replace(/\/$/, '') + '/mobilebasic';
        }
        targetUrl = urlObj.toString();
      } catch (e) {
        // Ignore URL parsing errors
      }
    }

    // Parse URL to get origin
    const urlObj = new URL(targetUrl);
    const origin = urlObj.origin;

    // Try multiple strategies
    let fetchResponse;
    let lastError;

    // Strategy 1: Simple fetch with minimal headers
    try {
      fetchResponse = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.8,en-US;q=0.5,en;q=0.3',
        },
        redirect: 'follow'
      });
      
      if (fetchResponse.ok) {
        const contentType = fetchResponse.headers.get('content-type') || 'text/html; charset=utf-8';
        res.setHeader('Content-Type', contentType);
        const text = await fetchResponse.text();
        return res.status(fetchResponse.status).send(text);
      }
      lastError = `Strategy 1 failed: ${fetchResponse.status}`;
    } catch (e) {
      lastError = `Strategy 1 error: ${e.message}`;
    }

    // Strategy 2: With full browser headers
    try {
      fetchResponse = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': origin + '/',
          'Origin': origin,
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0'
        },
        redirect: 'follow'
      });
      
      if (fetchResponse.ok) {
        const contentType = fetchResponse.headers.get('content-type') || 'text/html; charset=utf-8';
        res.setHeader('Content-Type', contentType);
        const text = await fetchResponse.text();
        return res.status(fetchResponse.status).send(text);
      }
      lastError = `Strategy 2 failed: ${fetchResponse.status}`;
    } catch (e) {
      lastError = `Strategy 2 error: ${e.message}`;
    }

    // Strategy 3: Mobile User-Agent
    try {
      fetchResponse = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9',
        },
        redirect: 'follow'
      });
      
      if (fetchResponse.ok) {
        const contentType = fetchResponse.headers.get('content-type') || 'text/html; charset=utf-8';
        res.setHeader('Content-Type', contentType);
        const text = await fetchResponse.text();
        return res.status(fetchResponse.status).send(text);
      }
      lastError = `Strategy 3 failed: ${fetchResponse.status}`;
    } catch (e) {
      lastError = `Strategy 3 error: ${e.message}`;
    }

    // All strategies failed
    res.status(fetchResponse?.status || 500).send(`All fetch strategies failed. Last error: ${lastError}`);
    
  } catch (e) {
    res.status(500).send(e.message || 'Internal Server Error');
  }
}
