import { useState, useEffect, useRef } from 'react';
import { Settings, Link2, Loader2 } from 'lucide-react';
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
  const [currentCharIndex, setCurrentCharIndex] = useState(-1);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);

  const mainContentRef = useRef<HTMLDivElement>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
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

  // Initialize voices
  useEffect(() => {
    const updateVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      const vnVoices = availableVoices.filter(v => 
        v.lang.includes('vi') && 
        !v.name.includes('Google') && 
        !v.name.includes('Microsoft Online')
      );
      setVoices(vnVoices);

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

  const getSelectedVoice = (): SpeechSynthesisVoice | undefined => {
    if (!selectedVoiceName) return voices[0];

    const parts = selectedVoiceName.split('|');
    const targetUri = parts[0];
    const targetIdx = parts.length > 1 ? parseInt(parts[1], 10) : -1;

    if (targetIdx !== -1 && voices[targetIdx] && voices[targetIdx].voiceURI === targetUri) {
      return voices[targetIdx];
    }

    return voices.find(v => v.voiceURI === targetUri) || 
           voices.find(v => v.name === targetUri) || 
           voices[0];
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    if (utteranceRef.current) {
      utteranceRef.current = null;
    }
    setIsPlaying(false);
    setCurrentCharIndex(-1);
  };

  const startSpeaking = (fromCharIndex: number = 0) => {
    if (!content) {
      console.log('No content to speak');
      return;
    }

    console.log('Starting speech from char:', fromCharIndex);

    stopSpeaking();

    // Haptic feedback
    if (window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(10);
    }

    // Find paragraph start
    let startIndex = fromCharIndex;
    if (fromCharIndex > 0) {
      const lastNewline = content.lastIndexOf('\n', fromCharIndex - 1);
      startIndex = lastNewline === -1 ? 0 : lastNewline + 1;
    }

    const textToSpeak = content.slice(startIndex);
    console.log('Text to speak (first 100 chars):', textToSpeak.slice(0, 100));
    
    if (!textToSpeak.trim()) {
      console.log('No text to speak after trim');
      return;
    }

    // CRITICAL: Unlock audio on iOS - must be called in user gesture
    try {
      const wakeUp = new SpeechSynthesisUtterance("");
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(wakeUp);
      console.log('Audio unlocked');
    } catch (e) {
      console.error('Failed to unlock audio:', e);
    }

    // Small delay to ensure unlock completes
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      const voice = getSelectedVoice();

      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
        console.log('Using voice:', voice.name);
      } else {
        console.log('No voice selected, using default');
      }

      utterance.rate = speed;
      utterance.pitch = 1;
      utterance.volume = 1;

      utterance.onboundary = (event) => {
        if (event.name === 'word') {
          setCurrentCharIndex(startIndex + event.charIndex);
        }
      };

      utterance.onstart = () => {
        console.log('Speech started successfully');
        setIsPlaying(true);
        setCurrentCharIndex(startIndex);
      };

      utterance.onend = () => {
        console.log('Speech ended');
        setIsPlaying(false);
        setCurrentCharIndex(-1);
      };

      utterance.onerror = (event) => {
        console.error('Speech error:', event.error, event);
        setIsPlaying(false);
        setCurrentCharIndex(-1);
      };

      utteranceRef.current = utterance;

      // Speak
      window.speechSynthesis.cancel(); // Clear any pending
      window.speechSynthesis.speak(utterance);
      
      console.log('speechSynthesis.speaking:', window.speechSynthesis.speaking);
      console.log('speechSynthesis.pending:', window.speechSynthesis.pending);
      console.log('speechSynthesis.paused:', window.speechSynthesis.paused);
    }, 50);
  };

  const handlePlayPause = () => {
    console.log('Play/Pause clicked, isPlaying:', isPlaying);
    
    // Haptic feedback
    if (window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(30);
    }
    
    if (isPlaying) {
      stopSpeaking();
    } else {
      const startIndex = currentCharIndex >= 0 ? currentCharIndex : 0;
      setIsAutoScrollEnabled(true);
      startSpeaking(startIndex);
    }
  };

  const handleTextClick = (charIndex: number) => {
    console.log('=== TEXT CLICKED ===');
    console.log('Char index:', charIndex);
    console.log('Content length:', content.length);
    console.log('Has voices:', voices.length);
    
    // Visual feedback
    if (window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(50);
    }
    
    setIsAutoScrollEnabled(true);
    
    // Call startSpeaking directly in the click handler (important for iOS)
    startSpeaking(charIndex);
  };

  const updateSpeed = (newSpeed: number) => {
    setSpeed(newSpeed);
    if (isPlaying) {
      const currentIndex = currentCharIndex;
      stopSpeaking();
      setTimeout(() => {
        startSpeaking(currentIndex >= 0 ? currentIndex : 0);
      }, 100);
    }
  };

  // Heartbeat
  useEffect(() => {
    let interval: any;
    
    if (isPlaying) {
      interval = setInterval(() => {
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        }
      }, 10000);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Auto-scroll
  useEffect(() => {
    if (currentCharIndex >= 0 && isAutoScrollEnabled && mainContentRef.current) {
      const now = Date.now();
      if (now - lastScrollTime.current < 800) return;

      const activeElement = document.querySelector('[data-active="true"]') as HTMLElement;
      if (activeElement) {
        const container = mainContentRef.current;
        const containerRect = container.getBoundingClientRect();
        const elementRect = activeElement.getBoundingClientRect();
        const relativeTop = elementRect.top - containerRect.top;

        if (relativeTop > containerRect.height * 0.6 || relativeTop < 80) {
          const targetTop = container.scrollTop + relativeTop - (containerRect.height / 3);
          
          isScrollingToRef.current = true;
          container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
          
          lastScrollTime.current = now;
          setTimeout(() => { isScrollingToRef.current = false; }, 600);
        }
      }
    }
  }, [currentCharIndex, isAutoScrollEnabled]);

  const handleScroll = () => {
    if (!isScrollingToRef.current && isPlaying && isAutoScrollEnabled) {
      setIsAutoScrollEnabled(false);
    }
  };

  const handlePrevious = () => {
    console.log('Previous clicked');
    if (window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(30);
    }
    const prevIndex = Math.max(0, currentCharIndex - 200);
    setIsAutoScrollEnabled(true);
    startSpeaking(prevIndex);
  };

  const handleNext = () => {
    console.log('Next clicked');
    if (window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(30);
    }
    const nextIndex = Math.min(content.length - 1, currentCharIndex + 200);
    setIsAutoScrollEnabled(true);
    startSpeaking(nextIndex);
  };

  return (
    <div className="w-full h-screen bg-black text-white flex flex-col font-sans overflow-hidden">
      {/* Top Bar */}
      <div className="bg-[#1c1c1e] border-b border-gray-800 px-3 py-2.5 flex items-center gap-2 flex-shrink-0">
        <button className="p-2 active:bg-gray-800 rounded-lg transition-colors touch-manipulation">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
            <path d="M3 12h18M3 6h18M3 18h18"/>
          </svg>
        </button>
        
        <div className="flex-1 bg-[#2c2c2e] rounded-lg px-3 py-2 flex items-center gap-2 min-w-0">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/..."
            className="flex-1 bg-transparent text-sm text-gray-300 placeholder-gray-500 outline-none min-w-0"
            onKeyDown={(e) => e.key === 'Enter' && fetchContent()}
          />
        </div>
        
        <button 
          onClick={fetchContent}
          disabled={loading}
          className="p-2 active:bg-gray-800 rounded-lg transition-colors disabled:opacity-50 touch-manipulation flex-shrink-0"
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

      {/* Main Content */}
      <main 
        ref={mainContentRef}
        className="flex-1 overflow-y-auto px-4 py-4 pb-24 -webkit-overflow-scrolling-touch"
        onScroll={handleScroll}
        onTouchMove={() => isPlaying && setIsAutoScrollEnabled(false)}
      >
        {content ? (
          <div className="max-w-2xl mx-auto">
            {/* Title */}
            <h1 className="text-xl font-bold mb-4 pb-3 border-b border-gray-800">
              {content.split('\n')[0].slice(0, 80)}
            </h1>
            
            {/* Content */}
            <div className="text-[15px] leading-[1.7] text-gray-200">
              {content.split('\n').map((paragraph, pIndex) => {
                if (!paragraph.trim()) return null;
                
                const paragraphStart = content.split('\n').slice(0, pIndex).join('\n').length + pIndex;
                const paragraphEnd = paragraphStart + paragraph.length;
                const isActive = currentCharIndex >= paragraphStart && currentCharIndex < paragraphEnd;
                
                return (
                  <p 
                    key={pIndex}
                    onTouchStart={(e) => {
                      // Prevent default to avoid iOS quirks
                      e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
                    }}
                    onTouchEnd={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.currentTarget.style.backgroundColor = '';
                      console.log('Touch end on paragraph:', pIndex);
                      handleTextClick(paragraphStart);
                    }}
                    onTouchCancel={(e) => {
                      e.currentTarget.style.backgroundColor = '';
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log('Click on paragraph:', pIndex);
                      handleTextClick(paragraphStart);
                    }}
                    data-active={isActive ? "true" : "false"}
                    className={`mb-4 px-4 py-3 rounded-lg cursor-pointer select-none transition-all duration-200 ${
                      isActive 
                        ? 'bg-blue-600/30 border-l-4 border-blue-400 text-white shadow-lg' 
                        : 'bg-gray-900/30'
                    }`}
                    style={{ 
                      WebkitTapHighlightColor: 'transparent',
                      touchAction: 'manipulation'
                    }}
                  >
                    {paragraph}
                  </p>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Link2 className="w-16 h-16 mb-4 opacity-30" />
            <p className="text-center text-sm px-4">Dán URL và nhấn nút tải để bắt đầu</p>
          </div>
        )}
      </main>

      {/* Resume Auto-scroll Button */}
      {!isAutoScrollEnabled && isPlaying && (
        <button 
          onClick={() => setIsAutoScrollEnabled(true)}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-blue-600 active:bg-blue-700 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium z-10 touch-manipulation"
        >
          Tiếp tục cuộn tự động
        </button>
      )}

      {/* Bottom Control Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#1c1c1e] border-t border-gray-800 px-4 py-3 safe-area-inset-bottom z-50 flex-shrink-0">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <button
            onClick={handlePrevious}
            disabled={!content}
            className="p-3 disabled:opacity-30 active:scale-90 active:bg-gray-800 rounded-lg transition-all"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-6 h-6">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>

          <button
            onClick={handleNext}
            disabled={!content}
            className="p-3 disabled:opacity-30 active:scale-90 active:bg-gray-800 rounded-lg transition-all"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-6 h-6">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>

          <button
            onClick={handlePlayPause}
            disabled={!content}
            className="p-4 disabled:opacity-30 active:scale-90 active:bg-gray-800 rounded-full transition-all"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-blue-500">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-blue-500">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>

          <button
            onClick={() => {
              if (window.navigator && window.navigator.vibrate) {
                window.navigator.vibrate(30);
              }
              setShowSettings(!showSettings);
            }}
            className={`p-3 active:scale-90 active:bg-gray-800 rounded-lg transition-all ${showSettings ? 'text-blue-500' : ''}`}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <Settings className="w-6 h-6" />
          </button>

          <button 
            className="p-3 active:scale-90 active:bg-gray-800 rounded-lg transition-all"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div 
          className="fixed inset-0 bg-black/80 z-[100] flex items-end"
          onClick={() => setShowSettings(false)}
        >
          <div 
            className="bg-[#1c1c1e] w-full rounded-t-3xl p-6 pb-8 animate-in slide-in-from-bottom duration-300 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-6"></div>
            
            <h2 className="text-xl font-bold mb-6">Cài đặt</h2>
            
            <div className="mb-6">
              <label className="text-sm text-gray-400 mb-2 block">Giọng đọc</label>
              <select
                value={selectedVoiceName}
                onChange={(e) => setSelectedVoiceName(e.target.value)}
                className="w-full bg-[#2c2c2e] border border-gray-700 rounded-xl p-3 text-white outline-none touch-manipulation"
              >
                <option value="">Mặc định thiết bị</option>
                
                {[...voices]
                  .map((v, originalIdx) => {
                    const vVal = (v.name + v.voiceURI).toLowerCase();
                    const isPremium = /\b(premium|enhanced|hq|high|natural|pro)\b/i.test(vVal);
                    
                    let displayName = v.name
                      .replace('Microsoft ', '')
                      .replace(/\(Enhanced\)/i, '')
                      .replace(/\(Premium\)/i, '')
                      .replace(/\(Compact\)/i, '')
                      .replace(' (Natural)', '')
                      .trim();

                    if (isPremium) displayName += ' ✨';

                    return { displayName, isPremium, value: `${v.voiceURI}|${originalIdx}` };
                  })
                  .sort((a, b) => {
                    if (a.isPremium !== b.isPremium) return a.isPremium ? -1 : 1;
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

            <button
              onClick={() => setShowSettings(false)}
              className="w-full bg-blue-600 active:bg-blue-700 text-white py-3 rounded-xl font-medium transition-colors touch-manipulation"
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
