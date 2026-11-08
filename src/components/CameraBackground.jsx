import { memo, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useShow } from '../state/ShowProvider.jsx';
import { useChessLens } from '../state/store.js';

/**
 * CameraBackground
 * Renders the live webcam stream as a cinematic full-screen background layer
 * or a picture-in-picture corner window behind the digital chess board.
 *
 * Hard Rule: Reuses the single MediaStream from ShowProvider. Never calls getUserMedia.
 */
function CameraBackgroundComponent() {
  const { cameraStream } = useShow();
  const settings = useChessLens((state) => state.settings);
  const cameraStatus = useChessLens((state) => state.camera.status);
  const demoActive = useChessLens((state) => state.demo.active);

  const mode = settings.cameraBgMode || 'off'; // 'background' | 'corner' | 'off'
  const opacity = settings.cameraBgOpacity ?? 35;
  const blur = settings.cameraBgBlur ?? 6;
  const brightness = settings.cameraBgBrightness ?? 100;
  const mirror = Boolean(settings.cameraBgMirror);
  const rotate = settings.cameraBgRotate || 0;
  const perfMode = Boolean(settings.cameraBgPerfMode);

  const videoRef = useRef(null);

  const isLive = cameraStatus === 'live' && Boolean(cameraStream) && !demoActive;
  const isVisible = isLive && mode !== 'off';

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (cameraStream && video.srcObject !== cameraStream) {
      video.srcObject = cameraStream;
      video.muted = true;
      video.playsInline = true;
      video.play().catch(() => {
        /* autoplay muted video */
      });
    } else if (!cameraStream && video.srcObject) {
      video.srcObject = null;
    }
  }, [cameraStream, isVisible, mode]);

  if (!isLive || mode === 'off') {
    return null;
  }

  return (
    <AnimatePresence mode="wait">
      {mode === 'background' && (
        <motion.div
          key="cam-bg-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeInOut' }}
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
          aria-hidden="true"
        >
          {/* Hardware accelerated transformed video element */}
          <div
            className="absolute inset-0 h-full w-full"
            style={{
              opacity: Math.max(0, Math.min(1, opacity / 100)),
              transform: `rotate(${rotate}deg) scaleX(${mirror ? -1 : 1})`,
              filter: `brightness(${brightness}%)${perfMode ? '' : ` blur(${blur}px)`}`,
              willChange: 'transform, opacity',
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover"
              aria-hidden="true"
            />
          </div>

          {/* Deep dark tint overlay ensuring high-contrast digital board readability */}
          <div className="absolute inset-0 bg-ink-950/65" />

          {/* Vignette darkening the perimeter */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_25%,rgba(5,7,11,0.85)_80%,rgba(5,7,11,0.98)_100%)]" />
        </motion.div>
      )}

      {mode === 'corner' && (
        <motion.div
          key="cam-bg-corner"
          initial={{ opacity: 0, scale: 0.85, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.85, y: 15 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="pointer-events-none absolute bottom-4 left-4 z-20 h-32 w-48 overflow-hidden rounded-2xl border border-brass-400/40 bg-ink-950/90 shadow-2xl shadow-black/90 ring-1 ring-black/80 sm:bottom-6 sm:left-6 sm:h-44 sm:w-64 md:h-48 md:w-72"
          aria-hidden="true"
        >
          <div
            className="h-full w-full overflow-hidden"
            style={{
              transform: `rotate(${rotate}deg) scaleX(${mirror ? -1 : 1})`,
              filter: `brightness(${brightness}%)`,
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover"
              aria-hidden="true"
            />
          </div>

          <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full border border-red-500/30 bg-black/75 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-red-300 backdrop-blur-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            Live Board
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default memo(CameraBackgroundComponent);
