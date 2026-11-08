import { Chess } from 'chess.js';
import { PIECE_VALUES, scoreForMover } from './evaluation.js';
import { squareToCell } from './homography.js';

// Move quality buckets. The thresholds are in centipawns from the mover's
// point of view, measured against the engine's evaluation of the position
// before the move (the standard "centipawn loss" approximation).
export const VERDICT_THRESHOLDS = {
  best: 10,
  excellent: 25,
  good: 50,
  inaccuracy: 100,
  mistake: 200,
};

export const VERDICT_ORDER = ['brilliant', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];

/**
 * A move is a candidate for "Brilliant" when the mover leaves more material
 * on the destination square than they capture, the opponent can take it, and
 * the engine still considers the move near-best and not losing. This is a
 * deliberately simple, explainable heuristic — it never runs on the critical
 * path.
 */
export function detectSacrifice(move, fenAfter) {
  if (!move || move.promotion) return false;
  const movedValue = PIECE_VALUES[move.piece] ?? 0;
  const capturedValue = move.captured ? PIECE_VALUES[move.captured] ?? 0 : 0;
  if (movedValue < 3) return false;
  if (movedValue - capturedValue < 2) return false;

  try {
    const game = new Chess(fenAfter);
    if (game.isCheckmate()) return true;
    const replies = game.moves({ verbose: true });
    return replies.some((reply) => reply.to === move.to && Boolean(reply.captured));
  } catch {
    return false;
  }
}

/**
 * Classify a move. `before` and `after` are White-relative evaluations.
 * Returns { verdict, cpLoss, sacrifice }.
 */
export function classifyMove({ before, after, move, preBestMove, forced = false }) {
  if (!move || !after) return { verdict: null, cpLoss: null, sacrifice: false };

  const beforeCp = scoreForMover(before, move.color);
  const afterCp = scoreForMover(after, move.color);
  const cpLoss = Math.max(0, Math.round(beforeCp - afterCp));

  const sacrifice = detectSacrifice(move, move.fenAfter);
  const nearBest = move.uci === preBestMove || cpLoss <= 15;

  let verdict;
  if (forced) {
    verdict = 'best';
  } else if (sacrifice && nearBest && cpLoss <= 25 && afterCp >= -80) {
    verdict = 'brilliant';
  } else if (move.uci === preBestMove || cpLoss <= VERDICT_THRESHOLDS.best) {
    verdict = 'best';
  } else if (cpLoss <= VERDICT_THRESHOLDS.excellent) {
    verdict = 'excellent';
  } else if (cpLoss <= VERDICT_THRESHOLDS.good) {
    verdict = 'good';
  } else if (cpLoss <= VERDICT_THRESHOLDS.inaccuracy) {
    verdict = 'inaccuracy';
  } else if (cpLoss <= VERDICT_THRESHOLDS.mistake) {
    verdict = 'mistake';
  } else {
    verdict = 'blunder';
  }

  // Audience sanity filter: avoid calling a move a blunder when the position
  // remains completely winning for the mover (e.g. +800 down to +550 cp).
  if (verdict === 'blunder' && afterCp >= 400) {
    verdict = afterCp >= 600 ? 'good' : 'inaccuracy';
  } else if (verdict === 'mistake' && afterCp >= 600) {
    verdict = 'good';
  }

  // If the mover retains a forced mate, do not penalize slightly longer mate sequences
  if (afterCp >= 50000 && (verdict === 'blunder' || verdict === 'mistake' || verdict === 'inaccuracy')) {
    verdict = 'good';
  }

  return { verdict, cpLoss, sacrifice };
}

/**
 * Detect hand or arm occlusion over the board.
 * A physical chess move changes at most 2 cells (regular move), 3 cells (en passant),
 * or 4 cells (castling). When a hand or forearm is over the board, it forms a
 * large connected cluster of changed cells and/or a high overall count.
 */
