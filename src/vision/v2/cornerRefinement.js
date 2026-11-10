/**
 * Vision v2: Corner Refinement and Grid-Alignment Score.
 *
 * Evaluates the edge energy along the 9 vertical and 9 horizontal grid lines
 * of the chessboard versus the square interiors, and performs a local search
 * (~2% of board size) around each corner to maximize grid alignment.
 */

import {
  computeHomography,
  invertHomography,
  applyHomography,
} from '../../lib/homography.js';
import { getSourcePixelData, extractLuminance } from './warp.js';

/**
 * Bilinear luminance sampling from a 1D luminance array.
 */
function sampleLuminanceBilinear(lum, width, height, x, y) {
  if (x < 0 || x >= width - 1 || y < 0 || y >= height - 1) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      return lum[Math.floor(y) * width + Math.floor(x)];
    }
    return 0;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = x - x0;
  const fy = y - y0;

  const row0 = y0 * width;
  const row1 = y1 * width;

  const v00 = lum[row0 + x0];
  const v10 = lum[row0 + x1];
  const v01 = lum[row1 + x0];
  const v11 = lum[row1 + x1];

  return (1 - fx) * (1 - fy) * v00 + fx * (1 - fy) * v10 + (1 - fx) * fy * v01 + fx * fy * v11;
}

/**
 * Check if 4 points form a strictly convex counter-clockwise or clockwise quad.
 */
function isConvexQuad(corners) {
  if (!corners || corners.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const p1 = corners[i];
    const p2 = corners[(i + 1) % 4];
    const p3 = corners[(i + 2) % 4];
    const dx1 = p2.x - p1.x;
    const dy1 = p2.y - p1.y;
    const dx2 = p3.x - p2.x;
    const dy2 = p3.y - p2.y;
    const cross = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(cross) < 1e-6) return false; // Colinear
    if (sign === 0) {
      sign = cross > 0 ? 1 : -1;
    } else if ((cross > 0 ? 1 : -1) !== sign) {
      return false; // Concave / self-intersecting
    }
  }
  return true;
}

/**
 * Compute edge energy on 9+9 grid lines versus square interiors on a warped board image.
 *
 * @param {Object} warpImageData - ImageData or { data, width, height } of the warped 512x512 or 256x256 board.
 * @returns {{ score: number, gridEnergy: number, interiorEnergy: number, ratio: number }}
 */
