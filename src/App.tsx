import { useState, useEffect, useRef } from 'react';

import { Play, Pause, Square, Settings, Link2, Loader2, X, Plus, Minus } from 'lucide-react';
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
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [showHeader, setShowHeader] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);


  const GOOGLE_TTS_ID = 'google_v_online';
  const googleAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastScrollY = useRef(0);
  const mainContentRef = useRef<HTMLDivElement>(null);





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
        const bestVoiceIdx = vnVoices.findIndex(v => {
          const vVal = (v.name + v.voiceURI).toLowerCase();
          return vVal.includes('premium') || vVal.includes('enhanced') || vVal.includes('hq') || vVal.includes('high');
        });
        const finalIdx = bestVoiceIdx !== -1 ? bestVoiceIdx : 0;
        setSelectedVoiceName(`${vnVoices[finalIdx].voiceURI}|${finalIdx}`);
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
      handlePause();
    } else {
      setIsAutoScrollEnabled(true);
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        setIsPlaying(true);
      } else {
        playFromStart(highlightCharIndex !== -1 ? highlightCharIndex : 0);
      }
    }
  };

  const handlePause = () => {
    window.speechSynthesis.cancel();
    if (googleAudioRef.current) {
      googleAudioRef.current.pause();
    }
    setIsPlaying(false);
  };

  const updateSpeed = (newSpeed: number) => {
    setSpeed(newSpeed);
    if (isPlaying) {
      handlePause();
    }
  };

  const playFromStart = (startIndex: number = 0) => {
    if (!content) return;
    setIsAutoScrollEnabled(true); // Bật lại cuộn khi chọn từ mới
    
    // Nhảy tới từ mới lập tức (instant) để tránh jitter trên iPhone
    if (mainContentRef.current) {
      const activeElement = document.querySelector(`span[data-index="${startIndex}"]`) as HTMLElement;
      if (activeElement) {
        const container = mainContentRef.current;
        const containerRect = container.getBoundingClientRect();
        const elementRect = activeElement.getBoundingClientRect();
        const contentTop = container.scrollTop + (elementRect.top - containerRect.top);
        container.scrollTo({ top: contentTop - 120, behavior: 'auto' });
      }
    }

    if (selectedVoiceName === GOOGLE_TTS_ID) {
      handlePlayGoogleOnline(startIndex);
      return;
    }
    
    window.speechSynthesis.cancel();

    const textToSpeak = content.slice(startIndex);
    const utterance = new SpeechSynthesisUtterance(textToSpeak);


    const parts = selectedVoiceName.split('|');
    const targetUri = parts[0];
    const targetIdx = parts.length > 1 ? parseInt(parts[1], 10) : -1;

    let voice: SpeechSynthesisVoice | undefined;
    
    // Tìm chính xác theo Index nếu có
    if (targetIdx !== -1 && voices[targetIdx] && voices[targetIdx].voiceURI === targetUri) {
      voice = voices[targetIdx];
    } else {
      // Fallback
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
      // Giữ highlightCharIndex để có thể đọc tiếp từ đó
    };

    utterance.onerror = () => {
      setIsPlaying(false);
      // Giữ highlightCharIndex để có thể đọc tiếp sau khi gặp lỗi
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

  const handlePlayGoogleOnline = (startIndex: number) => {
    window.speechSynthesis.cancel();
    if (googleAudioRef.current) {
      googleAudioRef.current.pause();
    }
    setIsPlaying(true);

    
    // Chia văn bản thành các đoạn nhỏ dưới 180 ký tự (Giới hạn của Google TTS)
    const text = content.slice(startIndex);
    const words = text.split(/\s+/);
    const chunks: string[] = [];
    let currentChunk = "";
    
    for (const word of words) {
      if ((currentChunk + " " + word).length < 180) {
        currentChunk += (currentChunk ? " " : "") + word;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = word;
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    
    let currentChunkIndex = 0;
    let accumulatedChars = startIndex;
    
    // Unlock Audio on iOS: Cần phát một đoạn âm thanh trống hoặc pause/play ngay trong callback click
    if (googleAudioRef.current) {
      googleAudioRef.current.play().then(() => {
        if (!isPlayingRef.current) googleAudioRef.current?.pause();
      }).catch(() => {});
    }

    const playNextChunk = () => {
      if (currentChunkIndex >= chunks.length || !isPlayingRef.current) {
        setIsPlaying(false);
        return;
      }

      const chunk = chunks[currentChunkIndex];
      const audio = googleAudioRef.current;
      if (!audio) {
        setIsPlaying(false);
        return;
      }
      
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=vi&client=tw-ob`;
      const proxiedUrl = `/api/proxy?url=${encodeURIComponent(ttsUrl)}`;

      audio.onplay = null;
      audio.onended = null;
      audio.onerror = null;

      audio.src = proxiedUrl;
      audio.playbackRate = speed;
      
      audio.onplay = () => {
        if (!isPlayingRef.current) {
          audio.pause();
          return;
        }
        setHighlightCharIndex(accumulatedChars);
      };

      audio.onended = () => {
        const nextCharIndex = content.indexOf(chunk, accumulatedChars) + chunk.length;
        accumulatedChars = nextCharIndex;
        currentChunkIndex++;
        playNextChunk();
      };

      audio.onerror = () => {
        setIsPlaying(false);
      };

      audio.play().catch(() => {
        setIsPlaying(false);
      });
    };

    playNextChunk();
  };

  // Heartbeat để tránh Chrome tự động dừng nói sau 15s (lỗi Web Speech API)
  useEffect(() => {
    let interval: any;
    if (isPlaying) {
      interval = setInterval(() => {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }, 10000); // 10s một lần
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Tối ưu cuộn tự động (Comfort Zone V6) - Sửa triệt để lỗi nhảy giật/oscillation trên iPhone
  const lastScrollTime = useRef(0);
  const isScrollingToRef = useRef(false);

  useEffect(() => {
    if (highlightCharIndex !== -1 && isAutoScrollEnabled && mainContentRef.current) {
      const now = Date.now();
      // Throttle mạnh hơn để tránh animation chồng chéo
      if (now - lastScrollTime.current < 1500) return; 

      const activeElement = document.querySelector('[data-highlight="true"]') as HTMLElement;
      if (activeElement) {
        const container = mainContentRef.current;
        const containerRect = container.getBoundingClientRect();
        const elementRect = activeElement.getBoundingClientRect();
        const relativeTop = elementRect.top - containerRect.top;

        // Chỉ cuộn bước lớn (Large Step) khi ra khỏi vùng an toàn 50px - 300px
        if (relativeTop > 300 || relativeTop < 50) {
          const contentTop = container.scrollTop + relativeTop;
          const target = contentTop - 120;
          
          isScrollingToRef.current = true;
          container.scrollTo({ top: target, behavior: 'smooth' });
          
          lastScrollTime.current = now;
          setTimeout(() => { isScrollingToRef.current = false; }, 1000);
        }
      }
    }
  }, [highlightCharIndex, isAutoScrollEnabled]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const currentScrollY = e.currentTarget.scrollTop;
    
    // Hiện nút cuộn lên đầu khi cuộn qua 300px
    setShowScrollTop(currentScrollY > 300);

    // Logic ẩn/hiện header dựa trên hướng cuộn
    if (currentScrollY > lastScrollY.current && currentScrollY > 100) {
      // Cuộn xuống -> Ẩn
      setShowHeader(false);
    } else if (currentScrollY < lastScrollY.current || currentScrollY < 10) {
      // Cuộn lên hoặc về đầu -> Hiện
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
    window.speechSynthesis.cancel();
    if (googleAudioRef.current) {
      googleAudioRef.current.pause();
    }
    setIsPlaying(false);
    setHighlightCharIndex(-1);
  };

  return (
    <div className="w-full h-screen bg-black text-gray-200 flex flex-col font-sans">
      <header className={`bg-gray-900 border-b border-gray-800 flex items-center justify-between transition-all duration-300 overflow-hidden ${showHeader ? 'h-16 p-4 opacity-100' : 'h-0 p-0 opacity-0 border-0'}`}>
        <h1 className="text-xl font-bold flex items-center gap-2 whitespace-nowrap">
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
              {/* Hiển thị danh sách giọng đọc */}
              <option value="">-- Mặc định thiết bị --</option>
              {[...voices]
                .map((v, originalIdx) => ({ v, originalIdx }))
                .sort((a, b) => {
                  const aVal = (a.v.name + a.v.voiceURI).toLowerCase();
                  const bVal = (b.v.name + b.v.voiceURI).toLowerCase();
                  const hasAKeyword = aVal.includes('premium') || aVal.includes('enhanced') || aVal.includes('hq') || aVal.includes('high');
                  const hasBKeyword = bVal.includes('premium') || bVal.includes('enhanced') || bVal.includes('hq') || bVal.includes('high');

                  if (a.v.name === b.v.name) {
                    if (hasAKeyword && !hasBKeyword) return -1;
                    if (!hasAKeyword && hasBKeyword) return 1;
                    return b.v.voiceURI.length - a.v.voiceURI.length;
                  }
                  return (hasBKeyword ? 1 : 0) - (hasAKeyword ? 1 : 0);
                })
                .map((item) => {
                  const v = item.v;
                  
                  // Lấy tên gốc
                  let displayName = v.name
                    .replace('Microsoft ', '')
                    .replace('Google ', '')
                    .replace(/\(Enhanced\)/i, '(Nâng cao)')
                    .replace(/\(Premium\)/i, '(Nâng cao ✨)')
                    .trim();

                  // Rất nhiều trường hợp trên iOS Safari, tiếng Việt "Linh (Nâng cao)" 
                  // chỉ có .name là "Linh", nhưng .voiceURI lại chứa "premium" hoặc "enhanced"
                  const vVal = (v.name + v.voiceURI).toLowerCase();
                  const isHiddenPremium = (vVal.includes('premium') || vVal.includes('enhanced') || vVal.includes('hq')) 
                                          && !displayName.includes('Nâng cao');
                  
                  if (isHiddenPremium) {
                    displayName += ' (Nâng cao ✨)';
                  }

                  // Xử lý nếu vẫn trùng lặp (ví dụ 2 giọng đều là "Linh" thường)
                  const otherVoicesWithSameName = voices.filter((ov, oIdx) => {
                    const ovDisplayName = ov.name.replace('Microsoft ', '').replace('Google ', '').replace(/\(Enhanced\)/i, '(Nâng cao)').replace(/\(Premium\)/i, '(Nâng cao ✨)').trim() + 
                      ((ov.name + ov.voiceURI).toLowerCase().includes('premium') || (ov.name + ov.voiceURI).toLowerCase().includes('enhanced') || (ov.name + ov.voiceURI).toLowerCase().includes('hq') && !ov.name.includes('Nâng cao') ? ' (Nâng cao ✨)' : '');
                    return ovDisplayName === displayName && oIdx !== item.originalIdx;
                  });

                  // Nếu có tên trùng hoàn toàn (kể cả sau khi đã thêm nhãn Nâng cao) thì đánh số
                  if (otherVoicesWithSameName.length > 0) {
                    // Đếm xem nó là giọng thứ mấy mang tên này
                    const sameNameVoices = voices.filter(ov => {
                       const ovName = ov.name.replace('Microsoft ', '').replace('Google ', '').replace(/\(Enhanced\)/i, '(Nâng cao)').replace(/\(Premium\)/i, '(Nâng cao ✨)').trim() + ((ov.name + ov.voiceURI).toLowerCase().includes('premium') || (ov.name + ov.voiceURI).toLowerCase().includes('enhanced') || (ov.name + ov.voiceURI).toLowerCase().includes('hq') && !ov.name.includes('Nâng cao') ? ' (Nâng cao ✨)' : '');
                       return ovName === displayName;
                    });
                    const orderIdx = sameNameVoices.findIndex(ov => ov === v) + 1;
                    displayName += ` #${orderIdx}`;
                  }

                  return (
                    <option key={`${v.voiceURI}-${item.originalIdx}`} value={`${v.voiceURI}|${item.originalIdx}`}>
                      {displayName}
                    </option>
                  );
                })}
              <option value={GOOGLE_TTS_ID}>Google Trực tuyến (Giọng chuẩn ⚡)</option>
            </select>
            <p className="text-xs text-gray-500 italic">
              Lưu ý: Nếu không thấy giọng tiếng Việt, hãy kiểm tra cài đặt Giọng nói/Trợ năng trên thiết bị của bạn (Ví dụ: Cài đặt &rarr; Giọng nói trên iOS hoặc Google TTS trên Android/PC).
            </p>
          </div>
        </div>
      )}

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
      </div>

        <div className="w-full max-w-3xl mb-32 lg:mb-10 px-2 lg:px-4">
          {content ? (
            <div className="text-base leading-[1.6] text-gray-300 font-sans pb-10" style={{ textRendering: 'optimizeLegibility' }}>
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
                        const isWhitespace = /^\s+$/.test(part);
                        return (
                          <span
                            key={i}
                            onDoubleClick={() => playFromStart(startIndex)}
                            data-index={startIndex}
                            className={`cursor-pointer transition-colors duration-200 hover:bg-gray-800 rounded ${!isWhitespace ? "px-0.5" : "px-0"} ${isHighlighted ? "bg-blue-600 text-white" : ""}`}
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
            <div className="flex flex-col items-center justify-center py-20 text-gray-600">
              <Link2 className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-center font-medium">Chưa có nội dung. Hãy dán URL và ấn "Tải chữ"!</p>
            </div>
          )}
        </div>

        {/* Floating Resume Scroll Button */}
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-6 h-6">
              <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </main>


      {/* Media Controller */}
      <footer className="bg-gray-900 border-t border-gray-800 p-3 pb-6 fixed bottom-0 left-0 right-0 z-10 lg:static">
        <div className="max-w-md mx-auto flex items-center justify-between px-4">
          <button
            onClick={handleStop}
            className="p-3 rounded-full bg-gray-800 hover:bg-gray-700 transition-transform active:scale-95 text-gray-300"
          >
            <Square className="w-5 h-5 fill-current" />
          </button>

          <button
            onClick={handlePlayPause}
            className="p-4 rounded-full bg-blue-600 hover:bg-blue-500 shadow-[0_0_20px_rgba(37,99,235,0.4)] transition-transform active:scale-95 text-white mx-4"
          >
            {isPlaying ? (
              <Pause className="w-8 h-8 fill-current" />
            ) : (
              <Play className="w-8 h-8 fill-current ml-1" />
            )}
          </button>


          <div className="relative">
            {showSpeedMenu && (
              <div className="fixed inset-0 bg-black/40 z-[100] flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setShowSpeedMenu(false)}>
                <div 
                  className="bg-gray-900 border border-gray-800 p-6 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-sm z-[110] animate-in slide-in-from-bottom duration-300"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-lg text-white">Tốc độ đọc</h3>
                    <span className="bg-blue-600 px-3 py-1 rounded-full text-white font-bold text-sm">
                      {Number(speed.toFixed(2))}x
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-4 mb-8">
                    <button 
                      onClick={() => updateSpeed(Math.max(0.5, Number((speed - 0.05).toFixed(2))))}
                      className="p-3 bg-gray-800 rounded-xl hover:bg-gray-700 active:scale-95 transition-all text-gray-300"
                      title="Giảm 0.05"
                    >
                      <Minus className="w-5 h-5" />
                    </button>
                    
                    <input 
                      type="range" 
                      min="0.5" 
                      max="3" 
                      step="0.05" 
                      value={speed}
                      onChange={(e) => {
                        setSpeed(parseFloat(e.target.value));
                        if (isPlaying) handlePause();
                      }}
                      className="flex-1 h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />

                    <button 
                      onClick={() => updateSpeed(Math.min(3, Number((speed + 0.05).toFixed(2))))}
                      className="p-3 bg-gray-800 rounded-xl hover:bg-gray-700 active:scale-95 transition-all text-gray-300"
                      title="Tăng 0.05"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-3">
                    {[1, 1.2, 1.5, 2].map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          updateSpeed(s);
                          setShowSpeedMenu(false);
                        }}
                        className={`py-3 px-2 rounded-xl text-sm font-bold transition-all ${
                          speed === s
                            ? "bg-blue-600 text-white shadow-lg shadow-blue-900/40"
                            : "bg-gray-800/50 text-gray-400 hover:bg-gray-800"
                        }`}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <button
              onClick={() => {
                if (!showSpeedMenu && isPlaying) handlePause();
                setShowSpeedMenu(!showSpeedMenu);
              }}
              className={`p-3 rounded-xl transition-colors active:scale-95 font-bold w-14 text-center ${showSpeedMenu ? 'bg-blue-600 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
            >
              {Number(speed.toFixed(2))}x
            </button>
          </div>
        </div>
      </footer>
      
      {/* Thẻ audio cố định trên DOM để bypass lỗi tự chạy (autoplay) trên iOS */}
      <audio ref={googleAudioRef} className="hidden" playsInline crossOrigin="anonymous" />
    </div>
  );
}

export default App;
