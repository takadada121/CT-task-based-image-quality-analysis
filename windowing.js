/**
 * 2D Window Functions Module
 * Applies 2D separable windowing to ROI image data.
 */
class Windowing {
  /**
   * Apply 2D window to ROI pixel array
   * @param {Float32Array} roiPixels 
   * @param {number} roiSize ROI width/height
   * @param {string} windowType "none" | "hann" | "hamming" | "welch" | "bartlett"
   * @returns {Object} { windowedPixels: Float32Array, meanSquareRatio: number }
   */
  static apply(roiPixels, roiSize, windowType = "none") {
    const N = roiSize * roiSize;
    const windowedPixels = new Float32Array(N);

    if (windowType === "none" || !windowType) {
      windowedPixels.set(roiPixels);
      return { windowedPixels, meanSquareRatio: 1.0 };
    }

    const w1d = this.get1DWindow(roiSize, windowType);
    let windowSumSq = 0.0;

    for (let y = 0; y < roiSize; y++) {
      const wy = w1d[y];
      for (let x = 0; x < roiSize; x++) {
        const wx = w1d[x];
        const w2d = wx * wy;
        const idx = y * roiSize + x;

        windowedPixels[idx] = roiPixels[idx] * w2d;
        windowSumSq += w2d * w2d;
      }
    }

    const meanSquareRatio = windowSumSq / N;

    return { windowedPixels, meanSquareRatio };
  }

  static get1DWindow(size, type) {
    const w = new Float32Array(size);
    const N = size - 1;

    for (let n = 0; n < size; n++) {
      if (type === "hann") {
        w[n] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * n) / N));
      } else if (type === "hamming") {
        w[n] = 0.54 - 0.46 * Math.cos((2.0 * Math.PI * n) / N);
      } else if (type === "welch") {
        const mid = N / 2.0;
        w[n] = 1.0 - Math.pow((n - mid) / mid, 2);
      } else if (type === "bartlett") {
        const mid = N / 2.0;
        w[n] = 1.0 - Math.abs((n - mid) / mid);
      } else {
        w[n] = 1.0;
      }
    }
    return w;
  }
}

window.Windowing = Windowing;
