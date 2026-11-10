import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useShow } from '../state/ShowProvider.jsx';
import { useChessLens } from '../state/store.js';
import { languageLabel, translate } from '../i18n/translations.js';
import { cx, Pill } from './Ui.jsx';

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M8 5.14v13.72c0 .8.87 1.3 1.56.9l11-6.86a1.05 1.05 0 0 0 0-1.8l-11-6.86A1.05 1.05 0 0 0 8 5.14Z" />
    </svg>
  );
}

function CheckIcon({ ok }) {
  if (ok) {
    return (
      <svg className="h-4 w-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  return (
    <svg className="h-4 w-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

export default function Splash() {
  const splash = useChessLens((state) => state.ui.splash);
  const lang = useChessLens((state) => state.settings.lang);
  const engine = useChessLens((state) => state.engine);
  const camera = useChessLens((state) => state.camera);
  const cameraFit = useChessLens((state) => state.cameraFit);
  const calibration = useChessLens((state) => state.calibration);
  const setUi = useChessLens((state) => state.setUi);
  const { startShow, toggleDemo, toggleOperator } = useShow();
  const t = (key) => translate(lang, key);

  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => setFontsLoaded(true)).catch(() => setFontsLoaded(true));
    } else {
      setFontsLoaded(true);
    }
  }, []);

  const cameraLive = camera.status === 'live';
  const calibrationReady = Boolean(calibration);
  const engineReady = engine.status === 'ready';
  const fullscreenReady = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);
  const offlineReady = true;

  const allReady = cameraLive && calibrationReady && engineReady && fontsLoaded && fullscreenReady;

  const engineTone = engine.status === 'ready' ? 'good' : engine.status === 'error' ? 'bad' : 'warn';
  const engineLabel =
    engine.status === 'ready'
      ? t('engineReady')
      : engine.status === 'error'
        ? t('engineError')
        : t('engineLoading');

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

  function openOperator() {
    setUi({ splash: false });
    toggleOperator();
  }

  const cameraFitOk = !cameraLive || (cameraFit?.status !== 'poor');

  const checklistItems = [
    { label: t('checkCamera'), ok: cameraLive },
    { label: t('checkCalibration'), ok: calibrationReady },
    { label: t('checkCameraFit'), ok: cameraFitOk },
    { label: t('checkEngine'), ok: engineReady },
    { label: t('checkFonts'), ok: fontsLoaded },
    { label: t('checkFullscreen'), ok: fullscreenReady },
    { label: t('checkOffline'), ok: offlineReady },
  ];

  return (
    <AnimatePresence>
      {splash && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          className="fixed inset-0 z-50 overflow-y-auto bg-ink-950"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(212,168,79,0.16),transparent_55%),radial-gradient(ellipse_at_50%_100%,rgba(56,189,248,0.06),transparent_50%)]" />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)',
              backgroundSize: '64px 64px',
            }}
          />
          <div className="pointer-events-none absolute -right-24 top-1/2 hidden -translate-y-1/2 select-none font-chess text-[42rem] leading-none text-white/[0.018] lg:block">
            ♞
          </div>

          <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-10 text-center sm:py-14">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.05 }}
              className="flex flex-col items-center"
            >
              <div className="grid h-16 w-16 place-items-center rounded-2xl border border-brass-400/30 bg-gradient-to-br from-brass-400/20 to-transparent shadow-glow">
                <span className="font-chess text-4xl leading-none text-brass-300">♞</span>
              </div>
              <div className="mt-5 text-[10px] uppercase tracking-[0.42em] text-brass-300/70">
                {t('preShow')}
              </div>
              <h1 className="mt-3 text-[clamp(3rem,8vw,6.5rem)] font-black leading-[0.9] tracking-tight">
                Chess<span className="text-brass-300">Lens</span>
              </h1>
              <p className="mt-3 max-w-xl text-balance text-base font-medium text-white/55 sm:text-lg">
                {t('tagline')}
              </p>
            </motion.div>

            {/* Pre-Show System Checklist */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.12 }}
              className="mt-6 w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.035] p-5 backdrop-blur-sm text-left shadow-xl sm:p-6"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <span className="eyebrow">{t('preShowChecklist')}</span>
                <span
                  className={cx(
                    'chip text-[10px] uppercase tracking-wider',
                    allReady
                      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                      : 'border-amber-400/30 bg-amber-400/10 text-amber-300',
                  )}
                >
                  <span
                    className={cx(
                      'h-1.5 w-1.5 rounded-full',
                      allReady ? 'bg-emerald-400' : 'bg-amber-400',
                    )}
                  />
                  {allReady ? t('readyForShow') : t('attentionNeeded')}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {checklistItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2.5 rounded-lg border border-white/5 bg-ink-900/60 px-3 py-2 text-xs font-medium text-white/80"
                  >
                    <CheckIcon ok={item.ok} />
                    <span className={item.ok ? 'text-white/90' : 'text-amber-200/90'}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.2 }}
              className="mt-7 flex w-full max-w-md flex-col gap-2.5"
            >
              <button type="button" onClick={() => startShow(true)} className="btn btn-primary h-12 text-base font-bold shadow-lg shadow-brass-400/15">
                <PlayIcon />
                {t('startShow')}
              </button>
              <button type="button" onClick={() => toggleDemo(true)} className="btn h-11">
                {t('demoMode')}
              </button>
              <button type="button" onClick={openOperator} className="btn h-11">
                {t('openOperator')}
              </button>
              <button
                type="button"
                onClick={() => startShow(false)}
                className="mt-1 text-xs font-medium text-white/35 transition hover:text-white/70"
              >
                {t('startWithoutFullscreen')}
              </button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.45, delay: 0.3 }}
              className="mt-6 flex flex-wrap items-center justify-center gap-2"
            >
              <Pill tone={engineTone} dot>
                {engineLabel}
              </Pill>
              <Pill tone={cameraTone} dot>
                {cameraLabel}
              </Pill>
              <Pill tone={calibration ? 'brass' : 'warn'} dot>
                {calibration ? t('calibrationSaved') : t('notCalibrated')}
              </Pill>
              <Pill>{languageLabel(lang)}</Pill>
            </motion.div>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-3 text-[11px] text-white/25">
              <span className={cx('font-mono')}>{t('keyboardHint')}</span>
              <span className="h-1 w-1 rounded-full bg-white/15" />
              <span>{t('savedLocally')}</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
