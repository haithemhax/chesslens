import { AnimatePresence, motion } from 'framer-motion';
import { useChessLens } from '../state/store.js';
import { translate } from '../i18n/translations.js';
import { formatEval } from '../lib/evaluation.js';
import { uciToSan } from '../lib/chessHelpers.js';
import { cx, VERDICT_TONE } from './Ui.jsx';

function resultLabel(t, status) {
  if (status.type === 'checkmate') return t('checkmate');
  if (status.type === 'stalemate') return t('stalemate');
  if (status.type === 'repetition') return t('drawByRepetition');
  if (status.type === 'material') return t('drawByMaterial');
  if (status.type === 'fifty') return t('drawByFifty');
  return t('draw');
}

export default function VerdictBanner() {
  const lastRecord = useChessLens((state) => state.game.moves[state.game.moves.length - 1] || null);
  const status = useChessLens((state) => state.game.status);
  const thinking = useChessLens((state) => state.game.thinking);
  const bestMove = useChessLens((state) => state.game.bestMove);
  const fen = useChessLens((state) => state.game.fen);
  const lang = useChessLens((state) => state.settings.lang);
  const t = (key, vars) => translate(lang, key, vars);

  const verdict = lastRecord?.verdict || null;
  const sanIsolate = (san) => (lang === 'ar' && san ? `\u2066${san}\u2069` : san || '');
  const moveLabel = lastRecord
    ? `${lastRecord.color === 'w' ? t('white') : t('black')} · ${sanIsolate(lastRecord.san)}`
    : '';
  const suggestion = !status.over && bestMove ? uciToSan(fen, bestMove) || bestMove : null;

  let key = 'waiting';
  let title = t('waiting');
  let subtitle = t('waitingHint');
  let tone = 'text-white/80';
  let eyebrow = t('status');

  if (status.over) {
    key = `result-${status.type}-${lastRecord?.id || 'none'}`;
    title = resultLabel(t, status);
    subtitle = status.winner
      ? t(status.winner === 'w' ? 'whiteWins' : 'blackWins')
      : (lastRecord ? sanIsolate(lastRecord.san) : '');
    tone = 'text-brass-200';
    eyebrow = t('gameOver');
  } else if (verdict) {
    key = `${lastRecord?.id}-${verdict}`;
    title = t(`verdict.${verdict}`);
    subtitle = moveLabel;
    tone = VERDICT_TONE[verdict] || 'text-white';
    eyebrow = t('lastMove');
  } else if (lastRecord) {
    // When move is played, show the move immediately without flickering "THINKING"
    key = `${lastRecord.id}-pending`;
    title = sanIsolate(lastRecord.san);
    subtitle = `${moveLabel} · ${t('thinking')}`;
    tone = 'text-white/85';
    eyebrow = t('lastMove');
  } else if (thinking) {
    key = 'thinking-start';
    title = t('thinking');
    subtitle = t('waitingHint');
    tone = 'text-white/50';
    eyebrow = t('status');
  }

  const isBrilliant = verdict === 'brilliant' && !status.over;

  return (
    <div className="panel relative flex h-full flex-col justify-between overflow-hidden p-4 sm:p-5">
      <div className="pointer-events-none absolute -right-6 -top-8 select-none font-chess text-[10rem] leading-none text-white/[0.025]">
        ♞
      </div>

      <div className="relative flex flex-1 flex-col justify-between">
        <div>
          <div className="flex items-center justify-between gap-3">
            <span className="eyebrow">{eyebrow}</span>
            {lastRecord && (
              <span className="font-mono text-[11px] text-white/30">
                {formatEval(lastRecord.evalBefore)} → {formatEval(lastRecord.evalAfter)}
              </span>
            )}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
              className="mt-1"
            >
              <h2
                className={cx(
                  'text-balance font-black uppercase leading-[0.95] tracking-tight',
                  'text-[clamp(1.5rem,3.4vh,3rem)]',
                  isBrilliant
                    ? 'bg-gradient-to-r from-brass-300 via-white to-brass-400 bg-clip-text text-transparent'
                    : tone,
                  thinking && !verdict && !status.over && 'animate-pulse',
                )}
              >
                {title}
              </h2>
              {subtitle && (
                <p className="mt-1.5 line-clamp-2 text-sm font-medium text-white/45 lg:text-base">
                  {subtitle}
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/35">
          {lastRecord?.cpLoss != null && verdict && (
            <span>
              {t('evaluation')} −{lastRecord.cpLoss} cp
            </span>
          )}
          {suggestion && (
            <span>
              {t('bestMove')}: <span className="font-mono text-brass-200/80">{sanIsolate(suggestion)}</span>
            </span>
          )}
          {status.over && lastRecord && (
            <span dir="ltr" className="font-mono text-white/40">{lastRecord.san}</span>
          )}
        </div>
      </div>
    </div>
  );
}
