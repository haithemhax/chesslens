import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useShow } from '../state/ShowProvider.jsx';
import { useChessLens } from '../state/store.js';
import { translate } from '../i18n/translations.js';
import { buildWarpMap, squareToCell } from '../lib/homography.js';
import { clearCalibration } from '../lib/storage.js';
import { drawCameraFitOverlay } from '../lib/cameraFit.js';
import { refineCorners } from '../vision/v2/cornerRefinement.js';
import CameraFitPanel from './CameraFitPanel.jsx';
import { cx } from './Ui.jsx';

const WARP_SIZE = 240;

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function drawOverlay(
  ctx,
  width,
  height,
  corners,
  draggingIndex = -1,
  offscreenCanvas = null,
  refinement = null,
  previewRefined = true,
) {
  if (!corners.length) return;
  const radius = Math.max(9, width * 0.012);

  ctx.save();
  ctx.lineWidth = Math.max(2, width * 0.003);

  // If refinement candidate is active, show visual comparison
  if (refinement && refinement.refinedCorners) {
    // 1. Draw original corners with dashed line
    ctx.strokeStyle = 'rgba(230, 192, 121, 0.45)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    corners.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Draw connecting vector lines
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.8)';
    ctx.lineWidth = 1.5;
    corners.forEach((pt, i) => {
      const ref = refinement.refinedCorners[i];
      if (!ref) return;
      ctx.beginPath();
      ctx.moveTo(pt.x * width, pt.y * height);
      ctx.lineTo(ref.x * width, ref.y * height);
      ctx.stroke();
    });

    // 3. Draw refined corners in emerald
    ctx.strokeStyle = '#10b981';
    ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    ctx.lineWidth = Math.max(2, width * 0.003);
    ctx.beginPath();
    refinement.refinedCorners.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.fill();

    refinement.refinedCorners.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.15, 0, Math.PI * 2);
      ctx.fillStyle = '#34d399';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#064e3b';
      ctx.stroke();

      ctx.fillStyle = '#064e3b';
      ctx.font = `800 ${Math.max(12, width * 0.016)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), x, y + 1);
    });
  } else {
    ctx.strokeStyle = 'rgba(240,217,168,0.95)';
    ctx.fillStyle = 'rgba(240,217,168,0.12)';

    if (corners.length > 1 && corners.length < 4) {
      ctx.beginPath();
      corners.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    corners.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      const isDragged = index === draggingIndex;

      ctx.beginPath();
      ctx.arc(x, y, isDragged ? radius * 1.3 : radius, 0, Math.PI * 2);
      ctx.fillStyle = isDragged ? '#f6e6c4' : '#e6c079';
      ctx.fill();
      ctx.lineWidth = Math.max(2, width * 0.0025);
      ctx.strokeStyle = 'rgba(8,9,12,0.85)';
      ctx.stroke();

      ctx.fillStyle = '#0b0d12';
      ctx.font = `700 ${Math.max(13, width * 0.018)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), x, y + 1);
    });
  }

  // Magnifier Loupe when dragging a corner
  if (draggingIndex >= 0 && corners[draggingIndex] && offscreenCanvas) {
    const pt = corners[draggingIndex];
    const srcX = pt.x * offscreenCanvas.width;
    const srcY = pt.y * offscreenCanvas.height;
    const targetX = pt.x * width;
    const targetY = pt.y * height;

    const loupeRadius = Math.max(42, width * 0.07);
    const loupeOffset = loupeRadius + 24;
    // Position loupe above the corner unless too close to top
    const loupeX = Math.min(width - loupeRadius - 8, Math.max(loupeRadius + 8, targetX));
    const loupeY = targetY > loupeRadius + 30 ? targetY - loupeOffset : targetY + loupeOffset;

    const zoom = 2.4;
    const sampleSize = (loupeRadius * 2) / zoom;

    ctx.save();
    ctx.beginPath();
    ctx.arc(loupeX, loupeY, loupeRadius, 0, Math.PI * 2);
    ctx.clip();

    ctx.drawImage(
      offscreenCanvas,
      srcX - sampleSize / 2,
      srcY - sampleSize / 2,
      sampleSize,
      sampleSize,
      loupeX - loupeRadius,
      loupeY - loupeRadius,
      loupeRadius * 2,
      loupeRadius * 2,
    );

    // Crosshairs inside magnifier
    ctx.strokeStyle = 'rgba(230,192,121,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(loupeX - loupeRadius, loupeY);
    ctx.lineTo(loupeX + loupeRadius, loupeY);
    ctx.moveTo(loupeX, loupeY - loupeRadius);
    ctx.lineTo(loupeX, loupeY + loupeRadius);
    ctx.stroke();

    ctx.restore();

    // Loupe border
    ctx.beginPath();
    ctx.arc(loupeX, loupeY, loupeRadius, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#e6c079';
    ctx.stroke();
  }

  ctx.restore();
}

