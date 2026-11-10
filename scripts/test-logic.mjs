import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  applyHomography,
  buildWarpMap,
  cellToSquare,
  computeHomography,
  invertHomography,
  squareToCell,
} from '../src/lib/homography.js';
import {
  evalFromMaterial,
  evalToCp,
  evalToWinProb,
  formatEval,
  gameResult,
  normalizeEngineScore,
  scoreForMover,
} from '../src/lib/evaluation.js';
import {
  classifyMove,
  detectHandOrOcclusion,
  findMatchingMoveSequence,
  scoreMoveAgainstChanges,
} from '../src/lib/classification.js';
import { parseMoveInput, uciToSan } from '../src/lib/chessHelpers.js';
import { makeCommentary, makeGameStartCommentary } from '../src/commentary/commentary.js';
import { OPERA_GAME } from '../src/demo/operaGame.js';
import { translate } from '../src/i18n/translations.js';
import { formatFilename, sanitizeFilenamePart } from '../src/recording/RecordingController.js';
import { sanitizeSettings, persistableSettings } from '../src/state/store.js';
import { VisionRouter, VISION_MODES } from '../src/vision/VisionRouter.js';
import { VisionBackend } from '../src/vision/VisionBackend.js';
import { JsVisionBackend } from '../src/vision/JsVisionBackend.js';
import { PythonVisionBackend } from '../src/vision/PythonVisionBackend.js';
import {
  CAMERA_FIT_CONFIG,
  computeQuadrilateralMetrics,
  computeWarpedImageMetrics,
  evaluateCameraFit,
} from '../src/lib/cameraFit.js';
import { warpBoard512, WARP_SIZE_V2 } from '../src/vision/v2/warp.js';
import {
  computeGridAlignmentScoreFromWarp,
  computeDirectGridScore,
  refineCorners,
} from '../src/vision/v2/cornerRefinement.js';
import { V2VisionBackend } from '../src/vision/v2/V2VisionBackend.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

function near(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

console.log('ChessLens logic checks');

test('homography maps the calibration square to the top-down square', () => {
  const src = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const dst = [
    { x: 0, y: 0 },
    { x: 511, y: 0 },
    { x: 511, y: 511 },
    { x: 0, y: 511 },
  ];
  const h = computeHomography(src, dst);
  assert.ok(h);
  const point = applyHomography(h, 50, 50);
  near(point.x, 255.5, 1e-3);
  near(point.y, 255.5, 1e-3);

  const inverse = invertHomography(h);
  const back = applyHomography(inverse, 255.5, 255.5);
  near(back.x, 50, 1e-3);
  near(back.y, 50, 1e-3);
});

test('warp map covers all 512x512 destination pixels', () => {
  const map = buildWarpMap({
    corners: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ],
    destSize: 512,
    sourceWidth: 1280,
    sourceHeight: 720,
  });
  assert.ok(map);
  assert.equal(map.offsets.length, 512 * 512);
  assert.ok(map.offsets.every((offset) => offset >= 0 && offset < 1280 * 720 * 4));
});

test('square <-> cell mapping round-trips in both orientations', () => {
  const files = 'abcdefgh';
  for (let file = 0; file < 8; file += 1) {
    for (let rank = 1; rank <= 8; rank += 1) {
      const square = `${files[file]}${rank}`;
      for (const flipped of [false, true]) {
        assert.equal(cellToSquare(squareToCell(square, flipped), flipped), square);
      }
    }
  }
});

test('material evaluation and score normalization', () => {
  const start = new Chess();
  assert.equal(evalFromMaterial(start.fen()).cpWhite, 0);
  start.move('e4');
  start.move('d5');
  start.move('exd5');
  assert.equal(evalFromMaterial(start.fen()).cpWhite, 100);

  const cp = normalizeEngineScore({ type: 'cp', value: 50 }, 'b');
  assert.equal(cp.cpWhite, -50);
  const mate = normalizeEngineScore({ type: 'mate', value: 3 }, 'w');
  assert.ok(mate.mateWhite === 3 && mate.cpWhite > 90000);
  assert.equal(evalToWinProb(cp) < 50, true);
  assert.equal(evalToWinProb(mate), 100);
  assert.equal(formatEval(mate), '+M3');
  assert.equal(formatEval({ cpWhite: 0, mateWhite: null }), '0.0');
});

test('win probability is symmetric and bounded', () => {
  assert.equal(evalToWinProb({ cpWhite: 0 }), 50);
  assert.ok(evalToWinProb({ cpWhite: 300 }) > 70);
  assert.ok(evalToWinProb({ cpWhite: -300 }) < 30);
  assert.equal(evalToWinProb({ mateWhite: 2 }), 100);
  assert.equal(evalToWinProb({ mateWhite: -2 }), 0);
  assert.equal(scoreForMover({ cpWhite: 100 }, 'b'), -100);
});

test('SAN and UCI input parsing', () => {
  const start = new Chess().fen();
  assert.equal(parseMoveInput(start, 'Nf3')?.san, 'Nf3');
  assert.equal(parseMoveInput(start, 'g1f3')?.san, 'Nf3');
  assert.equal(parseMoveInput(start, '0-0'), null);
  assert.equal(uciToSan(start, 'g1f3'), 'Nf3');

  const castleFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  assert.equal(parseMoveInput(castleFen, 'O-O')?.san, 'O-O');
  assert.equal(parseMoveInput(castleFen, 'e1g1')?.san, 'O-O');
});

test('changed-cell scoring accepts a clean move and tolerates one noisy cell', () => {
  const game = new Chess();
  const move = game.moves({ verbose: true }).find((item) => item.san === 'e4');
  const clean = [squareToCell('e2', false), squareToCell('e4', false)];
  const result = scoreMoveAgainstChanges(move, clean, false);
  assert.equal(result.score, 1);
  assert.equal(result.extras, 0);
  assert.equal(result.missing, 0);

  const noisy = [...clean, squareToCell('a1', false)];
  const noisyResult = scoreMoveAgainstChanges(move, noisy, false);
  assert.ok(noisyResult.score > 0.75 && noisyResult.score < 1);
  assert.equal(noisyResult.extras, 1);

  const partial = [squareToCell('e2', false)];
  const partialResult = scoreMoveAgainstChanges(move, partial, false);
  assert.ok(partialResult.score < 0.72);
  assert.equal(partialResult.missing, 1);
});

