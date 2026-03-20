import React, { useState, useEffect } from 'react';
import { Play, Pause, Square, Settings, Link2, Loader2 } from 'lucide-react';
import { Readability } from '@mozilla/readability';

function App() {
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [highlightCharIndex, setHighlightCharIndex] = useState(-1);

  // Initialize voices
  useEffect(() => {
    const updateVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      setVoices(availableVoices);
      
      // Tự động chọn giọng Việt đầu tiên nếu chưa chọn
      if (!selectedVoiceName) {
        const vnVoice = availableVoices.find(v => v.lang.includes('vi'));
        if (vnVoice) setSelectedVoiceName(vnVoice.name);
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

      // Tối ưu để bắt text từ Google Docs Mobile View
      // Các link docs.google.com/mobilebasic hiển thị dạng div hoặc p nằm gọn
      
      const reader = new Readability(doc);
      const article = reader.parse();

      if (article && article.textContent && article.textContent.trim().length > 50) {
        setContent(article.textContent.trim());
      } else {
        // Fallback: nếu Readability không hiểu được structure (như Docs hay bị)
        setContent(doc.body.innerText.replace(/\n\s*\n/g, '\n\n').trim());
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
        playFromStart();
      }
    }
  };

  const playFromStart = () => {
    if (!content) return;
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(content);
    
    const currentVoices = window.speechSynthesis.getVoices();
    const voice = currentVoices.find(v => v.name === selectedVoiceName) || 
                  currentVoices.find(v => v.lang.includes('vi'));
                  
    if (voice) {
      utterance.voice = voice;
      // Force lang if needed
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
        setHighlightCharIndex(event.charIndex);
      }
    };

    window.speechSynthesis.speak(utterance);
    setIsPlaying(true);
  };

  const handleStop = () => {
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    setHighlightCharIndex(-1);
  };

  const cycleSpeed = () => {
    const speeds = [1.0, 1.25, 1.5, 2.0, 0.75];
    const currentIndex = speeds.indexOf(speed);
    const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
    setSpeed(nextSpeed);
    
    // Nếu đang phát thì phải khởi động lại với tốc độ mới
    if (isPlaying) {
      handleStop();
      setTimeout(() => {
         // This is a naive restart from beginning. 
         // Real app needs tracking index, but for now we restart.
         playFromStart();
      }, 100);
    }
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
              {voices.filter(v => v.lang.includes('vi')).length > 0 ? (
                voices.filter(v => v.lang.includes('vi')).map(v => (
                  <option key={v.name} value={v.name}>{v.name.replace('Microsoft', '').replace('Google', '').trim()}</option>
                ))
              ) : (
                <option value="">(Không tìm thấy giọng tiếng Việt)</option>
              )}
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
                className="w-full pl-10 pr-4 py-3 bg-black border border-gray-800 rounded-xl text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
                onKeyDown={(e) => e.key === 'Enter' && fetchContent()}
              />
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

        <div className="w-full max-w-2xl flex-1 bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl overflow-y-auto mb-32 lg:mb-10">
          {content ? (
            <div className="text-xl leading-loose text-gray-300 font-serif whitespace-pre-line break-words pb-10">
              {/* Render content with highlighting */}
              {content.split(/(\s+)/).reduce((acc: any[], part, i) => {
                const prevLength = acc.reduce((sum, item) => sum + (item.props ? item.props.children.length : 0), 0);
                const isHighlighted = highlightCharIndex >= prevLength && highlightCharIndex < prevLength + part.length;
                
                acc.push(
                  <span 
                    key={i} 
                    className={isHighlighted ? "bg-blue-600 text-white rounded px-0.5 transition-colors duration-200" : ""}
                  >
                    {part}
                  </span>
                );
                return acc;
              }, [])}
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

          <button 
            onClick={cycleSpeed}
            className="p-4 rounded-full bg-gray-800 hover:bg-gray-700 transition-transform active:scale-95 text-gray-300 font-bold w-16 text-center"
          >
            {speed}x
          </button>
        </div>
      </footer>
    </div>
  );
}

export default App;
