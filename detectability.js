/**
 * AAPM TG233 Detectability Index (d') Analysis Engine
 * Implements NPW (Non-Prewhitening) observer model strictly matching dPrimeCalc.exe (Duke Univ.).
 */
class DetectabilityAnalysis {
  /**
   * Compute Detectability Index d', Integrand Curve, SPF^2, Task Bessel Function, and Cumulative d'(f)
   * @param {Object} ttfData { frequencies, ttf, nyquist }
   * @param {Object} npsData { frequencies, nps1D, nyquist }
   * @param {Object} taskDef { diameter: mm, contrast: HU }
   * @param {Object} options { observer: "NPW"|"NPWE", commonNyquist: boolean, fMin, fMax, isResearchMode, applyRegularization }
   * @returns {Object} { dPrime, frequencies, integrand, cumulativeDPrime, spf2, taskBessel, taskSpectrum, ttfInterp, npsInterp, fUpper, fLower }
   */
  static compute(ttfData, npsData, taskDef, options = {}) {
    if (!ttfData || !npsData) {
      throw new Error("Both TTF and NPS results are required for detectability analysis.");
    }

    const diameter = taskDef.diameter || 10.0;
    const contrast = taskDef.contrast !== undefined ? taskDef.contrast : 120.0;
    const binWidth = options.binWidth || 0.005; // 0.005 cycles/mm fine step

    // 1. Determine Integration Limits matching AAPM TG233 / dPrimeCalc.exe
    const nyqTTF = ttfData.nyquist || Math.max(...ttfData.frequencies);
    const nyqNPS = npsData.nyquist || Math.max(...npsData.frequencies);
    const fNyquist = Math.min(nyqTTF, nyqNPS); // Image Nyquist frequency

    let fUpper = fNyquist;
    if (options.fMax !== undefined && options.fMax > 0) {
      fUpper = options.fMax;
    }
    const fLower = options.fMin !== undefined ? options.fMin : 0.010; // Exclude DC

    // Specified Frequency Range Limits
    const specFMin = options.specFMin !== undefined ? options.specFMin : 0.010;
    const specFMax = options.specFMax !== undefined ? options.specFMax : 0.500;

    // 2. Build Unified Frequency Grid from 0.0 up to max frequency needed
    const maxGridF = Math.max(fUpper, specFMax);
    const numBins = Math.floor(maxGridF / binWidth) + 1;
    const frequencies = new Float32Array(numBins);
    const ttfInterp = new Float32Array(numBins);
    const npsInterp = new Float32Array(numBins);
    const spf2 = new Float32Array(numBins);
    const taskBessel = new Float32Array(numBins);

    for (let i = 0; i < numBins; i++) {
      const f = i * binWidth;
      frequencies[i] = f;
      const tVal = this.interpolate1D(ttfData.frequencies, ttfData.ttf, f);
      const nVal = this.interpolate1D(npsData.frequencies, npsData.nps1D, f);
      ttfInterp[i] = tVal;
      npsInterp[i] = nVal;

      // SPF^2 = TTF^2 / NPS
      spf2[i] = Math.pow(tVal, 2) / (nVal + 1e-12);

      // Normalized Task Bessel Function: 2 * J1(pi * D * f) / (pi * D * f)
      if (f < 1e-8) {
        taskBessel[i] = 1.0;
      } else {
        const arg = Math.PI * diameter * f;
        const TF = (typeof TaskFunction !== 'undefined') ? TaskFunction : DetectabilityAnalysis;
        taskBessel[i] = 2.0 * TF.besselJ1(arg) / arg;
      }
    }

    // 3. Compute Task Fourier Spectrum W_task(f)
    const TF = (typeof TaskFunction !== 'undefined') ? TaskFunction : DetectabilityAnalysis;
    const taskSpectrum = TF.computeSpectrum ? TF.computeSpectrum(frequencies, diameter, contrast) : TF.computeTaskSpectrum(frequencies, diameter, contrast);

    // 4. Integrand & Numerical Integrations (Range ① Nyquist & Range ② Specified Range)
    const integrand = new Float32Array(numBins);
    const cumulativeDPrime = new Float32Array(numBins);

    let signalSumNyq = 0.0;
    let noiseSumNyq = 0.0;

    let signalSumSpec = 0.0;
    let noiseSumSpec = 0.0;

    const observer = options.observer || "NPW";

    for (let i = 0; i < numBins; i++) {
      const f = frequencies[i];
      let npsVal = npsInterp[i];

      // Research Mode Optional Regularization
      if (options.isResearchMode && options.applyRegularization) {
        npsVal = Math.max(npsVal, 1e-6);
      }

      // Eye Filter E(f) (Default 1.0 for NPW in TG233 Mode)
      let eyeFilter = 1.0;
      if (observer === "NPWE") {
        const eyeDistance = options.eyeDistance || 500.0;
        const fDeg = f * (eyeDistance * Math.PI / 180.0);
        eyeFilter = fDeg * Math.exp(-0.1 * fDeg);
      }

      const wTask = taskSpectrum[i];
      const ttfVal = ttfInterp[i];

      // Signal power: |W_task(f)|^2 * TTF(f)^2 * E(f)^2
      const signalPower = Math.pow(wTask, 2) * Math.pow(ttfVal, 2) * Math.pow(eyeFilter, 2);

      // Noise integrand: 2 * pi * f * signalPower * NPS(f)
      const integrandVal = 2.0 * Math.PI * f * signalPower * npsVal;
      integrand[i] = integrandVal;

      // Integration Range ①: Nyquist Limit [fLower, fUpper]
      if (f >= fLower && f <= fUpper) {
        signalSumNyq += 2.0 * Math.PI * f * signalPower * binWidth;
        noiseSumNyq += integrandVal * binWidth;
      }

      // Integration Range ②: Specified Range [specFMin, specFMax]
      if (f >= specFMin && f <= specFMax) {
        signalSumSpec += 2.0 * Math.PI * f * signalPower * binWidth;
        noiseSumSpec += integrandVal * binWidth;
      }

      const cumDPrimeSq = noiseSumNyq > 0 ? Math.pow(signalSumNyq, 2) / noiseSumNyq : 0.0;
      cumulativeDPrime[i] = Math.sqrt(Math.max(0, cumDPrimeSq));
    }

    const dPrimeNyquist = noiseSumNyq > 0 ? (signalSumNyq / Math.sqrt(noiseSumNyq)) : 0.0;
    const dPrimeSpecified = noiseSumSpec > 0 ? (signalSumSpec / Math.sqrt(noiseSumSpec)) : 0.0;
    const dPrime = dPrimeNyquist;

    return {
      dPrime,
      dPrimeNyquist,
      dPrimeSpecified,
      frequencies,
      integrand,
      cumulativeDPrime,
      spf2,
      taskBessel,
      taskSpectrum,
      ttfInterp,
      npsInterp,
      fUpper,
      fLower,
      fNyquist,
      specFMin,
      specFMax
    };
  }

