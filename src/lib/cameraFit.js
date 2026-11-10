/**
 * Camera Fit Check for ChessLens.
 *
 * Evaluates whether the physical camera framing, resolution, angle, sharpness,
 * and lighting are suitable for reliable chess piece and move detection.
 *
 * Runs strictly on the operator side. Never blocks the live show.
 */

import {
  cellToSquare,
  squareToCell,
  computeHomography,
  invertHomography,
  applyHomography,
} from './homography.js';

export const CAMERA_FIT_CONFIG = {
  // 1. Board inside frame: normalized distance from camera edges
  edgeMarginMin: 0.03, // 3% safety margin inside every frame edge
  
  // 2. Board size in camera pixels: sqrt(quad area) / 8
  pixelsPerSquareGood: 60, // >= 60 px/square is sharp and comfortable
  pixelsPerSquareWarn: 35, // 35 - 60 px/square is borderline
  heightFractionTarget: 0.65, // Board should fill at least 65% of frame height
  heightFractionWarn: 0.50, // Below 50% frame height is too small
  
  // 3. Perspective tilt: maximum angle deviation from 90 degrees
  angleDeviationWarnDeg: 15, // > 15 deg deviation warns of excessive perspective
  angleDeviationPoorDeg: 25, // > 25 deg deviation is too steep
  
  // 4. Centering: normalized offset of quadrilateral centroid from frame center (0.5, 0.5)
  centerOffsetWarn: 0.08, // > 8% offset triggers a pan/center recommendation
  
  // 5. Grid alignment score (0 - 100)
  gridScoreGood: 55, // >= 55 indicates well-aligned physical square grid
  gridScoreWarn: 35, // 35 - 55 is borderline; < 35 indicates misaligned corners
  
  // 6. Sharpness (variance of the Laplacian)
  sharpnessMinAbsolute: 60, // Minimum absolute sharpness variance
  sharpnessDropWarnPct: 40, // Warn if sharpness drops by > 40% from baseline
  sharpnessDropPoorPct: 60, // Poor if sharpness drops by > 60% from baseline
  
  // 7. Exposure and glare
  brightnessMin: 60, // Warn if average luminance is under 60
  brightnessMax: 200, // Warn if average luminance is over 200
  glarePixelThreshold: 250, // Pixel channel threshold for near-saturation
  glareFrameMaxPct: 3.0, // Overall frame saturation > 3% warns of glare
  glareSquareMinPct: 6.0, // Saturated pixels > 6% in an individual square flags glare
  
  // Downscaled resolution for fast analysis (< 5 ms)
  analysisSize: 256,
};

/**
 * Compute geometric metrics of the 4 calibrated corners in camera pixel space.
 * `corners` are normalized {x, y} points in [0, 1].
 */
