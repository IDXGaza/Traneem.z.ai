import { useState, useRef, useCallback } from 'react';

export const useAudioRecorder = (onImport: (file: File, durationOverride?: number) => void) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const recordingTimeRef = useRef(0);
  
  // Visualizer 
  const [audioData, setAudioData] = useState<number[]>([]);
  const animationRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const isVisualizerActiveRef = useRef(false);

  const cleanup = useCallback(() => {
    isVisualizerActiveRef.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
    }
  }, []);

  const drawVisualizer = useCallback(() => {
    if (!analyserRef.current || !isVisualizerActiveRef.current) return;
    
    const bufferLength = analyserRef.current.frequencyBinCount; // 128
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteTimeDomainData(dataArray);

    // Create a simplified representation of the waveform (e.g. 50 bars)
    const bars = 50;
    const step = Math.floor(bufferLength / bars);
    const simplifiedData: number[] = [];
    
    for (let i = 0; i < bars; i++) {
        let max = 0;
        for (let j = 0; j < step; j++) {
            const val = Math.abs(dataArray[i * step + j] - 128);
            if (val > max) max = val;
        }
        simplifiedData.push((max / 128) * 100); // 0-100 scale
    }
    
    setAudioData(simplifiedData);
    
    animationRef.current = requestAnimationFrame(drawVisualizer);
  }, []);

  const startRecording = async () => {
    try {
      cleanup(); // ensure clean state
      setRecordingTime(0);
      recordingTimeRef.current = 0;
      setAudioData([]);
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 48000,
          channelCount: 2,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } 
      });

      // Setup audio analyzer for visualizer
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      const getSupportedMimeType = () => {
        const types = [
          'audio/webm;codecs=opus',
          'audio/mp4;codecs=mp4a.40.2',
          'audio/ogg;codecs=opus',
          'audio/webm'
        ];
        for (const type of types) {
          if (MediaRecorder.isTypeSupported(type)) {
            return type;
          }
        }
        return '';
      };
      
      const mimeType = getSupportedMimeType();
      const options = mimeType ? { mimeType, audioBitsPerSecond: 320000 } : { audioBitsPerSecond: 320000 };
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        cleanup();
        
        const recordedMimeType = mediaRecorder.mimeType || 'audio/webm';
        const rawBlob = new Blob(audioChunksRef.current, { type: recordedMimeType });
        const date = new Date();
        const dateStr = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        const defaultDuration = recordingTimeRef.current;
        
        try {
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const arrayBuffer = await rawBlob.arrayBuffer();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          
          // @ts-ignore
          const toWav = (await import('audiobuffer-to-wav')).default;
          const wavBuffer = toWav(audioBuffer);
          const wavBlob = new Blob([new DataView(wavBuffer)], { type: 'audio/wav' });
          const file = new File([wavBlob], `تسجيل صوتي - ${dateStr}.wav`, { type: 'audio/wav' });
          onImport(file, audioBuffer.duration);
        } catch (err) {
          console.error("Audio conversion failed, falling back to original blob", err);
          let extension = 'webm';
          if (recordedMimeType.includes('mp4')) extension = 'mp4';
          else if (recordedMimeType.includes('ogg')) extension = 'ogg';
          
          const file = new File([rawBlob], `تسجيل صوتي - ${dateStr}.${extension}`, { type: recordedMimeType });
          onImport(file, defaultDuration);
        }

        stream.getTracks().forEach(track => track.stop()); // Stop microphone
        setIsRecording(false);
        setIsPaused(false);
        setRecordingTime(0);
        recordingTimeRef.current = 0;
      };

      mediaRecorder.start(100); // chunk every 100ms
      setIsRecording(true);
      setIsPaused(false);
      isVisualizerActiveRef.current = true;
      drawVisualizer();
      
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          const newTime = prev + 1;
          recordingTimeRef.current = newTime;
          return newTime;
        });
      }, 1000);
      
    } catch (err: any) {
      console.log("Microphone access issue:", err.message);
      if (err.name === 'NotAllowedError' || err.message === 'Permission denied') {
        alert("لم يتم منح صلاحية الميكروفون. الرجاء فتح التطبيق في نافذة جديدة (من خلال زر المشاركة) إذا كنت تستخدمه داخل إطار.");
      } else {
        alert("تعذر الوصول إلى الميكروفون: " + err.message);
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      cleanup();
    }
  };

  const togglePause = () => {
    if (mediaRecorderRef.current && isRecording) {
      if (isPaused) {
        mediaRecorderRef.current.resume();
        setIsPaused(false);
        isVisualizerActiveRef.current = true;
        drawVisualizer();
        timerRef.current = setInterval(() => {
          setRecordingTime(prev => {
            const newTime = prev + 1;
            recordingTimeRef.current = newTime;
            return newTime;
          });
        }, 1000);
      } else {
        mediaRecorderRef.current.pause();
        setIsPaused(true);
        isVisualizerActiveRef.current = false;
        if (timerRef.current) clearInterval(timerRef.current);
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
      }
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      // Overwrite onstop so it doesn't save
      mediaRecorderRef.current.onstop = () => {
        const stream = mediaRecorderRef.current?.stream;
        if (stream) stream.getTracks().forEach(track => track.stop());
        cleanup();
        setIsRecording(false);
        setIsPaused(false);
        setRecordingTime(0);
        recordingTimeRef.current = 0;
      };
      mediaRecorderRef.current.stop();
    }
  };

  return {
    isRecording,
    isPaused,
    recordingTime,
    audioData,
    startRecording,
    stopRecording,
    togglePause,
    cancelRecording
  };
};