  static interpolate1D(xArr, yArr, xTarget) {
    if (!xArr || xArr.length === 0) return 0.0;
    if (xTarget <= xArr[0]) return yArr[0];
    if (xTarget >= xArr[xArr.length - 1]) return yArr[yArr.length - 1];

    for (let i = 0; i < xArr.length - 1; i++) {
      if (xTarget >= xArr[i] && xTarget <= xArr[i + 1]) {
        const t = (xTarget - xArr[i]) / (xArr[i + 1] - xArr[i]);
        return yArr[i] + t * (yArr[i + 1] - yArr[i]);
      }
    }
    return yArr[yArr.length - 1];
  }

  /**
   * Fallback High-precision First-order Bessel function J1(x) (15-degree polynomial fit)
   */
  static besselJ1(x) {
    const ax = Math.abs(x);
    if (ax < 1e-15) return 0.0;
    const sign = x >= 0 ? 1.0 : -1.0;

    if (ax <= 15.0) {
      const y = (ax / 15.0) * (ax / 15.0);
      const c = [
        4.999999999514691e-01,
        -1.406249997410610e+01,
        1.318359352163998e+02,
        -6.179808774970751e+02,
        1.738069987441678e+03,
        -3.258867871798428e+03,
        4.364459900761648e+03,
        -4.383474175852263e+03,
        3.422935394608715e+03,
        -2.135101302282503e+03,
        1.083862647781868e+03,
        -4.509301536603533e+02,
        1.516910537225764e+02,
        -3.923164423652408e+01,
        6.924972301447494e+00,
        -6.176929307306041e-01
      ];
      let val = c[15];
      for (let i = 14; i >= 0; i--) {
        val = c[i] + y * val;
      }
      return sign * ax * val;
    } else {
      const beta = ax - 0.75 * Math.PI;
      const amp = Math.sqrt(2.0 / (Math.PI * ax));
      return sign * amp * Math.cos(beta);
    }
  }

  /**
   * Fallback Task Spectrum Calculation W_task(f)
   */
  static computeTaskSpectrum(frequencies, diameter, contrast) {
    const N = frequencies.length;
    const spectrum = new Float32Array(N);
    const radius = diameter / 2.0;
    const area = Math.PI * radius * radius;

    for (let i = 0; i < N; i++) {
      const f = frequencies[i];
      if (Math.abs(f) < 1e-8) {
        spectrum[i] = contrast * area;
      } else {
        const arg = Math.PI * diameter * f;
        const j1 = this.besselJ1(arg);
        spectrum[i] = contrast * area * (2.0 * j1 / arg);
      }
    }
    return spectrum;
  }
}

if (typeof window !== 'undefined') {
  window.DetectabilityAnalysis = DetectabilityAnalysis;
}
if (typeof globalThis !== 'undefined') {
  globalThis.DetectabilityAnalysis = DetectabilityAnalysis;
}
