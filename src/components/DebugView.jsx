import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useShow } from '../state/ShowProvider.jsx';
import { useChessLens } from '../state/store.js';
import { translate } from '../i18n/translations.js';
import { squareToCell } from '../lib/homography.js';
import { formatEval } from '../lib/evaluation.js';
import { cx, Pill } from './Ui.jsx';

const MODE_KEYS = {
  idle: 'detectionIdle',
  watching: 'detectionWatching',
  motion: 'detectionMotion',
  occluded: 'detectionOccluded',
  analyzing: 'detectionAnalyzing',
  pending: 'detectionPending',
  paused: 'detectionPaused',
  error: 'cameraError',
};

export default function DebugView({ open, onClose }) {
  const lang = useChessLens((state) => state.settings.lang);
  const flip = useChessLens((state) => state.settings.flip);
  const debug = useChessLens((state) => state.debug);
  const vision = useChessLens((state) => state.vision);
  const game = useChessLens((state) => state.game);
  const engine = useChessLens((state) => state.engine);
  const {
    getDebugCanvas,
    startVisionRecording,
    stopVisionRecording,
    getVisionRecordedFrames,
    loadVisionRecordedFrames,
    replayVisionFrame,
  } = useShow();
  const t = (key, vars) => translate(lang, key, vars);

  const displayRef = useRef(null);
  const [hasSource, setHasSource] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedList, setRecordedList] = useState([]);
  const [replayIdx, setReplayIdx] = useState(0);
  const hasSourceRef = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const source = getDebugCanvas();
      const display = displayRef.current;
      if (!source || !display) return;
      if (display.width !== source.width || display.height !== source.height) {
        display.width = source.width;
        display.height = source.height;
      }
      const ctx = display.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(source, 0, 0);
      if (!hasSourceRef.current) {
        hasSourceRef.current = true;
        setHasSource(true);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [open, getDebugCanvas]);

  const changed = useMemo(() => new Set(debug.changedCells || []), [debug.changedCells]);
  const candidate = debug.candidates?.[0] || null;
  const expected = useMemo(() => {
    if (!candidate) return new Set();
    return new Set([
      squareToCell(candidate.from, flip),
      squareToCell(candidate.to, flip),
    ]);
  }, [candidate, flip]);

  const currentEntry = game.evalHistory[game.ply] || null;
  const modeKey = MODE_KEYS[vision.mode] || 'detectionIdle';

  function toggleRecording() {
    if (isRecording) {
      const frames = stopVisionRecording();
      setIsRecording(false);
      setRecordedList(frames);
    } else {
      startVisionRecording();
      setIsRecording(true);
      setRecordedList([]);
    }
  }

  function exportSession() {
    const frames = isRecording ? getVisionRecordedFrames() : recordedList;
    const blob = new Blob([JSON.stringify({ frames, exportedAt: Date.now() }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chesslens-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportSession(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result);
        const frames = Array.isArray(data?.frames) ? data.frames : Array.isArray(data) ? data : [];
        loadVisionRecordedFrames(frames);
        setRecordedList(frames);
        if (frames.length > 0) {
          setReplayIdx(0);
          replayVisionFrame(frames[0]);
        }
      } catch (err) {
        console.error('Failed to load session JSON', err);
      }
    };
    reader.readAsText(file);
  }

  function onScrub(index) {
    const idx = Math.max(0, Math.min(recordedList.length - 1, index));
    setReplayIdx(idx);
    if (recordedList[idx]) {
      replayVisionFrame(recordedList[idx]);
    }
  }

  return (
    <AnimatePresence>
      {open && (
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
              transition={{ duration: 0.22 }}
              className="panel w-full max-w-5xl overflow-hidden bg-ink-900/95"
            >
              <div className="panel-header px-5 py-4">
                <div>
                  <div className="eyebrow">{t('debugView')}</div>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight">{t('debugWarp')}</h2>
                </div>
                <button type="button" onClick={onClose} className="btn px-3 py-1.5 text-xs">
                  {t('close')}
                </button>
              </div>

              <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <div className="min-w-0">
                  <div className="relative mx-auto aspect-square w-full max-w-[440px] overflow-hidden rounded-xl border border-white/10 bg-ink-950">
                    <canvas ref={displayRef} className="h-full w-full" />
                    <div className="pointer-events-none absolute inset-0 grid grid-cols-8 grid-rows-8">
                      {Array.from({ length: 64 }, (_, index) => (
                        <div
                          key={index}
                          className={cx(
                            'border border-white/[0.06]',
                            changed.has(index) && 'bg-red-400/40',
                            expected.has(index) && !changed.has(index) && 'bg-brass-400/25',
                          )}
                        />
                      ))}
                    </div>
                    {!hasSource && (
                      <div className="absolute inset-0 grid place-items-center text-sm text-white/35">
                        {t('debugNoFrame')}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[10px] uppercase tracking-widest text-white/30">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-sm bg-red-400/70" />
                      {t('debugChangedCells')}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-sm bg-brass-400/60" />
                      {t('candidates')}
                    </span>
                  </div>
                </div>

                <div className="min-w-0 space-y-4">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <div className="label">{t('status')}</div>
                      <div className="mt-1 flex items-center gap-1.5 font-medium text-white/80">
                        <span>{t(modeKey)}</span>
                        {vision.occluded && (
                          <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300">
                            {t('detectionOccluded')}
                          </span>
                        )}
                        {vision.driftDetected && (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                            Shift
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <div className="label">{t('debugMotion')}</div>
                      <div className="mt-1 font-mono text-white/80">
                        {(debug.motion || 0).toFixed(3)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <div className="label">{t('debugChangedCells')}</div>
                      <div className="mt-1 font-mono text-white/80">{changed.size}</div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <div className="label">{t('engineSource')}</div>
                      <div className="mt-1 font-mono text-white/80">
                        {currentEntry?.source || (engine.status === 'ready' ? t('engineReady') : t('engineLoading'))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="label">{t('evaluation')}</span>
                      <span className="font-mono text-xs text-brass-200">
                        {formatEval(currentEntry?.eval)} · {t('engineDepth')} {currentEntry?.depth ?? 0}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Pill tone={game.thinking ? 'warn' : 'neutral'}>
                        {game.thinking ? t('thinking') : t('engineReady')}
                      </Pill>
                      <Pill>{game.ply} ply</Pill>
                    </div>
                  </div>

                  <div>
                    <div className="eyebrow mb-2">{t('candidates')}</div>
                    {debug.candidates?.length ? (
                      <div className="space-y-1.5">
                        {debug.candidates.map((item, index) => (
                          <div
                            key={item.uci}
                            className={cx(
                              'flex items-center justify-between gap-3 rounded-lg border px-3 py-2',
                              index === 0
                                ? 'border-brass-400/30 bg-brass-400/[0.07]'
                                : 'border-white/10 bg-white/[0.025]',
                            )}
                          >
                            <div className="min-w-0">
                              <div className="flex items-baseline gap-2">
                                <span className="font-mono text-sm font-semibold text-white/85">
                                  {item.san}
                                </span>
                                <span className="font-mono text-[10px] text-white/30">
                                  {item.from}→{item.to}
                                </span>
                              </div>
                              <div className="mt-0.5 text-[10px] text-white/30">
                                {item.hits}/{item.expectedCount} {t('candidateMatch')} · +
                                {item.extras} −{item.missing}
                              </div>
                            </div>
                            <span className="font-mono text-sm text-brass-200">
                              {item.scorePercent}%
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-4 text-center text-xs text-white/30">
                        {t('debugEmpty')}
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between">
                      <span className="eyebrow">{t('recordSession')}</span>
                      <span className="font-mono text-xs text-brass-200">
                        {isRecording
                          ? `${vision.recordedFramesCount || 0} frames`
                          : `${recordedList.length} frames`}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={toggleRecording}
                        className={cx('btn text-xs', isRecording ? 'btn-danger' : 'btn-primary')}
                      >
                        {isRecording ? t('stopRecording') : t('recordSession')}
                      </button>
                      <button
                        type="button"
                        disabled={recordedList.length === 0 && !isRecording}
                        onClick={exportSession}
                        className="btn text-xs"
                      >
                        Export JSON
                      </button>
                      <label className="btn cursor-pointer text-xs">
                        Import JSON
                        <input
                          type="file"
                          accept=".json"
                          onChange={handleImportSession}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {recordedList.length > 0 && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-[11px] text-white/40">
                          <span>Replay frame {replayIdx + 1}/{recordedList.length}</span>
                          <span className="font-mono text-brass-200">
                            {recordedList[replayIdx]?.mode || 'idle'}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={recordedList.length - 1}
                          value={replayIdx}
                          onChange={(e) => onScrub(Number(e.target.value))}
                          className="range mt-1.5"
                        />
                      </div>
                    )}
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