test('classification produces the expected verdict buckets', () => {
  const game = new Chess();
  const move = game.move('e4');
  const record = {
    ...move,
    uci: 'e2e4',
    fenAfter: game.fen(),
    color: 'w',
  };
  const inaccuracy = classifyMove({
    before: { cpWhite: 100 },
    after: { cpWhite: 0 },
    move: record,
    preBestMove: 'd2d4',
  });
  assert.equal(inaccuracy.verdict, 'inaccuracy');
  assert.equal(inaccuracy.cpLoss, 100);

  const best = classifyMove({
    before: { cpWhite: 100 },
    after: { cpWhite: 95 },
    move: record,
    preBestMove: 'e2e4',
  });
  assert.equal(best.verdict, 'best');

  const forced = classifyMove({
    before: { cpWhite: -900 },
    after: { cpWhite: -1200 },
    move: record,
    preBestMove: null,
    forced: true,
  });
  assert.equal(forced.verdict, 'best');
});

test('commentary is generated in all three languages', () => {
  const game = new Chess();
  const move = game.move('e4');
  const record = {
    ...move,
    ply: 0,
    uci: 'e2e4',
    fenAfter: game.fen(),
    fenBefore: new Chess().fen(),
    evalBefore: { cpWhite: 20, mateWhite: null },
    evalAfter: { cpWhite: 25, mateWhite: null },
    verdict: 'best',
    cpLoss: 0,
    sacrifice: false,
    bestMoveBefore: 'e2e4',
    gameOver: { over: false },
  };

  for (const lang of ['en', 'fr', 'ar']) {
    const text = makeCommentary(record, lang);
    assert.ok(typeof text === 'string' && text.length > 0);
    assert.ok(text.includes('e4'));
    assert.ok(makeGameStartCommentary(lang).length > 0);
  }
  assert.ok(makeCommentary(record, 'ar').includes('\u2066'));
});

test('translations fall back to English and interpolate', () => {
  assert.equal(translate('en', 'white'), 'White');
  assert.equal(translate('xx', 'white'), 'White');
  assert.equal(translate('en', 'mateIn', { n: 4 }), 'Mate in 4');
});

test('the Opera Game replays to a legal checkmate', () => {
  const game = new Chess();
  for (const san of OPERA_GAME.moves) {
    const move = game.move(san);
    assert.ok(move, `Illegal demo move: ${san}`);
  }
  assert.equal(OPERA_GAME.moves.length, 33);
  assert.equal(game.isCheckmate(), true);
  assert.equal(game.fen(), '1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5 b k - 1 17');
  const result = gameResult(game);
  assert.equal(result.over, true);
  assert.equal(result.type, 'checkmate');
  assert.equal(result.winner, 'w');
  assert.equal(evalToCp(evalFromMaterial(game.fen())), 100000);
});

test('special moves: castling kingside and queenside for both colors', () => {
  // White castling
  const whiteCastleFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const gWhite = new Chess(whiteCastleFen);
  const wKingside = gWhite.moves({ verbose: true }).find((m) => m.san === 'O-O');
  const wQueenside = gWhite.moves({ verbose: true }).find((m) => m.san === 'O-O-O');

  const wKingsideCells = ['e1', 'g1', 'h1', 'f1'].map((sq) => squareToCell(sq, false));
  const resWK = scoreMoveAgainstChanges(wKingside, wKingsideCells, false);
  assert.equal(resWK.score, 1);
  assert.equal(resWK.missing, 0);

  const wQueensideCells = ['e1', 'c1', 'a1', 'd1'].map((sq) => squareToCell(sq, false));
  const resWQ = scoreMoveAgainstChanges(wQueenside, wQueensideCells, false);
  assert.equal(resWQ.score, 1);
  assert.equal(resWQ.missing, 0);

  // Black castling
  const blackCastleFen = 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1';
  const gBlack = new Chess(blackCastleFen);
  const bKingside = gBlack.moves({ verbose: true }).find((m) => m.san === 'O-O');
  const bQueenside = gBlack.moves({ verbose: true }).find((m) => m.san === 'O-O-O');

  const bKingsideCells = ['e8', 'g8', 'h8', 'f8'].map((sq) => squareToCell(sq, false));
  const resBK = scoreMoveAgainstChanges(bKingside, bKingsideCells, false);
  assert.equal(resBK.score, 1);
  assert.equal(resBK.missing, 0);

  const bQueensideCells = ['e8', 'c8', 'a8', 'd8'].map((sq) => squareToCell(sq, false));
  const resBQ = scoreMoveAgainstChanges(bQueenside, bQueensideCells, false);
  assert.equal(resBQ.score, 1);
  assert.equal(resBQ.missing, 0);
});

test('special moves: en passant capture', () => {
  const epFen = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
  const game = new Chess(epFen);
  const epMove = game.moves({ verbose: true }).find((m) => m.san === 'exd6');
  assert.ok(epMove, 'exd6 move must be legal');

  // En passant involves 3 squares: from (e5), to (d6), and captured pawn square (d5)
  const epCells = ['e5', 'd5', 'd6'].map((sq) => squareToCell(sq, false));
  const res = scoreMoveAgainstChanges(epMove, epCells, false);
  assert.equal(res.score, 1);
  assert.equal(res.missing, 0);
  assert.equal(res.extras, 0);
});

test('special moves: pawn promotion and underpromotion', () => {
  const promoFen = '8/4P3/8/8/8/8/8/k6K w - - 0 1';
  const game = new Chess(promoFen);
  const moves = game.moves({ verbose: true });
  const queenPromo = moves.find((m) => m.promotion === 'q');
  const knightPromo = moves.find((m) => m.promotion === 'n');

  assert.ok(queenPromo && knightPromo);
  const promoCells = ['e7', 'e8'].map((sq) => squareToCell(sq, false));

  const resQ = scoreMoveAgainstChanges(queenPromo, promoCells, false);
  assert.equal(resQ.score, 1);
  assert.equal(resQ.missing, 0);

  const resN = scoreMoveAgainstChanges(knightPromo, promoCells, false);
  assert.equal(resN.score, 1);
  assert.equal(resN.missing, 0);
});

