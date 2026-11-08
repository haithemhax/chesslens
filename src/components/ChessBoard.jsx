import { useCallback, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { useChessLens } from '../state/store.js';
import { useShow } from '../state/ShowProvider.jsx';
import { translate } from '../i18n/translations.js';
import { cx } from './Ui.jsx';

const GLYPHS = {
  p: '♟',
  n: '♞',
  b: '♝',
  r: '♜',
  q: '♛',
  k: '♚',
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function parseBoard(fen) {
  try {
    const game = new Chess(fen);
    return { board: game.board(), checkSquare: findCheckSquare(game), turn: game.turn() };
  } catch {
    const game = new Chess();
    return { board: game.board(), checkSquare: null, turn: 'w' };
  }
}

function findCheckSquare(game) {
  if (!game.inCheck()) return null;
  const turn = game.turn();
  for (const row of game.board()) {
    for (const piece of row) {
      if (piece && piece.type === 'k' && piece.color === turn) {
        return piece.square || null;
      }
    }
  }
  return null;
}

export default function ChessBoard() {
  const fen = useChessLens((state) => state.game.fen);
  const lastMove = useChessLens((state) => state.game.lastMove);
  const flip = useChessLens((state) => state.settings.flip);
  const lang = useChessLens((state) => state.settings.lang);
  const demo = useChessLens((state) => state.demo);
  const settings = useChessLens((state) => state.settings);
  const setDemo = useChessLens((state) => state.setDemo);

  const { playBoardMove, newGame, undo, flipBoard, toggleDemo } = useShow();

  const t = (key, vars) => translate(lang, key, vars);

  const { board, checkSquare, turn } = useMemo(() => parseBoard(fen), [fen]);

  const [selectedSquare, setSelectedSquare] = useState(null);

  // Calculate legal moves for selected square (Chess.com style destination dots)
  const legalMoves = useMemo(() => {
    if (!selectedSquare) return [];
    try {
      const game = new Chess(fen);
      return game.moves({ square: selectedSquare, verbose: true });
    } catch {
      return [];
    }
  }, [fen, selectedSquare]);

  const legalToMap = useMemo(() => {
    const map = new Map();
    for (const m of legalMoves) {
      map.set(m.to, m);
    }
    return map;
  }, [legalMoves]);

  const isComputerTurn =
    demo.active &&
    demo.mode === 'vs-computer' &&
    turn !== (demo.playerColor || 'w');

  // Handle clicking on a square
  const handleSquareClick = useCallback(
    (square, piece) => {
      // If it's a legal move destination for currently selected piece, play it!
      if (legalToMap.has(square)) {
        const move = legalToMap.get(square);
        const promotion = move.promotion || (move.piece === 'p' && (square[1] === '8' || square[1] === '1') ? (settings.promotionChoice || 'q') : undefined);
        playBoardMove(selectedSquare, square, promotion);
        setSelectedSquare(null);
        return;
      }

      // If clicking own piece, select it (unless it's the computer's turn in vs-computer mode)
      if (piece && piece.color === turn) {
        if (isComputerTurn) return;
        setSelectedSquare(square === selectedSquare ? null : square);
        return;
      }

      // Otherwise deselect
      setSelectedSquare(null);
    },
    [legalToMap, selectedSquare, playBoardMove, turn, isComputerTurn, settings.promotionChoice],
  );

  // Drag and drop handlers
  const handleDragStart = (e, square, piece) => {
    if (isComputerTurn || piece?.color !== turn) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', square);
    setSelectedSquare(square);
  };

  const handleDrop = (e, targetSquare) => {
    e.preventDefault();
    const fromSquare = e.dataTransfer.getData('text/plain');
    if (!fromSquare || fromSquare === targetSquare) return;

    try {
      const game = new Chess(fen);
      const legals = game.moves({ square: fromSquare, verbose: true });
      const match = legals.find((m) => m.to === targetSquare);
      if (match) {
        const promotion = match.promotion || (match.piece === 'p' && (targetSquare[1] === '8' || targetSquare[1] === '1') ? (settings.promotionChoice || 'q') : undefined);
        playBoardMove(fromSquare, targetSquare, promotion);
        setSelectedSquare(null);
      }
    } catch {
      /* ignore invalid drops */
    }
  };

  const cells = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const sourceRow = flip ? 7 - row : row;
      const sourceCol = flip ? 7 - col : col;
      const file = sourceCol;
      const rank = 8 - sourceRow;
      const square = `${FILES[file]}${rank}`;
      const light = (file + rank) % 2 === 0;
      const piece = board[sourceRow]?.[sourceCol] || null;
      const isLast = lastMove && (lastMove.from === square || lastMove.to === square);
      const isCheck = checkSquare === square;
      const isSelected = selectedSquare === square;
      const isLegalDest = legalToMap.has(square);
      const isLegalCapture = isLegalDest && (piece != null || legalToMap.get(square)?.flags?.includes('e'));

      cells.push({
        square,
        light,
        piece,
        isLast,
        isCheck,
        isSelected,
        isLegalDest,
        isLegalCapture,
      });
    }
  }

  const rankLabels = Array.from({ length: 8 }, (_, index) => (flip ? index + 1 : 8 - index));
  const fileLabels = Array.from({ length: 8 }, (_, index) => FILES[flip ? 7 - index : index]);

  return (
    <div className="board-size relative flex flex-col gap-2">
      {/* Interactive Controls Bar for Demo/Play mode */}
      {demo.active && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brass-400/30 bg-ink-950/90 px-3 py-1.5 text-xs shadow-board backdrop-blur-md">
          {/* Mode Selector */}
          <div className="flex items-center gap-1">
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
                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition',
                  (demo.mode || 'vs-computer') === m.id
                    ? 'border border-brass-400/50 bg-brass-400/20 text-brass-200'
                    : 'text-white/50 hover:bg-white/5 hover:text-white/80',
                )}
              >
                <span>{m.icon}</span>
                <span className="hidden sm:inline">{m.label}</span>
              </button>
            ))}
          </div>

          {/* Player color toggle when playing vs computer */}
          {demo.mode === 'vs-computer' && (
            <div className="flex items-center gap-1 text-[11px]">
              <span className="text-white/40">{t('playAsWhite')}:</span>
              <button
                type="button"
                onClick={() => {
                  const nextColor = demo.playerColor === 'b' ? 'w' : 'b';
                  setDemo({ playerColor: nextColor });
                  if ((nextColor === 'b' && !flip) || (nextColor === 'w' && flip)) {
                    flipBoard();
                  }
                  newGame();
                }}
                className="chip border-brass-400/40 bg-brass-400/15 font-semibold text-brass-200 hover:border-brass-300"
              >
                {demo.playerColor === 'b' ? '⚫ Black' : '⚪ White'}
              </button>
            </div>
          )}

          {/* Quick buttons: New Game, Undo, Flip */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={newGame}
              title={t('resetGame')}
              className="btn px-2 py-1 text-[11px] text-white/70 hover:text-white"
            >
              ↺ <span className="hidden sm:inline">{t('resetGame')}</span>
            </button>
            <button
              type="button"
              onClick={undo}
              title={t('undoMove')}
              className="btn px-2 py-1 text-[11px] text-white/70 hover:text-white"
            >
              ⤺ <span className="hidden sm:inline">{t('undoMove')}</span>
            </button>
            <button
              type="button"
              onClick={flipBoard}
              title={t('flipBoard')}
              className="btn px-2 py-1 text-[11px] text-white/70 hover:text-white"
            >
              ⇅
            </button>
          </div>
        </div>
      )}

      {/* Main Chess Board Frame */}
      <div
        dir="ltr"
        className="rounded-[1.5rem] border border-brass-400/20 bg-gradient-to-br from-[#2b2218] via-board-rim to-[#15100b] p-2.5 shadow-board sm:p-3"
      >
        <div className="flex gap-1.5">
          {/* Rank Numbers (1-8) */}
          <div className="grid w-4 grid-rows-8 py-[2px] text-center font-mono text-[10px] leading-none text-brass-200/45">
            {rankLabels.map((rank) => (
              <span key={rank} className="grid place-items-center">
                {rank}
              </span>
            ))}
          </div>

          {/* 8x8 Board Grid with Chess.com style highlights & dots */}
          <div className="grid aspect-square flex-1 grid-cols-8 grid-rows-8 overflow-hidden rounded-md ring-1 ring-black/40">
            {cells.map(
              ({
                square,
                light,
                piece,
                isLast,
                isCheck,
                isSelected,
                isLegalDest,
                isLegalCapture,
              }) => (
                <div
                  key={square}
                  onClick={() => handleSquareClick(square, piece)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, square)}
                  className={cx(
                    'relative flex select-none items-center justify-center transition-colors',
                    light ? 'bg-board-light' : 'bg-board-dark',
                    isSelected && 'bg-[#f7ec74]/55 ring-2 ring-brass-300 ring-inset',
                    isLast && !isSelected && 'bg-[#baca2b]/35',
                    (piece?.color === turn && !isComputerTurn) || isLegalDest
                      ? 'cursor-pointer'
                      : 'cursor-default',
                  )}
                >
                  {/* Check highlight */}
                  {isCheck && (
                    <span className="pointer-events-none absolute inset-0 animate-pulse bg-red-500/35" />
                  )}

                  {/* Chess.com Legal Move Destination Indicators */}
                  {isLegalDest && !isLegalCapture && (
                    <span className="pointer-events-none z-20 h-3.5 w-3.5 rounded-full bg-black/30 ring-1 ring-white/20 sm:h-4 sm:w-4" />
                  )}

                  {isLegalCapture && (
                    <span className="pointer-events-none absolute inset-1 z-20 rounded-full border-[3.5px] border-black/30 sm:border-4" />
                  )}

                  {/* Piece Glyph */}
                  {piece && (
                    <span
                      draggable={piece.color === turn && !isComputerTurn}
                      onDragStart={(e) => handleDragStart(e, square, piece)}
                      className={cx(
                        'relative z-10 leading-none transition-transform active:scale-95',
                        piece.color === 'w' ? 'text-[#f7eeda]' : 'text-[#0b0d12]',
                      )}
                      style={{
                        fontFamily: "'Noto Sans Symbols 2', 'Segoe UI Symbol', serif",
                        fontSize: 'clamp(1.25rem, 6.4vmin, 3.9rem)',
                        textShadow:
                          piece.color === 'w'
                            ? '0 2px 2px rgba(0,0,0,.65), 0 6px 14px rgba(0,0,0,.35)'
                            : '0 1px 0 rgba(255,255,255,.35), 0 6px 14px rgba(0,0,0,.5)',
                        WebkitTextStroke:
                          piece.color === 'w'
                            ? '1px rgba(0,0,0,.35)'
                            : '1px rgba(240,217,168,.35)',
                      }}
                    >
                      {GLYPHS[piece.type] || ''}
                    </span>
                  )}
                </div>
              ),
            )}
          </div>
        </div>

        {/* File Letters (a-h) */}
        <div className="ml-[22px] mt-1 grid grid-cols-8 text-center font-mono text-[10px] leading-none text-brass-200/45">
          {fileLabels.map((file) => (
            <span key={file}>{file}</span>
          ))}
        </div>
      </div>

      {/* Turn & Status Hint */}
      <div className="flex items-center justify-between px-2 text-[11px] text-white/40">
        <div className="flex items-center gap-2">
          <span
            className={cx(
              'h-2 w-2 rounded-full',
              turn === 'w' ? 'bg-white ring-1 ring-white/40' : 'bg-ink-950 ring-1 ring-white/30',
            )}
          />
          <span className="font-medium text-white/80">
            {turn === 'w' ? t('turnWhite') : t('turnBlack')}
          </span>
          {isComputerTurn && (
            <span className="animate-pulse text-brass-300">({t('computerThinking')})</span>
          )}
        </div>

        {!demo.active && (
          <button
            type="button"
            onClick={() => toggleDemo(true)}
            className="text-[10px] text-brass-300/70 underline underline-offset-2 transition hover:text-brass-200"
          >
            {t('demoMode')} ({t('vsComputer')})
          </button>
        )}
      </div>
    </div>
  );
}
