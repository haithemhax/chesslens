import { Chess } from 'chess.js';

/** Convert a UCI move from a FEN to SAN, for engine suggestions. */
export function uciToSan(fen, uci) {
  if (!fen || !uci || uci === '(none)') return null;
  try {
    const game = new Chess(fen);
    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return move?.san || null;
  } catch {
    return null;
  }
}

/**
 * Accept SAN ("Nf3", "O-O") or UCI ("g1f3", "e7e8q") from the operator.
 * Returns a verbose chess.js move or null.
 */
export function parseMoveInput(fen, input) {
  const text = String(input || '').trim();
  if (!text) return null;

  const game = new Chess(fen);
  try {
    return game.move(text);
  } catch {
    /* try other formats */
  }

  const normalized = text.replace(/0/g, 'O').replace(/\s+/g, '');
  try {
    return game.move(normalized);
  } catch {
    /* try UCI */
  }

  const uci = text.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/i);
  if (uci) {
    try {
      return game.move({
        from: uci[1].toLowerCase(),
        to: uci[2].toLowerCase(),
        promotion: uci[3] ? uci[3].toLowerCase() : undefined,
      });
    } catch {
      return null;
    }
  }

  return null;
}

/** A short SAN list used by the LLM prompt and the debug panel. */
export function sanHistory(fen, moves) {
  try {
    const game = new Chess(fen);
    return moves.map((uci) => {
      const move = game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      return move?.san;
    });
  } catch {
    return [];
  }
}