test('candidate ambiguity and ranking', () => {
  // Position where two knights can move to d2 (Nbd2 vs Nfd2)
  const game = new Chess();
  game.move('d4');
  game.move('d5');
  game.move('Nf3');
  game.move('Nf6');
  const moves = game.moves({ verbose: true });
  const nbd2 = moves.find((m) => m.san === 'Nbd2');
  const nfd2 = moves.find((m) => m.san === 'Nfd2');
  assert.ok(nbd2 && nfd2);

  // If b1 and d2 changed:
  const b1d2Cells = ['b1', 'd2'].map((sq) => squareToCell(sq, false));
  const scoreNbd2 = scoreMoveAgainstChanges(nbd2, b1d2Cells, false);
  const scoreNfd2 = scoreMoveAgainstChanges(nfd2, b1d2Cells, false);

  assert.equal(scoreNbd2.score, 1);
  assert.ok(scoreNfd2.score < 0.72, 'incorrect knight candidate must fail the 0.72 confidence threshold');
  assert.ok(scoreNbd2.score - scoreNfd2.score >= 0.4, 'top candidate must lead by a decisive margin');
});

test('re-sync board reconciliation (findMatchingMoveSequence)', () => {
  const startFen = new Chess().fen();

  // 1-ply reconciliation: White played e4
  const e4Cells = ['e2', 'e4'].map((sq) => squareToCell(sq, false));
  const res1 = findMatchingMoveSequence(startFen, e4Cells, false);
  assert.ok(res1);
  assert.equal(res1.type, '1-ply');
  assert.equal(res1.sanList[0], 'e4');

  // 2-ply reconciliation: 1. e4 e5 played while camera was obstructed
  const e4e5Cells = ['e2', 'e4', 'e7', 'e5'].map((sq) => squareToCell(sq, false));
  const res2 = findMatchingMoveSequence(startFen, e4e5Cells, false);
  assert.ok(res2);
  assert.equal(res2.type, '2-ply');
  assert.deepEqual(res2.sanList, ['e4', 'e5']);
});

test('hand and occlusion detection (detectHandOrOcclusion)', () => {
  // Normal move (2 cells): should NOT be occluded
  const normal = detectHandOrOcclusion([12, 28]);
  assert.equal(normal.occluded, false);

  // Castling (4 cells): should NOT be occluded
  const castle = detectHandOrOcclusion([60, 62, 63, 61]);
  assert.equal(castle.occluded, false);

  // Hand/Arm covering 8+ cells: must be occluded
  const arm = detectHandOrOcclusion([10, 11, 12, 13, 18, 19, 20, 21]);
  assert.equal(arm.occluded, true);

  // Connected hand cluster (5 cells in close proximity): occluded
  const cluster = detectHandOrOcclusion([18, 19, 20, 26, 27]);
  assert.equal(cluster.occluded, true);
});

test('classification thresholds and live audience sanity', () => {
  const game = new Chess();
  const move = game.move('e4');
  const record = {
    ...move,
    uci: 'e2e4',
    fenAfter: game.fen(),
    color: 'w',
  };

  // Dropping from +800 to +550 cp should NOT be a blunder (white is still winning)
  const winningDrop = classifyMove({
    before: { cpWhite: 800 },
    after: { cpWhite: 550 },
    move: record,
    preBestMove: 'd2d4',
  });
  assert.notEqual(winningDrop.verdict, 'blunder');
  assert.ok(['good', 'inaccuracy'].includes(winningDrop.verdict));

  // Retaining forced mate in 3 (vs mate in 2) should NOT be a blunder
  const mateSequence = classifyMove({
    before: { cpWhite: 99990 },
    after: { cpWhite: 99980 },
    move: record,
    preBestMove: 'd2d4',
  });
  assert.ok(['good', 'best', 'excellent'].includes(mateSequence.verdict));

  // A genuine blunder turning +150 into -400 cp IS a blunder
  const trueBlunder = classifyMove({
    before: { cpWhite: 150 },
    after: { cpWhite: -400 },
    move: record,
    preBestMove: 'd2d4',
  });
  assert.equal(trueBlunder.verdict, 'blunder');
});

