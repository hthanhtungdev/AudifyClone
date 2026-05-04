import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, Settings, Link2, Loader2, X } from 'lucide-react';
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
  const [showHeader, setShowHeader] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);

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

    setShowScrollTop(currentScrollY > 300);

    if (currentScrollY > lastScrollY.current && currentScrollY > 100) {
      setShowHeader(false);
    } else if (currentScrollY < lastScrollY.current || currentScrollY < 10) {
      setShowHeader(true);
    }
    
    lastScrollY.current = currentScrollY;
  };

  const scrollToTop = () => {
    if (mainContentRef.current) {
      mainContentRef.current.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
      setShowHeader(true);
    }
  };

  const handleStop = () => {
    handlePause();
    setHighlightCharIndex(-1);
  };

  return (
    <div className="w-full h-screen bg-black text-gray-200 flex flex-col font-sans">
      {/* Header */}
      <header className={`bg-gray-900 border-b border-gray-800 flex items-center justify-between transition-all duration-300 overflow-hidden ${showHeader ? 'h-16 p-4 opacity-100' : 'h-0 p-0 opacity-0 border-0'}`}>
        <h1 className="text-xl font-bold flex items-center gap-2 whitespace-nowrap">
          <span className="bg-blue-600 p-1.5 rounded-lg text-white">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <rect x="3" y="8" width="4" height="8" rx="2" />
              <rect x="10" y="4" width="4" height="16" rx="2" />
              <rect x="17" y="10" width="4" height="4" rx="2" />
            </svg>
          </span>
          Audify
        </h1>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-2 rounded-full transition-colors ${showSettings ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-400'}`}
        >
          <Settings className="w-6 h-6" />
        </button>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="p-3 bg-gray-900 border-b border-gray-800 animate-in slide-in-from-top duration-200">
          <div className="max-w-2xl mx-auto flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Chọn giọng đọc</label>
            </div>
            <select
              value={selectedVoiceName}
              onChange={(e) => setSelectedVoiceName(e.target.value)}
              className="w-full bg-black border border-gray-700 rounded-xl p-3 text-gray-200 focus:border-blue-500 outline-none text-sm"
            >
              <option value="">-- Mặc định thiết bị --</option>
              
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
                    displayName += ' (Nâng cao ✨)';
                  } else if (isCompact) {
                    displayName += ' (Tiêu chuẩn)';
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
                .map((item, _, arr) => {
                  let finalLabel = item.displayName;
                  
                  const sameNameIndices = arr.filter(ai => ai.displayName === item.displayName);
                  if (sameNameIndices.length > 1) {
                    const orderInSameName = sameNameIndices.findIndex(ai => ai.value === item.value) + 1;
                    finalLabel += ` #${orderInSameName}`;
                    
                    const uriHint = item.v.voiceURI.split('.').pop() || '';
                    if (uriHint) {
                      finalLabel += ` [..${uriHint.slice(-8)}]`;
                    }
                  }

                  return (
                    <option key={item.value} value={item.value}>
                      {finalLabel}
                    </option>
                  );
                })
              }
            </select>

            {/* Speed Control */}
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Tốc độ đọc</label>
              <span className="text-sm text-gray-300">{speed.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={speed}
              onChange={(e) => updateSpeed(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      )}

      {/* Main Content */}
      <main 
        ref={mainContentRef}
        className="flex-1 overflow-y-auto p-4 flex flex-col items-center custom-scrollbar relative"
        onScroll={handleScroll}
        onWheel={() => isPlaying && setIsAutoScrollEnabled(false)}
        onTouchMove={() => isPlaying && setIsAutoScrollEnabled(false)}
      >
        <div className={`w-full max-w-2xl transition-all duration-300 ${showHeader ? 'translate-y-0 opacity-100 scale-100 mb-4' : '-translate-y-4 opacity-0 scale-95 pointer-events-none h-0 mb-0'}`}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 shadow-2xl">
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
                  className="w-full pl-10 pr-10 py-3 bg-black border border-gray-800 rounded-xl text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors text-sm"
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
                className="px-5 py-3 bg-blue-600 disabled:bg-blue-800 disabled:text-gray-400 hover:bg-blue-500 rounded-xl font-semibold transition-colors whitespace-nowrap flex items-center gap-2 text-sm"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Tải chữ"}
              </button>
            </div>
          </div>
        </div>

        <div className="w-full max-w-3xl mb-32 lg:mb-10 px-2 lg:px-4">
          {content ? (
            <div className="text-base leading-[1.6] text-gray-300 font-sans pb-10" style={{ textRendering: 'optimizeLegibility' }}>
              {(() => {
                let currentGlobalIndex = 0;
                return content.split(/([\r\n]+)/).map((segment, segIndex) => {
                  if (/^[\r\n]+$/.test(segment)) {
                    currentGlobalIndex += segment.length;
                    return null;
                  }

                  const pStartIdx = currentGlobalIndex;
                  const pEndIdx = pStartIdx + segment.length;
                  const isParagraphActive = highlightCharIndex >= pStartIdx && highlightCharIndex < pEndIdx;

                  return (
                    <p 
                      key={segIndex} 
                      className={`mb-6 text-left whitespace-pre-wrap break-words px-4 py-1 transition-all duration-300 rounded-xl will-change-transform ${isParagraphActive ? "border-l-4 border-emerald-500/50 pl-4" : "border-l-4 border-transparent pl-4"}`}
                    >
                      <span className={`${isParagraphActive ? "bg-emerald-600/20 ring-4 ring-emerald-600/20 rounded-sm" : ""}`} style={{ boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}>
                      {segment.split(/(\s+)/).map((part, i) => {
                        const wordStartIdx = currentGlobalIndex;
                        const isHighlighted = highlightCharIndex >= wordStartIdx && highlightCharIndex < wordStartIdx + part.length;
                        currentGlobalIndex += part.length;
                        const isWhitespace = /^\s+$/.test(part);
                        return (
                          <span
                            key={i}
                            onClick={(e) => {
                              if (e.detail > 2) return; 
                              playFromStart(wordStartIdx);
                            }}
                            data-index={wordStartIdx}
                            className={`cursor-pointer transition-all duration-200 hover:bg-white/10 rounded select-none ${!isWhitespace ? "px-1" : "px-0"} ${isHighlighted ? "bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.5)] font-bold scale-105" : ""}`}
                            data-highlight={isHighlighted ? "true" : "false"}
                          >
                            {part}
                          </span>
                        );
                      })}
                      </span>
                    </p>
                  );
                });
              })()}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-gray-600">
              <Link2 className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-center font-medium">Chưa có nội dung. Hãy dán URL và ấn "Tải chữ"!</p>
            </div>
          )}
        </div>

        {/* Resume Auto-scroll Button */}
        {!isAutoScrollEnabled && isPlaying && (
          <button 
            onClick={() => setIsAutoScrollEnabled(true)}
            className="fixed bottom-32 bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg animate-in fade-in slide-in-from-bottom duration-300 flex items-center gap-2 text-sm font-bold z-10"
          >
            Tiếp tục cuộn tự động
          </button>
        )}

        {/* Scroll To Top Button */}
        {showScrollTop && (
          <button 
            onClick={scrollToTop}
            className={`fixed ${!isAutoScrollEnabled && isPlaying ? 'bottom-44' : 'bottom-32'} right-6 bg-gray-800 text-white p-4 rounded-full shadow-2xl hover:bg-gray-700 transition-all active:scale-90 z-20 border border-gray-700`}
            title="Cuộn lên đầu"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
              <path d="M18 15l-6-6-6 6"/>
            </svg>
          </button>
        )}
      </main>

      {/* Control Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 p-4 shadow-2xl">
        <div className="max-w-2xl mx-auto flex items-center justify-center gap-4">
          <button
            onClick={handleStop}
            disabled={!content}
            className="p-3 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800 disabled:opacity-50 rounded-full transition-colors"
            title="Dừng"
          >
            <Square className="w-6 h-6" />
          </button>
          
          <button
            onClick={handlePlayPause}
            disabled={!content}
            className="p-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:opacity-50 rounded-full transition-colors shadow-lg"
            title={isPlaying ? "Tạm dừng" : "Phát"}
          >
            {isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
