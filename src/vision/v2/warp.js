import {
  buildWarpMap,
  computeHomography,
  invertHomography,
  applyHomography,
} from '../../lib/homography.js';

export const WARP_SIZE_V2 = 512;

/**
 * Allocate or reuse a 512x512 ImageData buffer.
 */
export function createWarpBuffer(destSize = WARP_SIZE_V2) {
  if (typeof ImageData !== 'undefined') {
    return new ImageData(destSize, destSize);
  }
  return {
    data: new Uint8ClampedArray(destSize * destSize * 4),
    width: destSize,
    height: destSize,
  };
}

/**
 * Extract pixel bytes from HTMLVideoElement, HTMLCanvasElement, ImageData or raw object.
 */
export function getSourcePixelData(source, sourceWidth, sourceHeight) {
  if (!source) return null;

  // Raw ImageData or { data, width, height }
  if (source.data && source.width && source.height) {
    return {
      data: source.data,
      width: source.width,
      height: source.height,
    };
  }

  // HTMLCanvasElement
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    const ctx = source.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const imgData = ctx.getImageData(0, 0, source.width, source.height);
    return {
      data: imgData.data,
      width: source.width,
      height: source.height,
    };
  }

  // HTMLVideoElement (drawn into an internal offscreen canvas)
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    const w = sourceWidth || source.videoWidth;
    const h = sourceHeight || source.videoHeight;
    if (!w || !h || source.readyState < 2) return null;

    if (typeof document !== 'undefined') {
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(source, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      return {
        data: imgData.data,
        width: w,
        height: h,
      };
    }
  }

  return null;
}

/**
 * Extract luminance channel Y from RGBA data.
 * lum = 0.299 * R + 0.587 * G + 0.114 * B
 */
export function extractLuminance(imageData, targetArray = null) {
  if (!imageData || !imageData.data) return null;
  const total = imageData.width * imageData.height;
  const lum = targetArray && targetArray.length >= total ? targetArray : new Float32Array(total);
  const data = imageData.data;

  for (let i = 0, p = 0; i < total; i += 1, p += 4) {
    lum[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return lum;
}

/**
 * Warp a source board frame into top-down 512x512 square using calibrated corners.
 * Reuses homography.js lookup table.
 */
export function warpBoard512({
  source,
  corners,
  sourceWidth = 0,
  sourceHeight = 0,
  destSize = WARP_SIZE_V2,
  warpMap = null,
  output = null,
}) {
  if (!corners || corners.length !== 4) return null;

  const srcPixels = getSourcePixelData(source, sourceWidth, sourceHeight);
  if (!srcPixels) return null;

  const w = srcPixels.width;
  const h = srcPixels.height;

  // Reuse or generate precomputed warp table
  const map =
    warpMap &&
    warpMap.destSize === destSize &&
    warpMap.sourceWidth === w &&
    warpMap.sourceHeight === h
      ? warpMap
      : buildWarpMap({ corners, destSize, sourceWidth: w, sourceHeight: h });

  if (!map) return null;

  const out = output || createWarpBuffer(destSize);
  const outData = out.data;
  const srcData = srcPixels.data;
  const offsets = map.offsets;
  const totalPixels = destSize * destSize;

  for (let i = 0; i < totalPixels; i += 1) {
    const srcIndex = offsets[i];
    const dstIndex = i * 4;
    outData[dstIndex] = srcData[srcIndex];
    outData[dstIndex + 1] = srcData[srcIndex + 1];
    outData[dstIndex + 2] = srcData[srcIndex + 2];
    outData[dstIndex + 3] = 255;
  }

  return {
    imageData: out,
    warpMap: map,
    width: destSize,
    height: destSize,
  };
}
