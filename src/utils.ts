import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Perspective transform math
export interface Point {
  x: number;
  y: number;
}

/**
 * Calculates the homography matrix for perspective transformation
 * Based on: http://franklinta.com/2014/09/08/computing-homography-to-transform-images-with-javascript-and-gl-matrix/
 */
export function getPerspectiveTransform(src: Point[], dst: Point[]) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy, dx]);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy, dy]);
  }

  const b = A.map(row => row.pop()!);
  const h = solveLinearSystem(A, b);
  return [...h, 1];
}

function solveLinearSystem(A: number[][], b: number[]) {
  const n = A.length;
  for (let i = 0; i < n; i++) {
    let max = i;
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(A[j][i]) > Math.abs(A[max][i])) max = j;
    }
    [A[i], A[max]] = [A[max], A[i]];
    [b[i], b[max]] = [b[max], b[i]];

    const pivot = A[i][i];
    if (Math.abs(pivot) < 1e-10) continue;

    for (let j = i + 1; j < n; j++) {
      const factor = A[j][i] / pivot;
      b[j] -= factor * b[i];
      for (let k = i; k < n; k++) {
        A[j][k] -= factor * A[i][k];
      }
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = 0;
    for (let j = i + 1; j < n; j++) {
      sum += A[i][j] * x[j];
    }
    if (Math.abs(A[i][i]) < 1e-10) x[i] = 0;
    else x[i] = (b[i] - sum) / A[i][i];
  }
  return x;
}

export function applyTransform(ctx: CanvasRenderingContext2D, img: HTMLImageElement, src: Point[], width: number, height: number) {
  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height }
  ];

  // We want to map destination pixels (x, y) back to source pixels (sx, sy)
  // So we calculate the transform from dst to src
  const h = getPerspectiveTransform(dst, src);
  
  const srcWidth = img.naturalWidth;
  const srcHeight = img.naturalHeight;
  
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcWidth;
  srcCanvas.height = srcHeight;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
  srcCtx.drawImage(img, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, srcWidth, srcHeight);
  
  const dstData = ctx.createImageData(width, height);
  const dstPixels = dstData.data;
  const srcPixels = srcData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const z = h[6] * x + h[7] * y + h[8];
      const sx = (h[0] * x + h[1] * y + h[2]) / z;
      const sy = (h[3] * x + h[4] * y + h[5]) / z;

      const dstIdx = (y * width + x) * 4;

      if (sx >= 0 && sx < srcWidth && sy >= 0 && sy < srcHeight) {
        const ix = Math.floor(sx);
        const iy = Math.floor(sy);
        const srcIdx = (iy * srcWidth + ix) * 4;
        
        dstPixels[dstIdx] = srcPixels[srcIdx];
        dstPixels[dstIdx + 1] = srcPixels[srcIdx + 1];
        dstPixels[dstIdx + 2] = srcPixels[srcIdx + 2];
        dstPixels[dstIdx + 3] = srcPixels[srcIdx + 3];
      } else {
        dstPixels[dstIdx] = 255;
        dstPixels[dstIdx + 1] = 255;
        dstPixels[dstIdx + 2] = 255;
        dstPixels[dstIdx + 3] = 255;
      }
    }
  }
  ctx.putImageData(dstData, 0, 0);
}
