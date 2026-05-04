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
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);

  const mainContentRef = useRef<HTMLDivElement>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const wordsRef = useRef<Array<{ text: string; start: number; end: number }>>([]);
  const currentWordIndexRef = useRef(-1);
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

  // Parse content into words with positions
  useEffect(() => {
    if (!content) {
      wordsRef.current = [];
      console.log('No content, clearing words');
      return;
    }

    const words: Array<{ text: string; start: number; end: number }> = [];
    let currentIndex = 0;

    // Split by whitespace but keep track of positions
    const tokens = content.match(/\S+|\s+/g) || [];
    
    console.log('Parsing content into words, total tokens:', tokens.length);
    
    tokens.forEach(token => {
      const start = currentIndex;
      const end = start + token.length;
      
      if (!/^\s+$/.test(token)) {
        words.push({ text: token, start, end });
      }
      
      currentIndex = end;
    });

    wordsRef.current = words;
    console.log('Total words parsed:', words.length);
    console.log('First 5 words:', words.slice(0, 5));
  }, [content]);

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
    setCurrentWordIndex(-1);
    currentWordIndexRef.current = -1;
  };

  const startSpeaking = (fromWordIndex: number = 0) => {
    if (!content || wordsRef.current.length === 0) {
      console.log('No content or words to speak');
      return;
    }

    console.log('Starting speech from word index:', fromWordIndex);

    // Stop any current speech
    stopSpeaking();

    // Haptic feedback
    if (window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(10);
    }

    // Find the word to start from
    const startIndex = Math.max(0, Math.min(fromWordIndex, wordsRef.current.length - 1));
    const textToSpeak = wordsRef.current.slice(startIndex).map(w => w.text).join('');

    console.log('Text to speak:', textToSpeak.slice(0, 100));

    if (!textToSpeak.trim()) {
      console.log('No text to speak after trim');
      return;
    }

    // Unlock audio on iOS
    const wakeUp = new SpeechSynthesisUtterance("");
    window.speechSynthesis.speak(wakeUp);

    // Create utterance
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    const voice = getSelectedVoice();

    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
      console.log('Using voice:', voice.name);
    }

    utterance.rate = speed;
    utterance.pitch = 1;
    utterance.volume = 1;

    // Track word boundaries
    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        // Calculate which word we're on
        const charIndexInSlice = event.charIndex;
        let accumulatedChars = 0;
        
        for (let i = 0; i < wordsRef.current.length - startIndex; i++) {
          const word = wordsRef.current[startIndex + i];
          const wordLength = word.text.length;
          
          if (charIndexInSlice >= accumulatedChars && charIndexInSlice < accumulatedChars + wordLength) {
            const globalWordIndex = startIndex + i;
            setCurrentWordIndex(globalWordIndex);
            currentWordIndexRef.current = globalWordIndex;
            break;
          }
          
          accumulatedChars += wordLength;
        }
      }
    };

    utterance.onstart = () => {
      console.log('Speech started');
      setIsPlaying(true);
      setCurrentWordIndex(startIndex);
      currentWordIndexRef.current = startIndex;
    };

    utterance.onend = () => {
      console.log('Speech ended');
      setIsPlaying(false);
      setCurrentWordIndex(-1);
      currentWordIndexRef.current = -1;
    };

    utterance.onerror = (event) => {
      console.error('Speech error:', event);
      setIsPlaying(false);
      setCurrentWordIndex(-1);
      currentWordIndexRef.current = -1;
    };

    utteranceRef.current = utterance;

    // Speak with delay to ensure everything is ready
    setTimeout(() => {
      console.log('Calling speechSynthesis.speak()');
      window.speechSynthesis.cancel(); // Clear queue
      window.speechSynthesis.speak(utterance);
      console.log('Speaking:', window.speechSynthesis.speaking);
      console.log('Pending:', window.speechSynthesis.pending);
    }, 100);
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      stopSpeaking();
    } else {
      const startIndex = currentWordIndexRef.current >= 0 ? currentWordIndexRef.current : 0;
      setIsAutoScrollEnabled(true);
      startSpeaking(startIndex);
    }
  };

  const handleWordClick = (wordIndex: number) => {
    console.log('Word clicked:', wordIndex, wordsRef.current[wordIndex]?.text);
    setIsAutoScrollEnabled(true);
    startSpeaking(wordIndex);
  };

  const updateSpeed = (newSpeed: number) => {
    setSpeed(newSpeed);
    if (isPlaying) {
      const currentIndex = currentWordIndexRef.current;
      stopSpeaking();
      setTimeout(() => {
        startSpeaking(currentIndex >= 0 ? currentIndex : 0);
      }, 100);
    }
  };

  // Heartbeat để tránh iOS tự động dừng
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
    if (currentWordIndex >= 0 && isAutoScrollEnabled && mainContentRef.current) {
      const now = Date.now();
      if (now - lastScrollTime.current < 1000) return;

      const activeElement = document.querySelector('[data-word-active="true"]') as HTMLElement;
      if (activeElement) {
        const container = mainContentRef.current;
        const containerRect = container.getBoundingClientRect();
        const elementRect = activeElement.getBoundingClientRect();
        const relativeTop = elementRect.top - containerRect.top;

        if (relativeTop > containerRect.height * 0.5 || relativeTop < 100) {
          const targetTop = container.scrollTop + relativeTop - (containerRect.height / 3);
          
          isScrollingToRef.current = true;
          container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
          
          lastScrollTime.current = now;
          setTimeout(() => { isScrollingToRef.current = false; }, 800);
        }
      }
    }
  }, [currentWordIndex, isAutoScrollEnabled]);

  const handleScroll = () => {
    if (!isScrollingToRef.current && isPlaying && isAutoScrollEnabled) {
      setIsAutoScrollEnabled(false);
    }
  };

  const handlePrevious = () => {
    const prevIndex = Math.max(0, currentWordIndexRef.current - 20);
    setIsAutoScrollEnabled(true);
    startSpeaking(prevIndex);
  };

  const handleNext = () => {
    const nextIndex = Math.min(wordsRef.current.length - 1, currentWordIndexRef.current + 20);
    setIsAutoScrollEnabled(true);
    startSpeaking(nextIndex);
  };

  return (
    <div className="w-full h-screen bg-black text-white flex flex-col font-sans">
      {/* Top Bar */}
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

      {/* Main Content */}
      <main 
        ref={mainContentRef}
        className="flex-1 overflow-y-auto px-4 py-6 pb-32"
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
            
            {/* Content with word-by-word rendering */}
            <div className="text-base leading-relaxed text-gray-200" style={{ textRendering: 'optimizeLegibility' }}>
              {(() => {
                // Group words into lines/paragraphs
                const lines: Array<Array<{ word: typeof wordsRef.current[0]; index: number }>> = [];
                let currentLine: Array<{ word: typeof wordsRef.current[0]; index: number }> = [];
                
                wordsRef.current.forEach((word, index) => {
                  const isNewLine = word.start > 0 && (content[word.start - 1] === '\n' || content[word.start - 2] === '\n');
                  
                  if (isNewLine && currentLine.length > 0) {
                    lines.push(currentLine);
                    currentLine = [];
                  }
                  
                  currentLine.push({ word, index });
                });
                
                if (currentLine.length > 0) {
                  lines.push(currentLine);
                }

                return lines.map((line, lineIndex) => {
                  const hasActiveWord = line.some(item => item.index === currentWordIndex);
                  
                  return (
                    <p 
                      key={lineIndex}
                      className={`mb-4 px-3 py-2 rounded transition-colors duration-200 ${
                        hasActiveWord ? 'bg-blue-600/20 border-l-4 border-blue-500' : ''
                      }`}
                    >
                      {line.map((item) => {
                        const isActive = item.index === currentWordIndex;
                        
                        return (
                          <span
                            key={item.index}
                            onClick={() => handleWordClick(item.index)}
                            data-word-index={item.index}
                            data-word-active={isActive ? "true" : "false"}
                            className={`cursor-pointer ${
                              isActive ? "text-blue-400 font-medium" : ""
                            }`}
                          >
                            {item.word.text}
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
        
        <div className="h-32"></div>
      </main>

      {/* Resume Auto-scroll Button */}
      {!isAutoScrollEnabled && isPlaying && (
        <button 
          onClick={() => setIsAutoScrollEnabled(true)}
          className="fixed bottom-28 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium z-10"
        >
          Tiếp tục cuộn tự động
        </button>
      )}

      {/* Bottom Control Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#1c1c1e] border-t border-gray-800 px-6 py-4 safe-area-inset-bottom z-50">
        <div className="flex items-center justify-between max-w-md mx-auto">
          {/* Previous Button */}
          <button
            onClick={handlePrevious}
            disabled={!content}
            className="p-3 disabled:opacity-30 transition-opacity"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>

          {/* Next Button */}
          <button
            onClick={handleNext}
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

          {/* Folder Button */}
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
          className="fixed inset-0 bg-black/80 z-[100] flex items-end"
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
