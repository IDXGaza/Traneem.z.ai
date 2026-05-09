
import React, { useState } from 'react';
import { Track } from '../types';

interface SidebarProps {
  onImport: (file: File, durationOverride?: number) => void;
  onRemove: (id: string) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onToggleSourceType: (id: string) => void;
  defaultView: 'all' | 'record' | 'import';
  setDefaultView: (view: 'all' | 'record' | 'import') => void;
  tracks: Track[];
  currentId: string | null;
  onSelect: (index: number) => void;
  isOpen?: boolean;
  onClose?: () => void;
  // new recording props
  isRecording?: boolean;
  onStartRecording?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  onImport, onRemove, onMove, onToggleSourceType, defaultView, setDefaultView, tracks, currentId, onSelect, isOpen, onClose,
  isRecording, onStartRecording
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [view, setView] = useState<'all' | 'record' | 'import'>(defaultView);
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);

  const navRef = React.useRef<HTMLElement>(null);
  const scrollIntervalId = React.useRef<number | null>(null);

  const startAutoScroll = (direction: 'up' | 'down') => {
    if (scrollIntervalId.current) return;
    scrollIntervalId.current = window.setInterval(() => {
      if (navRef.current) {
        navRef.current.scrollTop += direction === 'down' ? 15 : -15;
      }
    }, 20);
  };

  const stopAutoScroll = () => {
    if (scrollIntervalId.current) {
      clearInterval(scrollIntervalId.current);
      scrollIntervalId.current = null;
    }
  };

  const filteredTracksWithIndices = tracks
    .map((track, originalIndex) => ({ track, originalIndex }))
    .filter(item => {
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = item.track.name.toLowerCase().includes(searchLower) ||
        (item.track.artist && item.track.artist.toLowerCase().includes(searchLower));
      
      const matchesType = view === 'all' || 
                         (view === 'record' && item.track.sourceType === 'record') ||
                         (view === 'import' && (item.track.sourceType === 'import' || !item.track.sourceType));
      
      return matchesSearch && matchesType;
    })
    .sort((a, b) => {
      if (a.track.isFavorite && !b.track.isFavorite) return -1;
      if (!a.track.isFavorite && b.track.isFavorite) return 1;
      return a.originalIndex - b.originalIndex;
    });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      onImport(file);
    });

    if (onClose) onClose();
    
    e.target.value = '';
  };

  const onDragStart = (e: React.DragEvent, index: number) => {
    setDraggedItemIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    const ghost = e.currentTarget.cloneNode(true) as HTMLElement;
    ghost.style.position = "absolute";
    ghost.style.top = "-1000px";
    // We shouldn't use document.body.appendChild directly like this as it might leak, but it removes it in setTimeout
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!navRef.current) return;

    const { top, bottom } = navRef.current.getBoundingClientRect();
    const threshold = 60; // pixels from edge to start scrolling
    const y = e.clientY;

    if (y < top + threshold) {
       startAutoScroll('up');
    } else if (y > bottom - threshold) {
       startAutoScroll('down');
    } else {
       stopAutoScroll();
    }
  };

  const onDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    stopAutoScroll();
    if (draggedItemIndex !== null && draggedItemIndex !== index) {
      onMove(draggedItemIndex, index);
    }
    setDraggedItemIndex(null);
  };

  const onDragEnd = () => {
    stopAutoScroll();
    setDraggedItemIndex(null);
  };

  return (
    <>
      <div className={`fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[60] xl:hidden transition-all duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />
      
      <aside className={`fixed xl:relative inset-y-0 right-0 w-[85%] sm:w-80 bg-[#e8eef0] dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 flex flex-col shadow-2xl xl:shadow-none z-[70] transition-all duration-300 ease-in-out transform ${isOpen ? 'translate-x-0' : 'translate-x-full xl:translate-x-0'}`}>
        <div className="p-8 shrink-0 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-black text-[#4da8ab] tracking-tighter">ترانيم</h1>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="xl:hidden p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-all">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>

          <div className="flex gap-2 w-full relative">
            <div className="block flex-1 relative">
              <div className={`relative w-full bg-[#4da8ab] hover:bg-[#3d8c8e] text-white font-bold py-3 px-2 rounded-[20px] transition-all shadow-lg flex items-center justify-center gap-2 overflow-hidden text-sm ${isRecording ? 'opacity-50 pointer-events-none' : 'cursor-pointer active:scale-[0.98]'}`}>
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
                <span>استيراد لحن</span>
              </div>
              <input 
                type="file" 
                multiple
                className={`absolute inset-0 w-full h-full opacity-0 z-50 ${isRecording ? 'pointer-events-none' : 'cursor-pointer'}`} 
                accept="audio/*" 
                onChange={handleFileChange} 
                disabled={isRecording}
              />
            </div>

            <button 
              onClick={() => {
                if (onStartRecording) onStartRecording();
                if (onClose) onClose(); // close sidebar on mobile if it was open
              }}
              disabled={isRecording}
              className={`flex-1 w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 px-2 rounded-[20px] transition-all shadow-lg flex items-center justify-center gap-2 overflow-hidden text-sm active:scale-[0.98] ${isRecording ? 'opacity-50 pointer-events-none relative' : ''}`}
            >
              {isRecording ? (
                 <>
                   <div className="absolute inset-0 bg-rose-500/20 animate-pulse pointer-events-none" />
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
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl py-3 pr-10 pl-4 text-sm font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#4da8ab]/20 focus:bg-[#f0f4f5] dark:focus:bg-slate-800 transition-all placeholder:text-slate-400 dark:placeholder:text-slate-600"
            />
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-[#4da8ab] transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
          </div>
          
          <div className="flex gap-2 p-1 bg-slate-200/80 dark:bg-slate-800 rounded-xl">
             {[
               {id: 'all', label: 'الكل'}, 
               {id: 'record', label: 'تسجيلات'}, 
               {id: 'import', label: 'مستوردة'}
             ].map(v => (
               <button 
                 key={v.id} 
                 onClick={() => {
                   setView(v.id as any);
                   setDefaultView(v.id as any);
                 }}
                 className={`flex-1 text-[10px] font-bold py-2 rounded-lg transition-all ${view === v.id ? 'bg-[#f0f4f5] dark:bg-slate-700 shadow-sm text-[#4da8ab]' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
               >
                 {v.label}
               </button>
             ))}
          </div>
        </div>

        <nav ref={navRef} className="flex-1 overflow-y-auto px-6 pb-40 space-y-4 scroll-container">
          <div className="flex items-center gap-2 text-slate-400 dark:text-slate-700 px-2">
            <span className="text-[10px] font-black uppercase tracking-[0.3em]">مكتبتك</span>
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-900" />
          </div>
          
          <div className="space-y-2">
            {tracks.length === 0 ? (
              <div className="px-6 py-10 text-center bg-white/80 rounded-[24px] border border-dashed border-slate-300">
                <p className="text-[10px] text-slate-400 font-bold">لا توجد ملفات</p>
              </div>
            ) : (
              filteredTracksWithIndices.map((item, idx) => (
                <div 
                  key={item.track.id} 
                  draggable
                  onDragStart={(e) => onDragStart(e, item.originalIndex)}
                  onDragOver={onDragOver}
                  onDrop={(e) => onDrop(e, item.originalIndex)}
                  onDragEnd={onDragEnd}
                  className={`group flex items-center gap-1 transition-all ${draggedItemIndex === item.originalIndex ? 'opacity-50 scale-95' : ''}`}
                >
                  <div className="text-slate-400 dark:text-slate-800 cursor-grab active:cursor-grabbing p-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16"/></svg>
                  </div>

                  <button 
                    onClick={() => { onSelect(item.originalIndex); if (onClose) onClose(); }}
                    disabled={isRecording}
                    className={`flex-1 flex items-center gap-3 p-3 rounded-[20px] transition-all duration-300 min-w-0 ${currentId === item.track.id ? 'bg-[#4da8ab]/10 text-[#4da8ab] shadow-sm' : 'hover:bg-white/60 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-400'} ${isRecording ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    <div className="relative shrink-0">
                      <img src={item.track.coverUrl} className="w-10 h-10 rounded-xl object-cover shadow-sm" alt="" />
                      {item.track.isFavorite && (
                        <div className="absolute -top-1.5 -right-1.5 bg-white dark:bg-slate-900 rounded-full p-0.5 shadow-sm border border-slate-200 dark:border-slate-800">
                          <svg className="w-3 h-3 text-rose-500" fill="currentColor" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 text-right overflow-hidden">
                      <div className="flex items-center justify-end gap-1.5 mb-0.5">
                        <p className="font-bold text-xs truncate" dir="rtl" title={item.track.name}>
                          {item.track.name}
                        </p>
                      </div>
                      <p className="text-[10px] opacity-50 font-bold mt-1 truncate" title={item.track.artist || "ملف صوتي"}>
                        {item.track.artist || "ملف صوتي"}
                      </p>
                    </div>
                  </button>
                  
                  <button 
                    onClick={(e) => { e.stopPropagation(); onToggleSourceType(item.track.id); }} 
                    disabled={isRecording}
                    className={`p-2.5 text-slate-500 hover:text-[#4da8ab] dark:text-slate-500/70 dark:hover:text-[#4da8ab] bg-white/80 dark:bg-slate-500/10 hover:bg-slate-100 dark:hover:bg-slate-500/20 rounded-full transition-all active:scale-90 ml-1 shrink-0 ${isRecording ? 'opacity-50 pointer-events-none' : ''}`}
                    title="نقل بين القوائم"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                  </button>
                  
                  <button 
                    onClick={(e) => { e.stopPropagation(); onRemove(item.track.id); }} 
                    disabled={isRecording}
                    className={`p-2.5 text-slate-500 hover:text-red-500 dark:text-slate-500/70 dark:hover:text-red-400 bg-white/80 dark:bg-slate-500/10 hover:bg-slate-100 dark:hover:bg-slate-500/20 rounded-full transition-all active:scale-90 ml-1 shrink-0 ${isRecording ? 'opacity-50 pointer-events-none' : ''}`}
                    title="حذف الأنشودة"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
