import { AnimatePresence, motion } from 'framer-motion';
import { useChessLens } from '../state/store.js';
import { translate } from '../i18n/translations.js';
import { useShow } from '../state/ShowProvider.jsx';

export default function FinalResultModal() {
  const status = useChessLens((state) => state.game.status);
  const resultDismissed = useChessLens((state) => state.game.resultDismissed);
  const ply = useChessLens((state) => state.game.ply);
  const eventName = useChessLens((state) => state.settings.eventName);
  const whitePlayer = useChessLens((state) => state.settings.whitePlayer);
  const blackPlayer = useChessLens((state) => state.settings.blackPlayer);
  const lang = useChessLens((state) => state.settings.lang);
  const dismissResult = useChessLens((state) => state.dismissResult);
  const { newGameAction } = useShow();
  const t = (key, vars) => translate(lang, key, vars);

  if (!status?.over || resultDismissed) return null;

  const winner = status.winner; // 'w', 'b', or null
  const isMate = status.type === 'checkmate';
  const score = winner === 'w' ? '1 — 0' : winner === 'b' ? '0 — 1' : '½ — ½';
  const totalMoves = Math.floor(ply / 2);

  let resultTitle = t('gameOver');
  let winnerSubtitle = '';

  if (isMate) {
    resultTitle = t('result.checkmate');
    winnerSubtitle = winner === 'w' ? t('whiteVictorious') : t('blackVictorious');
  } else if (status.type === 'stalemate') {
    resultTitle = t('result.stalemate');
    winnerSubtitle = t('gameDrawn');
  } else if (status.type === 'repetition') {
    resultTitle = t('result.repetition');
    winnerSubtitle = t('gameDrawn');
  } else if (status.type === 'material') {
    resultTitle = t('result.material');
    winnerSubtitle = t('gameDrawn');
  } else if (status.type === 'fifty') {
    resultTitle = t('result.fifty');
    winnerSubtitle = t('gameDrawn');
  } else {
    resultTitle = t('result.draw');
    winnerSubtitle = t('gameDrawn');
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.35 }}
        onClick={dismissResult}
        className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/90 p-4 backdrop-blur-md sm:p-8"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.94, opacity: 0, y: 12 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-3xl overflow-hidden rounded-3xl border border-brass-400/40 bg-gradient-to-b from-[#1c1611] via-ink-950 to-black p-8 text-center shadow-2xl sm:p-12"
        >
          {/* Ambient victory glow */}
          <div className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-brass-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl" />

          {/* Dismiss button */}
          <button
            type="button"
            onClick={dismissResult}
            className="absolute right-5 top-5 rounded-full p-2 text-white/40 transition hover:bg-white/10 hover:text-white"
            title={t('reviewBoard')}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Trophy badge */}
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-2xl border border-brass-400/50 bg-gradient-to-br from-brass-400/30 to-brass-400/5 shadow-glow">
            <span className="font-chess text-5xl text-brass-300">♚</span>
          </div>

          <div className="mt-4 text-xs font-semibold uppercase tracking-[0.25em] text-brass-400/80">
            {eventName || t('appName')} · {t('finalResult')}
          </div>

          <h2 className="mt-2 text-balance font-black tracking-tight text-white text-[clamp(2.5rem,5.5vw,4rem)]">
            {resultTitle}
          </h2>

          <p className="mt-2 text-lg font-bold text-brass-200/90 sm:text-xl">
            {winnerSubtitle}
          </p>

          {/* Score Badge */}
          <div className="my-6 inline-block rounded-2xl border border-brass-400/40 bg-black/50 px-8 py-3 shadow-inner">
            <span className="font-mono text-4xl font-black tracking-widest text-white sm:text-5xl">
              {score}
            </span>
          </div>

          {/* Players matchup recap */}
          <div className="mx-auto flex max-w-lg items-center justify-around gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-left">
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">{t('white')}</div>
              <div className="font-bold text-white sm:text-lg">{whitePlayer || t('white')}</div>
            </div>
            <div className="text-xs font-bold text-brass-400">VS</div>
            <div className="text-right">
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">{t('black')}</div>
              <div className="font-bold text-white sm:text-lg">{blackPlayer || t('black')}</div>
            </div>
          </div>

          <p className="mt-4 text-xs text-white/40">
            {t('decidedInMoves', { n: totalMoves })}
          </p>

          {/* Buttons */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <button
              type="button"
              onClick={dismissResult}
              className="btn px-6 py-2.5 text-sm font-semibold"
            >
              {t('reviewBoard')}
            </button>
            <button
              type="button"
              onClick={() => {
                newGameAction();
              }}
              className="btn btn-primary px-6 py-2.5 text-sm font-bold shadow-lg shadow-brass-400/15"
            >
              {t('newGame')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
