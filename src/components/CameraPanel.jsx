import { memo, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useShow } from '../state/ShowProvider.jsx';
import { useChessLens } from '../state/store.js';
import { squareToCell } from '../lib/homography.js';
import { translate } from '../i18n/translations.js';
import { cx } from './Ui.jsx';

/**
 * Isolated raw video component to avoid re-rendering video element
 * during chess engine or commentary updates.
 */
const RawVideoFeed = memo(function RawVideoFeed({ stream, mirror, rotate }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream && video.srcObject !== stream) {
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.play().catch(() => {
        /* autoplay muted stream */
      });
    } else if (!stream && video.srcObject) {
      video.srcObject = null;
    }
  }, [stream]);

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black/40">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="h-full w-full object-contain"
        style={{
          transform: `rotate(${rotate}deg) scaleX(${mirror ? -1 : 1})`,
          willChange: 'transform',
        }}
        aria-hidden="true"
      />
    </div>
  );
});

/**
 * Top-down warped board view with optional last-move square highlighting.
 * Renders from VisionController's warp canvas at a steady ~15-20 fps.
 */
const WarpedBoardFeed = memo(function WarpedBoardFeed({ getDebugCanvas, lastMove, flip, mirror, rotate }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    let animId = 0;
    let lastDraw = 0;
    const interval = 1000 / 18; // ~18 fps is smooth and very low CPU

    function render(time) {
      animId = requestAnimationFrame(render);
      if (time - lastDraw < interval) return;
      lastDraw = time;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const sourceCanvas = getDebugCanvas?.();
      if (!sourceCanvas) {
        ctx.fillStyle = '#0b0e14';
        ctx.fillRect(0, 0, 512, 512);
        return;
      }

      // Draw the top-down 512x512 warped board
      ctx.drawImage(sourceCanvas, 0, 0, 512, 512);

      // Subtle move highlight on the warped board if lastMove is present
      if (lastMove?.from && lastMove?.to) {
        const fromCell = squareToCell(lastMove.from, flip);
        const toCell = squareToCell(lastMove.to, flip);

        const highlightCell = (cell, isDestination) => {
          const col = cell % 8;
          const row = Math.floor(cell / 8);
          const x = col * 64;
          const y = row * 64;

          // Soft translucent fill
          ctx.fillStyle = isDestination
            ? 'rgba(212, 168, 79, 0.38)'
            : 'rgba(212, 168, 79, 0.22)';
          ctx.fillRect(x, y, 64, 64);

          // Subtle glowing border
          ctx.strokeStyle = isDestination
            ? 'rgba(245, 208, 126, 0.85)'
            : 'rgba(212, 168, 79, 0.55)';
          ctx.lineWidth = 2.5;
          ctx.strokeRect(x + 1.25, y + 1.25, 61.5, 61.5);
        };

        highlightCell(fromCell, false);
        highlightCell(toCell, true);
      }
    }

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [getDebugCanvas, lastMove?.from, lastMove?.to, flip]);

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black/40">
      <canvas
        ref={canvasRef}
        width={512}
        height={512}
        className="h-full w-full object-contain"
        style={{
          transform: `rotate(${rotate}deg) scaleX(${mirror ? -1 : 1})`,
          willChange: 'transform',
        }}
      />
    </div>
  );
});

/**
 * CameraPanel
 * Displays a live video feed of the physical board to the right of the digital board.
 * Supports:
 * - "Raw camera" or "Top-down warped board" with subtle move highlight.
 * - Hardware stream sharing without extra getUserMedia calls.
 * - Seamless fallback during camera loss, offline, or Demo/Panic mode.
 */
export default function CameraPanel() {
  const { cameraStream, getDebugCanvas } = useShow();
  const cameraStatus = useChessLens((state) => state.camera.status);
  const demoActive = useChessLens((state) => state.demo.active);
  const flip = useChessLens((state) => state.settings.flip);
  const lastMove = useChessLens((state) => state.game.lastMove);
  const lang = useChessLens((state) => state.settings.lang);
  const settings = useChessLens((state) => state.settings);

  const t = (key) => translate(lang, key);

  const source = settings.cameraPanelSource || 'raw';
  const mirror = Boolean(settings.cameraPanelMirror);
  const rotate = settings.cameraPanelRotate || 0;
  const size = settings.cameraPanelSize || 'medium';

  const isLive = cameraStatus === 'live' && Boolean(cameraStream) && !demoActive;

  // Responsive max heights depending on size setting
  const heightClamps = {
    small: 'h-[145px] sm:h-[165px] lg:h-[185px]',
    medium: 'h-[175px] sm:h-[200px] lg:h-[225px]',
    large: 'h-[210px] sm:h-[245px] lg:h-[275px]',
  };

  return (
    <div
      className={cx(
        'panel relative flex flex-col overflow-hidden border border-brass-400/25 bg-ink-950/80 shadow-board transition-all duration-300',
        heightClamps[size] || heightClamps.medium,
      )}
    >
      {/* Subtle brass edge line */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-brass-400/80 via-brass-400/30 to-transparent" />

      {/* Header bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-3.5 py-1.5 sm:py-2">
        <div className="flex items-center gap-2">
          {/* Status pill badge */}
          <span
            className={cx(
              'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase',
              isLive
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                : demoActive
                  ? 'border-brass-400/30 bg-brass-400/10 text-brass-200'
                  : 'border-white/10 bg-white/5 text-white/40',
            )}
          >
            <span
              className={cx(
                'h-1.5 w-1.5 rounded-full',
                isLive ? 'animate-pulse bg-emerald-400' : demoActive ? 'bg-brass-400' : 'bg-white/30',
              )}
            />
            {isLive ? 'LIVE' : demoActive ? 'DEMO' : 'OFFLINE'}
          </span>

          <span className="text-[11px] font-medium tracking-wide text-white/80">
            {source === 'warped' ? t('warpedBoard') : t('liveBoard')}
          </span>
        </div>

        <span className="font-mono text-[9px] uppercase tracking-widest text-brass-300/70">
          {source === 'warped' ? 'TOP-DOWN' : 'CAM'}
        </span>
      </div>

      {/* Main video / canvas / placeholder viewport */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black/50">
        <AnimatePresence mode="wait">
          {isLive ? (
            <motion.div
              key={`live-${source}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="h-full w-full"
            >
              {source === 'warped' ? (
                <WarpedBoardFeed
                  getDebugCanvas={getDebugCanvas}
                  lastMove={lastMove}
                  flip={flip}
                  mirror={mirror}
                  rotate={rotate}
                />
              ) : (
                <RawVideoFeed
                  stream={cameraStream}
                  mirror={mirror}
                  rotate={rotate}
                />
              )}
            </motion.div>
          ) : (
            <motion.div
              key="offline-placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex h-full w-full flex-col items-center justify-center p-4 text-center"
            >
              <div className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-lg text-brass-300/60 shadow-inner">
                {demoActive ? '♞' : '📹'}
              </div>
              <p className="mt-1.5 text-xs font-semibold text-white/70">
                {demoActive ? t('demoReplay') : t('cameraOffline')}
              </p>
              <p className="text-[10px] text-white/30">
                {demoActive ? t('demoHint') : t('waitingForStream')}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
