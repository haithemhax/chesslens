import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useShow } from '../state/ShowProvider.jsx';
import { useChessLens } from '../state/store.js';
import { LANGUAGES, translate } from '../i18n/translations.js';
import { cx, Pill, RangeRow, Section, Switch } from './Ui.jsx';
import { drawCameraFitOverlay } from '../lib/cameraFit.js';
import CameraFitPanel from './CameraFitPanel.jsx';
import DebugView from './DebugView.jsx';

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

export default function OperatorPanel() {
  const open = useChessLens((state) => state.ui.operatorOpen);
  const settings = useChessLens((state) => state.settings);
  const camera = useChessLens((state) => state.camera);
  const cameraFit = useChessLens((state) => state.cameraFit);
  const engine = useChessLens((state) => state.engine);
  const calibration = useChessLens((state) => state.calibration);
  const vision = useChessLens((state) => state.vision);
  const demo = useChessLens((state) => state.demo);
  const recording = useChessLens((state) => state.recording);
  const llmKey = useChessLens((state) => state.llmKey);
  const online = useChessLens((state) => state.online);
  const gameOver = useChessLens((state) => state.game.status.over);
  const setSettings = useChessLens((state) => state.setSettings);
  const setDemo = useChessLens((state) => state.setDemo);
  const setLlmKey = useChessLens((state) => state.setLlmKey);
  const setUi = useChessLens((state) => state.setUi);
  const setShowIntroScreen = useChessLens((state) => state.setShowIntroScreen);
  const showResult = useChessLens((state) => state.showResult);

  const {
    startCamera,
    stopCamera,
    selectDevice,
    openCalibration,
    syncBoard,
    applyManualMove,
    resolveCandidate,
    ignoreCandidates,
    newGame,
    undo,
    togglePause,
    flipBoard,
    toggleDemo,
    setLanguage,
    restartEngine,
    toggleFullscreen,
    setTestMode,
    startRecording,
    stopRecording,
    selectRecordingDirectory,
    captureBaseline,
    videoRef,
  } = useShow();

  const [manual, setManual] = useState('');
  const [debugOpen, setDebugOpen] = useState(false);
  const operatorCanvasRef = useRef(null);

  useEffect(() => {
    if (!open || camera.status !== 'live') return undefined;

    let animId = 0;
    let lastDraw = 0;
    const interval = 1000 / 15; // 15 fps

    function render(time) {
      animId = requestAnimationFrame(render);
      if (time - lastDraw < interval) return;
      lastDraw = time;

      const video = videoRef?.current;
      const canvas = operatorCanvasRef.current;
      if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      drawCameraFitOverlay(
        ctx,
        canvas.width,
        canvas.height,
        cameraFit,
        calibration?.corners,
        settings.flip,
      );
    }

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [open, camera.status, cameraFit, calibration?.corners, settings.flip, videoRef]);

  const lang = settings.lang;
  const t = (key, vars) => translate(lang, key, vars);

  const cameraTone =
    camera.status === 'live' ? 'good' : camera.status === 'error' ? 'bad' : 'neutral';
  const cameraLabel =
    camera.status === 'live'
      ? t('cameraOk')
      : camera.status === 'error'
        ? t('cameraError')
        : camera.status === 'starting'
          ? t('cameraStarting')
          : t('cameraOff');
  const engineTone = engine.status === 'ready' ? 'good' : engine.status === 'error' ? 'bad' : 'warn';
  const engineLabel =
    engine.status === 'ready'
      ? t('engineReady')
      : engine.status === 'error'
        ? t('engineError')
        : t('engineLoading');
  const detectionTone =
    vision.mode === 'pending' || vision.mode === 'paused'
      ? 'warn'
      : vision.mode === 'motion' || vision.mode === 'analyzing'
        ? 'brass'
        : 'neutral';

  function close() {
    setUi({ operatorOpen: false });
  }

  function submitManual(event) {
    event.preventDefault();
    const record = applyManualMove(manual, 'manual');
    if (record) setManual('');
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="operator-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={close}
              className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
            />

            <motion.aside
              key="operator-panel"
              role="dialog"
              aria-modal="true"
              aria-label={t('operator')}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[480px] flex-col border-l border-white/10 bg-ink-900/95 shadow-2xl backdrop-blur-xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4">
                <div className="min-w-0">
                  <div className="eyebrow">{t('operator')}</div>
                  <h2 className="mt-1 truncate text-lg font-semibold tracking-tight">
                    {t('operatorSubtitle')}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label={t('close')}
                  className="btn h-8 w-8 shrink-0 px-0 text-lg leading-none"
                >
                  ×
                </button>
              </div>

              <div className="border-b border-white/10 px-4 py-3">
                <div className="flex flex-wrap gap-1.5">
                  <Pill tone={cameraTone} dot>
                    {cameraLabel}
                  </Pill>
                  <Pill tone={engineTone} dot>
                    {engineLabel}
                  </Pill>
                  <Pill tone={calibration ? 'brass' : 'warn'} dot>
                    {calibration ? t('calibrationSaved') : t('notCalibrated')}
                  </Pill>
                  <Pill tone={detectionTone} dot>
                    {t(MODE_KEYS[vision.mode] || 'detectionIdle')}
                  </Pill>
                  <Pill tone={online ? 'good' : 'neutral'} dot>
                    {online ? t('online') : t('offline')}
                  </Pill>
                  {cameraFit && (
                    <Pill
                      tone={
                        cameraFit.status === 'good'
                          ? 'good'
                          : cameraFit.status === 'warning'
                            ? 'warn'
                            : 'bad'
                      }
                      dot
                    >
                      {`FIT: ${cameraFit.status.toUpperCase()}`}
                    </Pill>
                  )}
                  {demo.active && <Pill tone="brass">{t('demoBadge')}</Pill>}
                </div>

                {(camera.message || engine.message) && (
                  <div className="mt-2 space-y-1">
                    {camera.message && (
                      <p className="text-[11px] leading-snug text-red-200/70">{camera.message}</p>
                    )}
                    {engine.message && (
                      <p className="text-[11px] leading-snug text-red-200/70">{engine.message}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="scroll-area flex-1">
                <Section title={t('camera')}>
                  <label className="block">
                    <span className="label">{t('device')}</span>
                    <select
                      className="field mt-1.5"
                      value={settings.deviceId}
                      onChange={(event) => selectDevice(event.target.value)}
                    >
                      <option value="">{t('cameraHint')}</option>
                      {camera.devices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!camera.devices.length && (
                    <p className="mt-1.5 text-[11px] text-white/30">{t('noDevices')}</p>
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => startCamera(settings.deviceId)}
                      className="btn btn-primary text-xs"
                    >
                      {t('startCamera')}
                    </button>
                    <button type="button" onClick={stopCamera} className="btn text-xs">
                      {t('stopCamera')}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={openCalibration}
                    className="btn mt-2 w-full text-xs"
                  >
                    {calibration ? t('recalibrate') : t('calibrate')}
                  </button>

                  {camera.status === 'live' && (
                    <div className="relative mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/60 shadow-inner">
                      <canvas
                        ref={operatorCanvasRef}
                        className="mx-auto block aspect-video max-h-[175px] w-full object-contain"
                      />
                    </div>
                  )}

                  <CameraFitPanel
                    fitResult={cameraFit}
                    onCaptureBaseline={() => captureBaseline('start')}
                    baselineActive={Boolean(calibration?.baselineSharpness)}
                    className="mt-3"
                  />
                </Section>

                <Section title={t('cameraPanel')}>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm font-medium text-white/80">{t('cameraPanelShow')}</span>
                      <Switch
                        checked={settings.cameraPanelShow ?? true}
                        onChange={(checked) => setSettings({ cameraPanelShow: checked })}
                        label={t('cameraPanelShow')}
                      />
                    </div>

                    {(settings.cameraPanelShow ?? true) && (
                      <>
                        <div>
                          <span className="label mb-1.5 block">{t('cameraPanelSource')}</span>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { id: 'raw', label: t('sourceRaw') },
                              { id: 'warped', label: t('sourceWarped') },
                            ].map((src) => (
                              <button
                                key={src.id}
                                type="button"
                                onClick={() => setSettings({ cameraPanelSource: src.id })}
                                className={cx(
                                  'btn px-2 py-1.5 text-xs',
                                  (settings.cameraPanelSource || 'raw') === src.id &&
                                    'border-brass-400/50 bg-brass-400/15 text-brass-200',
                                )}
                              >
                                {src.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <span className="label mb-1.5 block">{t('cameraPanelSize')}</span>
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { id: 'small', label: t('sizeSmall') },
                              { id: 'medium', label: t('sizeMedium') },
                              { id: 'large', label: t('sizeLarge') },
                            ].map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => setSettings({ cameraPanelSize: s.id })}
                                className={cx(
                                  'btn px-2 py-1.5 text-xs',
                                  (settings.cameraPanelSize || 'medium') === s.id &&
                                    'border-brass-400/50 bg-brass-400/15 text-brass-200',
                                )}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <span className="label mb-1.5 block">{t('rotation')}</span>
                          <div className="grid grid-cols-4 gap-2">
                            {[0, 90, 180, 270].map((deg) => (
                              <button
                                key={deg}
                                type="button"
                                onClick={() => setSettings({ cameraPanelRotate: deg })}
                                className={cx(
                                  'btn px-2 py-1 text-xs',
                                  (settings.cameraPanelRotate || 0) === deg &&
                                    'border-brass-400/50 bg-brass-400/15 text-brass-200',
                                )}
                              >
                                {deg}°
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-4">
                          <span className="text-xs text-white/70">{t('mirrorCamera')}</span>
                          <Switch
                            checked={Boolean(settings.cameraPanelMirror)}
                            onChange={(checked) => setSettings({ cameraPanelMirror: checked })}
                            label={t('mirrorCamera')}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </Section>

                <Section title={t('cameraBackground')}>
                  <div className="space-y-3">
                    <div>
                      <span className="label mb-1.5 block">{t('cameraBgMode')}</span>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: 'background', label: t('modeBackground') },
                          { id: 'corner', label: t('modeCorner') },
                          { id: 'off', label: t('modeOff') },
                        ].map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSettings({ cameraBgMode: item.id })}
                            className={cx(
                              'btn px-2 py-1.5 text-xs',
                              (settings.cameraBgMode || 'off') === item.id &&
                                'border-brass-400/50 bg-brass-400/15 text-brass-200',
                            )}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {settings.cameraBgMode !== 'off' && (
                      <>
                        <RangeRow
                          label={t('opacity')}
                          value={settings.cameraBgOpacity ?? 35}
                          display={`${settings.cameraBgOpacity ?? 35}%`}
                          min={0}
                          max={100}
                          step={5}
                          onChange={(value) => setSettings({ cameraBgOpacity: value })}
                        />
                        {!settings.cameraBgPerfMode && (
                          <RangeRow
                            label={t('blur')}
                            value={settings.cameraBgBlur ?? 6}
                            display={`${settings.cameraBgBlur ?? 6}px`}
                            min={0}
                            max={20}
                            step={1}
                            onChange={(value) => setSettings({ cameraBgBlur: value })}
                          />
                        )}
                        <RangeRow
                          label={t('brightness')}
                          value={settings.cameraBgBrightness ?? 100}
                          display={`${settings.cameraBgBrightness ?? 100}%`}
                          min={50}
                          max={150}
                          step={5}
                          onChange={(value) => setSettings({ cameraBgBrightness: value })}
                        />
                        <div>
                          <span className="label mb-1.5 block">{t('rotation')}</span>
                          <div className="grid grid-cols-4 gap-2">
                            {[0, 90, 180, 270].map((deg) => (
                              <button
                                key={deg}
                                type="button"
                                onClick={() => setSettings({ cameraBgRotate: deg })}
                                className={cx(
                                  'btn px-2 py-1 text-xs',
                                  (settings.cameraBgRotate || 0) === deg &&
                                    'border-brass-400/50 bg-brass-400/15 text-brass-200',
                                )}
                              >
                                {deg}°
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-xs text-white/70">{t('mirrorCamera')}</span>
                          <Switch
                            checked={Boolean(settings.cameraBgMirror)}
                            onChange={(checked) => setSettings({ cameraBgMirror: checked })}
                            label={t('mirrorCamera')}
                          />
                        </div>
                        <div className="border-t border-white/5 pt-2">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <div className="text-xs font-medium text-white/80">{t('perfMode')}</div>
                              <div className="text-[10px] text-white/35">{t('perfModeHint')}</div>
                            </div>
                            <Switch
                              checked={Boolean(settings.cameraBgPerfMode)}
                              onChange={(checked) => setSettings({ cameraBgPerfMode: checked })}
                              label={t('perfMode')}
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </Section>

                <Section title={t('videoRecording')}>
                  <div className="space-y-3">
                    {recording.active && (
                      <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                          <span className="font-mono font-bold text-red-200">{t('recordingActive')}</span>
                          <span className="font-mono text-white/90">
                            {Math.floor(recording.elapsedSeconds / 60)
                              .toString()
                              .padStart(2, '0')}
                            :
                            {(recording.elapsedSeconds % 60).toString().padStart(2, '0')}
                          </span>
                        </div>
                        <span className="text-[11px] text-white/60">
                          Part {recording.segmentIndex + 1}
                          {recording.savedSegments > 0 && ` (${recording.savedSegments} ${t('recordingPartsSaved')})`}
                        </span>
                      </div>
                    )}

                    <div>
                      <span className="label mb-1.5 block">{t('recordingSource')}</span>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: 'camera', label: t('sourceCamera') },
                          { id: 'screen', label: t('sourceScreen') },
                        ].map((src) => (
                          <button
                            key={src.id}
                            type="button"
                            disabled={recording.active}
                            onClick={() => setSettings({ recordingSource: src.id })}
                            className={cx(
                              'btn px-2 py-1.5 text-xs',
                              (settings.recordingSource || 'camera') === src.id &&
                                'border-brass-400/50 bg-brass-400/15 text-brass-200',
                              recording.active && 'opacity-50 cursor-not-allowed',
                            )}
                          >
                            {src.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {recording.active ? (
                        <button
                          type="button"
                          onClick={stopRecording}
                          className="btn btn-danger col-span-2 text-xs font-semibold"
                        >
                          {t('stopRecording')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={startRecording}
                          className="btn btn-primary col-span-2 text-xs font-semibold"
                        >
                          {t('startRecording')}
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={selectRecordingDirectory}
                      className={cx(
                        'btn w-full text-xs',
                        recording.directoryChosen && 'border-emerald-400/40 text-emerald-200 bg-emerald-400/10',
                      )}
                    >
                      {recording.directoryChosen ? `✓ ${t('folderConnected')}` : t('chooseFolder')}
                    </button>

                    <RangeRow
                      label={t('segmentLength')}
                      value={settings.recordingSegmentMinutes || 10}
                      display={`${settings.recordingSegmentMinutes || 10} min`}
                      min={1}
                      max={60}
                      step={1}
                      onChange={(value) => setSettings({ recordingSegmentMinutes: value })}
                    />

                    <RangeRow
                      label={t('bitrate')}
                      value={Math.round((settings.recordingBitrate || 4000000) / 1000000)}
                      display={`${((settings.recordingBitrate || 4000000) / 1000000).toFixed(1)} Mbps`}
                      min={1}
                      max={10}
                      step={0.5}
                      onChange={(value) => setSettings({ recordingBitrate: Math.round(value * 1000000) })}
                    />
                  </div>
                </Section>

                <Section title={t('game')}>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={newGame} className="btn text-xs">
                      {t('newGame')}
                    </button>
                    <button type="button" onClick={undo} className="btn text-xs">
                      {t('undo')}
                    </button>
                    <button type="button" onClick={flipBoard} className="btn text-xs">
                      {t('flip')}
                    </button>
                    <button type="button" onClick={togglePause} className="btn text-xs">
                      {settings.detectionPaused ? t('resumeDetection') : t('pauseDetection')}
                    </button>
                    <button type="button" onClick={syncBoard} className="btn col-span-2 text-xs">
                      {t('syncBoard')}
                    </button>
                  </div>

                  <form onSubmit={submitManual} className="mt-3">
                    <label className="block">
                      <span className="label">{t('manualMove')}</span>
                      <div className="mt-1.5 flex gap-2">
                        <input
                          value={manual}
                          onChange={(event) => setManual(event.target.value)}
                          placeholder={t('manualPlaceholder')}
                          className="field min-w-0 flex-1"
                          autoComplete="off"
                          spellCheck="false"
                        />
                        <button type="submit" className="btn btn-primary shrink-0 text-xs">
                          {t('applyManual')}
                        </button>
                      </div>
                    </label>
                    <p className="mt-1 text-[10px] text-white/25">{t('manualMoveHint')}</p>
                  </form>
                </Section>

                {vision.pending && (
                  <Section title={t('candidates')}>
                    <div className="mb-2 flex items-center justify-between text-[11px] text-white/45">
                      <span>{t('topCandidatesHint')}</span>
                      <span className="font-mono text-[10px] text-brass-300">
                        {t('pressNumberToConfirm')}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {vision.candidates.map((candidate, idx) => (
                        <button
                          key={candidate.uci}
                          type="button"
                          onClick={() => resolveCandidate(candidate)}
                          className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:border-brass-400/40 hover:bg-brass-400/[0.08]"
                        >
                          <div className="flex items-center gap-2">
                            <span className="grid h-5 w-5 place-items-center rounded bg-white/10 font-mono text-xs font-bold text-white/70">
                              {idx + 1}
                            </span>
                            <span className="font-mono text-sm font-semibold text-white/85">
                              {candidate.san}
                            </span>
                          </div>
                          <span className="font-mono text-xs text-brass-200">
                            {candidate.scorePercent}%
                          </span>
                        </button>
                      ))}
                    </div>
                    <button type="button" onClick={ignoreCandidates} className="btn mt-2 w-full text-xs">
                      {t('ignored')}
                    </button>
                  </Section>
                )}

                <Section title={t('display')}>
                  <div className="label mb-1.5">{t('language')}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {LANGUAGES.map((item) => (
                      <button
                        key={item.code}
                        type="button"
                        onClick={() => setLanguage(item.code)}
                        className={cx(
                          'btn px-2 py-2 text-xs',
                          lang === item.code &&
                            'border-brass-400/50 bg-brass-400/15 text-brass-200',
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="btn mt-2 w-full text-xs"
                  >
                    {t('fullscreen')}
                  </button>
                </Section>

                <Section title={t('detection')}>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-white/80">{t('testDetection')}</div>
                        <div className="text-[10px] text-white/35">{t('testDetectionActive')}</div>
                      </div>
                      <Switch
                        checked={vision.testMode}
                        onChange={(checked) => setTestMode(checked)}
                        label={t('testDetection')}
                      />
                    </div>
                    {vision.testResult && (
                      <div className="rounded-lg border border-brass-400/30 bg-brass-400/[0.06] p-2.5 text-xs">
                        <div className="font-mono text-brass-200">
                          Matched: {vision.testResult.best?.san || 'none'} ({vision.testResult.best?.scorePercent ?? 0}%)
                        </div>
                        <div className="mt-1 text-[10px] text-white/40">
                          Changed: {vision.testResult.changedCells.length} cells
                        </div>
                      </div>
                    )}
                    <RangeRow
                      label={t('sensitivity')}
                      value={settings.motionSensitivity}
                      display={`${settings.motionSensitivity.toFixed(1)}×`}
                      min={0.5}
                      max={2.5}
                      step={0.1}
                      onChange={(value) => setSettings({ motionSensitivity: value })}
                    />
                    <RangeRow
                      label={t('settleTime')}
                      value={settings.settleMs}
                      display={`${settings.settleMs} ms`}
                      min={200}
                      max={1000}
                      step={50}
                      onChange={(value) => setSettings({ settleMs: value })}
                    />
                    <div>
                      <span className="label mb-1.5 block">{t('promotionPiece')}</span>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { id: 'q', label: '♛ Queen' },
                          { id: 'r', label: '♜ Rook' },
                          { id: 'b', label: '♝ Bishop' },
                          { id: 'n', label: '♞ Knight' },
                        ].map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setSettings({ promotionChoice: p.id })}
                            className={cx(
                              'btn px-2 py-1.5 text-xs',
                              settings.promotionChoice === p.id &&
                                'border-brass-400/50 bg-brass-400/15 text-brass-200',
                            )}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </Section>

                <Section title={t('eventAndPlayers')}>
                  <div className="space-y-3">
                    <div>
                      <label className="label mb-1 block">{t('eventName')}</label>
                      <input
                        value={settings.eventName || ''}
                        onChange={(e) => setSettings({ eventName: e.target.value })}
                        placeholder="Live Chess Show"
                        className="field text-xs"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="label mb-1 block">{t('whitePlayer')}</label>
                        <input
                          value={settings.whitePlayer || ''}
                          onChange={(e) => setSettings({ whitePlayer: e.target.value })}
                          placeholder="White"
                          className="field text-xs"
                        />
                      </div>
                      <div>
                        <label className="label mb-1 block">{t('blackPlayer')}</label>
                        <input
                          value={settings.blackPlayer || ''}
                          onChange={(e) => setSettings({ blackPlayer: e.target.value })}
                          placeholder="Black"
                          className="field text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowIntroScreen(!settings.showIntroScreen)}
                        className={cx('btn flex-1 text-xs', settings.showIntroScreen && 'btn-primary')}
                      >
                        {settings.showIntroScreen ? t('hideIntroScreen') : t('showIntroScreen')}
                      </button>
                      {gameOver && (
                        <button
                          type="button"
                          onClick={() => showResult()}
                          className="btn btn-primary flex-1 text-xs"
                        >
                          {t('showResultScreen')}
                        </button>
                      )}
                    </div>
                  </div>
                </Section>

                <Section title={t('engineSettings')}>
                  <div className="space-y-3">
                    <RangeRow
                      label={t('engineTime')}
                      value={settings.engineMs}
                      display={`${settings.engineMs} ms`}
                      min={400}
                      max={2000}
                      step={100}
                      onChange={(value) => setSettings({ engineMs: value })}
                    />
                    <RangeRow
                      label={t('engineStrength')}
                      value={settings.skillLevel}
                      display={String(settings.skillLevel)}
                      min={0}
                      max={20}
                      step={1}
                      onChange={(value) => setSettings({ skillLevel: value })}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={restartEngine}
                    className="btn mt-3 w-full text-xs"
                  >
                    {t('restartEngine')}
                  </button>
                </Section>

                <Section title={t('llmTitle')}>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-white/65">{t('llmEnable')}</span>
                    <Switch
                      checked={settings.llmEnabled}
                      onChange={(checked) => setSettings({ llmEnabled: checked })}
                      label={t('llmEnable')}
                    />
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-white/25">{t('llmNote')}</p>

                  {settings.llmEnabled && (
                    <div className="mt-3 space-y-2">
                      <input
                        type="password"
                        value={llmKey}
                        onChange={(event) => setLlmKey(event.target.value)}
                        placeholder={t('llmKey')}
                        className="field"
                        autoComplete="off"
                        spellCheck="false"
                      />
                      <p className="text-[10px] text-white/25">{t('llmKeyMemory')}</p>
                      <input
                        value={settings.llmBaseUrl}
                        onChange={(event) => setSettings({ llmBaseUrl: event.target.value })}
                        placeholder={t('llmBaseUrl')}
                        className="field"
                        autoComplete="off"
                        spellCheck="false"
                      />
                      <input
                        value={settings.llmModel}
                        onChange={(event) => setSettings({ llmModel: event.target.value })}
                        placeholder={t('llmModel')}
                        className="field"
                        autoComplete="off"
                        spellCheck="false"
                      />
                      {!online && (
                        <p className="text-[11px] text-amber-200/60">{t('offline')}</p>
                      )}
                    </div>
                  )}
                </Section>

                <Section title={t('demoMode')}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white/75">{t('demoTitle')}</div>
                      <div className="text-[11px] text-white/30">{t('demoSubtitle')}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleDemo()}
                      className={cx('btn shrink-0 text-xs', demo.active && 'btn-primary')}
                    >
                      {demo.active ? t('demoOff') : t('demoMode')}
                    </button>
                  </div>

                  {demo.active && (
                    <div className="mt-3 space-y-2 border-t border-white/5 pt-2">
                      <div className="grid grid-cols-3 gap-1.5">
                        {[
                          { id: 'vs-computer', label: t('vsComputer'), icon: '🤖' },
                          { id: 'pass-and-play', label: t('passAndPlay'), icon: '👥' },
                          { id: 'opera', label: t('operaReplay'), icon: '📜' },
                        ].map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setDemo({ mode: m.id });
                              if (m.id !== demo.mode) newGame();
                            }}
                            className={cx(
                              'btn flex-col gap-0.5 px-1 py-1.5 text-[10px]',
                              (demo.mode || 'vs-computer') === m.id &&
                                'border-brass-400/50 bg-brass-400/15 text-brass-200',
                            )}
                          >
                            <span className="text-xs">{m.icon}</span>
                            <span className="truncate">{m.label}</span>
                          </button>
                        ))}
                      </div>

                      {demo.mode === 'vs-computer' && (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-2">
                          <span className="text-xs text-white/60">{t('playAsWhite')}:</span>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setDemo({ playerColor: 'w' });
                                newGame();
                              }}
                              className={cx(
                                'btn px-2.5 py-1 text-xs',
                                (demo.playerColor || 'w') === 'w' &&
                                  'border-brass-400/50 bg-brass-400/15 text-brass-200',
                              )}
                            >
                              ⚪ White
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDemo({ playerColor: 'b' });
                                newGame();
                              }}
                              className={cx(
                                'btn px-2.5 py-1 text-xs',
                                demo.playerColor === 'b' &&
                                  'border-brass-400/50 bg-brass-400/15 text-brass-200',
                              )}
                            >
                              ⚫ Black
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <p className="mt-2 text-[10px] leading-relaxed text-white/25">{t('demoInteractiveHint')}</p>
                </Section>

                <Section title={t('debugView')}>
                  <button
                    type="button"
                    onClick={() => setDebugOpen(true)}
                    className="btn w-full text-xs"
                  >
                    {t('debugView')}
                  </button>
                </Section>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3 text-[10px] text-white/25">
                <span className="font-mono">{t('keyboardHint')}</span>
                <button
                  type="button"
                  onClick={close}
                  className="text-[11px] font-medium text-white/45 transition hover:text-white"
                >
                  {t('close')}
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <DebugView open={debugOpen} onClose={() => setDebugOpen(false)} />
    </>
  );
}
