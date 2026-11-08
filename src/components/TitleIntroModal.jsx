import { AnimatePresence, motion } from 'framer-motion';
import { useChessLens } from '../state/store.js';
import { translate } from '../i18n/translations.js';

export default function TitleIntroModal() {
  const show = useChessLens((state) => state.settings.showIntroScreen);
  const eventName = useChessLens((state) => state.settings.eventName);
  const whitePlayer = useChessLens((state) => state.settings.whitePlayer);
  const blackPlayer = useChessLens((state) => state.settings.blackPlayer);
  const lang = useChessLens((state) => state.settings.lang);
  const setShowIntroScreen = useChessLens((state) => state.setShowIntroScreen);
  const t = (key, vars) => translate(lang, key, vars);

  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        onClick={() => setShowIntroScreen(false)}
        className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/90 p-4 backdrop-blur-md sm:p-8"
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.94, opacity: 0, y: 12 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-4xl overflow-hidden rounded-3xl border border-brass-400/30 bg-gradient-to-b from-ink-900 via-ink-950 to-black p-8 text-center shadow-2xl sm:p-12"
        >
          {/* Ambient lighting glows */}
          <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-brass-400/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />

          {/* Dismiss button */}
          <button
            type="button"
            onClick={() => setShowIntroScreen(false)}
            className="absolute right-5 top-5 rounded-full p-2 text-white/40 transition hover:bg-white/10 hover:text-white"
            title={t('close')}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Event Eyebrow & Title */}
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-brass-400/40 bg-brass-400/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-brass-300">
            <span className="font-chess text-base">♞</span> {t('liveShow')}
          </div>

          <h1 className="mt-3 text-balance font-black tracking-tight text-white text-[clamp(2.5rem,6vw,4.5rem)]">
            {eventName || t('appName')}
          </h1>

          <div className="my-8 h-px w-full bg-gradient-to-r from-transparent via-brass-400/40 to-transparent" />

          {/* Matchup Players */}
          <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-[1fr_auto_1fr] sm:gap-8">
            {/* White Player */}
            <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-inner">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/30 bg-gradient-to-b from-white to-gray-200 text-ink-950 shadow-md">
                <span className="font-chess text-4xl">♔</span>
              </div>
              <span className="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                {t('white')}
              </span>
              <span className="mt-1 line-clamp-2 text-2xl font-black text-white sm:text-3xl">
                {whitePlayer || t('white')}
              </span>
            </div>

            {/* VS Badge */}
            <div className="flex flex-col items-center justify-center">
              <div className="grid h-12 w-12 place-items-center rounded-full border border-brass-400/40 bg-brass-400/15 font-black text-brass-300 shadow-glow">
                VS
              </div>
            </div>

            {/* Black Player */}
            <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-inner">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/20 bg-gradient-to-b from-ink-800 to-ink-950 text-white shadow-md">
                <span className="font-chess text-4xl text-brass-200">♚</span>
              </div>
              <span className="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                {t('black')}
              </span>
              <span className="mt-1 line-clamp-2 text-2xl font-black text-white sm:text-3xl">
                {blackPlayer || t('black')}
              </span>
            </div>
          </div>

          {/* Action CTA */}
          <div className="mt-10 flex flex-col items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setShowIntroScreen(false)}
              className="btn btn-primary px-8 py-3 text-base font-bold shadow-lg shadow-brass-400/15"
            >
              {t('startShow')}
            </button>
            <span className="text-xs text-white/40">
              {t('operatorHint')}
            </span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
