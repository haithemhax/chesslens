import { motion } from 'framer-motion';
import { currentEval, useChessLens } from '../state/store.js';
import { evalToWinProb, formatEval } from '../lib/evaluation.js';
import { translate } from '../i18n/translations.js';
import { cx } from './Ui.jsx';

export default function EvalBar() {
  const evaluation = useChessLens((state) => currentEval(state));
  const thinking = useChessLens((state) => state.game.thinking);
  const lang = useChessLens((state) => state.settings.lang);
  const t = (key) => translate(lang, key);

  const whiteProb = evaluation ? evalToWinProb(evaluation) : 50;
  const label = formatEval(evaluation);

  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
        {t('black')}
      </span>

      <div
        className="relative w-8 overflow-hidden rounded-full border border-white/10 bg-ink-800 shadow-inner"
        style={{ height: 'clamp(280px, 62vh, 660px)' }}
        aria-label={`${t('evaluation')} ${label}`}
      >
        <motion.div
          className="absolute inset-x-0 top-0 bg-gradient-to-b from-[#0a0c11] via-ink-850 to-ink-700"
          animate={{ height: `${100 - whiteProb}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
        <motion.div
          className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#f8f0de] via-[#e9dcc1] to-[#cbb994]"
          animate={{ height: `${whiteProb}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
        <div className="absolute inset-x-0 top-1/2 h-px bg-brass-400/60" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={cx(
              'rounded bg-ink-950/90 px-1.5 py-1 font-mono text-[10px] font-semibold text-brass-200 shadow',
              thinking && 'animate-pulse',
            )}
          >
            {label}
          </span>
        </div>
      </div>

      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">
        {t('white')}
      </span>
    </div>
  );
}
