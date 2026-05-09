

import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import JSZip from 'jszip'

// Types
interface Timestamp {
  id: string
  time: number
  label: string
}

interface Track {
  id: string
  name: string
  artist: string
  url: string
  coverUrl: string
  isFavorite: boolean
  timestamps: Timestamp[]
  duration: number
  playbackRate: number
  order: number
  fileBlob?: File | Blob
  coverBlob?: File | Blob
  sourceType: 'record' | 'import'
}

interface PlayerState {
  isPlaying: boolean
  currentTime: number
  volume: number
  playbackRate: number
  isLoading: boolean
  isLooping: boolean
}

// Offline-safe placeholder: inline SVG data URI (no internet needed)
const UNIFORM_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%234da8ab;stop-opacity:0.3'/%3E%3Cstop offset='100%25' style='stop-color:%234da8ab;stop-opacity:0.1'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='600' height='600' fill='url(%23g)'/%3E%3Ccircle cx='300' cy='260' r='80' fill='%234da8ab' opacity='0.4'/%3E%3Cpath d='M280 220 L280 320 L340 290 Z' fill='%234da8ab' opacity='0.5'/%3E%3Crect x='260' y='310' width='80' height='8' rx='4' fill='%234da8ab' opacity='0.3'/%3E%3Crect x='260' y='325' width='60' height='6' rx='3' fill='%234da8ab' opacity='0.2'/%3E%3C/svg%3E"

// IndexedDB helpers
const DB_NAME = 'TraneemDB'
const STORE_NAME = 'tracks'

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    try {
      if (!window.indexedDB) {
        return reject(new Error("IndexedDB is not supported"))
      }
      const timeoutId = setTimeout(() => reject(new Error("IndexedDB timeout")), 3000)
      const request = window.indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => { clearTimeout(timeoutId); resolve(request.result) }
      request.onerror = () => { clearTimeout(timeoutId); reject(request.error) }
      request.onblocked = () => { clearTimeout(timeoutId); reject(new Error("IndexedDB blocked")) }
    } catch (error) { reject(error) }
  })
}

// Helper to ensure fileBlob/coverBlob are proper Blobs (not deserialized objects)
const ensureBlob = (value: any, fallbackType: string): Blob | undefined => {
  if (!value) return undefined
  if (value instanceof Blob) return value
  // If IndexedDB deserialized it as a plain object, try to reconstruct
  if (typeof value === 'object' && value.type && value.size !== undefined) {
    try {
      // This might be an ArrayBuffer or similar
      if (value instanceof ArrayBuffer) return new Blob([value], { type: fallbackType })
      if (value.buffer instanceof ArrayBuffer) return new Blob([value.buffer], { type: fallbackType })
    } catch { /* ignore */ }
  }
  return undefined
}

const saveTrackToDB = async (track: any): Promise<void> => {
  try {
    const db = await initDB()
    // Ensure Blobs are properly serialized for IndexedDB
    const trackToStore = { ...track }
    // IndexedDB natively supports Blob storage, but we ensure they are proper Blobs
    if (trackToStore.fileBlob && !(trackToStore.fileBlob instanceof Blob)) {
      // If it's not a Blob, try to convert it
      if (trackToStore.fileBlob instanceof ArrayBuffer) {
        trackToStore.fileBlob = new Blob([trackToStore.fileBlob], { type: 'audio/mpeg' })
      } else {
        // Remove corrupted blob reference
        delete trackToStore.fileBlob
      }
    }
    if (trackToStore.coverBlob && !(trackToStore.coverBlob instanceof Blob)) {
      if (trackToStore.coverBlob instanceof ArrayBuffer) {
        trackToStore.coverBlob = new Blob([trackToStore.coverBlob], { type: 'image/jpeg' })
      } else {
        delete trackToStore.coverBlob
      }
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(STORE_NAME).put(trackToStore)
    })
  } catch (error) { console.error("IndexedDB save error:", error); throw error }
}

const deleteTrackFromDB = async (id: string): Promise<void> => {
  try {
    const db = await initDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(STORE_NAME).delete(id)
    })
  } catch (error) { console.error("IndexedDB delete error:", error) }
}

const getAllTracksFromDB = async (): Promise<any[]> => {
  try {
    const db = await initDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const request = tx.objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(tx.error)
    })
  } catch (error) { console.error("IndexedDB get all error:", error); return [] }
}

// Utility functions
const formatTime = (time: number) => {
  if (isNaN(time) || !isFinite(time)) return "0:00"
  const min = Math.floor(time / 60)
  const sec = Math.floor(time % 60)
  return `${min}:${sec.toString().padStart(2, '0')}`
}

const toArabicIndic = (num: number) => {
  const digits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
  return num.toString().split('').map(d => digits[parseInt(d)] || d).join('')
}

// Helper: fetch audio data from a blob URL (for backup export)
const fetchBlobFromUrl = async (url: string): Promise<Blob | null> => {
  try {
    const response = await fetch(url)
    if (response.ok) {
      return await response.blob()
    }
  } catch { /* ignore */ }
  return null
}