export default function CalibrationView() {
  const calibrating = useChessLens((state) => state.ui.calibrating);
  const lang = useChessLens((state) => state.settings.lang);
  const cameraFit = useChessLens((state) => state.cameraFit);
  const baselineSharpness = useChessLens((state) => state.calibration?.baselineSharpness);
  const setSettings = useChessLens((state) => state.setSettings);
  const { videoRef, finishCalibration, closeCalibration, captureBaseline, runCameraFitCheck } = useShow();
  const t = (key) => translate(lang, key);

  const [corners, setCorners] = useState([]);
  const [orientation, setOrientation] = useState('white');
  const [hasFrame, setHasFrame] = useState(false);
  const [refinement, setRefinement] = useState(null);
  const [isRefining, setIsRefining] = useState(false);
  const [previewRefined, setPreviewRefined] = useState(true);
  const draggingIndexRef = useRef(-1);
  const [draggingIndex, setDraggingIndex] = useState(-1);
  const previewRef = useRef(null);
  const warpRef = useRef(null);
  const hasFrameRef = useRef(false);

  useEffect(() => {
    if (!calibrating) return;
    const state = useChessLens.getState();
    const initialCorners = state.calibration?.corners
      ? state.calibration.corners.map((point) => ({ x: point.x, y: point.y }))
      : [];
    setCorners(initialCorners);
    setRefinement(null);
    setOrientation(state.settings.flip ? 'black' : 'white');
    setHasFrame(false);
    hasFrameRef.current = false;
    runCameraFitCheck(initialCorners);
  }, [calibrating, runCameraFitCheck]);

  useEffect(() => {
    if (calibrating && corners.length === 4) {
      runCameraFitCheck(corners);
    }
  }, [calibrating, corners, runCameraFitCheck]);

  useEffect(() => {
    if (!calibrating) return undefined;

    const offscreen = document.createElement('canvas');
    const offscreenCtx = offscreen.getContext('2d', { willReadFrequently: true });
    let raf = 0;
    let lastWarpAt = 0;

    const draw = (now) => {
      raf = requestAnimationFrame(draw);

      const video = videoRef.current;
      const preview = previewRef.current;
      if (!preview) return;
      const ctx = preview.getContext('2d');
      if (!ctx) return;

      if (video && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        if (preview.width !== video.videoWidth || preview.height !== video.videoHeight) {
          preview.width = video.videoWidth;
          preview.height = video.videoHeight;
        }
        if (offscreen.width !== video.videoWidth || offscreen.height !== video.videoHeight) {
          offscreen.width = video.videoWidth;
          offscreen.height = video.videoHeight;
        }

        offscreenCtx.drawImage(video, 0, 0, offscreen.width, offscreen.height);
        ctx.drawImage(offscreen, 0, 0, preview.width, preview.height);
        drawCameraFitOverlay(ctx, preview.width, preview.height, cameraFit, corners, orientation === 'black');
        drawOverlay(
          ctx,
          preview.width,
          preview.height,
          corners,
          draggingIndexRef.current,
          offscreen,
          refinement,
          previewRefined,
        );

        if (!hasFrameRef.current) {
          hasFrameRef.current = true;
          setHasFrame(true);
        }

        if (corners.length === 4 && now - lastWarpAt > 180) {
          lastWarpAt = now;
          const warpCanvas = warpRef.current;
          if (warpCanvas) {
            const activeWarpCorners =
              refinement && previewRefined && refinement.refinedCorners
                ? refinement.refinedCorners
                : corners;

            const map = buildWarpMap({
              corners: activeWarpCorners,
              destSize: WARP_SIZE,
              sourceWidth: offscreen.width,
              sourceHeight: offscreen.height,
            });
            if (map) {
              const source = offscreenCtx.getImageData(0, 0, offscreen.width, offscreen.height).data;
              const warpCtx = warpCanvas.getContext('2d');
              const image = warpCtx.createImageData(WARP_SIZE, WARP_SIZE);
              for (let index = 0; index < map.offsets.length; index += 1) {
                const sourceIndex = map.offsets[index];
                const targetIndex = index * 4;
                image.data[targetIndex] = source[sourceIndex];
                image.data[targetIndex + 1] = source[sourceIndex + 1];
                image.data[targetIndex + 2] = source[sourceIndex + 2];
                image.data[targetIndex + 3] = 255;
              }
              warpCtx.putImageData(image, 0, 0);

              // Overlaid 8x8 alignment grid on warped preview
              warpCtx.strokeStyle = refinement && previewRefined
                ? 'rgba(52, 211, 153, 0.65)'
                : 'rgba(230, 192, 121, 0.45)';
              warpCtx.lineWidth = 1;
              for (let i = 1; i < 8; i += 1) {
                const pos = (i * WARP_SIZE) / 8;
                warpCtx.beginPath();
                warpCtx.moveTo(pos, 0);
                warpCtx.lineTo(pos, WARP_SIZE);
                warpCtx.stroke();
                warpCtx.beginPath();
                warpCtx.moveTo(0, pos);
                warpCtx.lineTo(WARP_SIZE, pos);
                warpCtx.stroke();
              }

              // Highlight glare squares if any
              if (cameraFit?.img?.glareSquares?.length) {
                const squareSize = WARP_SIZE / 8;
                warpCtx.fillStyle = 'rgba(239, 68, 68, 0.35)';
                warpCtx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
                warpCtx.lineWidth = 1.5;
                for (const sq of cameraFit.img.glareSquares) {
                  const cell = squareToCell(sq, orientation === 'black');
                  const row = Math.floor(cell / 8);
                  const col = cell % 8;
                  const gx = col * squareSize;
                  const gy = row * squareSize;
                  warpCtx.fillRect(gx, gy, squareSize, squareSize);
                  warpCtx.strokeRect(gx + 1, gy + 1, squareSize - 2, squareSize - 2);

                  warpCtx.fillStyle = '#fee2e2';
                  warpCtx.font = 'bold 9px Inter, sans-serif';
                  warpCtx.textAlign = 'center';
                  warpCtx.textBaseline = 'middle';
                  warpCtx.fillText('⚡' + sq, gx + squareSize / 2, gy + squareSize / 2);
                }
              }
            }
          }
        }
      } else {
        ctx.fillStyle = '#0b0d12';
        ctx.fillRect(0, 0, preview.width, preview.height);
      }

      if (corners.length !== 4) {
        const warpCanvas = warpRef.current;
        const warpCtx = warpCanvas?.getContext('2d');
        if (warpCtx) warpCtx.clearRect(0, 0, WARP_SIZE, WARP_SIZE);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [calibrating, corners, refinement, previewRefined, videoRef, cameraFit, orientation, runCameraFitCheck]);

  function getCanvasPoint(event) {
    const canvas = previewRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
      canvasX: event.clientX - rect.left,
      canvasY: event.clientY - rect.top,
      rectWidth: rect.width,
      rectHeight: rect.height,
    };
  }

  function handlePointerDown(event) {
    const pt = getCanvasPoint(event);
    if (!pt) return;

    let nearestIdx = -1;
    let minDistance = 30; // hit radius in pixels
    corners.forEach((c, idx) => {
      const cx = c.x * pt.rectWidth;
      const cy = c.y * pt.rectHeight;
      const dist = Math.hypot(cx - pt.canvasX, cy - pt.canvasY);
      if (dist < minDistance) {
        minDistance = dist;
        nearestIdx = idx;
      }
    });

    if (nearestIdx >= 0) {
      setRefinement(null);
      draggingIndexRef.current = nearestIdx;
      setDraggingIndex(nearestIdx);
      try {
        event.target.setPointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
    } else if (corners.length < 4) {
      setRefinement(null);
      const newCorners = [...corners, { x: pt.x, y: pt.y }];
      setCorners(newCorners);
    }
  }

  function handlePointerMove(event) {
    if (draggingIndexRef.current < 0) return;
    const pt = getCanvasPoint(event);
    if (!pt) return;
    setRefinement(null);
    setCorners((prev) => {
      const next = [...prev];
      next[draggingIndexRef.current] = { x: pt.x, y: pt.y };
      return next;
    });
  }

  function handlePointerUp(event) {
    if (draggingIndexRef.current >= 0) {
      draggingIndexRef.current = -1;
      setDraggingIndex(-1);
      try {
        event.target.releasePointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  function handleReset() {
    clearCalibration();
    useChessLens.getState().clearCalibrationState();
    setCorners([]);
    setRefinement(null);
  }

  function handleRefineCorners() {
    if (corners.length !== 4) return;
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setIsRefining(true);
    setTimeout(() => {
      try {
        const res = refineCorners({
          corners,
          source: video,
          sourceWidth: video.videoWidth,
          sourceHeight: video.videoHeight,
        });
        setRefinement(res);
        setPreviewRefined(true);
      } finally {
        setIsRefining(false);
      }
    }, 25);
  }

  function handleAcceptRefinement() {
    if (refinement?.refinedCorners) {
      setCorners(refinement.refinedCorners);
      setRefinement(null);
    }
  }

  function handleKeepOriginal() {
    setRefinement(null);
  }

  function handleConfirm() {
    if (corners.length !== 4) return;
    setSettings({ flip: orientation === 'black' });
    finishCalibration(corners);
  }

  const cornerKeys = ['cornerTL', 'cornerTR', 'cornerBR', 'cornerBL'];
  const nextIndex = Math.min(corners.length, 3);

  return (
    <AnimatePresence>
      {calibrating && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-4 backdrop-blur-sm sm:p-6"
        >
          <div className="flex min-h-full items-start justify-center py-4 sm:items-center">
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.99 }}
              transition={{ duration: 0.24 }}
              className="panel w-full max-w-6xl overflow-hidden bg-ink-900/95"
            >
              <div className="panel-header px-5 py-4">
                <div>
                  <div className="eyebrow">{t('calibrating')}</div>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight">{t('calibrationTitle')}</h2>
                </div>
                <button type="button" onClick={closeCalibration} className="btn px-3 py-1.5 text-xs">
                  {t('close')}
                </button>
              </div>

              <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
                <div className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {cornerKeys.map((key, index) => (
                      <span
                        key={key}
                        className={cx(
                          'chip transition',
                          index < corners.length
                            ? 'border-brass-400/40 bg-brass-400/10 text-brass-200'
                            : index === nextIndex
                              ? 'border-white/25 bg-white/10 text-white/80'
                              : 'text-white/30',
                        )}
                      >
                        <span className="grid h-4 w-4 place-items-center rounded-full border border-current text-[9px]">
                          {index + 1}
                        </span>
                        {t(key)}
                      </span>
                    ))}
                  </div>

                  <div className="relative">
                    <canvas
                      ref={previewRef}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerUp}
                      style={{ touchAction: 'none' }}
                      className={cx(
                        'mx-auto block h-auto max-h-[52vh] w-auto max-w-full rounded-xl border border-white/10 bg-black shadow-2xl',
                        draggingIndex >= 0 ? 'cursor-grabbing' : corners.length < 4 ? 'cursor-crosshair' : 'cursor-grab',
                      )}
                    />
                    {!hasFrame && (
                      <div className="absolute inset-0 grid place-items-center rounded-xl bg-ink-950/70 text-sm text-white/40">
                        {t('debugNoFrame')}
                      </div>
                    )}
                    <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/15 bg-ink-950/80 px-2.5 py-1 font-mono text-[11px] text-white/70">
                      {corners.length} / 4 {draggingIndex >= 0 ? '(Dragging)' : ''}
                    </div>
                  </div>

                  <p className="mt-3 text-center text-xs leading-relaxed text-white/35">
                    {t('calibrationIntro')} <span className="text-white/55">{t('calibrationHint')}</span>
                  </p>
                </div>

                <div className="flex min-w-0 flex-col gap-4">
                  <div className="panel bg-white/[0.025] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="eyebrow">{t('warpPreview')}</div>
                      {refinement && (
                        <button
                          type="button"
                          onClick={() => setPreviewRefined(!previewRefined)}
                          className={cx(
                            'rounded border px-2 py-0.5 text-[10px] font-medium transition',
                            previewRefined
                              ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
                              : 'border-white/20 bg-white/5 text-white/60',
                          )}
                        >
                          {previewRefined ? 'Preview: Refined' : 'Preview: Original'}
                        </button>
                      )}
                    </div>
                    <canvas
                      ref={warpRef}
                      width={WARP_SIZE}
                      height={WARP_SIZE}
                      className="mx-auto aspect-square w-full max-w-[260px] rounded-lg border border-white/10 bg-ink-950"
                    />
                    {corners.length !== 4 && (
                      <p className="mt-2 text-center text-[11px] text-white/30">{t('clickCorners')}</p>
                    )}
                  </div>

                  {refinement ? (
                    <div className="rounded-xl border border-emerald-500/35 bg-emerald-950/40 p-3 text-xs text-white shadow-lg">
                      <div className="flex items-center justify-between font-semibold text-emerald-300">
                        <div className="flex items-center gap-1.5">
                          <span>✨</span>
                          <span>{t('refineScore')}:</span>
                          <span className="font-mono text-white/70">{refinement.initialScore}</span>
                          <span>→</span>
                          <span className="font-mono text-emerald-200">{refinement.refinedScore}</span>
                          <span className="font-mono text-[11px] text-emerald-400">
                            ({refinement.improvementPct >= 0 ? '+' : ''}{refinement.improvementPct}%)
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-white/50">
                          shift: {refinement.maxShiftPx}px
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-white/70">
                        {refinement.improved
                          ? 'Grid lines aligned with higher edge contrast.'
                          : 'Corners are already well-aligned.'}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleAcceptRefinement}
                          className="btn flex-1 border-emerald-400/50 bg-emerald-500/25 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/35"
                        >
                          {t('acceptRefinement')}
                        </button>
                        <button
                          type="button"
                          onClick={handleKeepOriginal}
                          className="btn py-1.5 text-xs text-white/60 hover:text-white"
                        >
                          {t('keepOriginal')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    corners.length === 4 && (
                      <button
                        type="button"
                        onClick={handleRefineCorners}
                        disabled={isRefining}
                        className="btn border-brass-400/40 bg-brass-400/10 py-2 text-xs font-semibold text-brass-200 hover:border-brass-400/60 hover:bg-brass-400/20"
                      >
                        {isRefining ? t('refining') : `✨ ${t('refineCorners')}`}
                      </button>
                    )
                  )}

                  <CameraFitPanel
                    fitResult={cameraFit}
                    onCaptureBaseline={() => captureBaseline('start')}
                    baselineActive={Boolean(baselineSharpness)}
                    className="w-full"
                  />

                  <div className="panel bg-white/[0.025] p-3">
                    <div className="eyebrow mb-2">{t('orientation')}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setOrientation('white')}
                        className={cx(
                          'btn px-2 py-2 text-xs',
                          orientation === 'white' && 'border-brass-400/50 bg-brass-400/15 text-brass-200',
                        )}
                      >
                        {t('whiteSide')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOrientation('black')}
                        className={cx(
                          'btn px-2 py-2 text-xs',
                          orientation === 'black' && 'border-brass-400/50 bg-brass-400/15 text-brass-200',
                        )}
                      >
                        {t('blackSide')}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs leading-relaxed text-amber-100/70">
                    {t('calibrationConfirm')}
                  </div>

                  <div className="mt-auto flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleConfirm}
                      disabled={corners.length !== 4}
                      className="btn btn-primary h-11"
                    >
                      {t('confirm')}
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={handleReset}
                        className="btn h-10 text-xs text-red-300 hover:border-red-400/40"
                      >
                        {t('reset')}
                      </button>
                      <button
                        type="button"
                        onClick={closeCalibration}
                        className="btn h-10 text-xs"
                      >
                        {t('cancel')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
