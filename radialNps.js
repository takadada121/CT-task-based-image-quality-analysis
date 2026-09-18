/**
 * 1D Radial Frequency Averaging & NPS Metrics Engine
 * Converts 2D NPS array into 1D radial frequency curve and calculates summary metrics.
 */
class RadialNps {
  /**
   * Compute 1D Radial NPS from 2D NPS Matrix
   * @param {Float32Array} nps2D Shifted 2D NPS matrix (center = DC 0 frequency)
   * @param {number} roiSize Size of 2D NPS matrix in pixels (N x N)
   * @param {number} pixelSize Pixel spacing in mm
   * @param {number} binWidth User selected radial frequency bin width (e.g., 0.01 cycles/mm)
   * @param {boolean} excludeDC If true, excludes f=0 from summary metrics (AAPM TG233 standard)
   * @returns {Object} { frequencies, nps1D, nyquist, fPeak, fAve, npsIntegral, stdDevHU }
   */
  static process(nps2D, roiSize, pixelSize, binWidth = 0.01, excludeDC = true) {
    const half = roiSize / 2;
    const nyquist = 1.0 / (2.0 * pixelSize);

    // Spatial frequency step per pixel in 2D spectrum
    const deltaF = 1.0 / (roiSize * pixelSize);

    const numBins = Math.ceil(nyquist / binWidth) + 1;
    const binSums = new Float64Array(numBins);
    const binCounts = new Uint32Array(numBins);

    // Radial integration across 2D grid
    for (let y = 0; y < roiSize; y++) {
      const fy = (y - half) * deltaF;
      for (let x = 0; x < roiSize; x++) {
        const fx = (x - half) * deltaF;
        const radialFreq = Math.hypot(fx, fy);

        if (radialFreq <= nyquist) {
          const binIdx = Math.round(radialFreq / binWidth);
          if (binIdx < numBins) {
            binSums[binIdx] += nps2D[y * roiSize + x];
            binCounts[binIdx] += 1;
          }
        }
      }
    }

    // Build 1D NPS array & frequency array
    const frequencies = [];
    const nps1D = [];

    for (let i = 0; i < numBins; i++) {
      const f = i * binWidth;
      if (f <= nyquist) {
        frequencies.push(f);
        const val = binCounts[i] > 0 ? binSums[i] / binCounts[i] : 0.0;
        nps1D.push(val);
      }
    }

    // Calculate Summary Metrics
    let maxNps = -1;
    let fPeak = 0.0;
    let sumF_Nps = 0.0;
    let sumNps = 0.0;
    let npsIntegral = 0.0;

    for (let i = 0; i < frequencies.length; i++) {
      const f = frequencies[i];
      const val = nps1D[i];

      // Skip DC component (f=0) if excludeDC is active
      if (excludeDC && Math.abs(f) < 1e-6) {
        continue;
      }

      // 1. Peak Frequency (fpeak)
      if (val > maxNps) {
        maxNps = val;
        fPeak = f;
      }

      // 2. Mean Spectral Frequency (fave)
      sumF_Nps += f * val;
      sumNps += val;

      // 3. Trapezoidal / Discrete Integral of NPS
      // NPS_total = sum(NPS(f) * binWidth)
      npsIntegral += val * binWidth;
    }

    const fAve = sumNps > 0 ? (sumF_Nps / sumNps) : 0.0;

    // Derived Image Standard Deviation (SD in HU)
    // Variance = integral of 2D NPS = integral of 1D NPS * (2 * pi * f)
    // Or SD = sqrt(2 * pi * sum(f * NPS(f) * df))
    let varianceInt = 0.0;
    for (let i = 0; i < frequencies.length; i++) {
      const f = frequencies[i];
      const val = nps1D[i];
      if (excludeDC && Math.abs(f) < 1e-6) continue;
      varianceInt += 2.0 * Math.PI * f * val * binWidth;
    }

    const stdDevHU = Math.sqrt(Math.max(0, varianceInt));

    return {
      frequencies,
      nps1D,
      nyquist,
      fPeak,
      fAve,
      npsIntegral,
      stdDevHU
    };
  }
}

window.RadialNps = RadialNps;
