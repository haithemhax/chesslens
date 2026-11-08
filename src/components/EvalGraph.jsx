import { useMemo } from 'react';
import { useChessLens } from '../state/store.js';
import { evalToWinProb, formatEval } from '../lib/evaluation.js';
import { translate } from '../i18n/translations.js';

const WIDTH = 320;
const HEIGHT = 180;
const PAD = 14;

export default function EvalGraph() {
  const history = useChessLens((state) => state.game.evalHistory);
  const lang = useChessLens((state) => state.settings.lang);
  const t = (key) => translate(lang, key);

  const { line, area, lastPoint, lastEval } = useMemo(() => {
    const points = [];
    let latest = null;
    history.forEach((entry, index) => {
      if (!entry?.eval) return;
      latest = entry.eval;
      points.push({ index, prob: evalToWinProb(entry.eval) });
    });

    const maxIndex = Math.max(1, history.length - 1);
    const mapped = points.map((point) => [
      PAD + (point.index / maxIndex) * (WIDTH - 2 * PAD),
      PAD + (1 - point.prob / 100) * (HEIGHT - 2 * PAD),
    ]);

    if (!mapped.length) {
      mapped.push([PAD, HEIGHT / 2], [WIDTH - PAD, HEIGHT / 2]);
    } else if (mapped.length === 1) {
      mapped.unshift([PAD, mapped[0][1]]);
    }

    const path = mapped
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');

    return {
      line: path,
      area: `${path} L${mapped[mapped.length - 1][0].toFixed(1)},${HEIGHT - PAD} L${mapped[0][0].toFixed(1)},${HEIGHT - PAD} Z`,
      lastPoint: mapped[mapped.length - 1],
      lastEval: latest,
    };
  }, [history]);

  return (
    <div className="panel flex h-full min-h-[150px] flex-col overflow-hidden">
      <div className="panel-header py-2.5">
        <span className="eyebrow">{t('evaluation')}</span>
        <span className="font-mono text-xs text-brass-200">{formatEval(lastEval)}</span>
      </div>

      <div className="relative min-h-0 flex-1 px-2 pb-2 pt-3">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label={t('evaluation')}
        >
          <defs>
            <linearGradient id="evalFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e6c079" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#e6c079" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1={PAD}
              x2={WIDTH - PAD}
              y1={PAD + fraction * (HEIGHT - 2 * PAD)}
              y2={PAD + fraction * (HEIGHT - 2 * PAD)}
              stroke="rgba(255,255,255,0.07)"
              strokeWidth="1"
            />
          ))}
          <line
            x1={PAD}
            x2={WIDTH - PAD}
            y1={HEIGHT / 2}
            y2={HEIGHT / 2}
            stroke="rgba(230,192,121,0.35)"
            strokeDasharray="4 5"
            strokeWidth="1"
          />

          <path d={area} fill="url(#evalFill)" />
          <path
            d={line}
            fill="none"
            stroke="#f0d9a8"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {lastPoint && (
            <>
              <circle cx={lastPoint[0]} cy={lastPoint[1]} r="5" fill="#f0d9a8" opacity="0.25" />
              <circle cx={lastPoint[0]} cy={lastPoint[1]} r="2.5" fill="#f8f0de" />
            </>
          )}
        </svg>

        <span className="pointer-events-none absolute left-3 top-1 text-[9px] uppercase tracking-widest text-white/30">
          {t('white')}
        </span>
        <span className="pointer-events-none absolute bottom-1 left-3 text-[9px] uppercase tracking-widest text-white/30">
          {t('black')}
        </span>
      </div>
    </div>
  );
}
