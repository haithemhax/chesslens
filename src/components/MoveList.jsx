import { useEffect, useMemo, useRef } from 'react';
import { useChessLens } from '../state/store.js';
import { translate } from '../i18n/translations.js';
import { cx, VERDICT_DOT } from './Ui.jsx';

export default function MoveList() {
  const moves = useChessLens((state) => state.game.moves);
  const lang = useChessLens((state) => state.settings.lang);
  const t = (key) => translate(lang, key);
  const scrollRef = useRef(null);

  const rows = useMemo(() => {
    const grouped = [];
    for (let index = 0; index < moves.length; index += 2) {
      grouped.push({
        number: index / 2 + 1,
        white: moves[index] || null,
        black: moves[index + 1] || null,
      });
    }
    return grouped;
  }, [moves]);

  const lastId = moves[moves.length - 1]?.id;

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [moves.length]);

  return (
    <div className="panel flex h-full min-h-[200px] flex-col overflow-hidden">
      <div className="panel-header py-2.5">
        <span className="eyebrow">{t('moves')}</span>
        <span className="font-mono text-[11px] text-white/30">{moves.length}</span>
      </div>

      <div ref={scrollRef} className="scroll-area flex-1 px-2 py-2">
        {rows.length === 0 ? (
          <div className="grid h-full place-items-center px-4 text-center">
            <div>
              <div className="font-chess text-4xl text-white/10">♞</div>
              <p className="mt-2 text-sm text-white/35">{t('moveListEmpty')}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            {rows.map((row) => (
              <div
                key={row.number}
                dir="ltr"
                className="grid grid-cols-[2rem_1fr_1fr] items-center gap-1 rounded-lg px-1.5 py-1 text-sm"
              >
                <span className="font-mono text-[11px] text-white/25">{row.number}</span>
                {[row.white, row.black].map((move, index) => (
                  <span
                    key={move?.id || `${row.number}-${index}`}
                    className={cx(
                      'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5',
                      move?.id === lastId
                        ? 'bg-brass-400/10 text-brass-100 ring-1 ring-inset ring-brass-400/20'
                        : 'text-white/70',
                    )}
                  >
                    {move ? (
                      <>
                        {move.verdict && (
                          <span
                            className={cx(
                              'h-1.5 w-1.5 shrink-0 rounded-full',
                              VERDICT_DOT[move.verdict] || 'bg-white/20',
                            )}
                          />
                        )}
                        <span dir="ltr" className="truncate font-mono text-[13px] font-medium tracking-tight">
                          {move.san}
                        </span>
                      </>
                    ) : (
                      <span className="text-white/15">…</span>
                    )}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
