import { useState, useEffect, useRef } from 'react';
import { Settings, Link2, Loader2 } from 'lucide-react';
import { Readability } from '@mozilla/readability';

function App() {
  const [url, setUrl] = useState(() => localStorage.getItem('audify_url') || '');
  const [content, setContent] = useState(() => (localStorage.getItem('audify_content') || '').normalize('NFC'));
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlayingState] = useState(false);
  const isPlayingRef = useRef(false);
  const setIsPlaying = (val: boolean) => {
    setIsPlayingState(val);
    isPlayingRef.current = val;
  };
  const [speed, setSpeed] = useState(() => parseFloat(localStorage.getItem('audify_speed') || '1.0'));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState(() => localStorage.getItem('audify_voice') || '');
  const [showSettings, setShowSettings] = useState(false);
  const [highlightCharIndex, setHighlightCharIndex] = useState(-1);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);

  const lastScrollY = useRef(0);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const lastScrollTime = useRef(0);
  const isScrollingToRef = useRef(false);

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

  // Initialize voices - CHỈ giọng thiết bị
  useEffect(() => {
    const updateVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      // Chỉ giữ lại các giọng tiếng Việt từ thiết bị
      const vnVoices = availableVoices.filter(v => 
        v.lang.includes('vi') && 
        !v.name.includes('Google') && 
        !v.name.includes('Microsoft Online')
      );
      setVoices(vnVoices);

      // Tự động chọn giọng Premium/Enhanced tốt nhất nếu chưa chọn
      if (!selectedVoiceName && vnVoices.length > 0) {
        const sortedBest = [...vnVoices].sort((a, b) => {
          const vA = (a.name + a.voiceURI).toLowerCase();
          const vB = (b.name + b.voiceURI).toLowerCase();
          const rank = (v: string) => {
            if (v.includes('premium')) return 3;
            if (v.includes('enhanced') || v.includes('hq')) return 2;
            if (v.includes('compact')) return -1;
            return 0;
          };
          return rank(vB) - rank(vA);
        });
        
        const bestVoice = sortedBest[0];
        const originalIdx = vnVoices.findIndex(v => v === bestVoice);
        setSelectedVoiceName(`${bestVoice.voiceURI}|${originalIdx}`);
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
      handlePause();
    } else {
      setIsAutoScrollEnabled(true);
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        setIsPlaying(true);
      } else {
        playFromStart(highlightCharIndex !== -1 ? highlightCharIndex : 0, false);
      }
    }
  };

  const handlePause = () => {
    window.speechSynthesis.cancel();
    setIsPlaying(false);
  };

  const updateSpeed = (newSpeed: number) => {
    setSpeed(newSpeed);
    if (isPlaying) {
      handlePause();
    }
  };

  const playFromStart = (startIndex: number = 0, shouldJumpToStart: boolean = true) => {
    if (!content) return;
    setIsAutoScrollEnabled(true); 

    let actualStartIndex = startIndex;

    if (shouldJumpToStart) {
      let paragraphStartIndex = content.lastIndexOf('\n', startIndex - 1);
      paragraphStartIndex = paragraphStartIndex === -1 ? 0 : paragraphStartIndex + 1;
      actualStartIndex = paragraphStartIndex;
    }

    setHighlightCharIndex(actualStartIndex);

    // Haptic feedback cho iPhone
    if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(10);
    }

    // Unlock audio trên iOS
    const wakeUp = new SpeechSynthesisUtterance("");
    window.speechSynthesis.speak(wakeUp);
    
    // Nhảy tới vị trí đang đọc
    if (mainContentRef.current) {
      const activeElement = document.querySelector(`span[data-index="${startIndex}"]`) as HTMLElement;
      if (activeElement) {
        const container = mainContentRef.current;
        const containerRect = container.getBoundingClientRect();
        const elementRect = activeElement.getBoundingClientRect();
        
        const targetTop = container.scrollTop + (elementRect.top - containerRect.top) - (containerRect.height / 3);
        
        container.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
        lastScrollTime.current = Date.now();
      }
    }
    
    window.speechSynthesis.cancel();

    const textToSpeak = content.slice(actualStartIndex);
    const utterance = new SpeechSynthesisUtterance(textToSpeak);

    const parts = selectedVoiceName.split('|');
    const targetUri = parts[0];
    const targetIdx = parts.length > 1 ? parseInt(parts[1], 10) : -1;

    let voice: SpeechSynthesisVoice | undefined;
    
    if (targetIdx !== -1 && voices[targetIdx] && voices[targetIdx].voiceURI === targetUri) {
      voice = voices[targetIdx];
    } else {
      voice = voices.find(v => v.voiceURI === targetUri) ||
        voices.find(v => v.name === targetUri) ||
        voices[0];
    }

    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }

    utterance.rate = speed;
    utterance.pitch = 1;

    utterance.onend = () => {
      setIsPlaying(false);
    };

    utterance.onerror = () => {
      setIsPlaying(false);
    };

    utterance.onstart = () => {
      setIsPlaying(true);
    };

    utterance.onpause = () => {
      setIsPlaying(false);
    };

    utterance.onresume = () => {
      setIsPlaying(true);
    };

    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        setHighlightCharIndex(event.charIndex + actualStartIndex);
      }
    };

    setTimeout(() => {
      if (isPlayingRef.current || startIndex > 0) { 
        window.speechSynthesis.speak(utterance);
        setIsPlaying(true);
      }
    }, 10);
  };

  // Heartbeat để tránh iOS tự động dừng sau 15s
  useEffect(() => {
    let interval: any;
    
    if (isPlaying) {
      interval = setInterval(() => {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }, 10000);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Auto-scroll tối ưu cho iPhone
  useEffect(() => {
    if (highlightCharIndex !== -1 && isAutoScrollEnabled && mainContentRef.current) {
      const now = Date.now();
      if (now - lastScrollTime.current < 1500) return; 

      const activeElement = document.querySelector('[data-highlight="true"]') as HTMLElement;
      if (activeElement) {
        const container = mainContentRef.current;
        const containerRect = container.getBoundingClientRect();
        const elementRect = activeElement.getBoundingClientRect();
        const relativeTop = elementRect.top - containerRect.top;

        if (relativeTop > containerRect.height * 0.4 || relativeTop < 50) {
          const targetTop = container.scrollTop + relativeTop - (containerRect.height / 3);
          
          isScrollingToRef.current = true;
          container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
          
          lastScrollTime.current = now;
          setTimeout(() => { isScrollingToRef.current = false; }, 800);
        }
      }
    }
  }, [highlightCharIndex, isAutoScrollEnabled]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const currentScrollY = e.currentTarget.scrollTop;
    
    if (!isScrollingToRef.current && isPlaying && isAutoScrollEnabled) {
      if (Math.abs(currentScrollY - lastScrollY.current) > 5) {
        setIsAutoScrollEnabled(false);
      }
    }
    
    lastScrollY.current = currentScrollY;
  };

  return (
    <div className="w-full h-screen bg-black text-white flex flex-col font-sans">
      {/* Top Bar - Giống Safari Mobile */}
      <div className="bg-[#1c1c1e] border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
            <path d="M3 12h18M3 6h18M3 18h18"/>
          </svg>
        </button>
        
        <div className="flex-1 bg-[#2c2c2e] rounded-lg px-3 py-2 flex items-center gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/docume..."
            className="flex-1 bg-transparent text-sm text-gray-300 placeholder-gray-500 outline-none"
            onKeyDown={(e) => e.key === 'Enter' && fetchContent()}
          />
        </div>
        
        <button 
          onClick={fetchContent}
          disabled={loading}
          className="p-2 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              <path d="M9 10l6 2-6 2V10z"/>
            </svg>
          )}
        </button>
      </div>

      {/* Main Content Area */}
      <main 
        ref={mainContentRef}
        className="flex-1 overflow-y-auto px-4 py-6"
        onScroll={handleScroll}
        onWheel={() => isPlaying && setIsAutoScrollEnabled(false)}
        onTouchMove={() => isPlaying && setIsAutoScrollEnabled(false)}
      >
        {content ? (
          <div className="max-w-2xl mx-auto">
            {/* Title */}
            <h1 className="text-2xl font-bold mb-6 text-center border-b border-gray-800 pb-4">
              {content.split('\n')[0].slice(0, 100)}
            </h1>
            
            {/* Content */}
            <div className="text-base leading-relaxed text-gray-200" style={{ textRendering: 'optimizeLegibility' }}>
              {(() => {
                let currentGlobalIndex = 0;
                return content.split(/([\r\n]+)/).map((segment, segIndex) => {
                  if (/^[\r\n]+$/.test(segment)) {
                    currentGlobalIndex += segment.length;
                    return null;
                  }

                  return (
                    <p 
                      key={segIndex} 
                      className="mb-5 text-justify"
                    >
                      {segment.split(/(\s+)/).map((part, i) => {
                        const wordStartIdx = currentGlobalIndex;
                        const isHighlighted = highlightCharIndex >= wordStartIdx && highlightCharIndex < wordStartIdx + part.length;
                        currentGlobalIndex += part.length;
                        return (
                          <span
                            key={i}
                            onClick={(e) => {
                              if (e.detail > 2) return; 
                              playFromStart(wordStartIdx);
                            }}
                            data-index={wordStartIdx}
                            className={`cursor-pointer transition-all duration-150 ${isHighlighted ? "bg-blue-600 text-white px-1 rounded" : ""}`}
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
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Link2 className="w-16 h-16 mb-4 opacity-30" />
            <p className="text-center">Dán URL và nhấn nút tải để bắt đầu</p>
          </div>
        )}
        
        <div className="h-24"></div>
      </main>

      {/* Resume Auto-scroll Button */}
      {!isAutoScrollEnabled && isPlaying && (
        <button 
          onClick={() => setIsAutoScrollEnabled(true)}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium z-10"
        >
          Tiếp tục cuộn tự động
        </button>
      )}

      {/* Bottom Control Bar - Giống ảnh */}
      <div className="bg-[#1c1c1e] border-t border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between max-w-md mx-auto">
          {/* Previous Button */}
          <button
            onClick={() => {
              const prevIndex = Math.max(0, highlightCharIndex - 100);
              playFromStart(prevIndex);
            }}
            disabled={!content}
            className="p-3 disabled:opacity-30 transition-opacity"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>

          {/* Next Button */}
          <button
            onClick={() => {
              const nextIndex = Math.min(content.length - 1, highlightCharIndex + 100);
              playFromStart(nextIndex);
            }}
            disabled={!content}
            className="p-3 disabled:opacity-30 transition-opacity"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>

          {/* Play/Pause Button */}
          <button
            onClick={handlePlayPause}
            disabled={!content}
            className="p-4 disabled:opacity-30 transition-opacity"
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-9 h-9 text-blue-500">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-9 h-9 text-blue-500">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>

          {/* Settings Button */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-3 transition-colors ${showSettings ? 'text-blue-500' : ''}`}
          >
            <Settings className="w-7 h-7" />
          </button>

          {/* Folder/More Button */}
          <button className="p-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div 
          className="fixed inset-0 bg-black/80 z-50 flex items-end"
          onClick={() => setShowSettings(false)}
        >
          <div 
            className="bg-[#1c1c1e] w-full rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-6"></div>
            
            <h2 className="text-xl font-bold mb-6">Cài đặt</h2>
            
            {/* Voice Selection */}
            <div className="mb-6">
              <label className="text-sm text-gray-400 mb-2 block">Giọng đọc</label>
              <select
                value={selectedVoiceName}
                onChange={(e) => setSelectedVoiceName(e.target.value)}
                className="w-full bg-[#2c2c2e] border border-gray-700 rounded-xl p-3 text-white outline-none"
              >
                <option value="">Mặc định thiết bị</option>
                
                {[...voices]
                  .map((v, originalIdx) => {
                    const vVal = (v.name + v.voiceURI).toLowerCase();
                    const isPremium = /\b(premium|enhanced|hq|high|natural|pro)\b/i.test(vVal);
                    const isCompact = vVal.includes('compact');
                    
                    let displayName = v.name
                      .replace('Microsoft ', '')
                      .replace(/\(Enhanced\)/i, '')
                      .replace(/\(Premium\)/i, '')
                      .replace(/\(Compact\)/i, '')
                      .replace(' (Natural)', '')
                      .trim();

                    if (isPremium) {
                      displayName += ' ✨';
                    }

                    return { v, displayName, isPremium, isCompact, value: `${v.voiceURI}|${originalIdx}` };
                  })
                  .sort((a, b) => {
                    const rank = (item: any) => {
                      if (item.isPremium) return 2;
                      if (item.isCompact) return -1;
                      return 0;
                    };
                    const rA = rank(a);
                    const rB = rank(b);
                    if (rA !== rB) return rB - rA;
                    return a.displayName.localeCompare(b.displayName);
                  })
                  .map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.displayName}
                    </option>
                  ))
                }
              </select>
            </div>

            {/* Speed Control */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-gray-400">Tốc độ đọc</label>
                <span className="text-sm text-blue-500 font-medium">{speed.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={speed}
                onChange={(e) => updateSpeed(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0.5x</span>
                <span>1.0x</span>
                <span>2.0x</span>
              </div>
            </div>

            {/* Close Button */}
            <button
              onClick={() => setShowSettings(false)}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-medium transition-colors"
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