// Audio Recorder Hook (inline)
function useAudioRecorder(onComplete: (file: File, durationOverride?: number) => void) {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [audioData, setAudioData] = useState<number[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordingTimeRef = useRef(0)
  const animationRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const isVisualizerActiveRef = useRef(false)

  const cleanup = useCallback(() => {
    isVisualizerActiveRef.current = false
    if (timerRef.current) clearInterval(timerRef.current)
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {})
    }
  }, [])

  const drawVisualizer = useCallback(() => {
    if (!analyserRef.current || !isVisualizerActiveRef.current) return
    const bufferLength = analyserRef.current.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    analyserRef.current.getByteTimeDomainData(dataArray)
    const bars = 50
    const step = Math.floor(bufferLength / bars)
    const simplifiedData: number[] = []
    for (let i = 0; i < bars; i++) {
      let max = 0
      for (let j = 0; j < step; j++) {
        const val = Math.abs(dataArray[i * step + j] - 128)
        if (val > max) max = val
      }
      simplifiedData.push((max / 128) * 100)
    }
    setAudioData(simplifiedData)
    animationRef.current = requestAnimationFrame(drawVisualizer)
  }, [])

  const startRecording = async () => {
    // Check for HTTPS or localhost
    const isSecure = window.isSecureContext || window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    if (!isSecure) {
      alert("التسجيل يحتاج اتصال آمن (HTTPS). يرجى فتح التطبيق عبر رابط HTTPS.")
      return
    }

    // Check MediaRecorder support
    if (typeof MediaRecorder === 'undefined') {
      alert("متصفحك لا يدعم التسجيل الصوتي. يرجى استخدام متصفح أحدث.")
      return
    }

    try {
      cleanup()
      setRecordingTime(0)
      recordingTimeRef.current = 0
      setAudioData([])

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 48000, channelCount: 2, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      })

      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      const source = audioContextRef.current.createMediaStreamSource(stream)
      analyserRef.current = audioContextRef.current.createAnalyser()
      analyserRef.current.fftSize = 256
      source.connect(analyserRef.current)

      const getSupportedMimeType = () => {
        const types = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/ogg;codecs=opus', 'audio/webm']
        for (const type of types) { if (MediaRecorder.isTypeSupported(type)) return type }
        return ''
      }

      const mimeType = getSupportedMimeType()
      const options = mimeType ? { mimeType, audioBitsPerSecond: 320000 } : { audioBitsPerSecond: 320000 }
      const mediaRecorder = new MediaRecorder(stream, options)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }

      mediaRecorder.onstop = async () => {
        cleanup()
        const recordedMimeType = mediaRecorder.mimeType || 'audio/webm'
        const rawBlob = new Blob(audioChunksRef.current, { type: recordedMimeType })
        const date = new Date()
        const dateStr = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
        const defaultDuration = recordingTimeRef.current

        try {
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
          const arrayBuffer = await rawBlob.arrayBuffer()
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
          const toWav = (await import('audiobuffer-to-wav')).default
          const wavBuffer = toWav(audioBuffer)
          const wavBlob = new Blob([new DataView(wavBuffer as ArrayBuffer)], { type: 'audio/wav' })
          const file = new File([wavBlob], `تسجيل صوتي - ${dateStr}.wav`, { type: 'audio/wav' })
          onComplete(file, audioBuffer.duration)
        } catch (err) {
          console.error("Audio conversion failed, falling back", err)
          let extension = 'webm'
          if (recordedMimeType.includes('mp4')) extension = 'mp4'
          else if (recordedMimeType.includes('ogg')) extension = 'ogg'
          const file = new File([rawBlob], `تسجيل صوتي - ${dateStr}.${extension}`, { type: recordedMimeType })
          onComplete(file, defaultDuration)
        }

        stream.getTracks().forEach(track => track.stop())
        setIsRecording(false)
        setIsPaused(false)
        setRecordingTime(0)
        recordingTimeRef.current = 0
      }

      mediaRecorder.start(100)
      setIsRecording(true)
      setIsPaused(false)
      isVisualizerActiveRef.current = true
      drawVisualizer()

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          const newTime = prev + 1
          recordingTimeRef.current = newTime
          return newTime
        })
      }, 1000)
    } catch (err: any) {
      console.error("Microphone access issue:", err.message)
      if (err.name === 'NotAllowedError' || err.message === 'Permission denied') {
        alert("لم يتم منح صلاحية الميكروفون. يرجى السماح بالوصول إلى الميكروفون في إعدادات المتصفح.")
      } else if (err.name === 'NotFoundError') {
        alert("لم يتم العثور على ميكروفون. يرجى توصيل ميكروفون والمحاولة مرة أخرى.")
      } else if (err.name === 'NotReadableError') {
        alert("لا يمكن الوصول إلى الميكروفون. قد يكون قيد الاستخدام من قبل تطبيق آخر.")
      } else if (err.name === 'SecurityError') {
        alert("التسجيل يحتاج اتصال آمن (HTTPS). يرجى فتح التطبيق عبر رابط HTTPS.")
      } else {
        alert("تعذر الوصول إلى الميكروفون: " + err.message)
      }
    }
  }

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      cleanup()
    }
  }, [isRecording, cleanup])

  const togglePause = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      if (isPaused) {
        mediaRecorderRef.current.resume()
        setIsPaused(false)
        isVisualizerActiveRef.current = true
        drawVisualizer()
        timerRef.current = setInterval(() => {
          setRecordingTime(prev => { const n = prev + 1; recordingTimeRef.current = n; return n })
        }, 1000)
      } else {
        mediaRecorderRef.current.pause()
        setIsPaused(true)
        isVisualizerActiveRef.current = false
        if (timerRef.current) clearInterval(timerRef.current)
        if (animationRef.current) cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isRecording, isPaused, drawVisualizer])

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = () => {
        const stream = mediaRecorderRef.current?.stream
        if (stream) stream.getTracks().forEach(track => track.stop())
        cleanup()
        setIsRecording(false)
        setIsPaused(false)
        setRecordingTime(0)
        recordingTimeRef.current = 0
      }
      mediaRecorderRef.current.stop()
    }
  }, [isRecording, cleanup])

  return { isRecording, isPaused, recordingTime, audioData, startRecording, stopRecording, togglePause, cancelRecording }
}

