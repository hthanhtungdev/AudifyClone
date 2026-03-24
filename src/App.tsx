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
  const GOOGLE_TTS_ID_2 = 'google_v_online_2';
  const googleAudioRef = useRef<HTMLAudioElement | null>(null);
  const prefetchAudioRef = useRef<HTMLAudioElement | null>(null);
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

        // Tự động chọn giọng Nâng cao (Premium) tốt nhất nếu chưa chọn
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
    if (prefetchAudioRef.current) {
      prefetchAudioRef.current.pause();
      prefetchAudioRef.current.src = "";
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
    setIsAutoScrollEnabled(true); 

    // Tự động tìm vị trí đầu đoạn văn (Paragraph Start)
    let paragraphStartIndex = content.lastIndexOf('\n', startIndex - 1);
    paragraphStartIndex = paragraphStartIndex === -1 ? 0 : paragraphStartIndex + 1;
    
    // Sử dụng vị trí đầu đoạn để bắt đầu đọc
    const actualStartIndex = paragraphStartIndex;

    // Rung nhẹ phản hồi (Haptic peak) nếu thiết bị hỗ trợ
    if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(10);
    }

    // Mở khóa Audio trên iOS ngay lập tức
    const wakeUp = new SpeechSynthesisUtterance("");
    window.speechSynthesis.speak(wakeUp);

    if (googleAudioRef.current && (selectedVoiceName === GOOGLE_TTS_ID || selectedVoiceName === GOOGLE_TTS_ID_2)) {
      // Chỉ play để unlock nếu đang dùng Online voice, nhưng KHÔNG pause lại ngay lập tức nếu đang phát
      googleAudioRef.current.play().catch(() => {});
    }
    
    // Nhảy tới từ mới lập tức
    if (mainContentRef.current) {
      const activeElement = document.querySelector(`span[data-index="${startIndex}"]`) as HTMLElement;
      if (activeElement) {
        const container = mainContentRef.current;
        const containerRect = container.getBoundingClientRect();
        const elementRect = activeElement.getBoundingClientRect();
        
        // Tính toán vị trí để từ được chọn nằm ở khoảng 1/3 màn hình từ trên xuống
        const targetTop = container.scrollTop + (elementRect.top - containerRect.top) - (containerRect.height / 3);
        
        container.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
        lastScrollTime.current = Date.now(); // Reset timer cuộn tự động ngay sau khi nhảy
      }
    }

    if (selectedVoiceName === GOOGLE_TTS_ID || selectedVoiceName === GOOGLE_TTS_ID_2) {
      handlePlayGoogleOnline(actualStartIndex);
      return;
    }
    
    window.speechSynthesis.cancel();

    const textToSpeak = content.slice(actualStartIndex);
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
        // Cộng thêm actualStartIndex để highlight đúng vị trí trong content gốc
        setHighlightCharIndex(event.charIndex + actualStartIndex);
      }
    };

    // Debounce cancel/speak cực thấp để phản hồi ngay lập tức
    setTimeout(() => {
      if (isPlayingRef.current || startIndex > 0) { 
        window.speechSynthesis.speak(utterance);
        setIsPlaying(true);
      }
    }, 10);
  };

  const handlePlayGoogleOnline = (startIndex: number) => {
    window.speechSynthesis.cancel();
    // KHÔNG pause ở đây nếu vừa gọi play ở playFromStart để tránh interrupt iOS
    setIsPlaying(true);

    
    // Chia văn bản thành các đoạn nhỏ dưới 180 ký tự (Giới hạn của Google TTS)
    // Sử dụng Regex để giữ nguyên toàn bộ ký tự (bao gồm cả khoảng trắng thừa) nhằm đồng bộ highlight 100%
    const text = content.slice(startIndex);
    const tokens = text.match(/\S+|\s+/g) || [];
    const chunks: string[] = [];
    let currentChunk = "";
    
    for (const token of tokens) {
      if ((currentChunk + token).length < 180) {
        currentChunk += token;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = token;
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    
    let currentChunkIndex = 0;
    let accumulatedChars = startIndex;
    
    // KHÔNG pause ở đây để tránh interrupt iOS
    if (googleAudioRef.current) {
      googleAudioRef.current.play().catch(() => {});
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
      
      const tl = selectedVoiceName === GOOGLE_TTS_ID_2 ? 'vi-VN' : 'vi';
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${tl}&client=tw-ob`;
      const proxiedUrl = `/api/proxy?url=${encodeURIComponent(ttsUrl)}`;

      audio.onplay = null;
      audio.onended = null;
      audio.onerror = null;
      audio.ontimeupdate = null;

      audio.src = proxiedUrl;
      audio.playbackRate = speed;
      
      audio.onplay = () => {
        if (!isPlayingRef.current) {
          audio.pause();
          return;
        }
        setHighlightCharIndex(accumulatedChars);
      };

      // Giả lập highlight từng từ dựa trên tiến trình phát của file Audio
      let lastUpdate = 0;
      audio.ontimeupdate = () => {
        const now = Date.now();
        if (now - lastUpdate < 100) return; // Chỉ cập nhật highlight mỗi 100ms để tránh giật (smooth performance)
        lastUpdate = now;

        if (!audio.duration || !isPlayingRef.current) return;
        
        const progress = audio.currentTime / audio.duration;
        const charIndexInChunk = Math.floor(progress * chunk.length);
        
        // Tìm vị trí bắt đầu của từ gần nhất để highlight không bị cắt nửa chừng
        const lastSpace = chunk.lastIndexOf(' ', charIndexInChunk);
        const wordStart = lastSpace === -1 ? 0 : lastSpace + 1;
        
        setHighlightCharIndex(accumulatedChars + wordStart);
      };

      // Tải trước (Pre-fetch) đoạn tiếp theo để tránh khựng
      if (currentChunkIndex + 1 < chunks.length && prefetchAudioRef.current) {
        const nextChunk = chunks[currentChunkIndex + 1];
        const nextTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(nextChunk)}&tl=${tl}&client=tw-ob`;
        prefetchAudioRef.current.src = `/api/proxy?url=${encodeURIComponent(nextTtsUrl)}`;
        prefetchAudioRef.current.load();
      }

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

  // Heartbeat để tránh Chrome/iOS tự động dừng nói sau 15s (lỗi Web Speech API)
  // CHỈ chạy khi đang dùng giọng hệ thống (không phải Google Online)
  useEffect(() => {
    let interval: any;
    const isSystemVoice = selectedVoiceName !== GOOGLE_TTS_ID && selectedVoiceName !== GOOGLE_TTS_ID_2;
    
    if (isPlaying && isSystemVoice) {
      interval = setInterval(() => {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }, 10000); // 10s một lần
    }
    return () => clearInterval(interval);
  }, [isPlaying, selectedVoiceName]);

  // Tối ưu cuộn tự động (Comfort Zone V6) - Sửa triệt để lỗi nhảy giật/oscillation trên iPhone
  const lastScrollTime = useRef(0);
  const isScrollingToRef = useRef(false);

  useEffect(() => {
    if (highlightCharIndex !== -1 && isAutoScrollEnabled && mainContentRef.current) {
      const now = Date.now();
      // Throttle animation cuộn tự động (1.5s một lần) để tránh giật hình
      if (now - lastScrollTime.current < 1500) return; 

      const activeElement = document.querySelector('[data-highlight="true"]') as HTMLElement;
      if (activeElement) {
        const container = mainContentRef.current;
        const containerRect = container.getBoundingClientRect();
        const elementRect = activeElement.getBoundingClientRect();
        const relativeTop = elementRect.top - containerRect.top;

        // "Vùng an toàn" (Comfort Zone): Chỉ cuộn nếu từ đang đọc vượt quá 40% màn hình từ trên xuống
        // Điều này giúp giữ vệt highlight luôn ở nửa trên màn hình, dễ đọc và không giật lag.
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
    handlePause();
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
              <option value={GOOGLE_TTS_ID}>Google Trực tuyến (Giọng chuẩn ⚡)</option>
              <option value={GOOGLE_TTS_ID_2}>Google Trực tuyến (Giọng 2 ✨)</option>
              
              {[...voices]
                .filter(v => !v.name.includes('Google') && !v.name.includes('Microsoft Online'))
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
                  
                  // Nếu bị trùng tên hiển thị (như 2 Linh Tiêu Chuẩn), đánh số để phân biệt
                  const sameNameIndices = arr.filter(ai => ai.displayName === item.displayName);
                  if (sameNameIndices.length > 1) {
                    const orderInSameName = sameNameIndices.findIndex(ai => ai.value === item.value) + 1;
                    finalLabel += ` #${orderInSameName}`;
                    
                    // Thêm gợi ý URI nếu vẫn bị trùng lặp
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
          </div>
        </div>
      )}

      {/* Nội dung chính */}
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
              {/* Render content with HTML paragraphs and highlighting */}
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
                      className={`mb-6 text-left whitespace-pre-wrap break-words transition-all duration-300 rounded-r-xl will-change-[background-color,transform] ${isParagraphActive ? "bg-blue-600/10 border-l-4 border-blue-600 pl-4 py-2" : "border-l-4 border-transparent pl-4 py-2"}`}
                    >
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
                            className={`cursor-pointer transition-colors duration-200 hover:bg-gray-800 rounded select-none ${!isWhitespace ? "px-0.5" : "px-0"} ${isHighlighted ? "bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.6)] font-bold" : ""}`}
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
      <audio ref={prefetchAudioRef} className="hidden" playsInline crossOrigin="anonymous" />
    </div>
  );
}

export default App;
