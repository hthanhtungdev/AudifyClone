import { useState, useEffect, useRef } from 'react';
import { Settings, Loader2, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { Readability } from '@mozilla/readability';

function App() {
  const [url, setUrl] = useState(() => localStorage.getItem('audify_url') || '');
  const [content, setContent] = useState(() => localStorage.getItem('audify_content') || '');
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentParagraph, setCurrentParagraph] = useState(-1);
  const [speed, setSpeed] = useState(() => parseFloat(localStorage.getItem('audify_speed') || '1.0'));
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingTimeoutRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);

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
    localStorage.setItem('audify_speed', speed.toString());
  }, [speed]);

  // Split content into sentences
  useEffect(() => {
    if (content) {
      // Split by sentence endings (. ! ? and newlines)
      const sentences = content
        .split(/([.!?]\s+|\n+)/)
        .reduce((acc: string[], part, i, arr) => {
          if (i % 2 === 0 && part.trim()) {
            const sentence = part + (arr[i + 1] || '');
            if (sentence.trim().length > 10) {
              acc.push(sentence.trim());
            }
          }
          return acc;
        }, []);
      
      setParagraphs(sentences);
      addLog(`Split into ${sentences.length} sentences`);
    }
  }, [content]);

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
      setCurrentParagraph(-1);
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

  // Stop speaking
  const stopSpeaking = () => {
    // Clear any pending timeout
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
    
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    utteranceRef.current = null;
    isProcessingRef.current = false;
    addLog('Stopped');
  };

  // Speak paragraph - CRITICAL: Must be called directly from user event
  const speakParagraph = (index: number) => {
    addLog(`speakParagraph(${index})`);
    console.log('speakParagraph called with index:', index);
    
    if (index < 0 || index >= paragraphs.length) {
      addLog(`Invalid index: ${index}`);
      console.error('Invalid index:', index, 'Total:', paragraphs.length);
      return;
    }

    // Clear any pending timeout immediately
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
      addLog('Cleared pending timeout');
    }

    // Stop current speech immediately
    window.speechSynthesis.cancel();
    isProcessingRef.current = false;
    addLog('Canceled previous speech');

    // iOS FIX: Small delay after cancel
    pendingTimeoutRef.current = setTimeout(() => {
      pendingTimeoutRef.current = null;
      
      // Create utterance
      const text = paragraphs[index];
      addLog(`Text: ${text.substring(0, 30)}...`);
      console.log('Speaking text:', text.substring(0, 50) + '...');
      
      const utterance = new SpeechSynthesisUtterance(text);

      // Always use system default voice (from iPhone Settings)
      utterance.lang = 'vi-VN';
      addLog('Using system default voice (iPhone Settings)');

      utterance.rate = speed;
      utterance.pitch = 1;
      utterance.volume = 1;

      utterance.onstart = () => {
        addLog(`✓ Speech started: ${index}`);
        console.log('Speech started for index:', index);
        setIsPlaying(true);
        setCurrentParagraph(index);
      };

      utterance.onend = () => {
        addLog(`✓ Speech ended: ${index}`);
        console.log('Speech ended for index:', index);
        
        // Auto play next sentence
        if (index + 1 < paragraphs.length) {
          speakParagraph(index + 1);
        } else {
          setIsPlaying(false);
          setCurrentParagraph(-1);
        }
      };

      utterance.onerror = (e) => {
        addLog(`✗ ERROR: ${e.error} at ${index}`);
        console.error('Speech error:', e.error, 'for index:', index);
        
        // Don't retry on canceled - user might have clicked another sentence
        if (e.error !== 'canceled') {
          setIsPlaying(false);
        }
      };

      utteranceRef.current = utterance;

      // Speak
      window.speechSynthesis.speak(utterance);
      addLog('speak() called');

      // Scroll to paragraph
      scrollToParagraph(index);
    }, 100);
  };

  // Scroll to paragraph
  const scrollToParagraph = (index: number) => {
    if (!contentRef.current) return;

    const element = contentRef.current.querySelector(`[data-index="${index}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Handle play/pause
  const handlePlayPause = () => {
    addLog(`Play/Pause clicked, isPlaying: ${isPlaying}`);
    
    if (isPlaying) {
      stopSpeaking();
    } else {
      const startIndex = currentParagraph >= 0 ? currentParagraph : 0;
      speakParagraph(startIndex);
    }
  };

  // Handle previous
  const handlePrevious = () => {
    addLog('Previous clicked');
    const prevIndex = Math.max(0, currentParagraph - 1);
    speakParagraph(prevIndex);
  };

  // Handle next
  const handleNext = () => {
    addLog('Next clicked');
    const nextIndex = Math.min(paragraphs.length - 1, currentParagraph + 1);
    speakParagraph(nextIndex);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      {/* Top Bar */}
      <div className="flex-shrink-0 bg-gray-900 border-b border-gray-800 p-3">
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder="Nhập URL..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
            onKeyDown={(e) => e.key === 'Enter' && fetchContent()}
          />
          <button
            onClick={fetchContent}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Tải'}
          </button>
        </div>
      </div>

      {/* Content - Web view with text overlay option */}
      <div 
        ref={contentRef}
        className="flex-1 overflow-hidden relative"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {url ? (
          <div className="h-full w-full relative">
            {/* Web iframe */}
            <iframe
              src={`/api/proxy?url=${encodeURIComponent(url)}`}
              className="w-full h-full border-0 bg-white"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
              title="Web Browser"
            />
            
            {/* Floating text overlay button */}
            {paragraphs.length > 0 && (
              <button
                onClick={() => {
                  // Show text overlay modal
                  const modal = document.getElementById('text-overlay-modal');
                  if (modal) modal.style.display = 'flex';
                }}
                className="fixed bottom-24 right-4 bg-blue-600 text-white p-4 rounded-full shadow-lg z-20 active:scale-95 transition-transform"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path d="M3 9h14V7H3v2zm0 4h14v-2H3v2zm0 4h14v-2H3v2zm16 0h2v-2h-2v2zm0-10v2h2V7h-2zm0 6h2v-2h-2v2z"/>
                </svg>
              </button>
            )}
            
            {/* Hint overlay */}
            {!isPlaying && (
              <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-blue-600/90 text-white px-4 py-2 rounded-full text-sm shadow-lg backdrop-blur z-10 pointer-events-none">
                💡 Nhấn nút 📄 để xem văn bản và nghe
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 p-4">
            <div className="text-center">
              <p className="text-lg mb-2">Nhập URL và nhấn Tải</p>
              <p className="text-sm text-gray-600">Web sẽ hiển thị và bạn có thể click để nghe</p>
            </div>
          </div>
        )}
      </div>
      
      {/* Text Overlay Modal */}
      <div
        id="text-overlay-modal"
        className="fixed inset-0 bg-black/80 z-50 hidden items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            e.currentTarget.style.display = 'none';
          }
        }}
      >
        <div className="bg-gray-900 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-gray-800">
            <h3 className="text-lg font-bold">📖 Văn bản</h3>
            <button
              onClick={() => {
                const modal = document.getElementById('text-overlay-modal');
                if (modal) modal.style.display = 'none';
              }}
              className="p-2 hover:bg-gray-800 rounded-lg"
            >
              ✕
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {paragraphs.map((para, index) => (
              <div
                key={index}
                onClick={() => {
                  // Speak this paragraph
                  window.speechSynthesis.cancel();
                  
                  const utterance = new SpeechSynthesisUtterance(para);
                  utterance.lang = 'vi-VN';
                  utterance.rate = speed;
                  utterance.pitch = 1;
                  utterance.volume = 1;
                  
                  utterance.onstart = () => {
                    setIsPlaying(true);
                    setCurrentParagraph(index);
                  };
                  
                  utterance.onend = () => {
                    // Auto play next
                    if (index + 1 < paragraphs.length) {
                      setTimeout(() => {
                        const nextBtn = document.querySelector(`[data-para-index="${index + 1}"]`) as HTMLElement;
                        if (nextBtn) nextBtn.click();
                      }, 100);
                    } else {
                      setIsPlaying(false);
                      setCurrentParagraph(-1);
                    }
                  };
                  
                  utterance.onerror = () => {
                    setIsPlaying(false);
                  };
                  
                  window.speechSynthesis.speak(utterance);
                }}
                data-para-index={index}
                className={`p-3 rounded-lg cursor-pointer transition-all select-none ${
                  currentParagraph === index
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'bg-gray-800 hover:bg-gray-700 active:bg-gray-600'
                }`}
                style={{
                  WebkitTapHighlightColor: 'transparent',
                  WebkitUserSelect: 'none'
                }}
              >
                <p className="text-sm leading-relaxed">{para}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Controls */}
      <div 
        className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 p-4"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        <div className="max-w-md mx-auto flex items-center justify-center gap-4">
          <button
            onClick={handlePrevious}
            disabled={!paragraphs.length || currentParagraph <= 0}
            className="p-3 rounded-full bg-gray-800 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-30 transition-all"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={handlePlayPause}
            disabled={!paragraphs.length}
            className="p-5 rounded-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-30 transition-all shadow-lg"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            {isPlaying ? (
              <Pause className="w-7 h-7 fill-current" />
            ) : (
              <Play className="w-7 h-7 fill-current" />
            )}
          </button>

          <button
            onClick={handleNext}
            disabled={!paragraphs.length || currentParagraph >= paragraphs.length - 1}
            className="p-3 rounded-full bg-gray-800 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-30 transition-all"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <SkipForward className="w-5 h-5" />
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="p-3 rounded-full bg-gray-800 hover:bg-gray-700 active:bg-gray-600 transition-all"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <Settings className="w-5 h-5" />
          </button>

          <button
            onClick={() => setShowDebug(!showDebug)}
            className="p-3 rounded-full bg-gray-800 hover:bg-gray-700 active:bg-gray-600 transition-all"
            style={{ WebkitTapHighlightColor: 'transparent' }}
            title="Debug"
          >
            <span className="text-xs font-mono">🐛</span>
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
              
              <div className="mt-3 p-3 bg-blue-900/30 border border-blue-700/50 rounded-lg text-xs text-blue-300">
                💡 <strong>Mẹo:</strong> Để thay đổi giọng đọc, vào Settings iPhone → Accessibility → Spoken Content → Voices → Chọn <strong>Linh (Nâng cao)</strong>
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
              
              {/* Quick preset buttons */}
              <div className="grid grid-cols-4 gap-2">
                {[0.8, 1.0, 1.2, 1.5].map((presetSpeed) => (
                  <button
                    key={presetSpeed}
                    onClick={() => setSpeed(presetSpeed)}
                    className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                      Math.abs(speed - presetSpeed) < 0.05
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {presetSpeed}x
                  </button>
                ))}
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