test('synthetic board image computer vision detector', () => {
  function createSyntheticFrame({ pawnSquare = 'e2', brightness = 0, noise = 0 } = {}) {
    const pixels = new Uint8ClampedArray(512 * 512 * 4);
    const pawnCell = pawnSquare ? squareToCell(pawnSquare, false) : null;
    const pawnR = pawnCell != null ? Math.floor(pawnCell / 8) : -1;
    const pawnC = pawnCell != null ? pawnCell % 8 : -1;

    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        const isLight = (r + c) % 2 === 0;
        const baseR = isLight ? 215 : 110;
        const baseG = isLight ? 195 : 85;
        const baseB = isLight ? 155 : 55;

        const y0 = r * 64;
        const x0 = c * 64;

        for (let y = y0; y < y0 + 64; y += 1) {
          for (let x = x0; x < x0 + 64; x += 1) {
            const idx = (y * 512 + x) * 4;
            let red = baseR;
            let green = baseG;
            let blue = baseB;

            if (r === pawnR && c === pawnC) {
              const dx = x - (x0 + 32);
              const dy = y - (y0 + 32);
              if (dx * dx + dy * dy <= 16 * 16) {
                red = 250;
                green = 248;
                blue = 240;
              }
            }

            if (brightness !== 0) {
              red += brightness;
              green += brightness;
              blue += brightness;
            }
            if (noise > 0) {
              const pseudo = (((x * 374761393 + y * 668265263) ^ 0x5bf03635) % 1000) / 1000;
              const n = pseudo * (noise * 2) - noise;
              red += n;
              green += n;
              blue += n;
            }

            pixels[idx] = Math.max(0, Math.min(255, Math.round(red)));
            pixels[idx + 1] = Math.max(0, Math.min(255, Math.round(green)));
            pixels[idx + 2] = Math.max(0, Math.min(255, Math.round(blue)));
            pixels[idx + 3] = 255;
          }
        }
      }
    }
    return pixels;
  }

  function computeDescriptor(pixels) {
    const DEST_SIZE = 512;
    const GRID = 8;
    const SAMPLE_STEP = 2;
    const VALUES_PER_BLOCK = 4;
    const BLOCKS_PER_CELL = 64;
    const VALUES_PER_CELL = 256;
    const descriptor = new Float32Array(GRID * GRID * VALUES_PER_CELL);

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumGrad = 0;
    let samples = 0;
    const stride = DEST_SIZE * 4;

    for (let y = 0; y < DEST_SIZE; y += SAMPLE_STEP) {
      const rowBase = y * stride;
      const cellRow = y >> 6;
      const blockRow = (y & 63) >> 3;

      for (let x = 0; x < DEST_SIZE; x += SAMPLE_STEP) {
        const index = rowBase + x * 4;
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];

        const cellCol = x >> 6;
        const blockCol = (x & 63) >> 3;
        const cell = cellRow * GRID + cellCol;
        const block = blockRow * 8 + blockCol;
        const base = cell * VALUES_PER_CELL + block * VALUES_PER_BLOCK;

        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const rightX = Math.min(DEST_SIZE - 1, x + SAMPLE_STEP);
        const downY = Math.min(DEST_SIZE - 1, y + SAMPLE_STEP);
        const rightIndex = rowBase + rightX * 4;
        const downIndex = downY * stride + x * 4;
        const lumRight = 0.299 * pixels[rightIndex] + 0.587 * pixels[rightIndex + 1] + 0.114 * pixels[rightIndex + 2];
        const lumDown = 0.299 * pixels[downIndex] + 0.587 * pixels[downIndex + 1] + 0.114 * pixels[downIndex + 2];
        const gradient = Math.abs(lumRight - lum) + Math.abs(lumDown - lum);

        descriptor[base] += r;
        descriptor[base + 1] += g;
        descriptor[base + 2] += b;
        descriptor[base + 3] += gradient;

        sumR += r; sumG += g; sumB += b; sumGrad += gradient;
        samples += 1;
      }
    }

    const meanR = Math.max(1, sumR / samples);
    const meanG = Math.max(1, sumG / samples);
    const meanB = Math.max(1, sumB / samples);
    const meanGrad = Math.max(0.5, sumGrad / samples);

    for (let cell = 0; cell < GRID * GRID; cell += 1) {
      const cellBase = cell * VALUES_PER_CELL;
      for (let block = 0; block < BLOCKS_PER_CELL; block += 1) {
        const base = cellBase + block * VALUES_PER_BLOCK;
        descriptor[base] /= meanR;
        descriptor[base + 1] /= meanG;
        descriptor[base + 2] /= meanB;
        descriptor[base + 3] /= meanGrad;
      }
    }
    return descriptor;
  }

  function findChangedCells(descA, descB) {
    const VALUES_PER_BLOCK = 4;
    const BLOCKS_PER_CELL = 64;
    const VALUES_PER_CELL = 256;
    const scores = new Float32Array(64);
    let maxScore = 0;

    for (let cell = 0; cell < 64; cell += 1) {
      const cellBase = cell * VALUES_PER_CELL;
      let sum = 0;
      let max = 0;
      for (let block = 0; block < BLOCKS_PER_CELL; block += 1) {
        const base = cellBase + block * VALUES_PER_BLOCK;
        const blockDiff = (
          Math.abs(descA[base] - descB[base]) +
          Math.abs(descA[base + 1] - descB[base + 1]) +
          Math.abs(descA[base + 2] - descB[base + 2]) +
          Math.abs(descA[base + 3] - descB[base + 3])
        ) / VALUES_PER_BLOCK;
        sum += blockDiff;
        if (blockDiff > max) max = blockDiff;
      }
      const score = 0.5 * (sum / BLOCKS_PER_CELL + max);
      scores[cell] = score;
      if (score > maxScore) maxScore = score;
    }

    const changed = [];
    const threshold = Math.max(0.08, maxScore * 0.55);
    for (let cell = 0; cell < 64; cell += 1) {
      if (scores[cell] >= threshold) {
        changed.push(cell);
      }
    }
    return changed;
  }

  // Test 1: Clean synthetic move e2 -> e4
  const frameBefore = createSyntheticFrame({ pawnSquare: 'e2' });
  const frameAfter = createSyntheticFrame({ pawnSquare: 'e4' });
  const descBefore = computeDescriptor(frameBefore);
  const descAfter = computeDescriptor(frameAfter);
  const changed = findChangedCells(descBefore, descAfter);

  const cellE2 = squareToCell('e2', false);
  const cellE4 = squareToCell('e4', false);
  assert.ok(changed.includes(cellE2), 'e2 must be detected as changed');
  assert.ok(changed.includes(cellE4), 'e4 must be detected as changed');

  const startMoves = new Chess().moves({ verbose: true });
  const e4Move = startMoves.find((m) => m.san === 'e4');
  const d4Move = startMoves.find((m) => m.san === 'd4');
  const scoreE4 = scoreMoveAgainstChanges(e4Move, changed, false);
  const scoreD4 = scoreMoveAgainstChanges(d4Move, changed, false);
  assert.ok(scoreE4.score > 0.85);
  assert.ok(scoreE4.score > scoreD4.score);

  // Test 2: Move with camera noise on both frames (+15 brightness shift on after)
  const frameBeforeCamera = createSyntheticFrame({ pawnSquare: 'e2', noise: 4 });
  const frameAfterCamera = createSyntheticFrame({ pawnSquare: 'e4', brightness: 15, noise: 4 });
  const descCamBefore = computeDescriptor(frameBeforeCamera);
  const descCamAfter = computeDescriptor(frameAfterCamera);
  const changedNoisy = findChangedCells(descCamBefore, descCamAfter);
  assert.ok(changedNoisy.includes(cellE2));
  assert.ok(changedNoisy.includes(cellE4));

  const scoreNoisyE4 = scoreMoveAgainstChanges(e4Move, changedNoisy, false);
  assert.ok(scoreNoisyE4.score >= 0.72, `Noisy move score ${scoreNoisyE4.score} should pass confidence threshold`);
});

test('recording filename formatting and sanitization', () => {
  const clean = sanitizeFilenamePart('World Championship: Final / Match 1?');
  assert.equal(clean, 'World_Championship_Final_Match_1');

  const arabic = sanitizeFilenamePart('بطولة الشطرنج 2026!');
  assert.equal(arabic, 'بطولة_الشطرنج_2026');

  const filename = formatFilename({
    eventName: 'Kasparov vs Deep Blue',
    whitePlayer: 'Garry Kasparov',
    blackPlayer: 'Deep Blue',
    partIndex: 2,
    timestamp: '2026-11-07T12:00:00.000Z',
    extension: 'webm',
  });
  assert.equal(filename, 'Kasparov_vs_Deep_Blue_Garry_Kasparov_vs_Deep_Blue_2026-11-07T12-00-00_part2.webm');
});

