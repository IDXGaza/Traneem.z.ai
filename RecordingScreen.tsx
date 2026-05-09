import React, { useEffect, useState, useRef } from 'react';

interface RecordingScreenProps {
  recordingTime: number; // in seconds, used as a backup
  isPaused: boolean;
  audioData: number[];
  onStop: () => void;
  onPause: () => void;
  onCancel: () => void;
}

const RecordingScreen: React.FC<RecordingScreenProps> = ({
  isPaused,
  audioData,
  onStop,
  onPause,
  onCancel
}) => {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const accumulatedTimeRef = useRef(0);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPaused) {
      startTimeRef.current = performance.now();
      
      const updateTimer = (time: number) => {
        if (startTimeRef.current !== null) {
          const delta = time - startTimeRef.current;
          setElapsedMs(accumulatedTimeRef.current + delta);
        }
        animationRef.current = requestAnimationFrame(updateTimer);
      };
      
      animationRef.current = requestAnimationFrame(updateTimer);
      
      return () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
        if (startTimeRef.current !== null) {
          accumulatedTimeRef.current += performance.now() - startTimeRef.current;
        }
      };
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (startTimeRef.current !== null) {
        accumulatedTimeRef.current += performance.now() - startTimeRef.current;
        startTimeRef.current = null;
      }
    }
  }, [isPaused]);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const centiseconds = Math.floor((ms % 1000) / 10);
    
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-lg mx-auto aspect-square relative p-4 rounded-[40px] md:rounded-[60px] overflow-hidden bg-[#e8eef0]/90 dark:bg-black/80 backdrop-blur-3xl border-[4px] md:border-[6px] border-[#f0f4f5] dark:border-slate-900 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.1)] dark:shadow-[0_24px_64px_-12px_rgba(0,0,0,0.3)] text-slate-800 dark:text-white transition-all duration-500">
      {/* Elapsed Time */}
      <div className="absolute top-12 flex flex-col items-center w-full">
        <h2 className="text-5xl md:text-7xl font-black tabular-nums tracking-wider" dir="ltr">
          {formatTime(elapsedMs)}
        </h2>
        <p className="mt-4 text-[#4da8ab] font-bold opacity-80 uppercase tracking-widest text-sm text-center">
          جودة عالية
        </p>
      </div>

      {/* Visualizer Area */}
      <div className="w-full h-40 flex items-center justify-center gap-1 mt-10 relative">
         <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-[#4da8ab]/50 -translate-x-1/2 z-0" />
         
         <div className="flex items-center gap-[2px] md:gap-1 z-10 w-full justify-center px-4">
            {audioData.length > 0 ? audioData.map((val, i) => {
              const capVal = isPaused ? 0 : val;
              const height = Math.max(10, Math.min(100, (capVal * 3) + 10)); // Scale up
              return (
                <div 
                  key={i}
                  className="w-1 md:w-1.5 bg-[#4da8ab] rounded-full transition-all duration-75 shadow-[0_0_8px_rgba(77,168,171,0.5)]"
                  style={{ height: `${height}%` }}
                />
              )
            }) : (
              // Empty skeleton bars if audioData is completely empty initially
              Array.from({ length: 50 }).map((_, i) => (
                <div 
                  key={i}
                  className="w-1 md:w-1.5 bg-[#4da8ab]/30 rounded-full"
                  style={{ height: '10%' }}
                />
              ))
            )}
         </div>
      </div>

      {/* Controls */}
      <div className="absolute bottom-10 w-full flex items-center justify-center gap-8 px-10">
        <button 
          onClick={onCancel}
          className="w-14 h-14 rounded-full bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-all active:scale-95"
          title="إلغاء المقطع"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        <button 
          onClick={onStop}
          className="w-20 h-20 rounded-full bg-[#4da8ab] hover:bg-[#3d8c8e] flex items-center justify-center text-white transition-all active:scale-95 shadow-[0_0_20px_rgba(77,168,171,0.4)]"
          title="حفظ التسجيل"
        >
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
        </button>

        <button 
          onClick={onPause}
          className="w-14 h-14 rounded-full bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-all active:scale-95"
          title={isPaused ? "متابعة التسجيل" : "إيقاف مؤقت"}
        >
          {isPaused ? (
            <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          ) : (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>
          )}
        </button>
      </div>
    </div>
  );
};

export default RecordingScreen;
