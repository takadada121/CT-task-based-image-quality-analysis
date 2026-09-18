/**
 * AAPM TG233 Circular Rod Task Transfer Function (TTF) Analysis Engine
 * Strictly follows AAPM TG233 Circular Rod Method for 100% CTmeasure (Duke Univ.) compatibility.
 * Features auto-centroid estimation, sub-pixel ESF radial binning (dr=0.05mm), signed derivative LSF,
 * Tukey taper windowing, and 2048-point zero-padded FFT spectral estimation up to 2.0 cycles/mm.
 */
class TTFAnalysis {
  /**
   * Compute TTF from extracted 2D Edge/Rod ROI pixel blocks
   * @param {Array<Float32Array>} roiList Array of extracted 2D ROI pixel arrays
   * @param {number} roiSize Size of 2D ROI in pixels
   * @param {number} pixelSize Pixel spacing in mm
   * @param {Object} options { isResearchMode, windowWidthMm }
   * @returns {Object} { frequencies, ttf, esf: {r, intensity}, lsf: {r, derivative}, f50, f10, f5, centroid, rodContrast, rPeak, nyquist }
   */
  static process(roiList, roiSize, pixelSize, options = {}) {
    if (!roiList || roiList.length === 0) {
      throw new Error("No ROIs provided for TTF analysis.");
    }

    const numRois = roiList.length;
    const N = roiSize;

    // 1. Ensemble average 2D ROI image across all slices in TTF range
    const avgRoi = new Float32Array(N * N);
    for (let r = 0; r < numRois; r++) {
      const pix = roiList[r];
      for (let i = 0; i < N * N; i++) {
        avgRoi[i] += pix[i] / numRois;
      }
    }

    // 2. AAPM TG233 Rod Centroid Estimation (Center of Mass)
    let sumI = 0.0, sumX = 0.0, sumY = 0.0;
    let minVal = Infinity, maxVal = -Infinity;

    for (let i = 0; i < N * N; i++) {
      if (avgRoi[i] < minVal) minVal = avgRoi[i];
      if (avgRoi[i] > maxVal) maxVal = avgRoi[i];
    }

    const rodContrast = maxVal - minVal;
    const threshold = minVal + 0.3 * rodContrast;

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const val = avgRoi[y * N + x];
        if (val > threshold) {
          const w = val - minVal;
          sumI += w;
          sumX += x * w;
          sumY += y * w;
        }
      }
    }

    const centerX = sumI > 0 ? sumX / sumI : N / 2;
    const centerY = sumI > 0 ? sumY / sumI : N / 2;

    // 3. Radial Binning for ESF (AAPM TG233 / CTmeasure standard: dr = 0.05 mm)
    const dr = 0.05; // mm sub-pixel radial bin step
    const maxRadius = (N / 2.0) * pixelSize;
    const numBins = Math.floor(maxRadius / dr);

    const binSums = new Float64Array(numBins);
    const binCounts = new Uint32Array(numBins);

    for (let y = 0; y < N; y++) {
      const dy = (y - centerY) * pixelSize;
      for (let x = 0; x < N; x++) {
        const dx = (x - centerX) * pixelSize;
        const r = Math.hypot(dx, dy);

        const binIdx = Math.floor(r / dr);
        if (binIdx < numBins) {
          binSums[binIdx] += avgRoi[y * N + x];
          binCounts[binIdx] += 1;
        }
      }
    }

    const esfR = [];
    const esfIntensity = [];

    for (let i = 0; i < numBins; i++) {
      if (binCounts[i] > 0) {
        esfR.push(i * dr);
        esfIntensity.push(binSums[i] / binCounts[i]);
      }
    }

    if (esfIntensity.length < 5) {
      throw new Error("Insufficient ESF radial bins.");
    }

    // Determine Polarity: Bright Rod (center > outer) vs Dark Rod (center < outer)
    const centerAvg = (esfIntensity[0] + esfIntensity[1] + (esfIntensity[2] || esfIntensity[0])) / 3.0;
    const outerAvg = (esfIntensity[esfIntensity.length - 1] + esfIntensity[esfIntensity.length - 2]) / 2.0;
    const isBrightRod = (options.isBrightRod !== undefined) ? options.isBrightRod : (centerAvg > outerAvg);

    // 4. LSF (Line Spread Function) via Signed Central Difference Differentiation
    const numEsf = esfR.length;
    const lsfR = [];
    let rawLsf = [];

    for (let i = 1; i < numEsf - 1; i++) {
      lsfR.push(esfR[i]);
      const diff = (esfIntensity[i + 1] - esfIntensity[i - 1]) / (2.0 * dr);
      // Signed derivative: -diff for bright rod, +diff for dark rod
      const signedLsf = isBrightRod ? -diff : diff;
      rawLsf.push(signedLsf);
    }

    if (rawLsf.length === 0) {
      throw new Error("Failed to compute LSF derivative.");
    }

    // Find LSF Peak Radius (Rod Edge Radius) constrained near refRPeak if provided
    let peakIdx = -1;
    let maxLsfVal = -Infinity;

    const refPeak = options.refRPeak || 0;
    const minSearchR = refPeak > 0 ? Math.max(0.5, refPeak - 3.5) : (0.05 * maxRadius);
    const maxSearchR = refPeak > 0 ? Math.min(maxRadius * 0.95, refPeak + 3.5) : (0.95 * maxRadius);

    for (let i = 0; i < rawLsf.length; i++) {
      const r = lsfR[i];
      if (r >= minSearchR && r <= maxSearchR) {
        if (rawLsf[i] > maxLsfVal) {
          maxLsfVal = rawLsf[i];
          peakIdx = i;
        }
      }
    }

    // Fallback: If no positive peak found in guided range, search entire valid radius (5% to 95%)
    if (peakIdx < 0 || maxLsfVal <= 0) {
      maxLsfVal = -Infinity;
      for (let i = 0; i < rawLsf.length; i++) {
        const r = lsfR[i];
        if (r >= 0.05 * maxRadius && r <= 0.95 * maxRadius) {
          if (rawLsf[i] > maxLsfVal) {
            maxLsfVal = rawLsf[i];
            peakIdx = i;
          }
        }
      }
    }

    if (peakIdx < 0) peakIdx = Math.floor(rawLsf.length / 2);
    const rPeak = (lsfR[peakIdx] !== undefined) ? lsfR[peakIdx] : (refPeak > 0 ? refPeak : maxRadius / 2.0);

    // 5. AAPM TG233 Tukey Taper Windowing around rPeak (width = 8.0 mm)
    const windowWidthMm = options.windowWidthMm || 8.0;
    const halfWin = windowWidthMm / 2.0;
    const lsfClean = new Float32Array(rawLsf.length);

    for (let i = 0; i < rawLsf.length; i++) {
      const dist = Math.abs(lsfR[i] - rPeak);
      if (dist <= halfWin) {
        const w = 0.5 * (1.0 + Math.cos((Math.PI * dist) / halfWin));
        lsfClean[i] = rawLsf[i] * w;
      } else {
        lsfClean[i] = 0.0;
      }
    }

    // 6. 1D FFT with Zero-Padding (n = 2048) for Ultra-fine Frequency Resolution
    const fftLen = 2048;
    const real = new Float32Array(fftLen);
    const imag = new Float32Array(fftLen);

    for (let i = 0; i < lsfClean.length; i++) {
      real[i] = lsfClean[i];
    }

    FFT2D.fft1D(real, imag, fftLen);

    // DC Component for Normalization
    const dcMag = Math.hypot(real[0], imag[0]);

    const frequencies = [];
    const ttf = [];

    const deltaF = 1.0 / (fftLen * dr);
    const maxFreqPlot = 2.0; // CTmeasure standard upper limit (2.0 cycles/mm)

    for (let k = 0; k < fftLen / 2; k++) {
      const f = k * deltaF;
      if (f > maxFreqPlot) break;

      const mag = Math.hypot(real[k], imag[k]);
      const ttfVal = dcMag > 0 ? mag / dcMag : 0.0;

      frequencies.push(f);
      ttf.push(ttfVal);
    }

    const f50 = this.interpolateFrequencyThreshold(frequencies, ttf, 0.50);
    const f10 = this.interpolateFrequencyThreshold(frequencies, ttf, 0.10);
    const f5  = this.interpolateFrequencyThreshold(frequencies, ttf, 0.05);

    return {
      frequencies,
      ttf,
      esf: { r: esfR, intensity: esfIntensity },
      lsf: { r: lsfR, derivative: Array.from(lsfClean) },
      f50,
      f10,
      f5,
      nyquist: maxFreqPlot,
      centroid: { x: centerX, y: centerY },
      minVal,
      maxVal,
      rodContrast,
      rPeak,
      isBrightRod,
      dcMag
    };
  }

  static interpolateFrequencyThreshold(freqs, ttf, threshold) {
    if (!freqs || freqs.length < 2) return 0.0;

    for (let i = 0; i < ttf.length - 1; i++) {
      if ((ttf[i] >= threshold && ttf[i + 1] <= threshold) || (ttf[i] <= threshold && ttf[i + 1] >= threshold)) {
        const f1 = freqs[i], f2 = freqs[i + 1];
        const v1 = ttf[i], v2 = ttf[i + 1];
        if (Math.abs(v2 - v1) < 1e-6) return f1;
        return f1 + ((threshold - v1) * (f2 - f1)) / (v2 - v1);
      }
    }
    return freqs[freqs.length - 1];
  }
}

window.TTFAnalysis = TTFAnalysis;