export function detectHandOrOcclusion(changedCells) {
  if (!Array.isArray(changedCells) || changedCells.length === 0) {
    return { occluded: false, maxClusterSize: 0, clusterCount: 0, reason: null };
  }

  // A single move never changes 8 or more cells on a physical board
  if (changedCells.length >= 8) {
    return {
      occluded: true,
      maxClusterSize: changedCells.length,
      clusterCount: 1,
      reason: `Too many changed cells (${changedCells.length} >= 8)`,
    };
  }

  // Find 8-connected components on the 8x8 grid
  const cellSet = new Set(changedCells);
  const visited = new Set();
  let maxClusterSize = 0;
  let clusterCount = 0;
  let maxClusterSpanR = 0;
  let maxClusterSpanC = 0;

  for (const cell of changedCells) {
    if (visited.has(cell)) continue;
    clusterCount += 1;
    let clusterSize = 0;
    let minR = 8;
    let maxR = -1;
    let minC = 8;
    let maxC = -1;

    const queue = [cell];
    visited.add(cell);

    while (queue.length > 0) {
      const current = queue.shift();
      clusterSize += 1;
      const r = Math.floor(current / 8);
      const c = current % 8;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;

      // 8-neighbourhood
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
            const neighbour = nr * 8 + nc;
            if (cellSet.has(neighbour) && !visited.has(neighbour)) {
              visited.add(neighbour);
              queue.push(neighbour);
            }
          }
        }
      }
    }

    if (clusterSize > maxClusterSize) {
      maxClusterSize = clusterSize;
      maxClusterSpanR = maxR - minR + 1;
      maxClusterSpanC = maxC - minC + 1;
    }
  }

  // An arm/hand typically forms a cluster of 5+ cells or a streak spanning across multiple ranks.
  // Castling occupies 4 cells along a single back rank (spanR = 1), which is a normal legal move.
  const isCastlingRank = maxClusterSize === 4 && maxClusterSpanR === 1;
  const isArmStreak = !isCastlingRank && (
    (maxClusterSize >= 4 && maxClusterSpanR >= 2 && maxClusterSpanC >= 2) ||
    (maxClusterSize >= 4 && maxClusterSpanR >= 3)
  );
  const isLargeBlob = maxClusterSize >= 5;
  const occluded = isLargeBlob || isArmStreak;

  return {
    occluded,
    maxClusterSize,
    clusterCount,
    reason: occluded
      ? isLargeBlob
        ? `Large cluster (${maxClusterSize} cells)`
        : `Arm streak across board (${maxClusterSize} cells, span ${maxClusterSpanR}x${maxClusterSpanC})`
      : null,
  };
}

/**
 * Score how well an observed set of changed cells matches the squares a legal
 * move is expected to change. Returns a normalized 0..1 score plus diagnostics.
 * One noisy cell is tolerated on each side of the comparison.
 */
export function scoreMoveAgainstChanges(move, changedCells, flipped) {
  const expected = new Set();

  expected.add(squareToCell(move.from, flipped));
  expected.add(squareToCell(move.to, flipped));

  if (move.flags.includes('k') || move.flags.includes('q')) {
    const rank = move.color === 'w' ? '1' : '8';
    if (move.flags.includes('k')) {
      expected.add(squareToCell(`h${rank}`, flipped));
      expected.add(squareToCell(`f${rank}`, flipped));
    } else {
      expected.add(squareToCell(`a${rank}`, flipped));
      expected.add(squareToCell(`d${rank}`, flipped));
    }
  }
  if (move.flags.includes('e')) {
    const file = move.to[0];
    const rank = move.color === 'w' ? Number(move.to[1]) - 1 : Number(move.to[1]) + 1;
    expected.add(squareToCell(`${file}${rank}`, flipped));
  }

  const observed = new Set(changedCells);
  let hits = 0;
  for (const cell of expected) if (observed.has(cell)) hits += 1;

  const expectedCount = expected.size;
  const observedCount = observed.size;
  const coverage = expectedCount ? hits / expectedCount : 0;
  const precision = observedCount ? hits / observedCount : 0;
  const f1 = coverage + precision > 0
    ? (2 * coverage * precision) / (coverage + precision)
    : 0;

  const extras = observedCount - hits;
  const missing = expectedCount - hits;
  // Allow 1 extra/missing without harsh penalty; for castling (4 cells), soften missing penalty
  const missingWeight = expectedCount >= 4 ? 0.2 : 0.3;
  const penalty = 0.22 * Math.max(0, extras - 1) + missingWeight * Math.max(0, missing - 1);

  return {
    score: Math.max(0, f1 - penalty),
    hits,
    expectedCount,
    observedCount,
    extras,
    missing,
    expectedCells: [...expected],
  };
}