test('settings persistence includes camera background and recording configs', () => {
  const sanitized = sanitizeSettings({
    cameraBgMode: 'corner',
    cameraBgOpacity: 45,
    cameraBgBlur: 10,
    cameraBgBrightness: 110,
    cameraBgMirror: true,
    cameraBgRotate: 180,
    cameraBgPerfMode: true,
    recordingBitrate: 6,
    recordingSegmentMinutes: 15,
    recordingSource: 'screen',
  });

  assert.equal(sanitized.cameraBgMode, 'corner');
  assert.equal(sanitized.cameraBgOpacity, 45);
  assert.equal(sanitized.cameraBgBlur, 10);
  assert.equal(sanitized.cameraBgBrightness, 110);
  assert.equal(sanitized.cameraBgMirror, true);
  assert.equal(sanitized.cameraBgRotate, 180);
  assert.equal(sanitized.cameraBgPerfMode, true);
  assert.equal(sanitized.recordingBitrate, 6);
  assert.equal(sanitized.recordingSegmentMinutes, 15);
  assert.equal(sanitized.recordingSource, 'screen');

  const persisted = persistableSettings(sanitized);
  assert.equal(persisted.cameraBgMode, 'corner');
  assert.equal(persisted.recordingSource, 'screen');
  assert.equal(persisted.llmKey, undefined); // Never saved
});

test('camera panel settings sanitization and persistence', () => {
  const sanitized = sanitizeSettings({
    cameraPanelShow: true,
    cameraPanelSource: 'warped',
    cameraPanelMirror: true,
    cameraPanelRotate: 90,
    cameraPanelSize: 'large',
  });

  assert.equal(sanitized.cameraPanelShow, true);
  assert.equal(sanitized.cameraPanelSource, 'warped');
  assert.equal(sanitized.cameraPanelMirror, true);
  assert.equal(sanitized.cameraPanelRotate, 90);
  assert.equal(sanitized.cameraPanelSize, 'large');

  // Check fallback on invalid inputs
  const fallback = sanitizeSettings({
    cameraPanelSource: 'invalid_source',
    cameraPanelRotate: 45,
    cameraPanelSize: 'extra_large',
  });
  assert.equal(fallback.cameraPanelSource, 'raw');
  assert.equal(fallback.cameraPanelRotate, 0);
  assert.equal(fallback.cameraPanelSize, 'medium');

  // Verify squareToCell for warped move highlights
  const fromCell = squareToCell('e2', false);
  const toCell = squareToCell('e4', false);
  assert.equal(fromCell, 52);
  assert.equal(toCell, 36);
  assert.ok(fromCell >= 0 && fromCell < 64);
  assert.ok(toCell >= 0 && toCell < 64);

  const persisted = persistableSettings(sanitized);
  assert.equal(persisted.cameraPanelShow, true);
  assert.equal(persisted.cameraPanelSource, 'warped');
  assert.equal(persisted.cameraPanelSize, 'large');
});

test('interactive chess play logic and legal move generation', () => {
  const game = new Chess();
  const e2Moves = game.moves({ square: 'e2', verbose: true });
  assert.equal(e2Moves.length, 2);
  const destinations = e2Moves.map((m) => m.to);
  assert.ok(destinations.includes('e3'));
  assert.ok(destinations.includes('e4'));

  // Test pawn capture detection
  game.move('e4');
  game.move('d5');
  const captureMoves = game.moves({ square: 'e4', verbose: true });
  const d5Capture = captureMoves.find((m) => m.to === 'd5');
  assert.ok(d5Capture);
  assert.equal(d5Capture.captured, 'p');

  // Test pawn promotion
  const promoGame = new Chess('7k/4P3/8/8/8/8/8/K7 w - - 0 1');
  const promoMoves = promoGame.moves({ square: 'e7', verbose: true });
  assert.equal(promoMoves.length, 4); // q, r, b, n
  assert.ok(promoMoves.some((m) => m.promotion === 'q'));
});

test('shared coordinate test vectors match Python definitions exactly', () => {
  // Canonical vector matching coordinates.py SHARED_TEST_VECTORS
  const sharedVectors = [
    { sq: 'a8', flip: false, cell: 0, r: 0, c: 0 },
    { sq: 'h8', flip: false, cell: 7, r: 0, c: 7 },
    { sq: 'a1', flip: false, cell: 56, r: 7, c: 0 },
    { sq: 'h1', flip: false, cell: 63, r: 7, c: 7 },
    { sq: 'e4', flip: false, cell: 36, r: 4, c: 4 },
    { sq: 'a8', flip: true, cell: 63, r: 7, c: 7 },
    { sq: 'h8', flip: true, cell: 56, r: 7, c: 0 },
    { sq: 'a1', flip: true, cell: 7, r: 0, c: 7 },
    { sq: 'h1', flip: true, cell: 0, r: 0, c: 0 },
    { sq: 'e4', flip: true, cell: 27, r: 3, c: 3 },
  ];

  for (const item of sharedVectors) {
    const cell = squareToCell(item.sq, item.flip);
    assert.equal(cell, item.cell, `squareToCell(${item.sq}, flip=${item.flip})`);
    const r = Math.floor(cell / 8);
    const c = cell % 8;
    assert.equal(r, item.r, `row of ${item.sq}`);
    assert.equal(c, item.c, `col of ${item.sq}`);

    const roundtrip = cellToSquare(cell, item.flip);
    assert.equal(roundtrip, item.sq, `cellToSquare(${cell}, flip=${item.flip})`);
  }
});

