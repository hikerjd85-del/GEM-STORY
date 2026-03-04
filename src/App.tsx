import React, { useState, useRef, useEffect } from 'react';
import { generateStoryOutline, generateImage, generateAudio, StoryPage } from './services/gemini';
import { Send, Image as ImageIcon, Volume2, Loader2, ChevronLeft, ChevronRight, Play, Square, AlertCircle } from 'lucide-react';

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [demographic, setDemographic] = useState('Ages 3 to 5 (Preschool)');
  const [language, setLanguage] = useState('English');
  const [voice, setVoice] = useState('Kore');
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [story, setStory] = useState<StoryPage[] | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [elapsed, setElapsed] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    let interval: any;
    const isWorking = isGenerating || (progress.total > 0 && progress.completed < progress.total);
    if (isWorking) {
      interval = setInterval(() => setElapsed(e => e + 1), 1000);
    } else if (!isWorking && progress.total === 0) {
      setElapsed(0);
    }
    return () => clearInterval(interval);
  }, [isGenerating, progress]);

  const handleGenerate = async () => {
    if (!prompt) return;
    setIsGenerating(true);
    setStory(null);
    setCurrentPage(0);
    setProgress({ completed: 0, total: 0 });
    setElapsed(0);
    
    try {
      // 1. Generate Outline
      const outline = await generateStoryOutline(prompt, demographic, language);
      setStory(outline);
      setProgress({ completed: 0, total: outline.length * 2 });
      setIsGenerating(false); // Outline done, start assets
      
      // 2. Generate Images and Audio in batches to avoid rate limits and browser connection limits
      const generateAssets = async () => {
        for (let i = 0; i < outline.length; i += 2) {
          const batch = outline.slice(i, i + 2);
          
          await Promise.all(batch.map(async (page, batchIdx) => {
            const index = i + batchIdx;
            
            const imagePromise = generateImage(page.imagePrompt).then(imageUrl => {
              setStory(prev => {
                if (!prev) return prev;
                const newStory = [...prev];
                newStory[index] = { ...newStory[index], imageUrl, imageError: !imageUrl };
                return newStory;
              });
            }).catch(e => {
              console.error("Image gen failed for page", index, e);
              setStory(prev => {
                if (!prev) return prev;
                const newStory = [...prev];
                newStory[index] = { ...newStory[index], imageError: true };
                return newStory;
              });
            }).finally(() => {
              setProgress(p => ({ ...p, completed: p.completed + 1 }));
            });
            
            const audioPromise = generateAudio(page.text, voice).then(audio => {
              setStory(prev => {
                if (!prev) return prev;
                const newStory = [...prev];
                if (audio) {
                  newStory[index] = { ...newStory[index], audioBase64: audio.base64, audioMimeType: audio.mimeType };
                } else {
                  newStory[index] = { ...newStory[index], audioError: true };
                }
                return newStory;
              });
            }).catch(e => {
              console.error("Audio gen failed for page", index, e);
              setStory(prev => {
                if (!prev) return prev;
                const newStory = [...prev];
                newStory[index] = { ...newStory[index], audioError: true };
                return newStory;
              });
            }).finally(() => {
              setProgress(p => ({ ...p, completed: p.completed + 1 }));
            });
            
            await Promise.all([imagePromise, audioPromise]);
          }));
          
          // Small delay between batches
          if (i + 2 < outline.length) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }
      };
      
      generateAssets();
      
    } catch (error) {
      console.error("Failed to generate story", error);
      alert("Failed to generate story. Please try again.");
      setIsGenerating(false);
    }
  };

  const playAudio = async (base64Data: string, mimeType: string) => {
    stopAudio();
    
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    try {
      const binaryString = window.atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      let audioBuffer: AudioBuffer;
      
      if (mimeType.includes('pcm')) {
        const buffer = new Int16Array(bytes.buffer);
        audioBuffer = ctx.createBuffer(1, buffer.length, 24000);
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < buffer.length; i++) {
          channelData[i] = buffer[i] / 32768.0;
        }
      } else {
        audioBuffer = await ctx.decodeAudioData(bytes.buffer);
      }
      
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => setIsPlaying(false);
      source.start();
      
      sourceNodeRef.current = source;
      setIsPlaying(true);
    } catch (e) {
      console.error("Failed to play audio", e);
      setIsPlaying(false);
    }
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop();
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
  };

  useEffect(() => {
    return () => {
      stopAudio();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    stopAudio();
  }, [currentPage]);

  const isWorking = isGenerating || (progress.total > 0 && progress.completed < progress.total);
  const estimatedTotalSeconds = 60; // 5 batches * ~12 seconds per batch
  const remainingSeconds = Math.max(0, estimatedTotalSeconds - elapsed);

  return (
    <div className="flex h-screen bg-stone-100 font-sans text-stone-900">
      {/* Left Column: Chat / Controls */}
      <div className="w-1/3 min-w-[320px] max-w-md bg-white border-r border-stone-200 flex flex-col shadow-sm z-10">
        <div className="p-6 border-b border-stone-100">
          <h1 className="text-2xl font-serif font-bold text-stone-800">Gemini Storybook</h1>
          <p className="text-sm text-stone-500 mt-1">Generate illustrated, narrated stories.</p>
        </div>
        
        <div className="flex-1 p-6 overflow-y-auto flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-stone-700">Language</label>
            <select 
              className="p-2 border border-stone-300 rounded-lg bg-stone-50 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={isWorking}
            >
              <option value="English">English</option>
              <option value="Farsi">Farsi</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-stone-700">Narrator Voice</label>
            <select 
              className="p-2 border border-stone-300 rounded-lg bg-stone-50 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              disabled={isWorking}
            >
              <option value="Kore">Kore (Female)</option>
              <option value="Zephyr">Zephyr (Female)</option>
              <option value="Puck">Puck (Neutral)</option>
              <option value="Charon">Charon (Male)</option>
              <option value="Fenrir">Fenrir (Male)</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-stone-700">Target Demographic</label>
            <select 
              className="p-2 border border-stone-300 rounded-lg bg-stone-50 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              value={demographic}
              onChange={(e) => setDemographic(e.target.value)}
              disabled={isWorking}
            >
              <option value="Ages 3 to 5 (Preschool)">Ages 3 to 5 (Preschool)</option>
              <option value="Ages 6 to 8 (Early Elementary)">Ages 6 to 8 (Early Elementary)</option>
              <option value="Ages 9+ (Late Elementary and Above)">Ages 9+ (Late Elementary and Above)</option>
            </select>
          </div>
          
          <div className="flex flex-col gap-2 flex-1">
            <label className="text-sm font-medium text-stone-700">Story Prompt</label>
            <textarea 
              className="flex-1 p-3 border border-stone-300 rounded-lg bg-stone-50 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all resize-none"
              placeholder="e.g., A brave little toaster goes on an adventure to find its missing cord..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isWorking}
            />
          </div>
        </div>
        
        <div className="p-6 border-t border-stone-100 bg-stone-50">
          <button 
            onClick={handleGenerate}
            disabled={isWorking || !prompt.trim()}
            className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            {isWorking ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating Story...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Create Storybook
              </>
            )}
          </button>
        </div>
      </div>

      {/* Right Column: Canvas */}
      <div className="flex-1 bg-stone-200 flex items-center justify-center p-8 overflow-hidden relative">
        {!story && !isGenerating && (
          <div className="text-center text-stone-400 max-w-md">
            <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <h2 className="text-xl font-medium text-stone-500">No Story Yet</h2>
            <p className="mt-2">Enter a prompt and click "Create Storybook" to begin generating your personalized narrative.</p>
          </div>
        )}
        
        {isGenerating && !story && (
          <div className="text-center text-stone-500 flex flex-col items-center">
            <Loader2 className="w-12 h-12 animate-spin mb-4 text-indigo-500" />
            <p className="font-medium animate-pulse">Writing story outline...</p>
            <p className="text-sm mt-2 text-stone-400">Estimated time: ~{estimatedTotalSeconds}s</p>
          </div>
        )}

        {story && story.length > 0 && (
          <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col h-full max-h-[800px]">
            {/* Progress Bar (if still generating assets) */}
            {progress.total > 0 && progress.completed < progress.total && (
              <div className="bg-indigo-50 border-b border-indigo-100 p-3 flex flex-col gap-2 shrink-0">
                <div className="flex justify-between text-xs font-medium text-indigo-800">
                  <span>Generating illustrations and audio... ({progress.completed}/{progress.total})</span>
                  <span>~{remainingSeconds}s remaining</span>
                </div>
                <div className="w-full bg-indigo-200 rounded-full h-1.5">
                  <div 
                    className="bg-indigo-600 h-1.5 rounded-full transition-all duration-500" 
                    style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Storybook Header */}
            <div className="p-4 border-b border-stone-100 flex items-center justify-between bg-stone-50 shrink-0">
              <span className="text-sm font-medium text-stone-500 uppercase tracking-wider">
                Page {currentPage + 1} of {story.length}
              </span>
              <div className="flex items-center gap-2">
                {story[currentPage].audioBase64 ? (
                  <button 
                    onClick={() => isPlaying ? stopAudio() : playAudio(story[currentPage].audioBase64!, story[currentPage].audioMimeType!)}
                    className={`p-2 rounded-full flex items-center justify-center transition-colors ${isPlaying ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'}`}
                    title={isPlaying ? "Stop Audio" : "Play Audio"}
                  >
                    {isPlaying ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                  </button>
                ) : story[currentPage].audioError ? (
                  <div className="p-2 text-red-400" title="Audio generation failed">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                ) : (
                  <div className="p-2 text-stone-400" title="Generating audio...">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                )}
              </div>
            </div>
            
            {/* Storybook Content */}
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
              {/* Image Pane */}
              <div className="w-full md:w-1/2 bg-stone-100 flex items-center justify-center relative border-b md:border-b-0 md:border-r border-stone-200">
                {story[currentPage].imageUrl ? (
                  <img 
                    src={story[currentPage].imageUrl} 
                    alt={`Illustration for page ${currentPage + 1}`}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : story[currentPage].imageError ? (
                  <div className="flex flex-col items-center text-red-400 p-6 text-center">
                    <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
                    <span className="text-sm">Image generation failed<br/>(Safety filter or timeout)</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-stone-400">
                    <Loader2 className="w-8 h-8 animate-spin mb-2 text-indigo-400" />
                    <span className="text-sm">Illustrating...</span>
                  </div>
                )}
              </div>
              
              {/* Text Pane */}
              <div className="w-full md:w-1/2 p-8 md:p-12 overflow-y-auto flex items-center justify-center bg-white" dir={language === 'Farsi' ? 'rtl' : 'ltr'}>
                <p className="text-xl md:text-2xl font-serif leading-relaxed text-stone-800">
                  {story[currentPage].text}
                </p>
              </div>
            </div>
            
            {/* Storybook Navigation */}
            <div className="p-4 border-t border-stone-100 bg-stone-50 flex items-center justify-between shrink-0">
              <button 
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="p-2 rounded-full hover:bg-stone-200 disabled:opacity-50 disabled:hover:bg-transparent transition-colors text-stone-600"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              
              <div className="flex gap-1">
                {story.map((_, idx) => (
                  <div 
                    key={idx} 
                    className={`h-1.5 rounded-full transition-all ${idx === currentPage ? 'w-6 bg-indigo-600' : 'w-2 bg-stone-300'}`}
                  />
                ))}
              </div>
              
              <button 
                onClick={() => setCurrentPage(p => Math.min(story.length - 1, p + 1))}
                disabled={currentPage === story.length - 1}
                className="p-2 rounded-full hover:bg-stone-200 disabled:opacity-50 disabled:hover:bg-transparent transition-colors text-stone-600"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
