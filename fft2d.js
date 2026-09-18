/**
 * 2D Fast Fourier Transform & 2D Power Spectrum Calculator
 * Radix-2 Cooley-Tukey FFT implementation.
 */
class FFT2D {
  /**
   * Compute 2D Noise Power Spectrum (NPS) for a single ROI
   * @param {Float32Array} roiData Windowed & Trend-removed pixel array
   * @param {number} roiSize ROI width/height in pixels (must be power of 2: 64, 128, 256...)
   * @param {number} pixelSize Pixel spacing in mm
   * @param {number} meanSquareRatio Energy correction factor for windowing function
   * @returns {Float32Array} Shifted 2D NPS array (mm^2 HU^2)
   */
  static computeNps2D(roiData, roiSize, pixelSize, meanSquareRatio = 1.0) {
    const N = roiSize;
    const numPixels = N * N;

    // Pad to power of 2 if necessary
    const powerOf2Size = this.nextPowerOf2(N);
    const size = powerOf2Size;

    const real = new Float32Array(size * size);
    const imag = new Float32Array(size * size);

    // Copy ROI pixels into real part
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        real[y * size + x] = roiData[y * N + x];
      }
    }

    // Perform 2D FFT
    this.transform2D(real, imag, size);

    // Calculate 2D NPS formula with zero-padding normalization:
    // NPS_2D(u, v) = (dx * dy / (Nx * Ny * W_factor)) * |FFT_padded|^2
    const scaleFactor = (pixelSize * pixelSize) / (N * N * meanSquareRatio);
    const nps2D = new Float32Array(size * size);

    for (let i = 0; i < size * size; i++) {
      const magSq = real[i] * real[i] + imag[i] * imag[i];
      nps2D[i] = magSq * scaleFactor;
    }

    // FFT Shift (Move DC 0 frequency component to center)
    return this.fftShift2D(nps2D, size);
  }

  /**
   * 2D Radix-2 FFT (In-place on real and imag arrays)
   */
  static transform2D(real, imag, size) {
    // 1. Transform Rows
    const rowReal = new Float32Array(size);
    const rowImag = new Float32Array(size);

    for (let y = 0; y < size; y++) {
      const rowOffset = y * size;
      for (let x = 0; x < size; x++) {
        rowReal[x] = real[rowOffset + x];
        rowImag[x] = imag[rowOffset + x];
      }
      this.fft1D(rowReal, rowImag, size);
      for (let x = 0; x < size; x++) {
        real[rowOffset + x] = rowReal[x];
        imag[rowOffset + x] = rowImag[x];
      }
    }

    // 2. Transform Columns
    const colReal = new Float32Array(size);
    const colImag = new Float32Array(size);

    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        colReal[y] = real[y * size + x];
        colImag[y] = imag[y * size + x];
      }
      this.fft1D(colReal, colImag, size);
      for (let y = 0; y < size; y++) {
        real[y * size + x] = colReal[y];
        imag[y * size + x] = colImag[y];
      }
    }
  }

  /**
   * 1D Cooley-Tukey Radix-2 FFT
   */
  static fft1D(real, imag, n) {
    // Bit reversal permutation
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        let tempR = real[i]; real[i] = real[j]; real[j] = tempR;
        let tempI = imag[i]; imag[i] = imag[j]; imag[j] = tempI;
      }
      let k = n >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }

    // Butterfly computations
    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const angle = -2.0 * Math.PI / len;
      const wStepR = Math.cos(angle);
      const wStepI = Math.sin(angle);

      for (let i = 0; i < n; i += len) {
        let wR = 1.0;
        let wI = 0.0;
        for (let k = 0; k < halfLen; k++) {
          const uIdx = i + k;
          const vIdx = i + k + halfLen;

          const uR = real[uIdx], uI = imag[uIdx];
          const vR = real[vIdx], vI = imag[vIdx];

          const tR = vR * wR - vI * wI;
          const tI = vR * wI + vI * wR;

          real[uIdx] = uR + tR;
          imag[uIdx] = uI + tI;
          real[vIdx] = uR - tR;
          imag[vIdx] = uI - tI;

          const nextWR = wR * wStepR - wI * wStepI;
          const nextWI = wR * wStepI + wI * wStepR;
          wR = nextWR;
          wI = nextWI;
        }
      }
    }
  }

  /**
   * Shift Zero-Frequency (DC) component to the center of 2D array
   */
  static fftShift2D(nps2D, size) {
    const shifted = new Float32Array(size * size);
    const half = size / 2;

    for (let y = 0; y < size; y++) {
      const newY = (y + half) % size;
      for (let x = 0; x < size; x++) {
        const newX = (x + half) % size;
        shifted[newY * size + newX] = nps2D[y * size + x];
      }
    }
    return shifted;
  }

  static nextPowerOf2(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
  }
}

window.FFT2D = FFT2D;