test('vision router state machine, health monitoring and fallback rules', () => {
  let fallbackEvents = [];

  class MockJsBackend extends VisionBackend {
    constructor() {
      super('js', 'Mock JS Vision');
      this.callbacks = {};
    }
    setCallbacks(cb) { this.callbacks = { ...this.callbacks, ...cb }; }
    start() {}
    stop() {}
    syncReference() { return true; }
    setPosition() {}
  }

  class MockPythonBackend extends VisionBackend {
    constructor() {
      super('python', 'Mock Python Vision');
      this.callbacks = {};
      this._healthy = true;
      this._connected = true;
      this._p95Latency = 50;
      this._lastMsgDelta = 100;
    }
    setCallbacks(cb) { this.callbacks = { ...this.callbacks, ...cb }; }
    setOnConnectionChange(cb) { this.onConnectionChange = cb; }
    isHealthy() {
      return Boolean(this._healthy && this._connected && this._p95Latency <= 800 && this._lastMsgDelta <= 1500);
    }
    start() {}
    stop() {}
    syncReference() { return true; }
    setPosition() {}
  }

  const js = new MockJsBackend();
  const py = new MockPythonBackend();

  const router = new VisionRouter({
    jsBackend: js,
    pythonBackend: py,
    mode: VISION_MODES.JS_ONLY,
    onFallback: (ev) => fallbackEvents.push(ev),
  });

  // 1. Initial default state: JS ONLY
  assert.equal(router.mode, 'js');
  assert.equal(router.authoritativeBackend.id, 'js');

  // 2. Switch to AUTO when Python is healthy
  router.lastSwitchAt = performance.now() - 70000; // allow switch
  router.healthyStreak = 25; // sustained healthy streak
  router.setMode(VISION_MODES.AUTO);
  assert.equal(router.mode, 'auto');
  assert.equal(router.authoritativeBackend.id, 'python');
  assert.ok(fallbackEvents.some((ev) => ev.from === 'js' && ev.to === 'python'));

  // 3. Python disconnects / becomes unhealthy mid-move -> automatic fallback to JS
  fallbackEvents = [];
  py._healthy = false;
  router.evaluateHealth();
  assert.equal(router.authoritativeBackend.id, 'js');
  assert.ok(fallbackEvents.some((ev) => ev.from === 'python' && ev.to === 'js'));

  // 4. Slow replies / latency spike (>800ms) prevents return to Python
  fallbackEvents = [];
  py._healthy = true;
  py._p95Latency = 950; // exceeds 800ms
  assert.equal(py.isHealthy(), false);
  router.healthyStreak = 25;
  router.lastSwitchAt = performance.now() - 70000;
  // Evaluate health
  py.callbacks.onState?.({ state: 'tracking' });
  assert.equal(router.authoritativeBackend.id, 'js'); // stays on JS!

  // 5. Stalled connection (>1500ms since last message)
  py._p95Latency = 40;
  py._lastMsgDelta = 1800; // stalled
  assert.equal(py.isHealthy(), false);
  py.callbacks.onState?.({ state: 'tracking' });
  assert.equal(router.authoritativeBackend.id, 'js'); // stays on JS!
});

test('shadow mode compares JS authority with Python and logs mismatches', () => {
  let shadowEvents = [];

  class SimpleJsBackend extends VisionBackend {
    constructor() { super('js', 'JS'); this.callbacks = {}; }
    setCallbacks(cb) { this.callbacks = { ...this.callbacks, ...cb }; }
    start() {}
    stop() {}
    syncReference() { return true; }
    setPosition() {}
  }
  class SimplePyBackend extends VisionBackend {
    constructor() { super('python', 'Python'); this.callbacks = {}; }
    setCallbacks(cb) { this.callbacks = { ...this.callbacks, ...cb }; }
    setOnConnectionChange() {}
    isHealthy() { return true; }
    start() {}
    stop() {}
    syncReference() { return true; }
    setPosition() {}
  }

  const js = new SimpleJsBackend();
  const py = new SimplePyBackend();

  const router = new VisionRouter({
    jsBackend: js,
    pythonBackend: py,
    mode: VISION_MODES.SHADOW,
    onShadowMismatch: (entry, count) => shadowEvents.push({ entry, count }),
  });

  assert.equal(router.authoritativeBackend.id, 'js');

  // JS emits e2e4
  js.callbacks.onDetection({ best: { uci: 'e2e4' }, changedCells: [52, 36] });

  // Python agrees on e2e4 -> no mismatch
  py.callbacks.onDetection({ best: { uci: 'e2e4' }, changedCells: [52, 36] });
  assert.equal(router.shadowMismatchCount, 0);

  // Next move: JS emits e7e5, Python emits d7d5 -> mismatch!
  js.callbacks.onDetection({ best: { uci: 'e7e5' }, changedCells: [12, 28] });
  py.callbacks.onDetection({ best: { uci: 'd7d5' }, changedCells: [11, 27] });

  assert.equal(router.shadowMismatchCount, 1);
  assert.equal(shadowEvents.length, 1);
  assert.equal(shadowEvents[0].entry.jsUci, 'e7e5');
  assert.equal(shadowEvents[0].entry.pyUci, 'd7d5');
});

test('chess.js validates vision candidates and discards illegal moves', () => {
  const game = new Chess();
  const fenBefore = game.fen();

  // Try applying illegal move candidate (e.g. e2e5 on initial position)
  let moveResult = null;
  try {
    moveResult = game.move({ from: 'e2', to: 'e5' });
  } catch {
    moveResult = null;
  }
  assert.equal(moveResult, null);
  // Board state was not corrupted
  assert.equal(game.fen(), fenBefore);

  // Legal move candidate applies cleanly
  const legalMove = game.move({ from: 'e2', to: 'e4' });
  assert.ok(legalMove);
  assert.equal(legalMove.san, 'e4');
  assert.notEqual(game.fen(), fenBefore);
});

// ------------------------------------------------------------- Camera Fit Check tests
function createMockImageData(width, height, pixelFn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a = 255] = pixelFn(x, y);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return { width, height, data };
}

test('camera fit: well-centered quadrilateral yields good status and high score', () => {
  // Board covering ~70% of 1280x720 video with generous margins
  const corners = [
    { x: 0.15, y: 0.15 },
    { x: 0.85, y: 0.15 },
    { x: 0.85, y: 0.85 },
    { x: 0.15, y: 0.85 },
  ];
  const metrics = computeQuadrilateralMetrics(corners, 1280, 720);
  assert.equal(metrics.isValid, true);
  assert.equal(metrics.isOutside, false);
  assert.equal(metrics.isCloseToEdge, false);
  assert.ok(metrics.pixelsPerSquare >= CAMERA_FIT_CONFIG.pixelsPerSquareGood);
  assert.ok(metrics.maxAngleDeviation < 1);
  assert.equal(metrics.hints.length, 0);

  const evalResult = evaluateCameraFit({
    corners,
    videoWidth: 1280,
    videoHeight: 720,
  });
  assert.equal(evalResult.status, 'good');
  assert.ok(evalResult.score >= 90);
});

test('camera fit: corner outside frame yields poor status with cut-off warning', () => {
  // Corner 0 is outside on the left
  const corners = [
    { x: -0.05, y: 0.15 },
    { x: 0.85, y: 0.15 },
    { x: 0.85, y: 0.85 },
    { x: 0.15, y: 0.85 },
  ];
  const metrics = computeQuadrilateralMetrics(corners, 1280, 720);
  assert.equal(metrics.isOutside, true);
  assert.ok(metrics.messages.some((m) => m.includes('cut off on the left')));

  const evalResult = evaluateCameraFit({ corners });
  assert.equal(evalResult.status, 'poor');
  assert.ok(evalResult.score < 65);
});

