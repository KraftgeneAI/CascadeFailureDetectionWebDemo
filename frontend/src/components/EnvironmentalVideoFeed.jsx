import { useRef, useEffect, useState } from 'react';

export default function EnvironmentalVideoFeed({ currentFrame, totalFrames }) {
  const videoRef = useRef(null);

  // ─── 1. Video Synchronization ────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || totalFrames <= 1) return;

    const syncTime = () => {
      const duration = video.duration || 0;
      if (duration > 0) {
        const percentage = currentFrame / (totalFrames - 1);
        const targetTime = percentage * duration;
        video.currentTime = targetTime;
      }
    };

    if (video.readyState >= 1) {
      syncTime();
    } else {
      video.addEventListener('loadedmetadata', syncTime);
      return () => video.removeEventListener('loadedmetadata', syncTime);
    }
  }, [currentFrame, totalFrames]);


  // ─── 2. Draggable Window Logic (Upgraded) ──────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef({ startX: 0, startY: 0, initialTx: 0, initialTy: 0 });

  const handleDragStart = (e) => {
    e.preventDefault();
    e.stopPropagation(); // Stops the map from panning!
    
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialTx: translate.x,
      initialTy: translate.y
    };
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleDragMove = (e) => {
      setTranslate({
        x: dragStartRef.current.initialTx + (e.clientX - dragStartRef.current.startX),
        y: dragStartRef.current.initialTy + (e.clientY - dragStartRef.current.startY)
      });
    };

    const handleDragEnd = () => setIsDragging(false);

    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
    };
  }, [isDragging]);


  // ─── 3. Resizable Window Logic (Upgraded) ──────────────────────────────────
  const [isResizing, setIsResizing] = useState(false);
  const [width, setWidth] = useState(320); // Starting width
  const resizeStartRef = useRef({ startX: 0, initialW: 0 });

  const handleResizeStart = (e) => {
    e.preventDefault();
    e.stopPropagation(); // Stops the map from panning!
    
    resizeStartRef.current = {
      startX: e.clientX,
      initialW: width
    };
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleResizeMove = (e) => {
      const newWidth = resizeStartRef.current.initialW + (e.clientX - resizeStartRef.current.startX);
      // Constrain the window between 200px and 800px wide
      setWidth(Math.max(200, Math.min(newWidth, 800)));
    };

    const handleResizeEnd = () => setIsResizing(false);

    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeEnd);
    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [isResizing]);


  return (
    <div 
      // Notice we removed 'w-64 md:w-80' from here so the inline width works perfectly
      className="absolute bottom-6 left-6 rounded-lg shadow-2xl bg-black/90 backdrop-blur-sm z-[9999] flex flex-col border border-gray-700"
      style={{
        transform: `translate(${translate.x}px, ${translate.y}px)`,
        width: `${width}px`, 
      }}
      // CRITICAL: Stop any accidental clicks inside the video box from dragging the map
      onMouseDown={(e) => e.stopPropagation()} 
      onWheel={(e) => e.stopPropagation()} 
    >
      {/* ── Header Bar (Drag Handle) ── */}
      <div 
        className="flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-gray-800 cursor-move rounded-t-lg select-none hover:bg-gray-800 transition-colors"
        onMouseDown={handleDragStart}
        title="Click and drag to move"
      >
        <div className="flex items-center gap-2 pointer-events-none">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] font-mono text-gray-300 uppercase tracking-wider">
            UAV-04 Feed
          </span>
        </div>
        <span className="text-[10px] font-mono text-gray-500 pointer-events-none">
          LAT/LON 45.4,-73.5
        </span>
      </div>

      {/* ── Video Player ── */}
      <div className="relative aspect-video bg-black rounded-b-lg overflow-hidden select-none">
        <video 
          ref={videoRef}
          src="/wildfire.mp4" 
          className="w-full h-full object-contain opacity-90 pointer-events-none"
          muted 
          playsInline
          preload="auto"
        />
        
        {/* Overlay Grid */}
        <div className="absolute inset-0 pointer-events-none opacity-20 border-[0.5px] border-green-500/30" 
             style={{ backgroundImage: 'linear-gradient(#22c55e30 1px, transparent 1px), linear-gradient(90deg, #22c55e30 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
        </div>

        {/* ── Custom Resize Handle ── */}
        <div 
          className="absolute bottom-0 right-0 w-8 h-8 cursor-se-resize flex items-end justify-end p-1.5 opacity-50 hover:opacity-100 transition-opacity bg-gradient-to-tl from-gray-800 to-transparent z-10"
          onMouseDown={handleResizeStart}
          title="Drag to resize"
        >
          {/* Visual indicator for resizing (3 little dots) */}
          <div className="w-2.5 h-2.5 flex flex-wrap justify-end gap-px pointer-events-none">
            <div className="w-0.5 h-0.5 bg-gray-400 rounded-full"></div>
            <div className="w-0.5 h-0.5 bg-gray-400 rounded-full"></div>
            <div className="w-0.5 h-0.5 bg-gray-400 rounded-full"></div>
          </div>
        </div>
      </div>
    </div>
  );
}