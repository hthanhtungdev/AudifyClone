import { useState, useEffect } from 'react';
import { Play, Pause, Square, Settings, Link2, Loader2, X } from 'lucide-react';
import { Readability } from '@mozilla/readability';

function App() {
  const [url, setUrl] = useState(() => localStorage.getItem('audify_url') || '');
  const [content, setContent] = useState(() => (localStorage.getItem('audify_content') || '').normalize('NFC'));
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(() => parseFloat(localStorage.getItem('audify_speed') || '1.0'));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState(() => localStorage.getItem('audify_voice') || '');
  const [showSettings, setShowSettings] = useState(false);
  const [highlightCharIndex, setHighlightCharIndex] = useState(-1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  // Sync state with localStorage
  useEffect(() => {
    localStorage.setItem('audify_url', url);
  }, [url]);

  useEffect(() => {
    localStorage.setItem('audify_content', content);
  }, [content]);

  useEffect(() => {
    localStorage.setItem('audify_speed', speed.toString());
  }, [speed]);

  useEffect(() => {
    localStorage.setItem('audify_voice', selectedVoiceName);
  }, [selectedVoiceName]);

  // Initialize voices
  useEffect(() => {
    const updateVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      // Chỉ giữ lại các giọng tiếng Việt theo yêu cầu
      const vnVoices = availableVoices.filter(v => v.lang.includes('vi'));
      setVoices(vnVoices);
      
      // Tự động chọn giọng phù hợp nhất nếu chưa chọn
      if (!selectedVoiceName && vnVoices.length > 0) {
        const bestVoice = vnVoices.find(v => v.name.includes('Premium') || v.name.includes('Enhanced')) || 
                         vnVoices[0];
        if (bestVoice) setSelectedVoiceName(bestVoice.name);
      }
    };

    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [selectedVoiceName]);

  const fetchContent = async () => {
    if (!url) return;
    setLoading(true);
    setContent('');
    try {
      // Sử dụng local proxy tự tạo trên server Vite để không bao giờ bị chặn
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      const htmlText = await response.text();
      
      if (!htmlText) throw new Error("Không thể tải trang");

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');
      
      const reader = new Readability(doc);
      const article = reader.parse();

      let finalString = '';

      if (article && article.content) {
        // Thêm newline cho các thẻ block để giữ nguyên paragraph khi lấy text
        let html = article.content;
        html = html.replace(/<br\s*\/?>/gi, '\n');
        html = html.replace(/<\/p>/gi, '\n\n');
        html = html.replace(/<\/(div|h1|h2|h3|h4|h5|h6|li)>/gi, '\n');
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const text = tempDiv.textContent || tempDiv.innerText || '';
        finalString = text.replace(/\n\s*\n/g, '\n\n').trim();
      }

      if (finalString.length > 50) {
        setContent(finalString.normalize("NFC"));
      } else {
        // Fallback: nếu Readability không hiểu được structure (như Docs hay bị)
        const text = doc.body.innerText.replace(/\n\s*\n/g, '\n\n').trim();
        setContent(text.normalize("NFC"));
      }
    } catch (err: any) {
      setContent('Lỗi tải văn bản: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      window.speechSynthesis.pause();
      setIsPlaying(false);
    } else {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        setIsPlaying(true);
      } else {
        playFromStart(0);
      }
    }
  };

  const playFromStart = (startIndex: number = 0) => {
    if (!content) return;
    window.speechSynthesis.cancel();
    
    // Nếu đọc từ giữa đoạn, lấy phần content từ startIndex
    const textToSpeak = content.slice(startIndex);
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    
    const currentVoices = window.speechSynthesis.getVoices();
    const voice = currentVoices.find(v => v.voiceURI === selectedVoiceName) || 
                  currentVoices.find(v => v.name === selectedVoiceName) || 
                  currentVoices.find(v => v.lang.includes('vi'));
                  
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    
    utterance.rate = speed;
    utterance.pitch = 1;

    utterance.onend = () => {
      setIsPlaying(false);
      setHighlightCharIndex(-1);
    };

    utterance.onerror = () => {
      setIsPlaying(false);
      setHighlightCharIndex(-1);
    };

    // Theo dõi vị trí đang đọc để highlight
    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        // Cộng thêm startIndex để highlight đúng vị trí trong content gốc
        setHighlightCharIndex(event.charIndex + startIndex);
      }
    };

    window.speechSynthesis.speak(utterance);
    setIsPlaying(true);
  };

  // Cuộn tự động đến đoạn đang highlight
  useEffect(() => {
    if (highlightCharIndex !== -1) {
      const activeElement = document.querySelector('[data-highlight="true"]');
      if (activeElement) {
        activeElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }
  }, [highlightCharIndex]);

  const handleStop = () => {
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    setHighlightCharIndex(-1);
  };

  return (
    <div className="w-full h-screen bg-black text-gray-200 flex flex-col font-sans">
      <header className="p-4 bg-gray-900 border-b border-gray-800 flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <span className="bg-blue-600 p-1.5 rounded-lg text-white">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <rect x="3" y="8" width="4" height="8" rx="2" />
              <rect x="10" y="4" width="4" height="16" rx="2" />
              <rect x="17" y="10" width="4" height="4" rx="2" />
            </svg>
          </span>
          Audify Clone
        </h1>
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className={`p-2 rounded-full transition-colors ${showSettings ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-400'}`}
        >
          <Settings className="w-6 h-6" />
        </button>
      </header>
      
      {showSettings && (
        <div className="p-4 bg-gray-900 border-b border-gray-800 animate-in slide-in-from-top duration-200">
          <div className="max-w-2xl mx-auto flex flex-col gap-3">
            <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Chọn giọng đọc</label>
            <select 
              value={selectedVoiceName}
              onChange={(e) => setSelectedVoiceName(e.target.value)}
              className="w-full bg-black border border-gray-700 rounded-xl p-3 text-gray-200 focus:border-blue-500 outline-none"
            >
              {voices
                .sort((a, b) => {
                  const aVal = a.name + a.voiceURI;
                  const bVal = b.name + b.voiceURI;
                  const aEnhanced = aVal.toLowerCase().includes('premium') || aVal.toLowerCase().includes('enhanced');
                  const bEnhanced = bVal.toLowerCase().includes('premium') || bVal.toLowerCase().includes('enhanced');
                  return (bEnhanced ? 1 : 0) - (aEnhanced ? 1 : 0);
                })
                .map(v => {
                  const vVal = v.name + v.voiceURI;
                  const isEnhanced = vVal.toLowerCase().includes('premium') || vVal.toLowerCase().includes('enhanced');
                  return (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name.replace('Microsoft', '').replace('Google', '').trim()} 
                      {isEnhanced ? ' (Nâng cao ✨)' : ''}
                    </option>
                  );
                })}
            </select>
            <p className="text-xs text-gray-500 italic">
              Lưu ý: Nếu không thấy giọng tiếng Việt, hãy vào Cài đặt iPhone &rarr; Trợ năng &rarr; Nội dung được đọc &rarr; Giọng nói để tải về.
            </p>
          </div>
        </div>
      )}
      
      <main className="flex-1 overflow-y-auto p-4 flex flex-col items-center">
        <div className="w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-2xl p-4 shadow-2xl mb-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Link2 className="h-5 w-5 text-gray-500" />
              </div>
              <input 
                type="url" 
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Dán URL Google Docs/Truyện..."
                className="w-full pl-10 pr-10 py-3 bg-black border border-gray-800 rounded-xl text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
                onKeyDown={(e) => e.key === 'Enter' && fetchContent()}
              />
              {url && (
                <button
                  onClick={() => setUrl('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-300 transition-colors"
                  title="Xóa URL"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
            <button 
              onClick={fetchContent}
              disabled={loading}
              className="px-5 py-3 bg-blue-600 disabled:bg-blue-800 disabled:text-gray-400 hover:bg-blue-500 rounded-xl font-semibold transition-colors whitespace-nowrap flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Tải chữ"}
            </button>
          </div>
        </div>

        <div className="w-full max-w-3xl flex-1 overflow-y-auto mb-32 lg:mb-10 px-2 lg:px-4">
          {content ? (
            <div className="text-base leading-[1.8] tracking-tight text-gray-300 font-serif pb-10">
              {/* Render content with HTML paragraphs and highlighting */}
              {(() => {
                let globalIndex = 0;
                return content.split(/([\r\n]+)/).map((segment, segIndex) => {
                  if (/^[\r\n]+$/.test(segment)) {
                    globalIndex += segment.length;
                    return null;
                  }
                  
                  return (
                    <p key={segIndex} className="mb-6 text-left whitespace-pre-wrap break-words">
                      {segment.split(/(\s+)/).map((part, i) => {
                        const startIndex = globalIndex;
                        const isHighlighted = highlightCharIndex >= startIndex && highlightCharIndex < startIndex + part.length;
                        globalIndex += part.length;
                        return (
                          <span 
                            key={i} 
                            onClick={() => playFromStart(startIndex)}
                            className={`cursor-pointer transition-colors duration-200 hover:bg-gray-800 rounded px-0.5 ${isHighlighted ? "bg-blue-600 text-white" : ""}`}
                            data-highlight={isHighlighted ? "true" : "false"}
                          >
                            {part}
                          </span>
                        );
                      })}
                    </p>
                  );
                });
              })()}
            </div>
          ) : (
            <p className="text-lg leading-loose text-gray-500 text-center mt-10">
              Chưa có nội dung.<br/> Hãy dán URL (Đặc biệt là link Google Docs bạn vừa cung cấp) và ấn "Tải chữ" để lấy nội dung nhé!
            </p>
          )}
        </div>
      </main>

      {/* Media Controller */}
      <footer className="bg-gray-900 border-t border-gray-800 p-4 pb-8 fixed bottom-0 left-0 right-0 z-10 lg:static">
        <div className="max-w-md mx-auto flex items-center justify-between px-6">
          <button 
            onClick={handleStop}
            className="p-4 rounded-full bg-gray-800 hover:bg-gray-700 transition-transform active:scale-95 text-gray-300"
          >
            <Square className="w-6 h-6 fill-current" />
          </button>
          
          <button 
            onClick={handlePlayPause}
            className="p-6 rounded-full bg-blue-600 hover:bg-blue-500 shadow-[0_0_20px_rgba(37,99,235,0.4)] transition-transform active:scale-95 text-white mx-4"
          >
            {isPlaying ? (
              <Pause className="w-10 h-10 fill-current" />
            ) : (
              <Play className="w-10 h-10 fill-current ml-1" />
            )}
          </button>

          <div className="relative">
            {showSpeedMenu && (
              <div className="absolute bottom-full right-0 mb-4 bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl p-4 w-64 animate-in fade-in slide-in-from-bottom-2 duration-200 z-50">
                <div className="flex flex-col gap-4">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-sm font-semibold text-gray-400">Tốc độ: <span className="text-blue-500">{speed.toFixed(1)}x</span></span>
                  </div>
                  <input 
                    type="range" 
                    min="0.5" 
                    max="3.0" 
                    step="0.1" 
                    value={speed}
                    onChange={(e) => {
                      const newSpeed = parseFloat(e.target.value);
                      setSpeed(newSpeed);
                      if (isPlaying) {
                        handleStop();
                        setTimeout(() => playFromStart(highlightCharIndex), 50);
                      }
                    }}
                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="grid grid-cols-4 gap-1">
                    {[1.0, 1.5, 2.0, 3.0].map(s => (
                      <button
                        key={s}
                        onClick={() => {
                          setSpeed(s);
                          if (isPlaying) {
                            handleStop();
                            setTimeout(() => playFromStart(highlightCharIndex), 50);
                          }
                        }}
                        className={`py-2 rounded-lg text-xs font-bold transition-colors ${speed === s ? 'bg-blue-600 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-400'}`}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <button 
              onClick={() => setShowSpeedMenu(!showSpeedMenu)}
              className={`p-4 rounded-full transition-colors active:scale-95 font-bold w-16 text-center ${showSpeedMenu ? 'bg-blue-600 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
            >
              {speed}x
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