test('camera fit: board too small yields poor status with zoom/closer warning', () => {
  // Board only 15% width and height (area tiny)
  const corners = [
    { x: 0.42, y: 0.42 },
    { x: 0.58, y: 0.42 },
    { x: 0.58, y: 0.58 },
    { x: 0.42, y: 0.58 },
  ];
  const metrics = computeQuadrilateralMetrics(corners, 1280, 720);
  assert.ok(metrics.pixelsPerSquare < CAMERA_FIT_CONFIG.pixelsPerSquareWarn);
  assert.ok(metrics.messages.some((m) => m.includes('too small')));

  const evalResult = evaluateCameraFit({ corners, videoWidth: 1280, videoHeight: 720 });
  assert.equal(evalResult.status, 'poor');
});

test('camera fit: strongly skewed trapezoid yields poor status with tilt warning', () => {
  // Top edge shifted right and bottom edge shifted left -> acute/obtuse angles > 30 deg deviation
  const corners = [
    { x: 0.35, y: 0.15 },
    { x: 0.90, y: 0.15 },
    { x: 0.60, y: 0.85 },
    { x: 0.10, y: 0.85 },
  ];
  const metrics = computeQuadrilateralMetrics(corners, 1280, 720);
  assert.ok(metrics.maxAngleDeviation > CAMERA_FIT_CONFIG.angleDeviationPoorDeg);
  assert.ok(metrics.messages.some((m) => m.includes('tilted')));

  const evalResult = evaluateCameraFit({ corners, videoWidth: 1280, videoHeight: 720 });
  assert.equal(evalResult.status, 'poor');
});

test('camera fit: off-center board produces direction hints', () => {
  // Board shifted towards bottom-right
  const corners = [
    { x: 0.35, y: 0.35 },
    { x: 0.95, y: 0.35 },
    { x: 0.95, y: 0.95 },
    { x: 0.35, y: 0.95 },
  ];
  const metrics = computeQuadrilateralMetrics(corners, 1280, 720);
  assert.ok(metrics.centroid.x > 0.58);
  assert.ok(metrics.centroid.y > 0.58);
  // Hints suggest panning left and up
  assert.ok(metrics.hints.includes('pan_left'));
  assert.ok(metrics.hints.includes('pan_up'));
  assert.ok(metrics.messages.some((m) => m.includes('move the phone left')));
  assert.ok(metrics.messages.some((m) => m.includes('move the phone up')));
});

test('camera fit: aligned checkerboard warped image produces high grid score', () => {
  const image = createMockImageData(256, 256, (x, y) => {
    const col = Math.floor(x / 32);
    const row = Math.floor(y / 32);
    const isLight = (col + row) % 2 === 0;
    const val = isLight ? 180 : 70;
    return [val, val, val];
  });

  const metrics = computeWarpedImageMetrics(image);
  assert.ok(metrics.gridScore >= CAMERA_FIT_CONFIG.gridScoreGood, `Grid score ${metrics.gridScore} should be >= ${CAMERA_FIT_CONFIG.gridScoreGood}`);
  assert.ok(metrics.meanBrightness >= 100 && metrics.meanBrightness <= 150);
  assert.equal(metrics.glareSquares.length, 0);
});

test('camera fit: shifted corners (15px) drops grid alignment score below threshold', () => {
  // Checkerboard shifted by 16px horizontally and vertically relative to grid lines
  const image = createMockImageData(256, 256, (x, y) => {
    const col = Math.floor((x + 16) / 32);
    const row = Math.floor((y + 16) / 32);
    const isLight = (col + row) % 2 === 0;
    const val = isLight ? 180 : 70;
    return [val, val, val];
  });

  const metrics = computeWarpedImageMetrics(image);
  assert.ok(metrics.gridScore < CAMERA_FIT_CONFIG.gridScoreWarn, `Grid score ${metrics.gridScore} should be < ${CAMERA_FIT_CONFIG.gridScoreWarn}`);
  assert.ok(metrics.messages.some((m) => m.includes('Grid alignment is low')));
});

test('camera fit: blurred warped image detects sharpness drop and warns to clean lens', () => {
  // Uniform flat image (sharpness variance 0)
  const flatImage = createMockImageData(256, 256, () => [120, 120, 120]);
  const metrics = computeWarpedImageMetrics(flatImage, 200); // baseline was 200

  assert.ok(metrics.sharpnessDropPct >= 60);
  assert.ok(metrics.messages.some((m) => m.includes('blurry')));
});

test('camera fit: glare patch on e4 is localized and reported with square label', () => {
  // Square e4 in standard orientation (flip = false):
  // file 'e' -> col 4 (0-indexed)
  // rank '4' -> row 4 (0-indexed from top: rank 8=0 ... rank 4=4)
  const image = createMockImageData(256, 256, (x, y) => {
    const col = Math.floor(x / 32);
    const row = Math.floor(y / 32);
    if (col === 4 && row === 4) {
      // Saturated glare spot
      return [255, 255, 255];
    }
    return [110, 110, 110];
  });

  const metrics = computeWarpedImageMetrics(image, null, false);
  assert.ok(metrics.glareSquares.includes('e4'), `Expected glare on e4, got ${metrics.glareSquares.join(', ')}`);
  assert.ok(metrics.messages.some((m) => m.includes('Glare on e4')));
});

test('camera fit: evaluateCameraFit before calibration shows guide without grid error', () => {
  // No corners yet (pre-calibration state)
  const rawImage = createMockImageData(256, 256, () => [130, 130, 130]);
  const result = evaluateCameraFit({
    corners: null,
    imageData: rawImage,
  });

  assert.equal(result.geom.isValid, false);
  assert.ok(result.messages.includes('Fit the whole board inside the frame'));
  // Should NOT complain about grid alignment before corners are marked
  assert.ok(!result.messages.some((m) => m.includes('Grid alignment')));
});

// ------------------------------------------------------------- Vision v2 tests (Phase 1)
test('vision v2: warpBoard512 extracts 512x512 top-down image with precomputed lookup table', () => {
  assert.equal(WARP_SIZE_V2, 512);

  // Synthetic 640x480 image
  const W = 640;
  const H = 480;
  const source = createMockImageData(W, H, (x, y) => [
    (x % 256),
    (y % 256),
    ((x + y) % 256),
  ]);

  const corners = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];

  const warped = warpBoard512({
    source,
    corners,
    sourceWidth: W,
    sourceHeight: H,
  });

  assert.ok(warped);
  assert.equal(warped.width, 512);
  assert.equal(warped.height, 512);
  assert.equal(warped.imageData.data.length, 512 * 512 * 4);
  assert.ok(warped.warpMap);
  assert.equal(warped.warpMap.offsets.length, 512 * 512);
});