export function computeQuadrilateralMetrics(corners, videoWidth = 1280, videoHeight = 720) {
  if (!Array.isArray(corners) || corners.length !== 4) {
    return {
      isValid: false,
      corners: [],
      isOutside: false,
      isCloseToEdge: false,
      pixelsPerSquare: 0,
      heightFraction: 0,
      maxAngleDeviation: 0,
      centroid: { x: 0.5, y: 0.5 },
      centroidOffset: { dx: 0, dy: 0 },
      edgeDistances: { left: 0, right: 0, top: 0, bottom: 0 },
      messages: ['Fit the whole board inside the frame'],
      hints: [],
    };
  }

  const W = Math.max(1, videoWidth);
  const H = Math.max(1, videoHeight);

  // Pixel coordinates
  const P = corners.map((c) => ({
    x: c.x * W,
    y: c.y * H,
    normX: c.x,
    normY: c.y,
  }));

  // 1. Edge margins and boundary checks
  let isOutside = false;
  let isCloseToEdge = false;
  let minLeft = 1;
  let minRight = 1;
  let minTop = 1;
  let minBottom = 1;

  for (const pt of corners) {
    if (pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1) {
      isOutside = true;
    }
    const distLeft = pt.x;
    const distRight = 1 - pt.x;
    const distTop = pt.y;
    const distBottom = 1 - pt.y;

    if (distLeft < minLeft) minLeft = distLeft;
    if (distRight < minRight) minRight = distRight;
    if (distTop < minTop) minTop = distTop;
    if (distBottom < minBottom) minBottom = distBottom;

    if (
      distLeft < CAMERA_FIT_CONFIG.edgeMarginMin ||
      distRight < CAMERA_FIT_CONFIG.edgeMarginMin ||
      distTop < CAMERA_FIT_CONFIG.edgeMarginMin ||
      distBottom < CAMERA_FIT_CONFIG.edgeMarginMin
    ) {
      isCloseToEdge = true;
    }
  }

  // 2. Shoelace area for quadrilateral
  // P0: TL, P1: TR, P2: BR, P3: BL
  const area = 0.5 * Math.abs(
    (P[0].x * P[1].y - P[1].x * P[0].y) +
    (P[1].x * P[2].y - P[2].x * P[1].y) +
    (P[2].x * P[3].y - P[3].x * P[2].y) +
    (P[3].x * P[0].y - P[0].x * P[3].y)
  );

  const pixelsPerSquare = Math.round((Math.sqrt(Math.max(0, area)) / 8) * 10) / 10;

  // Fraction of frame height filled by board bounding box
  const minY = Math.min(...corners.map((p) => p.y));
  const maxY = Math.max(...corners.map((p) => p.y));
  const heightFraction = Math.max(0, Math.min(1, maxY - minY));

  // 3. Perspective tilt: interior corner angles
  const angles = [];
  for (let i = 0; i < 4; i += 1) {
    const prev = P[(i + 3) % 4];
    const curr = P[i];
    const next = P[(i + 1) % 4];

    const v1x = prev.x - curr.x;
    const v1y = prev.y - curr.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    const dot = v1x * v2x + v1y * v2y;
    const mag1 = Math.hypot(v1x, v1y);
    const mag2 = Math.hypot(v2x, v2y);
    if (mag1 > 0 && mag2 > 0) {
      const cosVal = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
      const deg = (Math.acos(cosVal) * 180) / Math.PI;
      angles.push(deg);
    } else {
      angles.push(90);
    }
  }

  const angleDeviations = angles.map((a) => Math.abs(a - 90));
  const maxAngleDeviation = Math.round(Math.max(...angleDeviations) * 10) / 10;

  // 4. Centering offset
  const centroidX = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const centroidY = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  const dx = centroidX - 0.5;
  const dy = centroidY - 0.5;

  const messages = [];
  const hints = [];

  // Edge and cut-off messages
  if (isOutside || isCloseToEdge) {
    if (minRight < CAMERA_FIT_CONFIG.edgeMarginMin) {
      messages.push('Board is cut off on the right: move the phone left');
      hints.push('pan_left');
    }
    if (minLeft < CAMERA_FIT_CONFIG.edgeMarginMin) {
      messages.push('Board is cut off on the left: move the phone right');
      hints.push('pan_right');
    }
    if (minTop < CAMERA_FIT_CONFIG.edgeMarginMin) {
      messages.push('Board is cut off at the top: move the phone down');
      hints.push('pan_down');
    }
    if (minBottom < CAMERA_FIT_CONFIG.edgeMarginMin) {
      messages.push('Board is cut off at the bottom: move the phone up');
      hints.push('pan_up');
    }
  } else if (Math.abs(dx) > CAMERA_FIT_CONFIG.centerOffsetWarn || Math.abs(dy) > CAMERA_FIT_CONFIG.centerOffsetWarn) {
    if (dx > CAMERA_FIT_CONFIG.centerOffsetWarn) {
      hints.push('pan_left');
      messages.push('Board is off-center to the right: move the phone left');
    } else if (dx < -CAMERA_FIT_CONFIG.centerOffsetWarn) {
      hints.push('pan_right');
      messages.push('Board is off-center to the left: move the phone right');
    }
    if (dy > CAMERA_FIT_CONFIG.centerOffsetWarn) {
      hints.push('pan_up');
      messages.push('Board is off-center towards bottom: move the phone up');
    } else if (dy < -CAMERA_FIT_CONFIG.centerOffsetWarn) {
      hints.push('pan_down');
      messages.push('Board is off-center towards top: move the phone down');
    }
  }

  // Size messages
  if (pixelsPerSquare < CAMERA_FIT_CONFIG.pixelsPerSquareWarn) {
    messages.push('Board is too small: move the phone closer or zoom in');
  } else if (pixelsPerSquare < CAMERA_FIT_CONFIG.pixelsPerSquareGood || heightFraction < CAMERA_FIT_CONFIG.heightFractionWarn) {
    messages.push('Board is small: move the phone closer if possible');
  }

  // Tilt messages
  if (maxAngleDeviation > CAMERA_FIT_CONFIG.angleDeviationPoorDeg) {
    messages.push('Phone is tilted: place it directly above the board');
  } else if (maxAngleDeviation > CAMERA_FIT_CONFIG.angleDeviationWarnDeg) {
    messages.push('Phone is slightly tilted: level the camera');
  }

  return {
    isValid: true,
    corners,
    isOutside,
    isCloseToEdge,
    pixelsPerSquare,
    heightFraction: Math.round(heightFraction * 100) / 100,
    maxAngleDeviation,
    centroid: { x: centroidX, y: centroidY },
    centroidOffset: { dx: Math.round(dx * 100) / 100, dy: Math.round(dy * 100) / 100 },
    edgeDistances: {
      left: Math.round(minLeft * 100) / 100,
      right: Math.round(minRight * 100) / 100,
      top: Math.round(minTop * 100) / 100,
      bottom: Math.round(minBottom * 100) / 100,
    },
    messages,
    hints,
  };
}

