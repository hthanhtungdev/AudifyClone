import { useState, useEffect, useRef } from 'react';
import { Settings, Loader2, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { Readability } from '@mozilla/readability';

function App() {
  const [url, setUrl] = useState(() => localStorage.getItem('audify_url') || '');
  const [content, setContent] = useState(() => localStorage.getItem('audify_content') || '');
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(() => parseFloat(localStorage.getItem('audify_speed') || '1.0'));
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [rawHTML, setRawHTML] = useState(() => localStorage.getItem('audify_html') || ''); // Store raw HTML

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const webContentRef = useRef<HTMLDivElement>(null);
  const pendingTimeoutRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  const currentSentenceRef = useRef<HTMLElement | null>(null); // Track current sentence element
  const shouldAutoPlayRef = useRef(true); // Control auto-play behavior

  // Debug logger
  const addLog = (message: string) => {
    setDebugLogs(prev => [...prev.slice(-20), `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  // Register Service Worker - only in standalone mode
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    
    if ('serviceWorker' in navigator && isStandalone) {
      // Only register SW when running as PWA
      navigator.serviceWorker.register('/sw.js').catch(() => {});
      addLog('Service Worker registered (PWA mode)');
    } else {
      addLog('Service Worker skipped (Browser mode)');
    }
  }, []);

  // Check if running as PWA
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    
    if (!isStandalone && isIOS) {
      const hasSeenPrompt = localStorage.getItem('pwa_prompt_seen');
      if (!hasSeenPrompt) {
        setTimeout(() => setShowInstallPrompt(true), 3000);
      }
    }
  }, []);

  // Listen for messages from iframe (text clicked in web view)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'SPEAK_TEXT') {
        const text = event.data.text;
        addLog(`Received text from iframe: ${text.substring(0, 50)}...`);
        
        // Speak the text directly
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'vi-VN';
        utterance.rate = speed;
        utterance.pitch = 1;
        utterance.volume = 1;
        
        utterance.onstart = () => {
          setIsPlaying(true);
          addLog('✓ Speaking iframe text');
        };
        
        utterance.onend = () => {
          setIsPlaying(false);
        };
        
        utterance.onerror = (e) => {
          addLog(`✗ Speech error: ${e.error}`);
          setIsPlaying(false);
        };
        
        window.speechSynthesis.speak(utterance);
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [speed]);

  // Load voices - simplified
  useEffect(() => {
    const loadVoices = () => {
      const allVoices = window.speechSynthesis.getVoices();
      addLog(`Total voices available: ${allVoices.length}`);
      
      // Always use system default
      if (!selectedVoice) {
        setSelectedVoice('');
        addLog('Using system default voice');
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, [selectedVoice]);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem('audify_url', url);
  }, [url]);

  useEffect(() => {
    localStorage.setItem('audify_content', content);
  }, [content]);

  useEffect(() => {
    localStorage.setItem('audify_html', rawHTML);
  }, [rawHTML]);

  useEffect(() => {
    localStorage.setItem('audify_speed', speed.toString());
  }, [speed]);

  // Set HTML content once when rawHTML changes
  useEffect(() => {
    if (webContentRef.current && rawHTML) {
      webContentRef.current.innerHTML = rawHTML;
      addLog('HTML content set');
    }
  }, [rawHTML]);

  // Fetch content
  const fetchContent = async () => {
    if (!url) return;
    
    setLoading(true);
    setContent('');
    addLog(`Fetching: ${url}`);
    
    try {
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const htmlText = await response.text();
      addLog(`Received ${htmlText.length} characters`);

      if (!htmlText || htmlText.length < 100) {
        throw new Error('Nội dung quá ngắn hoặc trống');
      }

      // Store raw HTML for rendering
      setRawHTML(htmlText);

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');
      
      // Try Readability first
      const reader = new Readability(doc);
      const article = reader.parse();

      let text = '';
      
      if (article && article.content && article.content.length > 100) {
        addLog('Using Readability parser');
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = article.content;
        
        // Extract paragraphs properly
        const paragraphs: string[] = [];
        const walker = document.createTreeWalker(
          tempDiv,
          NodeFilter.SHOW_ELEMENT,
          null
        );
        
        let node;
        while (node = walker.nextNode()) {
          const el = node as HTMLElement;
          if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI'].includes(el.tagName)) {
            const text = el.textContent?.trim();
            if (text && text.length > 0) {
              paragraphs.push(text);
            }
          }
        }
        
        text = paragraphs.join('\n\n');
      } else {
        // Fallback: get all text from body
        addLog('Using fallback: body text');
        text = doc.body.textContent || '';
      }

      if (!text || text.trim().length < 50) {
        throw new Error('Không tìm thấy nội dung văn bản. URL có thể không hợp lệ hoặc bị chặn.');
      }

      setContent(text.trim());
      addLog(`✓ Loaded ${text.length} characters`);
      
    } catch (err) {
      const errorMsg = (err as Error).message;
      addLog(`✗ Error: ${errorMsg}`);
      alert('❌ Lỗi tải nội dung:\n\n' + errorMsg + '\n\nGợi ý:\n- Kiểm tra URL có đúng không\n- Thử URL khác\n- Một số trang web có thể bị chặn');
      setContent('');
    } finally {
      setLoading(false);
    }
  };

  // Speak a specific element
  const speakElement = (element: HTMLElement) => {
    const text = element.textContent || '';
    
    if (!text || text.trim().length < 10) {
      addLog('Text too short, skipping');
      return;
    }
    
    addLog(`Speaking: ${text.substring(0, 30)}...`);
    
    // Remove highlight from previous element (if different)
    if (currentSentenceRef.current && currentSentenceRef.current !== element) {
      currentSentenceRef.current.classList.remove('speaking');
    }
    
    // Store current element
    currentSentenceRef.current = element;
    
    // Cancel any current speech
    window.speechSynthesis.cancel();
    
    // Add highlight class
    element.classList.add('speaking');
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Create and speak utterance
    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.lang = 'vi-VN';
    utterance.rate = speed;
    utterance.pitch = 1;
    utterance.volume = 1;
    
    utterance.onstart = () => {
      setIsPlaying(true);
      addLog('▶ Playing');
    };
    
    utterance.onend = () => {
      // Remove highlight
      element.classList.remove('speaking');
      
      addLog(`Finished speaking. Auto-play: ${shouldAutoPlayRef.current}`);
      
      // Only auto-play if enabled
      if (!shouldAutoPlayRef.current) {
        setIsPlaying(false);
        addLog('Auto-play disabled, stopping');
        return;
      }
      
      // Find ALL text elements in the document
      const allElements = Array.from(
        webContentRef.current?.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li') || []
      ) as HTMLElement[];
      
      addLog(`Found ${allElements.length} total elements`);
      
      // Find current element index
      const currentIndex = allElements.indexOf(element);
      
      addLog(`Current index: ${currentIndex}`);
      
      if (currentIndex === -1) {
        addLog('Current element not found in list');
        setIsPlaying(false);
        return;
      }
      
      // Get next element
      const nextElement = allElements[currentIndex + 1];
      
      if (nextElement) {
        addLog(`Auto-playing next (${currentIndex + 2}/${allElements.length})`);
        speakElement(nextElement);
      } else {
        setIsPlaying(false);
        addLog('■ Finished - no more paragraphs');
      }
    };
    
    utterance.onerror = (e) => {
      addLog(`✗ Error: ${e.error}`);
      setIsPlaying(false);
      element.classList.remove('speaking');
    };
    
    window.speechSynthesis.speak(utterance);
  };

  // Stop speaking
  const stopSpeaking = () => {
    // Clear any pending timeout
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
    
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    
    // Keep highlight on current element (don't clear it)
    // This helps user see where they paused
    
    utteranceRef.current = null;
    isProcessingRef.current = false;
    addLog('Paused - position saved with highlight');
  };

  // Resume speaking from current position
  const resumeSpeaking = () => {
    if (!currentSentenceRef.current) {
      addLog('No saved position, starting from beginning');
      // Find first paragraph
      const firstParagraph = contentRef.current?.querySelector('p, h1, h2, h3, h4, h5, h6, li') as HTMLElement;
      if (firstParagraph) {
        shouldAutoPlayRef.current = true;
        speakElement(firstParagraph);
      }
      return;
    }
    
    addLog('Resuming from saved position');
    // Resume the saved element
    shouldAutoPlayRef.current = true;
    speakElement(currentSentenceRef.current);
  };

  // Handle play/pause
  const handlePlayPause = () => {
    addLog(`Play/Pause clicked, isPlaying: ${isPlaying}`);
    
    if (isPlaying) {
      stopSpeaking();
    } else {
      resumeSpeaking();
    }
  };

  // Handle previous
  const handlePrevious = () => {
    addLog('Previous clicked');
    
    // Stop current speech
    window.speechSynthesis.cancel();
    
    // Clear current highlight
    if (currentSentenceRef.current) {
      currentSentenceRef.current.classList.remove('speaking');
    }
    
    if (!currentSentenceRef.current) {
      // If no current, find first paragraph
      const firstParagraph = contentRef.current?.querySelector('p, h1, h2, h3, h4, h5, h6, li') as HTMLElement;
      if (firstParagraph) {
        shouldAutoPlayRef.current = true;
        speakElement(firstParagraph);
      }
      return;
    }
    
    // Find previous paragraph
    let prevElement: HTMLElement | null = null;
    let sibling = currentSentenceRef.current.previousElementSibling;
    
    while (sibling) {
      if (sibling.tagName === 'P' || sibling.tagName.match(/^H[1-6]$/) || sibling.tagName === 'LI') {
        prevElement = sibling as HTMLElement;
        break;
      }
      sibling = sibling.previousElementSibling;
    }
    
    // If no previous sibling, try parent's previous sibling
    if (!prevElement && currentSentenceRef.current.parentElement) {
      let parentSibling = currentSentenceRef.current.parentElement.previousElementSibling;
      while (parentSibling && !prevElement) {
        if (parentSibling.tagName === 'P' || parentSibling.tagName.match(/^H[1-6]$/) || parentSibling.tagName === 'LI') {
          prevElement = parentSibling as HTMLElement;
          break;
        }
        const paragraphs = parentSibling.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
        if (paragraphs.length > 0) {
          prevElement = paragraphs[paragraphs.length - 1] as HTMLElement;
          break;
        }
        parentSibling = parentSibling.previousElementSibling;
      }
    }
    
    if (prevElement) {
      addLog('Found previous paragraph');
      shouldAutoPlayRef.current = true;
      speakElement(prevElement);
    } else {
      addLog('No previous paragraph found');
      setIsPlaying(false);
    }
  };

  // Handle next
  const handleNext = () => {
    addLog('Next clicked');
    
    // Stop current speech
    window.speechSynthesis.cancel();
    
    // Clear current highlight
    if (currentSentenceRef.current) {
      currentSentenceRef.current.classList.remove('speaking');
    }
    
    if (!currentSentenceRef.current) {
      // If no current, find first paragraph
      const firstParagraph = contentRef.current?.querySelector('p, h1, h2, h3, h4, h5, h6, li') as HTMLElement;
      if (firstParagraph) {
        shouldAutoPlayRef.current = true;
        speakElement(firstParagraph);
      }
      return;
    }
    
    // Find next paragraph
    let nextElement: HTMLElement | null = null;
    let sibling = currentSentenceRef.current.nextElementSibling;
    
    while (sibling) {
      if (sibling.tagName === 'P' || sibling.tagName.match(/^H[1-6]$/) || sibling.tagName === 'LI') {
        nextElement = sibling as HTMLElement;
        break;
      }
      const child = sibling.querySelector('p, h1, h2, h3, h4, h5, h6, li');
      if (child) {
        nextElement = child as HTMLElement;
        break;
      }
      sibling = sibling.nextElementSibling;
    }
    
    // If no next sibling, try parent's next sibling
    if (!nextElement && currentSentenceRef.current.parentElement) {
      let parentSibling = currentSentenceRef.current.parentElement.nextElementSibling;
      while (parentSibling && !nextElement) {
        if (parentSibling.tagName === 'P' || parentSibling.tagName.match(/^H[1-6]$/) || parentSibling.tagName === 'LI') {
          nextElement = parentSibling as HTMLElement;
          break;
        }
        const child = parentSibling.querySelector('p, h1, h2, h3, h4, h5, h6, li');
        if (child) {
          nextElement = child as HTMLElement;
          break;
        }
        parentSibling = parentSibling.nextElementSibling;
      }
    }
    
    if (nextElement) {
      addLog('Found next paragraph');
      shouldAutoPlayRef.current = true;
      speakElement(nextElement);
    } else {
      addLog('No next paragraph found');
      setIsPlaying(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      {/* Top Bar */}
      <div className="flex-shrink-0 bg-gray-900 border-b border-gray-800 p-3 relative z-50">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onFocus={(e) => e.target.select()}
              placeholder="Nhập URL..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
              onKeyDown={(e) => e.key === 'Enter' && fetchContent()}
              style={{ paddingRight: url ? '36px' : '12px' }}
            />
            {url && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setUrl('');
                  setRawHTML('');
                  setContent('');
                  localStorage.removeItem('audify_url');
                  localStorage.removeItem('audify_html');
                  localStorage.removeItem('audify_content');
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded-full transition-colors"
                type="button"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={fetchContent}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Tải'}
          </button>
        </div>
      </div>

      {/* Content - Render HTML directly with click-to-speak */}
      <div 
        ref={contentRef}
        className="flex-1 overflow-y-auto relative bg-black"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {rawHTML ? (
          <div
            ref={webContentRef}
            className="w-full h-full web-content"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              
              // Get the closest text container
              let textElement: HTMLElement | null = null;
              
              if (target.tagName === 'P' || target.tagName.match(/^H[1-6]$/)) {
                textElement = target;
              } else if (target.closest('p, h1, h2, h3, h4, h5, h6, li')) {
                textElement = target.closest('p, h1, h2, h3, h4, h5, h6, li') as HTMLElement;
              }
              
              if (textElement) {
                shouldAutoPlayRef.current = true; // Enable auto-play when clicking
                speakElement(textElement);
              }
            }}
            style={{
              cursor: 'pointer'
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 p-4">
            <div className="text-center">
              <p className="text-lg mb-2">Nhập URL và nhấn Tải</p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div 
        className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 p-3"
        style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
      >
        <div className="max-w-md mx-auto flex items-center justify-center gap-3">
          <button
            onClick={handlePrevious}
            disabled={!rawHTML}
            className="p-2.5 rounded-full bg-gray-800 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-30 transition-all flex-shrink-0"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={handlePlayPause}
            disabled={!rawHTML}
            className="p-4 rounded-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-30 transition-all shadow-lg flex-shrink-0"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            {isPlaying ? (
              <Pause className="w-6 h-6 fill-current" />
            ) : (
              <Play className="w-6 h-6 fill-current" />
            )}
          </button>

          <button
            onClick={handleNext}
            disabled={!rawHTML}
            className="p-2.5 rounded-full bg-gray-800 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-30 transition-all flex-shrink-0"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <SkipForward className="w-5 h-5" />
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="p-2.5 rounded-full bg-gray-800 hover:bg-gray-700 active:bg-gray-600 transition-all flex-shrink-0"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <Settings className="w-5 h-5" />
          </button>

          <button
            onClick={() => setShowDebug(!showDebug)}
            className="p-2.5 rounded-full bg-gray-800 hover:bg-gray-700 active:bg-gray-600 transition-all flex-shrink-0"
            style={{ WebkitTapHighlightColor: 'transparent' }}
            title="Debug"
          >
            <span className="text-sm">🐛</span>
          </button>
        </div>
      </div>

      {/* Debug Panel */}
      {showDebug && (
        <div className="fixed top-16 left-2 right-2 bg-black/95 border border-green-500 rounded-lg p-3 z-50 max-h-64 overflow-y-auto text-xs font-mono">
          <div className="flex justify-between items-center mb-2">
            <span className="text-green-400 font-bold">DEBUG LOG</span>
            <button 
              onClick={() => setDebugLogs([])}
              className="text-red-400 text-xs"
            >
              Clear
            </button>
          </div>
          {debugLogs.map((log, i) => (
            <div key={i} className="text-green-300 text-[10px] leading-tight">
              {log}
            </div>
          ))}
        </div>
      )}

      {/* Install Prompt */}
      {showInstallPrompt && (
        <div 
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => {
            setShowInstallPrompt(false);
            localStorage.setItem('pwa_prompt_seen', 'true');
          }}
        >
          <div 
            className="bg-gray-900 rounded-2xl p-6 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold mb-4">📱 Cài đặt App</h3>
            <p className="text-gray-300 mb-4 text-sm leading-relaxed">
              Để sử dụng giọng đọc <strong>Linh Nâng cao</strong> từ cài đặt iPhone, hãy cài đặt app này:
            </p>
            <ol className="text-sm text-gray-400 space-y-2 mb-6 list-decimal list-inside">
              <li>Nhấn nút <strong>Chia sẻ</strong> (Share) ở Safari</li>
              <li>Chọn <strong>"Thêm vào Màn hình chính"</strong></li>
              <li>Nhấn <strong>"Thêm"</strong></li>
            </ol>
            <button
              onClick={() => {
                setShowInstallPrompt(false);
                localStorage.setItem('pwa_prompt_seen', 'true');
              }}
              className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white py-3 rounded-lg font-medium"
            >
              Đã hiểu
            </button>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div 
          className="fixed inset-0 bg-black/80 z-50 flex items-end"
          onClick={() => setShowSettings(false)}
        >
          <div 
            className="bg-gray-900 w-full rounded-t-3xl p-6 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: 'max(24px, calc(env(safe-area-inset-bottom) + 24px))' }}
          >
            <div className="w-12 h-1 bg-gray-700 rounded-full mx-auto mb-6"></div>
            
            <h2 className="text-xl font-bold mb-6">Cài đặt</h2>

            {/* Voice Selection - Simplified */}
            <div className="mb-6">
              <label className="text-sm text-gray-400 mb-2 block">Giọng đọc</label>
              <div className="p-4 bg-gray-800 border border-gray-700 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-xl">
                    🎯
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-white">Mặc định hệ thống</div>
                    <div className="text-xs text-gray-400">Sử dụng giọng từ Settings iPhone</div>
                  </div>
                  <div className="text-green-500 text-xl">✓</div>
                </div>
              </div>
            </div>

            {/* Speed Control */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-3">
                <label className="text-sm text-gray-400">Tốc độ</label>
                <span className="text-lg text-blue-500 font-bold">{speed.toFixed(2)}x</span>
              </div>
              
              {/* Buttons for precise control */}
              <div className="flex items-center gap-3 mb-3">
                <button
                  onClick={() => setSpeed(Math.max(0.5, parseFloat((speed - 0.05).toFixed(2))))}
                  className="w-12 h-12 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 rounded-xl flex items-center justify-center text-2xl font-bold transition-colors"
                >
                  −
                </button>
                
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.05"
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  className="flex-1 h-3 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  style={{
                    WebkitAppearance: 'none',
                  }}
                />
                
                <button
                  onClick={() => setSpeed(Math.min(2.0, parseFloat((speed + 0.05).toFixed(2))))}
                  className="w-12 h-12 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 rounded-xl flex items-center justify-center text-2xl font-bold transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            <button
              onClick={() => setShowSettings(false)}
              className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white py-3 rounded-lg font-medium transition-colors"
            >
              Xong
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
