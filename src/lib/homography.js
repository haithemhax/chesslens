// Projective geometry used by the calibration step.
//
// The operator clicks the four board corners in the camera image. We compute
// the homography that maps those source points to a top-down 512x512 square,
// invert it once, and precompute a source-pixel lookup table for every pixel
// of the top-down image. Warping a frame then becomes a tight loop with no
// per-pixel matrix math.

export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    if (Math.abs(M[pivot][col]) < 1e-10) return null;
    if (pivot !== col) [M[pivot], M[col]] = [M[col], M[pivot]];

    const div = M[col][col];
    for (let j = col; j <= n; j += 1) M[col][j] /= div;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = M[row][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j += 1) M[row][j] -= factor * M[col][j];
    }
  }

  return M.map((row) => row[n]);
}

/**
 * Compute the 3x3 homography (row-major, h33 = 1) mapping src points to dst.
 * Both arguments are arrays of four {x, y} points.
 */
export function computeHomography(src, dst) {
  if (src.length !== 4 || dst.length !== 4) return null;
  const A = [];
  const b = [];

  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }

  const h = solveLinear(A, b);
  if (!h || h.some((v) => !Number.isFinite(v))) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function invertHomography(h) {
  const [a, b, c, d, e, f, g, i, j] = h;
  const det = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
  if (Math.abs(det) < 1e-12) return null;

  return [
    (e * j - f * i) / det,
    (c * i - b * j) / det,
    (b * f - c * e) / det,
    (f * g - d * j) / det,
    (a * j - c * g) / det,
    (c * d - a * f) / det,
    (d * i - e * g) / det,
    (b * g - a * i) / det,
    (a * e - b * d) / det,
  ];
}

export function applyHomography(h, x, y) {
  const denom = h[6] * x + h[7] * y + h[8];
  if (Math.abs(denom) < 1e-12) return { x: NaN, y: NaN };
  return {
    x: (h[0] * x + h[1] * y + h[2]) / denom,
    y: (h[3] * x + h[4] * y + h[5]) / denom,
  };
}

/**
 * Build a nearest-neighbour lookup table from a 512x512 top-down image to the
 * source camera frame. `corners` are normalized (0..1) TL, TR, BR, BL points
 * relative to the video dimensions.
 */
export function buildWarpMap({ corners, destSize, sourceWidth, sourceHeight }) {
  if (!corners || corners.length !== 4) return null;

  const src = corners.map((p) => ({ x: p.x * sourceWidth, y: p.y * sourceHeight }));
  const dst = [
    { x: 0, y: 0 },
    { x: destSize - 1, y: 0 },
    { x: destSize - 1, y: destSize - 1 },
    { x: 0, y: destSize - 1 },
  ];

  const forward = computeHomography(src, dst);
  if (!forward) return null;
  const inverse = invertHomography(forward);
  if (!inverse) return null;

  const offsets = new Int32Array(destSize * destSize);
  const sourceX = new Float32Array(destSize * destSize);
  const sourceY = new Float32Array(destSize * destSize);

  let ptr = 0;
  for (let y = 0; y < destSize; y += 1) {
    for (let x = 0; x < destSize; x += 1) {
      const p = applyHomography(inverse, x + 0.5, y + 0.5);
      const sx = Math.min(sourceWidth - 1, Math.max(0, Math.round(p.x)));
      const sy = Math.min(sourceHeight - 1, Math.max(0, Math.round(p.y)));
      sourceX[ptr] = sx;
      sourceY[ptr] = sy;
      offsets[ptr] = (sy * sourceWidth + sx) * 4;
      ptr += 1;
    }
  }

  return {
    offsets,
    sourceX,
    sourceY,
    forward,
    inverse,
    destSize,
    sourceWidth,
    sourceHeight,
  };
}

/** Map a board square (e.g. "e4") to the corresponding top-down cell index. */
export function squareToCell(square, flipped) {
  const file = square.charCodeAt(0) - 97; // a=0 ... h=7
  const rank = Number(square[1]) - 1; // 1..8
  const col = flipped ? 7 - file : file;
  const row = flipped ? rank : 7 - rank;
  return row * 8 + col;
}

/** Map a top-down cell index (0..63) to a board square. */
export function cellToSquare(index, flipped) {
  const row = Math.floor(index / 8);
  const col = index % 8;
  const file = flipped ? 7 - col : col;
  const rank = flipped ? row + 1 : 8 - row;
  return String.fromCharCode(97 + file) + rank;
}

export function isCellInside(index) {
  return Number.isInteger(index) && index >= 0 && index < 64;
}