/**
 * Measure image-based metrics on the downscaled warped board:
 * grid alignment score, sharpness (Laplacian variance), exposure, and glare squares.
 *
 * `imageData` is an ImageData or an object { data: Uint8ClampedArray|Uint8Array, width, height }
 * of size 256x256.
 */
export function computeWarpedImageMetrics(imageData, baselineSharpness = null, flip = false) {
  if (!imageData || !imageData.data || imageData.width < 8 || imageData.height < 8) {
    return {
      gridScore: 0,
      sharpness: 0,
      sharpnessDropPct: null,
      meanBrightness: 0,
      saturationPct: 0,
      glareSquares: [],
      messages: [],
    };
  }

  const { data, width, height } = imageData;
  const totalPixels = width * height;

  // Single-pass luminance and saturation
  const lum = new Float32Array(totalPixels);
  let sumLum = 0;
  let satCount = 0;

  // Per-square glare tracking (8x8 squares)
  const cellW = width / 8;
  const cellH = height / 8;
  const squareSatCounts = new Int32Array(64);
  const squarePixelCounts = new Int32Array(64);

  const satThreshold = CAMERA_FIT_CONFIG.glarePixelThreshold;

  for (let i = 0, ptr = 0; i < totalPixels; i += 1, ptr += 4) {
    const r = data[ptr];
    const g = data[ptr + 1];
    const b = data[ptr + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[i] = y;
    sumLum += y;

    const isSat = r >= satThreshold && g >= satThreshold && b >= satThreshold;
    if (isSat) satCount += 1;

    // Which of the 64 squares does pixel (px, py) belong to?
    const px = i % width;
    const py = Math.floor(i / width);
    const col = Math.min(7, Math.floor(px / cellW));
    const row = Math.min(7, Math.floor(py / cellH));
    const cellIdx = row * 8 + col;
    squarePixelCounts[cellIdx] += 1;
    if (isSat) squareSatCounts[cellIdx] += 1;
  }

  const meanBrightness = Math.round(sumLum / totalPixels);
  const saturationPct = Math.round((satCount / totalPixels) * 1000) / 10;

  // Find individual squares with high glare
  const glareSquares = [];
  for (let cell = 0; cell < 64; cell += 1) {
    const count = squarePixelCounts[cell];
    if (count > 0) {
      const squareSatPct = (squareSatCounts[cell] / count) * 100;
      if (squareSatPct >= CAMERA_FIT_CONFIG.glareSquareMinPct) {
        glareSquares.push(cellToSquare(cell, flip));
      }
    }
  }

  // 6. Sharpness via Variance of the Laplacian
  // Step 2 across image for speed (< 1 ms on 256x256)
  let sumLap = 0;
  let sumLapSq = 0;
  let lapCount = 0;

  for (let y = 2; y < height - 2; y += 2) {
    const rowOffset = y * width;
    for (let x = 2; x < width - 2; x += 2) {
      const idx = rowOffset + x;
      const lap =
        lum[idx - 1] +
        lum[idx + 1] +
        lum[idx - width] +
        lum[idx + width] -
        4 * lum[idx];
      sumLap += lap;
      sumLapSq += lap * lap;
      lapCount += 1;
    }
  }

  let sharpness = 0;
  if (lapCount > 0) {
    const meanLap = sumLap / lapCount;
    sharpness = Math.round((sumLapSq / lapCount - meanLap * meanLap) * 10) / 10;
  }

  let sharpnessDropPct = null;
  if (baselineSharpness && baselineSharpness > 10) {
    const drop = ((baselineSharpness - sharpness) / baselineSharpness) * 100;
    sharpnessDropPct = Math.round(Math.max(0, drop));
  }

  // 5. Grid alignment score: contrast on grid lines vs center of squares
  // In 256x256, each square is 32 px.
  // Interior grid lines are at 32, 64, 96, 128, 160, 192, 224.
  // Centers are at 16, 48, 80, 112, 144, 176, 208, 240.
  let gridGradSum = 0;
  let gridGradSamples = 0;
  let centerGradSum = 0;
  let centerGradSamples = 0;

  // Horizontal gradient across vertical boundaries
  for (let k = 1; k <= 7; k += 1) {
    const gridX = Math.round(k * cellW);
    const midX = Math.round((k - 0.5) * cellW);
    for (let y = 4; y < height - 4; y += 2) {
      const gIdx = y * width + gridX;
      gridGradSum += Math.abs(lum[gIdx + 1] - lum[gIdx - 1]);
      gridGradSamples += 1;

      const mIdx = y * width + midX;
      centerGradSum += Math.abs(lum[mIdx + 1] - lum[mIdx - 1]);
      centerGradSamples += 1;
    }
  }

  // Vertical gradient across horizontal boundaries
  for (let k = 1; k <= 7; k += 1) {
    const gridY = Math.round(k * cellH);
    const midY = Math.round((k - 0.5) * cellH);
    for (let x = 4; x < width - 4; x += 2) {
      const gIdx = gridY * width + x;
      gridGradSum += Math.abs(lum[gIdx + width] - lum[gIdx - width]);
      gridGradSamples += 1;

      const mIdx = midY * width + x;
      centerGradSum += Math.abs(lum[mIdx + width] - lum[mIdx - width]);
      centerGradSamples += 1;
    }
  }

  const avgGridGrad = gridGradSamples > 0 ? gridGradSum / gridGradSamples : 0;
  const avgCenterGrad = centerGradSamples > 0 ? centerGradSum / centerGradSamples : 0;
  const ratio = (avgGridGrad + 1e-4) / (avgGridGrad + avgCenterGrad + 2e-4);

  // Scaled 0 to 100: ratio 0.40 is 0, ratio 0.85 is 100
  const rawScore = (ratio - 0.4) * 220;
  const gridScore = Math.round(Math.max(0, Math.min(100, rawScore)));

  const messages = [];

  // Glare message
  if (glareSquares.length > 0) {
    const displayList = glareSquares.slice(0, 4).join(', ');
    messages.push(`Glare on ${displayList}: move the lamp or change the angle`);
  } else if (saturationPct > CAMERA_FIT_CONFIG.glareFrameMaxPct) {
    messages.push('High glare detected: move the lamp or change the angle');
  }

  // Brightness messages
  if (meanBrightness < CAMERA_FIT_CONFIG.brightnessMin) {
    messages.push('Lighting is too dark: increase room lighting');
  } else if (meanBrightness > CAMERA_FIT_CONFIG.brightnessMax) {
    messages.push('Lighting is too bright: reduce exposure');
  }

  // Sharpness message
  if (sharpnessDropPct != null && sharpnessDropPct >= CAMERA_FIT_CONFIG.sharpnessDropWarnPct) {
    messages.push('Image is blurry: clean the lens or lock the focus');
  } else if (sharpness < CAMERA_FIT_CONFIG.sharpnessMinAbsolute) {
    messages.push('Image is blurry: clean the lens or lock the focus');
  }

  // Misaligned corners score
  if (gridScore < CAMERA_FIT_CONFIG.gridScoreWarn) {
    messages.push('Grid alignment is low: check corner placement');
  }

  return {
    gridScore,
    sharpness,
    sharpnessDropPct,
    meanBrightness,
    saturationPct,
    glareSquares,
    messages,
  };
}

/**
 * Full Camera Fit evaluation combining geometry and warped image analysis.
 *
 * Returns overall status: 'good' | 'warning' | 'poor', an overall score (0-100),
 * and actionable operator messages.
 */
export function evaluateCameraFit({
  corners = null,
  videoWidth = 1280,
  videoHeight = 720,
  imageData = null,
  baselineSharpness = null,
  driftDetected = false,
  flip = false,
} = {}) {
  const geom = computeQuadrilateralMetrics(corners, videoWidth, videoHeight);
  const img = imageData ? computeWarpedImageMetrics(imageData, baselineSharpness, flip) : null;

  const allMessages = [...geom.messages];
  if (img) {
    for (const msg of img.messages) {
      if (!geom.isValid && msg.includes('Grid alignment')) continue;
      if (!allMessages.includes(msg)) allMessages.push(msg);
    }
  }

  // 8. Drift detection reuse
  if (driftDetected) {
    const driftMsg = 'Camera moved: recalibrate';
    if (!allMessages.includes(driftMsg)) {
      allMessages.unshift(driftMsg);
    }
  }

  // Determine overall status
  let status = 'good';

  if (!geom.isValid) {
    status = 'warning';
  } else if (
    geom.isOutside ||
    geom.pixelsPerSquare < CAMERA_FIT_CONFIG.pixelsPerSquareWarn ||
    geom.maxAngleDeviation > CAMERA_FIT_CONFIG.angleDeviationPoorDeg ||
    driftDetected ||
    (img && img.gridScore < CAMERA_FIT_CONFIG.gridScoreWarn) ||
    (img && img.sharpnessDropPct != null && img.sharpnessDropPct >= CAMERA_FIT_CONFIG.sharpnessDropPoorPct) ||
    (img && img.saturationPct > CAMERA_FIT_CONFIG.glareFrameMaxPct * 2.5)
  ) {
    status = 'poor';
  } else if (
    geom.isCloseToEdge ||
    geom.pixelsPerSquare < CAMERA_FIT_CONFIG.pixelsPerSquareGood ||
    geom.maxAngleDeviation > CAMERA_FIT_CONFIG.angleDeviationWarnDeg ||
    geom.heightFraction < CAMERA_FIT_CONFIG.heightFractionWarn ||
    (img && img.gridScore < CAMERA_FIT_CONFIG.gridScoreGood) ||
    (img && img.sharpnessDropPct != null && img.sharpnessDropPct >= CAMERA_FIT_CONFIG.sharpnessDropWarnPct) ||
    (img && img.sharpness < CAMERA_FIT_CONFIG.sharpnessMinAbsolute) ||
    (img && img.glareSquares.length > 0) ||
    (img && (img.meanBrightness < CAMERA_FIT_CONFIG.brightnessMin || img.meanBrightness > CAMERA_FIT_CONFIG.brightnessMax))
  ) {
    status = 'warning';
  }

  // Calculate composite quality score (0 - 100)
  let score = 100;
  if (!geom.isValid) {
    score = 40;
  } else {
    if (geom.isOutside) score -= 40;
    else if (geom.isCloseToEdge) score -= 15;

    if (geom.pixelsPerSquare < CAMERA_FIT_CONFIG.pixelsPerSquareWarn) score -= 30;
    else if (geom.pixelsPerSquare < CAMERA_FIT_CONFIG.pixelsPerSquareGood) score -= 12;

    if (geom.maxAngleDeviation > CAMERA_FIT_CONFIG.angleDeviationPoorDeg) score -= 25;
    else if (geom.maxAngleDeviation > CAMERA_FIT_CONFIG.angleDeviationWarnDeg) score -= 10;

    if (driftDetected) score -= 35;

    if (img) {
      if (img.gridScore < CAMERA_FIT_CONFIG.gridScoreWarn) score -= 20;
      else if (img.gridScore < CAMERA_FIT_CONFIG.gridScoreGood) score -= 10;

      if (img.sharpnessDropPct != null && img.sharpnessDropPct >= CAMERA_FIT_CONFIG.sharpnessDropWarnPct) score -= 20;
      else if (img.sharpness < CAMERA_FIT_CONFIG.sharpnessMinAbsolute) score -= 15;

      if (img.glareSquares.length > 0) score -= Math.min(25, img.glareSquares.length * 5);
      if (img.meanBrightness < CAMERA_FIT_CONFIG.brightnessMin || img.meanBrightness > CAMERA_FIT_CONFIG.brightnessMax) score -= 15;
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    status,
    score,
    geom,
    img,
    messages: allMessages,
    hints: geom.hints,
    driftDetected,
  };
}

/**
 * Draw the Camera Fit guide overlay onto a camera canvas (e.g. in CalibrationView or Operator preview).
 */
export function drawCameraFitOverlay(
  ctx,
  width,
  height,
  fitResult = null,
  corners = null,
  flip = false,
) {
  if (!ctx || width <= 0 || height <= 0) return;

  const status = fitResult?.status || 'warning';
  const statusColor =
    status === 'good'
      ? 'rgba(52, 211, 153, 0.9)' // emerald
      : status === 'warning'
        ? 'rgba(251, 191, 36, 0.9)' // amber
        : 'rgba(239, 68, 68, 0.9)'; // red

  ctx.save();

  // 1. Dashed recommended-framing box (~75% width, ~70% height in center)
  const boxW = width * 0.76;
  const boxH = height * 0.72;
  const boxX = (width - boxW) / 2;
  const boxY = (height - boxH) / 2;

  ctx.strokeStyle = 'rgba(230, 192, 121, 0.4)';
  ctx.lineWidth = Math.max(1.5, width * 0.002);
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(boxX, boxY, boxW, boxH);
  ctx.setLineDash([]);

  // Corner guide accents on the recommended box
  const accentLen = Math.min(24, boxW * 0.08);
  ctx.strokeStyle = 'rgba(230, 192, 121, 0.7)';
  ctx.lineWidth = Math.max(2, width * 0.003);

  // TL corner accent
  ctx.beginPath();
  ctx.moveTo(boxX, boxY + accentLen);
  ctx.lineTo(boxX, boxY);
  ctx.lineTo(boxX + accentLen, boxY);
  ctx.stroke();

  // TR corner accent
  ctx.beginPath();
  ctx.moveTo(boxX + boxW - accentLen, boxY);
  ctx.lineTo(boxX + boxW, boxY);
  ctx.lineTo(boxX + boxW, boxY + accentLen);
  ctx.stroke();

  // BR corner accent
  ctx.beginPath();
  ctx.moveTo(boxX + boxW, boxY + boxH - accentLen);
  ctx.lineTo(boxX + boxW, boxY + boxH);
  ctx.lineTo(boxX + boxW - accentLen, boxY + boxH);
  ctx.stroke();

  // BL corner accent
  ctx.beginPath();
  ctx.moveTo(boxX + accentLen, boxY + boxH);
  ctx.lineTo(boxX, boxY + boxH);
  ctx.lineTo(boxX, boxY + boxH - accentLen);
  ctx.stroke();

  // 2. If no corners yet: draw instruction text inside the dashed box
  if (!corners || corners.length < 4) {
    ctx.fillStyle = 'rgba(240, 217, 168, 0.85)';
    ctx.font = `600 ${Math.max(12, width * 0.018)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Fit the whole board inside the frame', width / 2, boxY + 22);
    ctx.restore();
    return;
  }

  // 3. Draw calibrated quadrilateral colored by status
  ctx.strokeStyle = statusColor;
  ctx.lineWidth = Math.max(2.5, width * 0.0035);
  ctx.fillStyle = status === 'poor' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(240, 217, 168, 0.06)';

  ctx.beginPath();
  corners.forEach((pt, idx) => {
    const x = pt.x * width;
    const y = pt.y * height;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 4. Highlight glare squares if any
  if (fitResult?.img?.glareSquares?.length && corners.length === 4) {
    const src = corners.map((p) => ({ x: p.x * width, y: p.y * height }));
    const dst = [
      { x: 0, y: 0 },
      { x: 512, y: 0 },
      { x: 512, y: 512 },
      { x: 0, y: 512 },
    ];
    const forward = computeHomography(src, dst);
    const inv = forward ? invertHomography(forward) : null;

    if (inv) {
      for (const sq of fitResult.img.glareSquares) {
        const cell = squareToCell(sq, flip);
        const col = cell % 8;
        const row = Math.floor(cell / 8);
        const u0 = col * 64;
        const v0 = row * 64;
        const u1 = (col + 1) * 64;
        const v1 = (row + 1) * 64;

        const p0 = applyHomography(inv, u0, v0);
        const p1 = applyHomography(inv, u1, v0);
        const p2 = applyHomography(inv, u1, v1);
        const p3 = applyHomography(inv, u0, v1);

        if (
          Number.isFinite(p0.x) &&
          Number.isFinite(p1.x) &&
          Number.isFinite(p2.x) &&
          Number.isFinite(p3.x)
        ) {
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.closePath();

          ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
          ctx.lineWidth = Math.max(1.5, width * 0.002);
          ctx.stroke();

          const cx = (p0.x + p1.x + p2.x + p3.x) / 4;
          const cy = (p0.y + p1.y + p2.y + p3.y) / 4;
          ctx.fillStyle = '#fee2e2';
          ctx.font = `700 ${Math.max(10, width * 0.012)}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`⚡${sq}`, cx, cy);
        }
      }
    }
  }

  ctx.restore();
}