export function computeGridAlignmentScoreFromWarp(warpImageData) {
  if (!warpImageData || !warpImageData.data || warpImageData.width < 16) {
    return { score: 0, gridEnergy: 0, interiorEnergy: 0, ratio: 0 };
  }

  const { data, width, height } = warpImageData;
  const S = width / 8;
  const total = width * height;

  // Single-pass luminance
  const lum = new Float32Array(total);
  for (let i = 0, p = 0; i < total; i += 1, p += 4) {
    lum[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  let gridEnergySum = 0;
  let gridCount = 0;
  let interiorEnergySum = 0;
  let interiorCount = 0;

  // 9 vertical grid lines (col 0, 1, ..., 8)
  for (let k = 0; k <= 8; k += 1) {
    const gx = Math.min(width - 2, Math.max(1, Math.round(k * S)));
    const x0 = Math.max(0, gx - 1);
    const x1 = Math.min(width - 1, gx + 1);
    for (let y = 4; y < height - 4; y += 2) {
      const grad = Math.abs(lum[y * width + x1] - lum[y * width + x0]);
      gridEnergySum += grad;
      gridCount += 1;
    }
  }

  // 9 horizontal grid lines (row 0, 1, ..., 8)
  for (let k = 0; k <= 8; k += 1) {
    const gy = Math.min(height - 2, Math.max(1, Math.round(k * S)));
    const y0 = Math.max(0, gy - 1);
    const y1 = Math.min(height - 1, gy + 1);
    for (let x = 4; x < width - 4; x += 2) {
      const grad = Math.abs(lum[y1 * width + x] - lum[y0 * width + x]);
      gridEnergySum += grad;
      gridCount += 1;
    }
  }

  // Square interiors: middle lines at (k + 0.5) * S, k = 0..7
  for (let k = 0; k < 8; k += 1) {
    const mx = Math.round((k + 0.5) * S);
    for (let y = 4; y < height - 4; y += 2) {
      const grad = Math.abs(lum[y * width + mx + 1] - lum[y * width + mx - 1]);
      interiorEnergySum += grad;
      interiorCount += 1;
    }
  }

  for (let k = 0; k < 8; k += 1) {
    const my = Math.round((k + 0.5) * S);
    for (let x = 4; x < width - 4; x += 2) {
      const grad = Math.abs(lum[(my + 1) * width + x] - lum[(my - 1) * width + x]);
      interiorEnergySum += grad;
      interiorCount += 1;
    }
  }

  const avgGrid = gridCount > 0 ? gridEnergySum / gridCount : 0;
  const avgInt = interiorCount > 0 ? interiorEnergySum / interiorCount : 0;
  // Damping constant 15 prevents degenerate saturation on flat/clean interiors
  const ratio = (avgGrid + 1e-4) / (avgGrid + avgInt + 15);

  // Scaled 0 to 100: ratio 0.25 is 0, ratio 0.90 is 100
  const rawScore = (ratio - 0.25) * 155;
  const score = Math.round(Math.max(0, Math.min(100, rawScore)));

  return {
    score,
    gridEnergy: Math.round(avgGrid * 10) / 10,
    interiorEnergy: Math.round(avgInt * 10) / 10,
    ratio: Math.round(ratio * 1000) / 1000,
  };
}

/**
 * Fast direct grid alignment score evaluated via homography inverse sampling
 * without needing to warp the full 512x512 image.
 */
export function computeDirectGridScore({
  corners,
  lum,
  sourceWidth,
  sourceHeight,
  destSize = 256,
  sampleSteps = 32,
}) {
  if (!corners || corners.length !== 4 || !isConvexQuad(corners)) {
    return { score: 0, gridEnergy: 0, interiorEnergy: 0, objective: -1000, ratio: 0 };
  }

  const src = corners.map((p) => ({ x: p.x * sourceWidth, y: p.y * sourceHeight }));
  const dst = [
    { x: 0, y: 0 },
    { x: destSize - 1, y: 0 },
    { x: destSize - 1, y: destSize - 1 },
    { x: 0, y: destSize - 1 },
  ];

  const forward = computeHomography(src, dst);
  if (!forward) return { score: 0, gridEnergy: 0, interiorEnergy: 0, objective: -1000, ratio: 0 };
  const inv = invertHomography(forward);
  if (!inv) return { score: 0, gridEnergy: 0, interiorEnergy: 0, objective: -1000, ratio: 0 };

  const S = destSize / 8;
  const step = destSize / sampleSteps;

  let gridEnergySum = 0;
  let gridCount = 0;
  let intEnergySum = 0;
  let intCount = 0;

  // 9 vertical lines at k * S, k = 0..8
  for (let k = 0; k <= 8; k += 1) {
    const u = k * S;
    for (let i = 1; i < sampleSteps - 1; i += 1) {
      const v = i * step;
      const pLeft = applyHomography(inv, u - 1.5, v);
      const pRight = applyHomography(inv, u + 1.5, v);
      const valL = sampleLuminanceBilinear(lum, sourceWidth, sourceHeight, pLeft.x, pLeft.y);
      const valR = sampleLuminanceBilinear(lum, sourceWidth, sourceHeight, pRight.x, pRight.y);
      gridEnergySum += Math.abs(valR - valL);
      gridCount += 1;
    }
  }

  // 9 horizontal lines at k * S, k = 0..8
  for (let k = 0; k <= 8; k += 1) {
    const v = k * S;
    for (let i = 1; i < sampleSteps - 1; i += 1) {
      const u = i * step;
      const pTop = applyHomography(inv, u, v - 1.5);
      const pBottom = applyHomography(inv, u, v + 1.5);
      const valT = sampleLuminanceBilinear(lum, sourceWidth, sourceHeight, pTop.x, pTop.y);
      const valB = sampleLuminanceBilinear(lum, sourceWidth, sourceHeight, pBottom.x, pBottom.y);
      gridEnergySum += Math.abs(valB - valT);
      gridCount += 1;
    }
  }

  // 8 vertical interior lines at (k + 0.5) * S, k = 0..7
  for (let k = 0; k < 8; k += 1) {
    const u = (k + 0.5) * S;
    for (let i = 1; i < sampleSteps - 1; i += 1) {
      const v = i * step;
      const pLeft = applyHomography(inv, u - 1.5, v);
      const pRight = applyHomography(inv, u + 1.5, v);
      const valL = sampleLuminanceBilinear(lum, sourceWidth, sourceHeight, pLeft.x, pLeft.y);
      const valR = sampleLuminanceBilinear(lum, sourceWidth, sourceHeight, pRight.x, pRight.y);
      intEnergySum += Math.abs(valR - valL);
      intCount += 1;
    }
  }

  // 8 horizontal interior lines at (k + 0.5) * S, k = 0..7
  for (let k = 0; k < 8; k += 1) {
    const v = (k + 0.5) * S;
    for (let i = 1; i < sampleSteps - 1; i += 1) {
      const u = i * step;
      const pTop = applyHomography(inv, u, v - 1.5);
      const pBottom = applyHomography(inv, u, v + 1.5);
      const valT = sampleLuminanceBilinear(lum, sourceWidth, sourceHeight, pTop.x, pTop.y);
      const valB = sampleLuminanceBilinear(lum, sourceWidth, sourceHeight, pBottom.x, pBottom.y);
      intEnergySum += Math.abs(valB - valT);
      intCount += 1;
    }
  }

  const avgGrid = gridCount > 0 ? gridEnergySum / gridCount : 0;
  const avgInt = intCount > 0 ? intEnergySum / intCount : 0;
  // Damping constant 15 prevents degenerate saturation on flat/clean interiors
  const ratio = (avgGrid + 1e-4) / (avgGrid + avgInt + 15);

  const rawScore = (ratio - 0.25) * 155;
  const score = Math.round(Math.max(0, Math.min(100, rawScore)));

  // Smooth continuous objective for coordinate descent
  const objective = avgGrid - 0.5 * avgInt;

  return {
    score,
    gridEnergy: Math.round(avgGrid * 10) / 10,
    interiorEnergy: Math.round(avgInt * 10) / 10,
    ratio: Math.round(ratio * 1000) / 1000,
    objective,
  };
}

/**
 * Perform local search (~2% of board size) around each corner to maximize grid-alignment score.
 *
 * @param {Object} options
 * @param {Array<{x:number, y:number}>} options.corners - Initial 4 normalized corners (0..1)
 * @param {HTMLVideoElement|HTMLCanvasElement|ImageData|Object} options.source - Source frame
 * @param {number} [options.sourceWidth] - Width of source image
 * @param {number} [options.sourceHeight] - Height of source image
 * @param {number} [options.maxSearchFrac=0.025] - Search radius as fraction of board size (~2.5%)
 * @param {Array<{radiusFrac:number}>} [options.passes] - Search passes
 * @returns {Object} Refinement result
 */
export function refineCorners({
  corners,
  source,
  sourceWidth = 0,
  sourceHeight = 0,
  maxSearchFrac = 0.025,
  passes = [{ radiusFrac: 1.0 }, { radiusFrac: 0.5 }, { radiusFrac: 0.2 }],
}) {
  if (!corners || corners.length !== 4) {
    return {
      refinedCorners: corners ? [...corners] : [],
      originalCorners: corners || [],
      initialScore: 0,
      refinedScore: 0,
      improvementPct: 0,
      improved: false,
      shifts: [],
      maxShiftPx: 0,
      elapsedMs: 0,
      evaluations: 0,
      error: 'Invalid corners',
    };
  }

  const pixelData = getSourcePixelData(source, sourceWidth, sourceHeight);
  if (!pixelData) {
    return {
      refinedCorners: [...corners],
      originalCorners: [...corners],
      initialScore: 0,
      refinedScore: 0,
      improvementPct: 0,
      improved: false,
      shifts: [],
      maxShiftPx: 0,
      elapsedMs: 0,
      evaluations: 0,
      error: 'No source image data',
    };
  }

  const W = pixelData.width;
  const H = pixelData.height;
  const lum = extractLuminance(pixelData);
  if (!lum) {
    return {
      refinedCorners: [...corners],
      originalCorners: [...corners],
      initialScore: 0,
      refinedScore: 0,
      improvementPct: 0,
      improved: false,
      shifts: [],
      maxShiftPx: 0,
      elapsedMs: 0,
      evaluations: 0,
      error: 'Failed to extract luminance',
    };
  }

  // Calculate physical board size in pixels
  const p0 = { x: corners[0].x * W, y: corners[0].y * H };
  const p1 = { x: corners[1].x * W, y: corners[1].y * H };
  const p2 = { x: corners[2].x * W, y: corners[2].y * H };
  const p3 = { x: corners[3].x * W, y: corners[3].y * H };

  const topW = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const botW = Math.hypot(p2.x - p3.x, p2.y - p3.y);
  const leftH = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const rightH = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const avgBoardPixels = Math.max(10, (topW + botW + leftH + rightH) / 4);

  // Maximum shift in normalized coordinates (~2% to 2.5% of board size)
  const maxSearchPixels = avgBoardPixels * maxSearchFrac;
  const maxNormX = maxSearchPixels / W;
  const maxNormY = maxSearchPixels / H;

  let bestCorners = corners.map((c) => ({ x: c.x, y: c.y }));
  const initialEval = computeDirectGridScore({
    corners: bestCorners,
    lum,
    sourceWidth: W,
    sourceHeight: H,
  });

  let currentObjective = initialEval.objective;
  const tStart = performance.now();
  let evaluations = 1;

  // Multi-pass coordinate descent
  for (const pass of passes) {
    const rx = maxNormX * pass.radiusFrac;
    const ry = maxNormY * pass.radiusFrac;

    for (let cIdx = 0; cIdx < 4; cIdx += 1) {
      let cornerBestX = bestCorners[cIdx].x;
      let cornerBestY = bestCorners[cIdx].y;
      let cornerBestObjective = currentObjective;

      for (let sX = -1; sX <= 1; sX += 1) {
        for (let sY = -1; sY <= 1; sY += 1) {
          if (sX === 0 && sY === 0) continue;
          const candidateX = Math.min(0.999, Math.max(0.001, bestCorners[cIdx].x + sX * rx));
          const candidateY = Math.min(0.999, Math.max(0.001, bestCorners[cIdx].y + sY * ry));

          const testCorners = bestCorners.map((c, i) =>
            i === cIdx ? { x: candidateX, y: candidateY } : c,
          );

          evaluations += 1;
          const testEval = computeDirectGridScore({
            corners: testCorners,
            lum,
            sourceWidth: W,
            sourceHeight: H,
          });

          if (testEval.objective > cornerBestObjective) {
            cornerBestObjective = testEval.objective;
            cornerBestX = candidateX;
            cornerBestY = candidateY;
          }
        }
      }

      if (cornerBestObjective > currentObjective) {
        bestCorners[cIdx] = { x: cornerBestX, y: cornerBestY };
        currentObjective = cornerBestObjective;
      }
    }
  }

  const finalEval = computeDirectGridScore({
    corners: bestCorners,
    lum,
    sourceWidth: W,
    sourceHeight: H,
  });

  const elapsedMs = Math.round((performance.now() - tStart) * 10) / 10;

  // Calculate per-corner shifts
  let maxShiftPx = 0;
  const shifts = bestCorners.map((c, i) => {
    const orig = corners[i];
    const dxPx = (c.x - orig.x) * W;
    const dyPx = (c.y - orig.y) * H;
    const distPx = Math.round(Math.hypot(dxPx, dyPx) * 10) / 10;
    if (distPx > maxShiftPx) maxShiftPx = distPx;
    return {
      cornerIndex: i,
      dxPx: Math.round(dxPx * 10) / 10,
      dyPx: Math.round(dyPx * 10) / 10,
      distPx,
      distPctBoard: Math.round((distPx / avgBoardPixels) * 1000) / 10,
    };
  });

  const initialScore = initialEval.score;
  const refinedScore = finalEval.score;
  const improved = refinedScore > initialScore || currentObjective > initialEval.objective + 0.1;
  const improvementPct =
    initialScore > 0
      ? Math.round(((refinedScore - initialScore) / initialScore) * 100)
      : refinedScore > 0
        ? 100
        : 0;

  return {
    refinedCorners: bestCorners,
    originalCorners: [...corners],
    initialScore,
    refinedScore,
    improvementPct,
    improved,
    shifts,
    maxShiftPx,
    avgBoardPixels: Math.round(avgBoardPixels),
    elapsedMs,
    evaluations,
    initialMetrics: initialEval,
    finalMetrics: finalEval,
  };
}
