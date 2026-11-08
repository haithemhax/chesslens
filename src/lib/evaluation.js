import { Chess } from 'chess.js';

// Large but finite value used to turn "mate in N" into centipawns. Keeping a
// small distance component means a faster mate is slightly better than a
// slower one, so losing a forced mate still shows up as a loss.
export const MATE_CP = 100000;

export const PIECE_VALUES = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

/**
 * Convert a raw UCI score (always from the side-to-move's point of view) into
 * a White-relative evaluation. `score` is {type: 'cp'|'mate', value}.
 */
export function normalizeEngineScore(score, turn) {
  if (!score) return null;
  const sign = turn === 'w' ? 1 : -1;
  if (score.type === 'mate') {
    const mate = score.value;
    return {
      cpWhite: sign * (mate === 0 ? MATE_CP : Math.sign(mate) * (MATE_CP - Math.abs(mate) * 10)),
      mateWhite: sign * mate,
      terminal: null,
      source: 'engine',
    };
  }
  return {
    cpWhite: sign * score.value,
    mateWhite: null,
    terminal: null,
    source: 'engine',
  };
}

/** Convert an evaluation to a single centipawn number from White's view. */
export function evalToCp(ev) {
  if (!ev) return 0;
  if (ev.mateWhite != null) {
    if (ev.terminal === 'checkmate') return ev.mateWhite > 0 ? MATE_CP : -MATE_CP;
    if (ev.mateWhite === 0) return 0;
    return Math.sign(ev.mateWhite) * (MATE_CP - Math.abs(ev.mateWhite) * 10);
  }
  return ev.cpWhite ?? 0;
}

/** White's expected score in percent, using the standard logistic curve. */
export function evalToWinProb(ev) {
  if (!ev) return 50;
  if (ev.terminal === 'checkmate') return ev.mateWhite > 0 ? 100 : 0;
  if (ev.mateWhite != null) return ev.mateWhite > 0 ? 100 : 0;
  const cp = ev.cpWhite ?? 0;
  return 100 / (1 + Math.exp(-0.00368208 * cp));
}

export function evalFromMaterial(fen) {
  try {
    const game = new Chess(fen);
    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? 'b' : 'w';
      return {
        cpWhite: winner === 'w' ? MATE_CP : -MATE_CP,
        mateWhite: winner === 'w' ? 1 : -1,
        terminal: 'checkmate',
        winner,
        source: 'material',
      };
    }
    if (game.isStalemate()) {
      return { cpWhite: 0, mateWhite: null, terminal: 'stalemate', source: 'material' };
    }
    if (game.isDraw()) {
      return { cpWhite: 0, mateWhite: null, terminal: 'draw', source: 'material' };
    }
    let cp = 0;
    for (const row of game.board()) {
      for (const piece of row) {
        if (!piece) continue;
        const value = PIECE_VALUES[piece.type] ?? 0;
        cp += piece.color === 'w' ? value : -value;
      }
    }
    return { cpWhite: cp * 100, mateWhite: null, terminal: null, source: 'material' };
  } catch {
    return { cpWhite: 0, mateWhite: null, terminal: null, source: 'material' };
  }
}

export function gameResult(game) {
  if (game.isCheckmate()) {
    return { over: true, type: 'checkmate', winner: game.turn() === 'w' ? 'b' : 'w' };
  }
  if (game.isStalemate()) return { over: true, type: 'stalemate', winner: null };
  if (game.isThreefoldRepetition()) return { over: true, type: 'repetition', winner: null };
  if (game.isInsufficientMaterial()) return { over: true, type: 'material', winner: null };
  if (game.isDraw()) return { over: true, type: 'draw', winner: null };
  return { over: false };
}

/** Synthesize a terminal evaluation without asking the engine. */
export function terminalEval(game) {
  const result = gameResult(game);
  if (!result.over) return null;
  if (result.type === 'checkmate') {
    return {
      cpWhite: result.winner === 'w' ? MATE_CP : -MATE_CP,
      mateWhite: result.winner === 'w' ? 1 : -1,
      terminal: 'checkmate',
      winner: result.winner,
      source: 'engine',
    };
  }
  return {
    cpWhite: 0,
    mateWhite: null,
    terminal: result.type === 'stalemate' ? 'stalemate' : 'draw',
    winner: null,
    source: 'engine',
  };
}

/** "＋1.4", "−0.7", "＋M5" or "#" for a finished mate. */
export function formatEval(ev) {
  if (!ev) return '—';
  if (ev.terminal === 'checkmate') return '#';
  if (ev.mateWhite != null) {
    return `${ev.mateWhite > 0 ? '+' : '−'}M${Math.abs(ev.mateWhite)}`;
  }
  const pawns = (ev.cpWhite ?? 0) / 100;
  if (Math.abs(pawns) < 0.05) return '0.0';
  const digits = Math.abs(pawns) >= 10 ? 0 : 1;
  return `${pawns > 0 ? '+' : '−'}${Math.abs(pawns).toFixed(digits)}`;
}

export function scoreForMover(ev, color) {
  const cp = evalToCp(ev);
  return color === 'w' ? cp : -cp;
}

export function mateForMover(ev, color) {
  if (!ev || ev.mateWhite == null) return null;
  return color === 'w' ? ev.mateWhite : -ev.mateWhite;
}