/**
 * Find whether 1 legal move or a 2-ply sequence reconciles the current physical
 * board state with the software game position.
 */
export function findMatchingMoveSequence(gameFen, changedCells, flipped) {
  if (!gameFen || !Array.isArray(changedCells) || changedCells.length === 0) {
    return null;
  }

  let game;
  try {
    game = new Chess(gameFen);
  } catch {
    return null;
  }

  const legal1 = game.moves({ verbose: true });
  if (!legal1.length) return null;

  // 1. Try 1-ply moves
  const scored1 = legal1
    .map((move) => {
      const match = scoreMoveAgainstChanges(move, changedCells, flipped);
      return {
        sequence: [move],
        score: match.score,
        san: move.san,
        uci: `${move.from}${move.to}${move.promotion || ''}`,
      };
    })
    .sort((a, b) => b.score - a.score);

  if (scored1[0] && scored1[0].score >= 0.72) {
    const margin = scored1[0].score - (scored1[1]?.score ?? 0);
    return {
      type: '1-ply',
      moves: scored1[0].sequence,
      sanList: [scored1[0].san],
      score: scored1[0].score,
      margin,
      candidate: scored1[0],
    };
  }

  // 2. Try 2-ply sequences (e.g. White played, then Black played before camera settled)
  // Only evaluate top 1-ply candidates to keep execution fast (<10ms)
  const candidate2 = [];
  const top1Plies = scored1.slice(0, 10);

  for (const candidate of top1Plies) {
    const m1 = candidate.sequence[0];
    const testGame = new Chess(gameFen);
    testGame.move(m1);
    const legal2 = testGame.moves({ verbose: true });

    for (const m2 of legal2) {
      // Combined expected cells of move 1 and move 2
      const res1 = scoreMoveAgainstChanges(m1, changedCells, flipped);
      const res2 = scoreMoveAgainstChanges(m2, changedCells, flipped);
      const combinedExpected = new Set([...res1.expectedCells, ...res2.expectedCells]);

      let hits = 0;
      for (const cell of combinedExpected) {
        if (changedCells.includes(cell)) hits += 1;
      }
      const expCount = combinedExpected.size;
      const obsCount = changedCells.length;
      const cov = expCount ? hits / expCount : 0;
      const prec = obsCount ? hits / obsCount : 0;
      const f1 = cov + prec > 0 ? (2 * cov * prec) / (cov + prec) : 0;
      const extras = obsCount - hits;
      const missing = expCount - hits;
      const score = Math.max(0, f1 - 0.2 * Math.max(0, extras - 1) - 0.25 * Math.max(0, missing - 1));

      if (score >= 0.70) {
        candidate2.push({
          sequence: [m1, m2],
          sanList: [m1.san, m2.san],
          score,
        });
      }
    }
  }

  if (candidate2.length > 0) {
    candidate2.sort((a, b) => b.score - a.score);
    return {
      type: '2-ply',
      moves: candidate2[0].sequence,
      sanList: candidate2[0].sanList,
      score: candidate2[0].score,
      margin: candidate2[0].score - (candidate2[1]?.score ?? 0),
    };
  }

  return null;
}
