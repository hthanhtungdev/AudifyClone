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
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Register Service Worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
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

  // Load voices
  useEffect(() => {
    const loadVoices = () => {
      const allVoices = window.speechSynthesis.getVoices();
      const viVoices = allVoices.filter(v => v.lang.includes('vi'));
      setVoices(viVoices);
      
      if (!selectedVoice && viVoices.length > 0) {
        setSelectedVoice(viVoices[0].name);
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

  // Split content into paragraphs
  useEffect(() => {
    if (content) {
      const paras = content
        .split(/\n\n+/) // Split by double newlines
        .map(p => p.trim())
        .filter(p => p.length > 0);
      setParagraphs(paras);
    }
  }, [content]);

  // Fetch content
  const fetchContent = async () => {
    if (!url) return;
    
    setLoading(true);
    try {
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      const htmlText = await response.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');
      const reader = new Readability(doc);
      const article = reader.parse();

      let text = '';
      if (article && article.content) {
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
        text = doc.body.textContent || '';
      }

      setContent(text.trim());
      setCurrentParagraph(-1);
    } catch (err) {
      alert('Lỗi tải nội dung: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Stop speaking
  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    utteranceRef.current = null;
  };

  // Speak paragraph - CRITICAL: Must be called directly from user event
  const speakParagraph = (index: number) => {
    if (index < 0 || index >= paragraphs.length) return;

    // Stop current speech
    window.speechSynthesis.cancel();

    // Create utterance
    const text = paragraphs[index];
    const utterance = new SpeechSynthesisUtterance(text);

    // Set voice
    const voice = voices.find(v => v.name === selectedVoice);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = 'vi-VN';
    }

    utterance.rate = speed;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onstart = () => {
      setIsPlaying(true);
      setCurrentParagraph(index);
    };

    utterance.onend = () => {
      // Auto play next paragraph
      if (index + 1 < paragraphs.length) {
        speakParagraph(index + 1);
      } else {
        setIsPlaying(false);
        setCurrentParagraph(-1);
      }
    };

    utterance.onerror = (e) => {
      console.error('Speech error:', e);
      setIsPlaying(false);
    };

    utteranceRef.current = utterance;

    // Speak immediately - NO setTimeout!
    window.speechSynthesis.speak(utterance);

    // Scroll to paragraph
    scrollToParagraph(index);
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
    if (isPlaying) {
      stopSpeaking();
    } else {
      const startIndex = currentParagraph >= 0 ? currentParagraph : 0;
      speakParagraph(startIndex);
    }
  };

  // Handle previous
  const handlePrevious = () => {
    const prevIndex = Math.max(0, currentParagraph - 1);
    speakParagraph(prevIndex);
  };

  // Handle next
  const handleNext = () => {
    const nextIndex = Math.min(paragraphs.length - 1, currentParagraph + 1);
    speakParagraph(nextIndex);
  };

  // Handle paragraph click
  const handleParagraphClick = (index: number) => {
    speakParagraph(index);
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

      {/* Content */}
      <div 
        ref={contentRef}
        className="flex-1 overflow-y-auto p-4 pb-32"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {paragraphs.length > 0 ? (
          <div className="max-w-2xl mx-auto space-y-3">
            {paragraphs.map((para, index) => (
              <div
                key={index}
                data-index={index}
                onClick={() => handleParagraphClick(index)}
                className={`p-4 rounded-lg cursor-pointer transition-all select-none ${
                  currentParagraph === index
                    ? 'bg-blue-600 text-white shadow-lg scale-[1.02]'
                    : 'bg-gray-900 hover:bg-gray-800 active:bg-gray-700'
                }`}
                style={{
                  WebkitTapHighlightColor: 'transparent',
                  WebkitUserSelect: 'none'
                }}
              >
                <p className="text-[15px] leading-relaxed">{para}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <p>Nhập URL và nhấn Tải để bắt đầu</p>
          </div>
        )}
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
        </div>
      </div>

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

            {/* Voice Selection */}
            <div className="mb-6">
              <label className="text-sm text-gray-400 mb-2 block">Giọng đọc</label>
              <select
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 outline-none focus:border-blue-500"
              >
                {voices.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {voice.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Speed Control */}
            <div className="mb-6">
              <div className="flex justify-between mb-2">
                <label className="text-sm text-gray-400">Tốc độ</label>
                <span className="text-sm text-blue-500 font-medium">{speed.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={speed}
                onChange={(e) => setSpeed(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0.5x</span>
                <span>1.0x</span>
                <span>2.0x</span>
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
