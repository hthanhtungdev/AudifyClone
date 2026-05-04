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

    // Giả lập trình duyệt iPhone để vượt qua rào cản bot
    const fetchResponse = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': targetUrl,
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      }
    });
    
    // Forward the content type if available
    const contentType = fetchResponse.headers.get('content-type') || 'text/html; charset=utf-8';
    res.setHeader('Content-Type', contentType);

    const text = await fetchResponse.text();
    
    // Inject interactive text-to-speech script
    const injectedScript = `
      <script>
        console.log('[Audify] Interactive TTS script loaded');
        
        // Listen for text selection and click
        document.addEventListener('click', function(e) {
          const target = e.target;
          
          // Get text content from clicked element
          let textContent = '';
          
          // Try to get paragraph or heading
          if (target.tagName === 'P' || target.tagName.match(/^H[1-6]$/)) {
            textContent = target.textContent;
          } else if (target.closest('p, h1, h2, h3, h4, h5, h6, li, div')) {
            const parent = target.closest('p, h1, h2, h3, h4, h5, h6, li, div');
            textContent = parent.textContent;
          } else {
            textContent = target.textContent;
          }
          
          if (textContent && textContent.trim().length > 10) {
            console.log('[Audify] Text clicked:', textContent.substring(0, 50));
            
            // Send to parent window
            window.parent.postMessage({
              type: 'SPEAK_TEXT',
              text: textContent.trim()
            }, '*');
            
            // Visual feedback
            target.style.backgroundColor = '#3b82f6';
            target.style.color = 'white';
            setTimeout(() => {
              target.style.backgroundColor = '';
              target.style.color = '';
            }, 2000);
          }
        });
        
        // Add hover effect
        const style = document.createElement('style');
        style.textContent = \`
          p:hover, h1:hover, h2:hover, h3:hover, h4:hover, h5:hover, h6:hover, li:hover {
            background-color: rgba(59, 130, 246, 0.1) !important;
            cursor: pointer !important;
            transition: background-color 0.2s !important;
          }
        \`;
        document.head.appendChild(style);
        
        console.log('[Audify] Click listener and hover styles added');
      </script>
    `;
    
    // Inject before </body> or </html> or at the end
    let modifiedText = text;
    if (text.includes('</body>')) {
      modifiedText = text.replace('</body>', injectedScript + '</body>');
    } else if (text.includes('</html>')) {
      modifiedText = text.replace('</html>', injectedScript + '</html>');
    } else {
      modifiedText = text + injectedScript;
    }
    
    res.status(fetchResponse.status).send(modifiedText);
  } catch (e) {
    res.status(500).send(e.message || 'Internal Server Error');
  }
}