// Memoized track item component
const TrackListItem = memo(function TrackListItem({
  track,
  isActive,
  isDark,
  isRecording,
  onSelect,
  onRemove,
  onMoveCategory,
}: {
  track: Track
  isActive: boolean
  isDark: boolean
  isRecording: boolean
  onSelect: () => void
  onRemove: () => void
  onMoveCategory: () => void
}) {
  return (
    <div className="group flex items-center gap-1">
      <button
        onClick={onSelect}
        disabled={isRecording}
        className={`flex-1 flex items-center gap-3 p-3 rounded-[20px] transition-all duration-300 min-w-0 ${
          isActive
            ? 'bg-[#4da8ab]/10 text-[#4da8ab] shadow-sm'
            : `${isDark ? 'hover:bg-slate-900 text-slate-400' : 'hover:bg-white/60 text-slate-600'}`
        } ${isRecording ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <div className="relative shrink-0">
          <img src={track.coverUrl} className="w-10 h-10 rounded-xl object-cover shadow-sm" alt="" />
          {track.isFavorite && (
            <div className={`absolute -top-1.5 -right-1.5 rounded-full p-0.5 shadow-sm border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
              <svg className="w-3 h-3 text-rose-500" fill="currentColor" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 text-right overflow-hidden">
          <div className="flex items-center gap-2">
            <p className="font-bold text-xs truncate" dir="rtl">{track.name}</p>
            <span className={`shrink-0 text-[8px] font-black px-1.5 py-0.5 rounded-full ${
              track.sourceType === 'record'
                ? 'bg-amber-500/10 text-amber-500'
                : 'bg-[#4da8ab]/10 text-[#4da8ab]'
            }`}>
              {track.sourceType === 'record' ? 'تسجيل' : 'مستوردة'}
            </span>
          </div>
          <p className="text-[10px] opacity-50 font-bold mt-1 truncate">{track.artist || "ملف صوتي"}</p>
        </div>
      </button>

      {/* Move category button */}
      <button
        onClick={(e) => { e.stopPropagation(); onMoveCategory() }}
        disabled={isRecording}
        className={`p-1.5 hover:text-[#4da8ab] rounded-full transition-all active:scale-90 shrink-0 opacity-0 group-hover:opacity-100 ${
          isDark ? 'text-slate-500/70 hover:bg-slate-500/20' : 'text-slate-500 hover:bg-slate-100'
        } ${isRecording ? 'opacity-50 pointer-events-none' : ''}`}
        title={track.sourceType === 'record' ? 'نقل إلى مستوردة' : 'نقل إلى تسجيلات'}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
        </svg>
      </button>

      <button
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        disabled={isRecording}
        className={`p-2.5 hover:text-red-500 rounded-full transition-all active:scale-90 ml-1 shrink-0 ${
          isDark ? 'text-slate-500/70 hover:bg-slate-500/20' : 'text-slate-500 hover:bg-slate-100'
        } ${isRecording ? 'opacity-50 pointer-events-none' : ''}`}
        title="حذف الأنشودة"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
      </button>
    </div>
  )
})

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<'all' | 'record' | 'import'>('all')
  const [playerState, setPlayerState] = useState<PlayerState>({
    isPlaying: false, currentTime: 0, volume: 1, playbackRate: 1, isLoading: false, isLooping: false
  })
  const [backupProgress, setBackupProgress] = useState<{ active: boolean; current: number; total: number; type: 'export' | 'import' | null }>({ active: false, current: 0, total: 0, type: null })

  const audioRef = useRef<HTMLAudioElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastUpdateTimeRef = useRef<number>(0)
  const currentTrack = currentTrackIndex !== null ? tracks[currentTrackIndex] : null

  // Refs for audio event handlers to avoid recreating the effect
  const isLoopingRef = useRef(playerState.isLooping)
  const currentTrackIndexRef = useRef(currentTrackIndex)
  const tracksLengthRef = useRef(tracks.length)

  // Keep refs in sync with state
  useEffect(() => { isLoopingRef.current = playerState.isLooping }, [playerState.isLooping])
  useEffect(() => { currentTrackIndexRef.current = currentTrackIndex }, [currentTrackIndex])
  useEffect(() => { tracksLengthRef.current = tracks.length }, [tracks.length])

  const { isRecording, isPaused: isRecordingPaused, recordingTime, audioData, startRecording, stopRecording, togglePause: toggleRecordingPause, cancelRecording } = useAudioRecorder(useCallback((file: File, durationOverride?: number) => {
    addTrack(file, durationOverride)
  }, []))

  // Initialize dark mode from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const shouldBeDark = savedTheme === 'dark' || (!savedTheme && prefersDark)
    setIsDark(shouldBeDark)
    if (shouldBeDark) {
      document.documentElement.classList.add('dark')
      document.documentElement.classList.remove('light')
    } else {
      document.documentElement.classList.remove('dark')
      document.documentElement.classList.add('light')
    }
  }, [])

  // Initialize view from localStorage
  useEffect(() => {
    const savedView = localStorage.getItem('traneem-view')
    if (savedView && ['all', 'record', 'import'].includes(savedView)) {
      setView(savedView as 'all' | 'record' | 'import')
    }
  }, [])

  // Load tracks from IndexedDB
  useEffect(() => {
    const loadTracks = async () => {
      try {
        const saved = await getAllTracksFromDB()
        if (saved.length > 0) {
          const withUrls = saved.sort((a: any, b: any) => (a.order || 0) - (b.order || 0)).map((t: any) => {
            const fileBlob = ensureBlob(t.fileBlob, 'audio/mpeg')
            const coverBlob = ensureBlob(t.coverBlob, 'image/jpeg')
            return {
              ...t,
              fileBlob,
              coverBlob,
              url: fileBlob ? URL.createObjectURL(fileBlob) : (t.audioUrl || ""),
              coverUrl: coverBlob ? URL.createObjectURL(coverBlob) : (t.coverUrl || UNIFORM_PLACEHOLDER)
            }
          })
          setTracks(withUrls)
          // Restore saved track index
          const savedIndex = localStorage.getItem('traneem-currentTrackIndex')
          if (savedIndex !== null) {
            const idx = parseInt(savedIndex, 10)
            if (!isNaN(idx) && idx >= 0 && idx < withUrls.length) {
              setCurrentTrackIndex(idx)
            } else if (withUrls.length > 0) {
              setCurrentTrackIndex(0)
            }
          } else if (withUrls.length > 0) {
            setCurrentTrackIndex(0)
          }
        }
      } catch (e) { console.error("Failed to load tracks", e) }
    }
    loadTracks()
  }, [])

  // Save view to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('traneem-view', view)
  }, [view])

  // Save currentTrackIndex to localStorage when it changes
  useEffect(() => {
    if (currentTrackIndex !== null) {
      localStorage.setItem('traneem-currentTrackIndex', currentTrackIndex.toString())
    }
  }, [currentTrackIndex])

  // Register service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  const toggleDark = useCallback(() => {
    setIsDark(prev => {
      const newDark = !prev
      if (newDark) {
        document.documentElement.classList.add('dark')
        document.documentElement.classList.remove('light')
        localStorage.setItem('theme', 'dark')
      } else {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
        localStorage.setItem('theme', 'light')
      }
      return newDark
    })
  }, [])

  const handleSelectTrack = useCallback((index: number) => {
    setCurrentTrackIndex(index)
    setPlayerState(prev => ({ ...prev, isPlaying: true, currentTime: 0 }))
  }, [])

  const handlePlayPause = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    setPlayerState(prev => {
      if (prev.isPlaying) {
        audio.pause()
        return { ...prev, isPlaying: false }
      } else {
        const playPromise = audio.play()
        if (playPromise) playPromise.catch(() => setPlayerState(p => ({ ...p, isPlaying: false })))
        return { ...prev, isPlaying: true }
      }
    })
  }, [])

  const handleSeek = useCallback((time: number) => {
    const audio = audioRef.current
    if (audio) { audio.currentTime = time; setPlayerState(prev => ({ ...prev, currentTime: time })) }
  }, [])

  const handleSkip = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (audio) {
      const newTime = Math.max(0, Math.min(audio.currentTime + seconds, audio.duration || 0))
      audio.currentTime = newTime
      setPlayerState(prev => ({ ...prev, currentTime: newTime }))
    }
  }, [])

  const handleToggleLoop = useCallback(() => setPlayerState(prev => ({ ...prev, isLooping: !prev.isLooping })), [])

  const handleToggleFavorite = useCallback(() => {
    setTracks(prev => {
      const idx = currentTrackIndexRef.current
      if (idx === null) return prev
      const track = prev[idx]
      if (!track) return prev
      const updated = { ...track, isFavorite: !track.isFavorite }
      saveTrackToDB(updated)
      return prev.map(t => t.id === track.id ? updated : t)
    })
  }, [])

  const handleAddTimestamp = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    setTracks(prev => {
      const idx = currentTrackIndexRef.current
      if (idx === null) return prev
      const track = prev[idx]
      if (!track) return prev
      const newTs: Timestamp = { id: Math.random().toString(36).substr(2, 9), time: audio.currentTime, label: `علامة ${track.timestamps.length + 1}` }
      const updated = { ...track, timestamps: [...track.timestamps, newTs] }
      saveTrackToDB(updated)
      return prev.map(t => t.id === track.id ? updated : t)
    })
  }, [])

  const handleRemoveTimestamp = useCallback((tsId: string) => {
    setTracks(prev => {
      const idx = currentTrackIndexRef.current
      if (idx === null) return prev
      const track = prev[idx]
      if (!track) return prev
      const updated = { ...track, timestamps: track.timestamps.filter(ts => ts.id !== tsId) }
      saveTrackToDB(updated)
      return prev.map(t => t.id === track.id ? updated : t)
    })
  }, [])

  const handleTimestampSeek = useCallback((time: number) => {
    const audio = audioRef.current
    if (audio) {
      audio.currentTime = time
      setPlayerState(prev => ({ ...prev, currentTime: time, isPlaying: true }))
      const p = audio.play()
      if (p) p.catch(() => setPlayerState(prev => ({ ...prev, isPlaying: false })))
    }
  }, [])

  const addTrack = useCallback(async (file: File, durationOverride?: number) => {
    const id = Math.random().toString(36).substr(2, 9)
    const isAudioFile = file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i)
    const newTrack: Track = {
      id, name: file.name.replace(/\.[^/.]+$/, ""), artist: "",
      url: URL.createObjectURL(file), coverUrl: UNIFORM_PLACEHOLDER,
      isFavorite: false, timestamps: [], duration: durationOverride || 0, playbackRate: 1,
      order: tracksLengthRef.current, fileBlob: file, sourceType: isAudioFile ? 'import' : 'record',
    }
    setTracks(prev => {
      const updated = [...prev, newTrack]
      setCurrentTrackIndex(updated.length - 1)
      return updated
    })
    setPlayerState(ps => ({ ...ps, isPlaying: true }))
    try { await saveTrackToDB(newTrack) } catch (error) { console.error("Failed to save track:", error) }
  }, [])

  const removeTrack = useCallback(async (id: string) => {
    try { await deleteTrackFromDB(id) } catch (error) { console.error("Failed to delete track:", error) }
    setTracks(prev => {
      const newTracks = prev.filter(t => t.id !== id)
      if (newTracks.length === 0) setCurrentTrackIndex(null)
      else if (currentTrackIndexRef.current !== null && currentTrackIndexRef.current >= newTracks.length) setCurrentTrackIndex(newTracks.length - 1)
      return newTracks
    })
  }, [])

  const handleUpdateName = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setTracks(prev => {
      const idx = currentTrackIndexRef.current
      if (idx === null) return prev
      const track = prev[idx]
      if (!track) return prev
      const newName = window.prompt("تعديل اسم الأنشودة:", track.name)
      if (newName?.trim()) {
        const updated = { ...track, name: newName.trim() }
        saveTrackToDB(updated)
        return prev.map(t => t.id === track.id ? updated : t)
      }
      return prev
    })
  }, [])

  const handleUpdateArtist = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setTracks(prev => {
      const idx = currentTrackIndexRef.current
      if (idx === null) return prev
      const track = prev[idx]
      if (!track) return prev
      const newArtist = window.prompt("تعديل اسم الفنان:", track.artist || "")
      if (newArtist !== null) {
        const updated = { ...track, artist: newArtist.trim() }
        saveTrackToDB(updated)
        return prev.map(t => t.id === track.id ? updated : t)
      }
      return prev
    })
  }, [])

  const handleUpdateCover = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setTracks(prev => {
        const idx = currentTrackIndexRef.current
        if (idx === null) return prev
        const track = prev[idx]
        if (!track) return prev
        const updated: Track = { ...track, coverUrl: URL.createObjectURL(file), coverBlob: file }
        saveTrackToDB(updated)
        return prev.map(t => t.id === track.id ? updated : t)
      })
    }
  }, [])

  const handleStartRecording = useCallback(() => {
    if (playerState.isPlaying && audioRef.current) {
      audioRef.current.pause()
      setPlayerState(prev => ({ ...prev, isPlaying: false }))
    }
    startRecording()
  }, [playerState.isPlaying, startRecording])

  const handleFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    Array.from(files).forEach(file => addTrack(file))
    setIsSidebarOpen(false)
    e.target.value = ''
  }, [addTrack])

  // Move track between categories
  const handleMoveCategory = useCallback((trackId: string) => {
    setTracks(prev => {
      const trackIdx = prev.findIndex(t => t.id === trackId)
      if (trackIdx === -1) return prev
      const track = prev[trackIdx]
      const newSourceType = track.sourceType === 'record' ? 'import' : 'record'
      const updated = { ...track, sourceType: newSourceType as 'record' | 'import' }
      saveTrackToDB(updated)
      return prev.map(t => t.id === trackId ? updated : t)
    })
  }, [])

  // Export backup as ZIP (with progress and blob URL fetch)
  const handleExportBackup = useCallback(async () => {
    if (tracks.length === 0) {
      alert('لا توجد أناشيد للتصدير')
      return
    }

    try {
      setBackupProgress({ active: true, current: 0, total: tracks.length, type: 'export' })
      const zip = new JSZip()
      const metadata: any[] = []

      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i]
        setBackupProgress(prev => ({ ...prev, current: i + 1 }))

        // Export audio file
        let audioFileName = ''
        let audioBlob: Blob | null = track.fileBlob instanceof Blob ? track.fileBlob : null

        // If fileBlob is missing but we have a blob URL, try to fetch it
        if (!audioBlob && track.url && track.url.startsWith('blob:')) {
          const fetched = await fetchBlobFromUrl(track.url)
          if (fetched) audioBlob = fetched
        }

        if (audioBlob) {
          const ext = audioBlob.type.includes('wav') ? 'wav'
            : audioBlob.type.includes('mp4') ? 'm4a'
            : audioBlob.type.includes('ogg') ? 'ogg'
            : audioBlob.type.includes('webm') ? 'webm'
            : 'mp3'
          audioFileName = `audio/${track.id}.${ext}`
          zip.file(audioFileName, audioBlob)

          // Update track's fileBlob if it was missing
          if (!track.fileBlob) {
            setTracks(prev => prev.map(t => t.id === track.id ? { ...t, fileBlob: audioBlob! } : t))
          }
        } else if (track.url && !track.url.startsWith('blob:')) {
          audioFileName = track.url
        }

        // Export cover image
        let coverFileName = ''
        let coverBlob: Blob | null = track.coverBlob instanceof Blob ? track.coverBlob : null

        // If coverBlob is missing but we have a blob URL, try to fetch it
        if (!coverBlob && track.coverUrl && track.coverUrl.startsWith('blob:')) {
          const fetched = await fetchBlobFromUrl(track.coverUrl)
          if (fetched) coverBlob = fetched
        }

        if (coverBlob) {
          const ext = coverBlob.type.includes('png') ? 'png'
            : coverBlob.type.includes('webp') ? 'webp'
            : 'jpg'
          coverFileName = `covers/${track.id}.${ext}`
          zip.file(coverFileName, coverBlob)

          if (!track.coverBlob) {
            setTracks(prev => prev.map(t => t.id === track.id ? { ...t, coverBlob: coverBlob! } : t))
          }
        } else if (track.coverUrl && track.coverUrl !== UNIFORM_PLACEHOLDER && !track.coverUrl.startsWith('blob:')) {
          coverFileName = track.coverUrl
        }

        metadata.push({
          id: track.id,
          name: track.name,
          artist: track.artist,
          isFavorite: track.isFavorite,
          timestamps: track.timestamps,
          duration: track.duration,
          playbackRate: track.playbackRate,
          order: track.order,
          sourceType: track.sourceType,
          audioFile: audioFileName,
          coverFile: coverFileName,
        })
      }

      zip.file('metadata.json', JSON.stringify(metadata, null, 2))

      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const date = new Date()
      const dateStr = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')}`
      a.download = `ترانيم-نسخة-احتياطية-${dateStr}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setIsDropdownOpen(false)
    } catch (error) {
      console.error('Export backup failed:', error)
      alert('فشل تصدير النسخة الاحتياطية')
    } finally {
      setBackupProgress({ active: false, current: 0, total: 0, type: null })
    }
  }, [tracks])

  // Import backup from ZIP (with progress)
  const handleImportBackup = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const zip = await JSZip.loadAsync(file)
      const metadataFile = zip.file('metadata.json')
      if (!metadataFile) {
        alert('ملف النسخة الاحتياطية غير صالح')
        return
      }

      const metadataStr = await metadataFile.async('string')
      const metadata = JSON.parse(metadataStr)

      setBackupProgress({ active: true, current: 0, total: metadata.length, type: 'import' })

      // Stop current playback
      if (audioRef.current) {
        audioRef.current.pause()
        setPlayerState(prev => ({ ...prev, isPlaying: false }))
      }

      const newTracks: Track[] = []

      for (let i = 0; i < metadata.length; i++) {
        const item = metadata[i]
        setBackupProgress(prev => ({ ...prev, current: i + 1 }))

        // Extract audio blob
        let audioBlob: Blob | undefined
        let audioUrl = ''
        if (item.audioFile && !item.audioFile.startsWith('http')) {
          const audioZipFile = zip.file(item.audioFile)
          if (audioZipFile) {
            const ext = item.audioFile.split('.').pop() || 'mp3'
            const mimeType = ext === 'wav' ? 'audio/wav'
              : ext === 'ogg' ? 'audio/ogg'
              : ext === 'm4a' ? 'audio/mp4'
              : ext === 'webm' ? 'audio/webm'
              : 'audio/mpeg'
            const arrayBuffer = await audioZipFile.async('arraybuffer')
            audioBlob = new Blob([arrayBuffer], { type: mimeType })
            audioUrl = URL.createObjectURL(audioBlob)
          }
        } else if (item.audioFile) {
          audioUrl = item.audioFile
        }

        // Extract cover blob
        let coverBlob: Blob | undefined
        let coverUrl = UNIFORM_PLACEHOLDER
        if (item.coverFile && !item.coverFile.startsWith('http')) {
          const coverZipFile = zip.file(item.coverFile)
          if (coverZipFile) {
            const ext = item.coverFile.split('.').pop() || 'jpg'
            const mimeType = ext === 'png' ? 'image/png'
              : ext === 'webp' ? 'image/webp'
              : 'image/jpeg'
            const arrayBuffer = await coverZipFile.async('arraybuffer')
            coverBlob = new Blob([arrayBuffer], { type: mimeType })
            coverUrl = URL.createObjectURL(coverBlob)
          }
        } else if (item.coverFile) {
          coverUrl = item.coverFile
        }

        const track: Track = {
          id: item.id || Math.random().toString(36).substr(2, 9),
          name: item.name || 'أنشودة بدون اسم',
          artist: item.artist || '',
          url: audioUrl,
          coverUrl: coverUrl,
          isFavorite: item.isFavorite || false,
          timestamps: item.timestamps || [],
          duration: item.duration || 0,
          playbackRate: item.playbackRate || 1,
          order: item.order ?? newTracks.length,
          fileBlob: audioBlob,
          coverBlob: coverBlob,
          sourceType: item.sourceType || 'import',
        }

        newTracks.push(track)

        // Save to IndexedDB
        try { await saveTrackToDB(track) } catch (err) { console.error('Failed to save imported track:', err) }
      }

      // Sort by order
      newTracks.sort((a, b) => a.order - b.order)

      setTracks(newTracks)
      if (newTracks.length > 0) setCurrentTrackIndex(0)
      setIsDropdownOpen(false)

      alert(`تم استيراد ${newTracks.length} أنشودة بنجاح`)
    } catch (error) {
      console.error('Import backup failed:', error)
      alert('فشل استيراد النسخة الاحتياطية')
    } finally {
      setBackupProgress({ active: false, current: 0, total: 0, type: null })
    }

    e.target.value = ''
  }, [])

  // Audio event listeners - using refs for stable callback references
  const handleSelectTrackRef = useRef(handleSelectTrack)
  handleSelectTrackRef.current = handleSelectTrack

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const updateTime = () => {
      const now = Date.now()
      if (!audioRef.current || (now - lastUpdateTimeRef.current < 300)) return
      lastUpdateTimeRef.current = now
      setPlayerState(prev => ({ ...prev, currentTime: audio.currentTime }))
    }
    const onEnded = () => {
      if (isLoopingRef.current) {
        audio.currentTime = 0
        audio.play().catch(() => {})
      } else {
        const idx = currentTrackIndexRef.current
        const len = tracksLengthRef.current
        if (idx !== null && len > 0) {
          handleSelectTrackRef.current((idx + 1) % len)
        } else {
          setPlayerState(prev => ({ ...prev, isPlaying: false }))
        }
      }
    }
    const onWaiting = () => setPlayerState(prev => ({ ...prev, isLoading: true }))
    const onPlaying = () => setPlayerState(prev => ({ ...prev, isLoading: false }))
    const onCanPlay = () => { setLoadError(null); setPlayerState(prev => ({ ...prev, isLoading: false })) }
    const onLoadedMetadata = () => {
      if (audio && currentTrackIndexRef.current !== null && isFinite(audio.duration)) {
        setTracks(prev => prev.map((t, idx) => idx === currentTrackIndexRef.current ? { ...t, duration: audio.duration } : t))
      }
    }
    const onError = () => { setLoadError("فشل تشغيل المقطع."); setPlayerState(prev => ({ ...prev, isPlaying: false, isLoading: false })) }

    audio.addEventListener('timeupdate', updateTime)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('timeupdate', updateTime)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('error', onError)
    }
  }, []) // Empty deps - uses refs instead

  // Filter tracks with useMemo
  const filteredTracks = useMemo(() => {
    return tracks
      .map((track, originalIndex) => ({ track, originalIndex }))
      .filter(item => {
        const matchesType = view === 'all' ||
          (view === 'record' && item.track.sourceType === 'record') ||
          (view === 'import' && (item.track.sourceType === 'import' || !item.track.sourceType))
        return matchesType
      })
      .sort((a, b) => {
        if (a.track.isFavorite && !b.track.isFavorite) return -1
        if (!a.track.isFavorite && b.track.isFavorite) return 1
        return a.originalIndex - b.originalIndex
      })
  }, [tracks, view])

  const safeDuration = currentTrack && currentTrack.duration && isFinite(currentTrack.duration) ? currentTrack.duration : Math.max(playerState.currentTime, 100)
  const progress = (playerState.currentTime / safeDuration) * 100

  return (
    <div
      className={`flex flex-col h-screen h-[100dvh] overflow-hidden transition-colors duration-300 ${
        isDark
          ? 'bg-slate-950 text-slate-100 watercolor-bg-dark'
          : 'bg-[#f0f4f5] text-slate-900 watercolor-bg-light'
      }`}
      dir="rtl"
    >
      {/* Backup Progress Overlay */}
      {backupProgress.active && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className={`p-6 rounded-3xl shadow-2xl max-w-xs w-full mx-4 text-center border ${
            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <div className="w-10 h-10 border-3 border-[#4da8ab] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className={`font-bold text-sm mb-3 ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
              {backupProgress.type === 'export' ? 'جاري التصدير...' : 'جاري الاستيراد...'}
            </p>
            <div className={`w-full h-2 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
              <div
                className="h-full bg-[#4da8ab] rounded-full transition-all duration-300"
                style={{ width: `${backupProgress.total > 0 ? (backupProgress.current / backupProgress.total * 100) : 0}%` }}
              />
            </div>
            <p className={`text-xs mt-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              {backupProgress.current} / {backupProgress.total}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className={`flex items-center justify-between p-4 backdrop-blur-lg shrink-0 z-[100] relative border-b transition-colors duration-300 ${
        isDark ? 'bg-slate-950/80 border-slate-800' : 'bg-[#f0f4f5]/80 border-slate-200'
      }`}>
        <div className="flex items-center gap-1 md:gap-3">
          {!isRecording && (
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 text-[#4da8ab] active:scale-95 transition-transform">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
          )}
        </div>

        <h1 className="text-xl md:text-2xl font-black text-[#4da8ab] absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">ترانيم</h1>

        <div className="relative flex items-center gap-3">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className={`p-1.5 rounded-full transition-colors border-2 border-transparent ${
              isDark ? 'hover:bg-slate-900 hover:border-slate-800' : 'hover:bg-slate-100 hover:border-slate-200'
            }`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              isDark ? 'bg-slate-800 text-slate-500' : 'bg-slate-200 text-slate-500'
            }`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
          </button>

          {isDropdownOpen && (
            <>
              <div className="fixed inset-0 z-[110]" onClick={() => setIsDropdownOpen(false)} />
              <div className={`absolute left-0 top-full mt-2 w-60 rounded-2xl shadow-xl z-[120] overflow-hidden flex flex-col py-2 animate-in fade-in slide-in-from-top-2 duration-200 border transition-colors ${
                isDark ? 'bg-slate-900 border-slate-800' : 'bg-[#e8eef0] border-slate-200'
              }`}>
                <button onClick={handleExportBackup} disabled={backupProgress.active} className={`w-full text-right px-4 py-3 text-sm font-bold transition-colors flex items-center gap-2 disabled:opacity-50 ${
                  isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-50'
                }`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12" /></svg>
                  تصدير نسخة احتياطية (ZIP)
                </button>
                <label className={`w-full text-right px-4 py-3 text-sm font-bold transition-colors flex items-center gap-2 cursor-pointer ${
                  backupProgress.active ? 'opacity-50 pointer-events-none' : ''
                } ${isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4v12" /></svg>
                  استيراد نسخة احتياطية (ZIP)
                  <input type="file" accept=".zip" className="hidden" onChange={handleImportBackup} />
                </label>

                <div className={`h-px my-1 ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />

                {/* Theme Toggle Button */}
                <div className="w-full px-4 py-2 flex items-center justify-center">
                  <button
                    onClick={toggleDark}
                    className={`relative flex items-center justify-center gap-2 px-5 py-2.5 rounded-full transition-all duration-500 ease-in-out active:scale-95 ${
                      isDark
                        ? 'bg-amber-100 text-amber-600 hover:bg-amber-200 shadow-md shadow-amber-200/50'
                        : 'bg-indigo-900 text-indigo-200 hover:bg-indigo-800 shadow-md shadow-indigo-900/50'
                    }`}
                  >
                    <div className="relative w-5 h-5 flex items-center justify-center">
                      {/* Sun - shown in dark mode (click to switch to light) */}
                      <svg
                        className={`w-5 h-5 absolute transition-all duration-500 ${
                          isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-90 scale-50'
                        }`}
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z" />
                      </svg>
                      {/* Moon - shown in light mode (click to switch to dark) */}
                      <svg
                        className={`w-5 h-5 absolute transition-all duration-500 ${
                          !isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50'
                        }`}
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path fillRule="evenodd" d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 003.463-.69.75.75 0 01.981.98 10.503 10.503 0 01-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 01.818.162z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <span className="text-sm font-bold">
                      {isDark ? 'الوضع الفاتح' : 'الوضع الداكن'}
                    </span>
                  </button>
                </div>

                <div className={`h-px my-1 ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />

                <button onClick={() => setIsDropdownOpen(false)} className={`w-full text-right px-4 py-3 text-sm font-bold transition-colors flex items-center gap-2 ${
                  isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-50'
                }`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                  مشاركة التطبيق
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar Overlay */}
        <div
          className={`fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[60] xl:hidden transition-all duration-300 ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          onClick={() => setIsSidebarOpen(false)}
        />

        {/* Sidebar */}
        <aside className={`fixed xl:relative inset-y-0 right-0 w-[85%] sm:w-80 flex flex-col shadow-2xl xl:shadow-none z-[70] transition-all duration-300 ease-in-out transform border-l ${
          isSidebarOpen ? 'translate-x-0' : 'translate-x-full xl:translate-x-0'
        } ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-[#e8eef0] border-slate-200'}`}>
          <div className="p-8 shrink-0 space-y-6">
            <div className="flex items-center justify-between">
              <h1 className="text-3xl font-black text-[#4da8ab] tracking-tighter">ترانيم</h1>
              <button onClick={() => setIsSidebarOpen(false)} className={`xl:hidden p-2 rounded-xl transition-all ${isDark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-200'}`}>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex gap-2 w-full">
              <div className="flex-1 relative">
                <div className={`w-full bg-[#4da8ab] hover:bg-[#3d8c8e] text-white font-bold py-3 px-2 rounded-[20px] transition-all shadow-lg flex items-center justify-center gap-2 text-sm ${isRecording ? 'opacity-50 pointer-events-none' : 'cursor-pointer active:scale-[0.98]'}`}>
                  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  <span>استيراد لحن</span>
                </div>
                <input
                  type="file"
                  multiple
                  className={`absolute inset-0 w-full h-full opacity-0 z-50 ${isRecording ? 'pointer-events-none' : 'cursor-pointer'}`}
                  accept="audio/*"
                  onChange={handleFileImport}
                  disabled={isRecording}
                />
              </div>

              <button
                onClick={() => { handleStartRecording(); setIsSidebarOpen(false) }}
                disabled={isRecording}
                className={`flex-1 w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 px-2 rounded-[20px] transition-all shadow-lg flex items-center justify-center gap-2 text-sm active:scale-[0.98] ${isRecording ? 'opacity-50 pointer-events-none' : ''}`}
              >
                {isRecording ? (
                  <>
                    <div className="w-3 h-3 rounded-full bg-rose-500 animate-pulse shrink-0" />
                    <span className="text-rose-500">جاري التسجيل...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                    <span>تسجيل صوتي</span>
                  </>
                )}
              </button>
            </div>

            <div className="relative group">
              <input
                type="text"
                placeholder="بحث عن نشيد..."
                className={`w-full border rounded-2xl py-3 pr-10 pl-4 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#4da8ab]/20 transition-all placeholder:text-slate-400 ${
                  isDark ? 'bg-slate-900 border-slate-800 text-slate-100 focus:bg-slate-800' : 'bg-white border-slate-200 text-slate-800 focus:bg-[#f0f4f5]'
                }`}
              />
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-[#4da8ab] transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </div>
            </div>

            <div className={`flex gap-2 p-1 rounded-xl ${isDark ? 'bg-slate-800' : 'bg-slate-200/80'}`}>
              {[
                { id: 'all', label: 'الكل' },
                { id: 'record', label: 'تسجيلات' },
                { id: 'import', label: 'مستوردة' }
              ].map(v => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id as any)}
                  className={`flex-1 text-[10px] font-bold py-2 rounded-lg transition-all ${
                    view === v.id
                      ? `shadow-sm text-[#4da8ab] ${isDark ? 'bg-slate-700' : 'bg-[#f0f4f5]'}`
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-6 pb-40 space-y-4 scroll-container">
            <div className={`flex items-center gap-2 px-2 ${isDark ? 'text-slate-700' : 'text-slate-400'}`}>
              <span className="text-[10px] font-black uppercase tracking-[0.3em]">مكتبتك</span>
              <div className={`flex-1 h-px ${isDark ? 'bg-slate-900' : 'bg-slate-200'}`} />
            </div>

            <div className="space-y-2">
              {tracks.length === 0 ? (
                <div className="px-6 py-10 text-center bg-white/80 rounded-[24px] border border-dashed border-slate-300">
                  <p className="text-[10px] text-slate-400 font-bold">لا توجد ملفات</p>
                </div>
              ) : (
                filteredTracks.map((item) => (
                  <TrackListItem
                    key={item.track.id}
                    track={item.track}
                    isActive={currentTrack?.id === item.track.id}
                    isDark={isDark}
                    isRecording={isRecording}
                    onSelect={() => { handleSelectTrack(item.originalIndex); setIsSidebarOpen(false) }}
                    onRemove={() => removeTrack(item.track.id)}
                    onMoveCategory={() => handleMoveCategory(item.track.id)}
                  />
                ))
              )}
            </div>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto scroll-container bg-transparent relative z-10 flex flex-col items-center">
          <div className={`px-4 py-8 md:p-12 max-w-4xl mx-auto w-full flex-1 flex flex-col items-center justify-center min-h-[500px] transition-colors duration-300 ${
            isDark ? 'bg-slate-950' : 'bg-[#f0f4f5]'
          }`}>
            {isRecording ? (
              /* Recording Screen */
              <div className={`flex flex-col items-center justify-center w-full max-w-lg mx-auto aspect-square relative p-4 rounded-[40px] md:rounded-[60px] overflow-hidden backdrop-blur-3xl border-[4px] md:border-[6px] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.1)] transition-all duration-500 ${
                isDark ? 'bg-black/80 border-slate-900 text-white shadow-[0_24px_64px_-12px_rgba(0,0,0,0.3)]' : 'bg-[#e8eef0]/90 border-[#f0f4f5] text-slate-800'
              }`}>
                <div className="absolute top-12 flex flex-col items-center w-full">
                  <h2 className="text-5xl md:text-7xl font-black tabular-nums tracking-wider" dir="ltr">
                    {(() => {
                      const totalSeconds = Math.floor(recordingTime)
                      const mins = Math.floor(totalSeconds / 60)
                      const secs = totalSeconds % 60
                      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
                    })()}
                  </h2>
                  <p className="mt-4 text-[#4da8ab] font-bold opacity-80 uppercase tracking-widest text-sm text-center">جودة عالية</p>
                </div>

                <div className="w-full h-40 flex items-center justify-center gap-1 mt-10 relative">
                  <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-[#4da8ab]/50 -translate-x-1/2 z-0" />
                  <div className="flex items-center gap-[2px] md:gap-1 z-10 w-full justify-center px-4">
                    {audioData.length > 0 ? audioData.map((val, i) => {
                      const capVal = isRecordingPaused ? 0 : val
                      const height = Math.max(10, Math.min(100, (capVal * 3) + 10))
                      return <div key={i} className="w-1 md:w-1.5 bg-[#4da8ab] rounded-full transition-all duration-75 shadow-[0_0_8px_rgba(77,168,171,0.5)]" style={{ height: `${height}%` }} />
                    }) : Array.from({ length: 50 }).map((_, i) => (
                      <div key={i} className="w-1 md:w-1.5 bg-[#4da8ab]/30 rounded-full" style={{ height: '10%' }} />
                    ))}
                  </div>
                </div>

                <div className="absolute bottom-10 w-full flex items-center justify-center gap-8 px-10">
                  <button onClick={cancelRecording} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-600'}`} title="إلغاء المقطع">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                  <button onClick={stopRecording} className="w-20 h-20 rounded-full bg-[#4da8ab] hover:bg-[#3d8c8e] flex items-center justify-center text-white transition-all active:scale-95 shadow-[0_0_20px_rgba(77,168,171,0.4)]" title="حفظ التسجيل">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                  </button>
                  <button onClick={toggleRecordingPause} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-600'}`} title={isRecordingPaused ? "متابعة التسجيل" : "إيقاف مؤقت"}>
                    {isRecordingPaused ? (
                      <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    ) : (
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>
                    )}
                  </button>
                </div>
              </div>
            ) : currentTrack ? (
              <div className="w-full flex flex-col items-center space-y-6 md:space-y-10 animate-in fade-in duration-500">
                {/* Cover Image */}
                <div className="relative group w-full max-w-[200px] md:max-w-xs lg:max-w-sm shrink-0">
                  <div className={`relative aspect-square w-full overflow-hidden rounded-[40px] md:rounded-[60px] shadow-2xl border-[4px] md:border-[6px] group-hover:scale-[1.01] transition-all duration-500 ${
                    isDark ? 'border-slate-900' : 'border-[#f0f4f5]'
                  }`}>
                    <img src={currentTrack.coverUrl} className="w-full h-full object-cover" alt="" />
                    <button onClick={() => coverInputRef.current?.click()} className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white z-20 cursor-pointer">
                      <svg className="w-8 h-8 md:w-12 md:h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </button>
                    <input type="file" ref={coverInputRef} className="absolute w-0 h-0 opacity-0" accept="image/*" onChange={handleUpdateCover} />
                  </div>
                </div>

                {/* Track Name & Artist */}
                <div className="relative z-30 text-center w-full px-4 min-w-0 space-y-3 md:space-y-6">
                  <div className="flex justify-center w-full">
                    <button onClick={handleUpdateName} className={`flex items-center gap-2 hover:bg-[#4da8ab]/10 bg-[#4da8ab]/5 px-5 py-3 rounded-2xl transition-all active:scale-95 cursor-pointer border max-w-[90vw] md:max-w-[70vw] lg:max-w-[600px] ${
                      isDark ? 'border-[#4da8ab]/10' : 'border-[#4da8ab]/20'
                    }`}>
                      <h1 className={`text-xl md:text-3xl lg:text-4xl font-black leading-tight truncate flex-1 ${
                        isDark ? 'text-slate-100' : 'text-slate-800'
                      }`}>{currentTrack.name}</h1>
                      <svg className="w-5 h-5 md:w-6 md:h-6 text-[#4da8ab] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                  </div>
                  <div className="flex justify-center items-center gap-2 w-full">
                    <button onClick={handleUpdateArtist} className={`flex items-center gap-2 hover:bg-slate-200 dark:hover:bg-slate-900 px-4 py-2 rounded-xl transition-all active:scale-95 cursor-pointer border max-w-[80vw] md:max-w-[50vw] ${
                      isDark ? 'bg-black border-slate-800' : 'bg-slate-200/60 border-slate-200'
                    }`}>
                      <span className={`text-sm md:text-xl font-bold transition-colors truncate ${
                        currentTrack.artist ? (isDark ? 'text-slate-300' : 'text-slate-600') : 'text-slate-400 italic'
                      }`}>{currentTrack.artist || "إضافة اسم الفنان..."}</span>
                      <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                  </div>
                  {/* Source Type Badge on main player */}
                  <div className="flex justify-center">
                    <span className={`text-[10px] font-black px-3 py-1 rounded-full ${
                      currentTrack.sourceType === 'record'
                        ? 'bg-amber-500/10 text-amber-500'
                        : 'bg-[#4da8ab]/10 text-[#4da8ab]'
                    }`}>
                      {currentTrack.sourceType === 'record' ? 'تسجيل' : 'مستوردة'}
                    </span>
                  </div>
                </div>

                {/* Timestamps */}
                {currentTrack.timestamps.length > 0 && (
                  <div className="w-full max-w-2xl px-2 space-y-3">
                    <div className="flex items-center justify-between px-2">
                      <h3 className={`font-black text-lg md:text-xl ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>العلامات الزمنية</h3>
                      <span className="text-[10px] font-black bg-[#4da8ab]/10 text-[#4da8ab] px-3 py-1 rounded-full uppercase tracking-widest">
                        {toArabicIndic(currentTrack.timestamps.length)} علامات
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2.5">
                      {[...currentTrack.timestamps].sort((a, b) => a.time - b.time).map((ts, index) => (
                        <div
                          key={ts.id}
                          onClick={() => handleTimestampSeek(ts.time)}
                          className={`flex items-center gap-4 p-4 rounded-[24px] border transition-all shadow-sm hover:shadow-md group cursor-pointer ${
                            isDark ? 'bg-slate-900/80 hover:bg-slate-800 border-slate-800' : 'bg-white/80 hover:bg-[#e8eef0] border-slate-200'
                          }`}
                        >
                          <div className={`w-8 h-8 flex items-center justify-center rounded-xl font-black text-sm ${
                            isDark ? 'bg-slate-800 text-slate-600' : 'bg-slate-100 text-slate-400'
                          }`}>
                            {toArabicIndic(index + 1)}
                          </div>
                          <div className="text-lg md:text-xl font-black text-[#4da8ab] tabular-nums group-hover:scale-110 transition-transform px-2" style={{ direction: 'ltr' }}>
                            {toArabicIndic(Math.floor(ts.time / 60)).padStart(2, '٠')}:
                            {toArabicIndic(Math.floor(ts.time % 60)).padStart(2, '٠')}
                          </div>
                          <div className="flex-1 min-w-0 text-right">
                            <p className={`text-xs md:text-sm font-bold truncate ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{ts.label}</p>
                          </div>
                          <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                            <button onClick={(e) => { e.stopPropagation(); handleRemoveTimestamp(ts.id) }} className="p-2 text-slate-400 hover:text-rose-500 transition-colors">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="h-64 md:h-80 shrink-0 w-full" aria-hidden="true" />
              </div>
            ) : (
              <div className="h-[60vh] flex flex-col items-center justify-center space-y-6 text-center px-6 opacity-30">
                <div className="w-20 h-20 bg-[#4da8ab]/5 rounded-[24px] flex items-center justify-center text-[#4da8ab]">
                  <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                </div>
                <h2 className={`text-lg font-black ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>مكتبتك خالية</h2>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Footer Player */}
      <footer className="fixed bottom-0 left-0 right-0 z-[50] p-4 md:p-8 pointer-events-none mb-[env(safe-area-inset-bottom,0px)]">
        <audio ref={audioRef} src={currentTrack?.url} className="hidden" preload="auto" crossOrigin="anonymous" />
        {!isRecording && (
          <div className={`max-w-3xl mx-auto backdrop-blur-3xl border rounded-[32px] pointer-events-auto transition-colors duration-300 ${
            isDark
              ? 'bg-black/80 border-slate-800 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.3)]'
              : 'bg-[#e8eef0]/95 border-slate-200 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.1)]'
          }`}>
            {currentTrack && (
              <div className={`w-full flex flex-col py-4 px-5 md:px-10 transition-all duration-500 ${loadError ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
                {/* Progress Bar */}
                <div className="w-full flex items-center gap-3 mb-3">
                  <span className={`text-[9px] md:text-[10px] font-black tabular-nums w-8 text-right ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                    {formatTime(playerState.currentTime)}
                  </span>
                  <div className="flex-1 relative h-6 flex items-center touch-none group">
                    <input
                      type="range" min={0} max={safeDuration} value={playerState.currentTime}
                      onChange={(e) => handleSeek(Number(e.target.value))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                      style={{ direction: 'rtl' }}
                      disabled={!!loadError || playerState.isLoading}
                    />
                    <div className={`w-full h-1.5 rounded-full relative overflow-hidden ${isDark ? 'bg-slate-800/50' : 'bg-slate-200/50'}`}>
                      <div
                        className={`absolute right-0 top-0 h-full bg-[#4da8ab] rounded-full transition-all duration-200 ${playerState.isLoading ? 'animate-pulse' : ''}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div
                      className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-[#4da8ab] rounded-full shadow-md pointer-events-none transition-all group-hover:scale-125 ${
                        isDark ? 'bg-slate-100' : 'bg-[#f0f4f5]'
                      }`}
                      style={{ right: `calc(${progress}% - 7px)` }}
                    />
                  </div>
                  <span className={`text-[9px] md:text-[10px] font-black tabular-nums w-8 text-left ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    {currentTrack.duration && isFinite(currentTrack.duration) ? formatTime(currentTrack.duration) : "0:00"}
                  </span>
                </div>

                {/* Controls */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 md:gap-2 flex-1 justify-start">
                    <button onClick={handleToggleFavorite} className={`p-2 transition-all active:scale-90 ${currentTrack.isFavorite ? 'text-rose-500' : (isDark ? 'text-slate-600 hover:text-rose-400' : 'text-slate-400 hover:text-rose-400')}`}>
                      <svg className="w-5 h-5 md:w-6 md:h-6" fill={currentTrack.isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                    </button>
                    <button onClick={handleToggleLoop} className={`p-2 transition-all active:scale-90 ${playerState.isLooping ? 'text-[#4da8ab]' : (isDark ? 'text-slate-600 hover:text-[#4da8ab]/50' : 'text-slate-400 hover:text-[#4da8ab]/50')}`} title="تكرار النشيد">
                      <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </button>
                  </div>

                  <div className="flex items-center justify-center gap-3 md:gap-8">
                    <button onClick={() => handleSkip(10)} className={`${isDark ? 'text-slate-600 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'} p-2 active:scale-90 transition-all`} disabled={!!loadError || playerState.isLoading}>
                      <svg className="w-6 h-6 md:w-8 md:h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.5 2v6h6M2.66 15.57a10 10 0 1 0 .57-8.38" /><text x="12" y="15.5" fontSize="6" fontWeight="900" textAnchor="middle" fill="currentColor" stroke="none">10</text></svg>
                    </button>

                    <button onClick={handlePlayPause} className={`w-12 h-12 md:w-16 md:h-16 rounded-2xl md:rounded-[24px] flex items-center justify-center shadow-xl md:shadow-2xl active:scale-95 transition-all ${
                      loadError ? (isDark ? 'bg-slate-800 text-slate-600' : 'bg-slate-300 text-slate-400') : 'bg-[#4da8ab] text-white'
                    }`} disabled={!!loadError}>
                      {playerState.isLoading ? (
                        <div className="w-5 h-5 md:w-6 md:h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : playerState.isPlaying ? (
                        <svg className="w-6 h-6 md:w-8 md:h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                      ) : (
                        <svg className="w-6 h-6 md:w-8 md:h-8 translate-x-[-1px]" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      )}
                    </button>

                    <button onClick={() => handleSkip(-10)} className={`${isDark ? 'text-slate-600 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'} p-2 active:scale-90 transition-all`} disabled={!!loadError || playerState.isLoading}>
                      <svg className="w-6 h-6 md:w-8 md:h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38" /><text x="12" y="15.5" fontSize="6" fontWeight="900" textAnchor="middle" fill="currentColor" stroke="none">10</text></svg>
                    </button>
                  </div>

                  <div className="flex items-center justify-end flex-1">
                    <button onClick={handleAddTimestamp} className="p-2.5 md:p-3 text-[#4da8ab] bg-[#4da8ab]/5 hover:bg-[#4da8ab]/10 rounded-xl md:rounded-2xl active:scale-90 transition-all" disabled={!!loadError || playerState.isLoading}>
                      <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" /></svg>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </footer>
    </div>
  )
}