test('vision v2: computeGridAlignmentScore measures edge energy on 9+9 grid lines vs square interiors', () => {
  // Aligned 256x256 checkerboard
  const alignedWarp = createMockImageData(256, 256, (x, y) => {
    const col = Math.floor(x / 32);
    const row = Math.floor(y / 32);
    const isLight = (col + row) % 2 === 0;
    const val = isLight ? 210 : 70;
    return [val, val, val];
  });

  const alignedMetrics = computeGridAlignmentScoreFromWarp(alignedWarp);
  assert.ok(alignedMetrics.score >= 80, `Expected aligned score >= 80, got ${alignedMetrics.score}`);
  assert.ok(alignedMetrics.gridEnergy > alignedMetrics.interiorEnergy * 2);

  // Shifted 256x256 checkerboard (shifted by 16px, so grid lines hit square centers)
  const shiftedWarp = createMockImageData(256, 256, (x, y) => {
    const col = Math.floor((x + 16) / 32);
    const row = Math.floor((y + 16) / 32);
    const isLight = (col + row) % 2 === 0;
    const val = isLight ? 210 : 70;
    return [val, val, val];
  });

  const shiftedMetrics = computeGridAlignmentScoreFromWarp(shiftedWarp);
  assert.ok(shiftedMetrics.score < alignedMetrics.score - 30, `Shifted score ${shiftedMetrics.score} should drop significantly below ${alignedMetrics.score}`);
});

test('vision v2: refineCorners searches ~2% radius, improves score, and tightens corners back towards ground truth', () => {
  const W = 800;
  const H = 800;
  const boardX0 = 100;
  const boardY0 = 100;
  const sqSize = 75; // 8 * 75 = 600 px board

  const source = createMockImageData(W, H, (x, y) => {
    let val = 40; // background border
    if (x >= boardX0 && x < boardX0 + 8 * sqSize && y >= boardY0 && y < boardY0 + 8 * sqSize) {
      const col = Math.floor((x - boardX0) / sqSize);
      const row = Math.floor((y - boardY0) / sqSize);
      const isLight = (col + row) % 2 === 0;
      val = isLight ? 215 : 75;
    }
    return [val, val, val];
  });

  const trueCorners = [
    { x: boardX0 / W, y: boardY0 / H },
    { x: (boardX0 + 600) / W, y: boardY0 / H },
    { x: (boardX0 + 600) / W, y: (boardY0 + 600) / H },
    { x: boardX0 / W, y: (boardY0 + 600) / H },
  ];

  // Perturb corners by ~2% (15 pixels)
  const perturbedCorners = [
    { x: (boardX0 - 14) / W, y: (boardY0 + 12) / H },
    { x: (boardX0 + 600 + 15) / W, y: (boardY0 - 10) / H },
    { x: (boardX0 + 600 - 12) / W, y: (boardY0 + 600 + 15) / H },
    { x: (boardX0 + 14) / W, y: (boardY0 + 600 - 12) / H },
  ];

  const result = refineCorners({
    corners: perturbedCorners,
    source,
    sourceWidth: W,
    sourceHeight: H,
    maxSearchFrac: 0.025,
  });

  assert.ok(result);
  assert.equal(result.refinedCorners.length, 4);
  assert.ok(result.improved, 'Refinement should flag improved = true');
  assert.ok(result.refinedScore > result.initialScore, `Refined score ${result.refinedScore} should exceed initial score ${result.initialScore}`);
  assert.ok(result.elapsedMs < 60, `Refinement took ${result.elapsedMs}ms, should be < 60ms`);

  // Measure Euclidean distance to ground truth before vs after
  let totalErrorBefore = 0;
  let totalErrorAfter = 0;
  for (let i = 0; i < 4; i += 1) {
    const errBefore = Math.hypot((perturbedCorners[i].x - trueCorners[i].x) * W, (perturbedCorners[i].y - trueCorners[i].y) * H);
    const errAfter = Math.hypot((result.refinedCorners[i].x - trueCorners[i].x) * W, (result.refinedCorners[i].y - trueCorners[i].y) * H);
    totalErrorBefore += errBefore;
    totalErrorAfter += errAfter;
  }

  assert.ok(totalErrorAfter < totalErrorBefore * 0.6, `Error after (${totalErrorAfter.toFixed(1)}px) should be substantially lower than before (${totalErrorBefore.toFixed(1)}px)`);
});

test('vision v2: refineCorners gracefully handles invalid, degenerate, or edge-clamped corners', () => {
  const dummySource = createMockImageData(256, 256, () => [128, 128, 128]);

  // Degenerate corners (colinear)
  const colinear = [
    { x: 0.1, y: 0.1 },
    { x: 0.2, y: 0.2 },
    { x: 0.3, y: 0.3 },
    { x: 0.4, y: 0.4 },
  ];
  const resColinear = refineCorners({ corners: colinear, source: dummySource });
  assert.ok(resColinear);
  assert.equal(resColinear.refinedCorners.length, 4);

  // Missing corners
  const resEmpty = refineCorners({ corners: [], source: dummySource });
  assert.equal(resEmpty.improved, false);
  assert.ok(resEmpty.error);

  // Missing source
  const resNoSource = refineCorners({
    corners: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }],
    source: null,
  });
  assert.equal(resNoSource.improved, false);
  assert.ok(resNoSource.error);
});

test('vision v2: V2VisionBackend conforms to VisionBackend interface and exposes refinement', () => {
  const backend = new V2VisionBackend();
  assert.equal(backend.id, 'v2');
  assert.equal(backend.name, 'JavaScript Vision v2');

  let stateEmitted = null;
  backend.setCallbacks({
    onState: (s) => { stateEmitted = s; },
  });

  backend.setCalibration([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }], false);
  backend.setFlip(true);
  assert.equal(backend.flip, true);

  backend.start();
  assert.equal(backend.running, true);
  assert.equal(backend.paused, false);

  backend.pause();
  assert.equal(backend.paused, true);

  backend.resume();
  assert.equal(backend.paused, false);

  const debug = backend.getDebugState();
  assert.equal(debug.id, 'v2');
  assert.equal(debug.running, true);
  assert.equal(debug.paused, false);
});

console.log(`\n${passed} logic checks passed.`);
