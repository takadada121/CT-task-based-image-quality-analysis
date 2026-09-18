/**
 * Unified Bootstrap Resampling Engine (Version 2.0)
 * Applies image-set level resampling for TTF, NPS, and Detectability (d') uncertainty propagation.
 */
class BootstrapEngine {
  /**
   * Run Unified Bootstrap Resampling
   * @param {Array<Float32Array>} ttfRois Extracted TTF edge ROIs
   * @param {Array<Float32Array>} npsRois Extracted NPS noise ROIs
   * @param {Object} config { npsRoiSize, ttfRoiSize, pixelSize, ttfParams, npsParams, taskDef, iterations }
   * @param {Function} progressCallback Progress callback (percent)
   * @returns {Promise<Object>} Bootstrap CIs and per-iteration sample matrix
   */
  static async run(ttfRois, npsRois, config = {}, progressCallback = null) {
    const iterations = config.iterations || 1000;
    const npsRoiSize = config.npsRoiSize || config.roiSize || 128;
    const ttfRoiSize = config.ttfRoiSize || config.roiSize || 64;
    const pixelSize = config.pixelSize || 0.625;

    const numTtfRois = ttfRois ? ttfRois.length : 0;
    const numNpsRois = npsRois ? npsRois.length : 0;

    if (numTtfRois === 0 && numNpsRois === 0) {
      throw new Error("No ROIs available for Bootstrap resampling.");
    }

    const ttfSamples = [];
    const npsSamples = [];
    const dPrimeNyqSamples = new Float64Array(iterations);
    const dPrimeSpecSamples = new Float64Array(iterations);

    const dPrime2NyqSamples = new Float64Array(iterations);
    const dPrime2SpecSamples = new Float64Array(iterations);

    const f50Samples = new Float64Array(iterations);
    const f10Samples = new Float64Array(iterations);
    const f5Samples  = new Float64Array(iterations);

    const sdSamples    = new Float64Array(iterations);
    const fPeakSamples = new Float64Array(iterations);
    const fAveSamples  = new Float64Array(iterations);

    const chunkSize = Math.max(10, Math.floor(iterations / 20));

    for (let b = 0; b < iterations; b++) {
      // 1. TTF Bootstrap Draw (with up to 10 retries if threshold crossing fails)
      let ttfRes = null;
      if (numTtfRois > 0) {
        let attempts = 0;
        const maxRetries = 10;
        let isValid = false;

        do {
          attempts++;
          const resampleTtfRois = [];
          for (let i = 0; i < numTtfRois; i++) {
            const idx = Math.floor(Math.random() * numTtfRois);
            resampleTtfRois.push(ttfRois[idx]);
          }
          ttfRes = TTFAnalysis.process(resampleTtfRois, ttfRoiSize, pixelSize, config.ttfParams || {});

          const fNyqMax = ttfRes.nyquist || 2.0;
          const maxTTF = (ttfRes && ttfRes.ttf) ? Math.max(...ttfRes.ttf) : 999;
          isValid = ttfRes &&
                    typeof ttfRes.f50 === 'number' &&
                    !isNaN(ttfRes.f50) &&
                    ttfRes.f50 > 0 &&
                    ttfRes.f50 < (fNyqMax - 1e-5) &&
                    maxTTF < 1.8 &&
                    (ttfRes.dcMag === undefined || ttfRes.dcMag > 1e-3);
        } while (!isValid && attempts < maxRetries);

        f50Samples[b] = ttfRes.f50;
        f10Samples[b] = ttfRes.f10;
        f5Samples[b]  = ttfRes.f5;
        ttfSamples.push(ttfRes.ttf);
      }

      // 2. NPS Bootstrap Draw
      let npsRes = null;
      if (numNpsRois > 0) {
        const fftSize = FFT2D.nextPowerOf2(npsRoiSize);
        const avg2DNps = new Float32Array(fftSize * fftSize);
        const npsParams = config.npsParams || {};

        for (let i = 0; i < numNpsRois; i++) {
          const idx = Math.floor(Math.random() * numNpsRois);
          const roiPixels = npsRois[idx];
          const trendRemoved = TrendRemoval.process(roiPixels, npsRoiSize, npsParams.trendMethod || "mean");
          const { windowedPixels, meanSquareRatio } = Windowing.apply(trendRemoved, npsRoiSize, npsParams.windowType || "none");
          const nps2D = FFT2D.computeNps2D(windowedPixels, npsRoiSize, pixelSize, meanSquareRatio);

          for (let k = 0; k < nps2D.length; k++) {
            avg2DNps[k] += nps2D[k] / numNpsRois;
          }
        }

        npsRes = RadialNps.process(avg2DNps, fftSize, pixelSize, npsParams.binWidth || 0.01, npsParams.excludeDC !== false);
        sdSamples[b]    = npsRes.stdDevHU;
        fPeakSamples[b] = npsRes.fPeak;
        fAveSamples[b]  = npsRes.fAve;
        npsSamples.push(npsRes.nps1D);
      }

      // 3. Detectability (d') Bootstrap Draw (Task ① & Task ②)
      if (ttfRes && npsRes && config.taskDef) {
        const dRes = DetectabilityAnalysis.compute(ttfRes, npsRes, config.taskDef, config.detectabilityOptions || {});
        dPrimeNyqSamples[b] = dRes.dPrimeNyquist;
        dPrimeSpecSamples[b] = dRes.dPrimeSpecified;

        if (config.task2Def) {
          const dRes2 = DetectabilityAnalysis.compute(ttfRes, npsRes, config.task2Def, config.detectabilityOptions || {});
          dPrime2NyqSamples[b] = dRes2.dPrimeNyquist;
          dPrime2SpecSamples[b] = dRes2.dPrimeSpecified;
        }
      }

      if (b % chunkSize === 0 || b === iterations - 1) {
        if (progressCallback) progressCallback((b + 1) / iterations);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // 4. Compute 95% Confidence Intervals (2.5% and 97.5% percentiles)
    const lowIdx = Math.floor(iterations * 0.025);
    const highIdx = Math.floor(iterations * 0.975);

    const getCI = (arr) => {
      const sorted = Array.from(arr).sort((a, b) => a - b);
      return [sorted[lowIdx], sorted[highIdx]];
    };

    const computeCurveCI = (sampleMatrix) => {
      if (sampleMatrix.length === 0) return { lower: [], upper: [] };
      const numBins = sampleMatrix[0].length;
      const lower = new Float32Array(numBins);
      const upper = new Float32Array(numBins);

      for (let i = 0; i < numBins; i++) {
        const binVals = sampleMatrix.map(s => s[i]).sort((a, b) => a - b);
        lower[i] = binVals[lowIdx];
        upper[i] = binVals[highIdx];
      }
      return { lower, upper };
    };

    return {
      ttfCI: computeCurveCI(ttfSamples),
      npsCI: computeCurveCI(npsSamples),
      f50CI: getCI(f50Samples),
      f10CI: getCI(f10Samples),
      f5CI:  getCI(f5Samples),
      sdCI:    getCI(sdSamples),
      fPeakCI: getCI(fPeakSamples),
      fAveCI:  getCI(fAveSamples),
      dPrimeCI: dPrimeNyqSamples.length > 0 ? getCI(dPrimeNyqSamples) : [0, 0],
      dPrimeNyqCI: dPrimeNyqSamples.length > 0 ? getCI(dPrimeNyqSamples) : [0, 0],
      dPrimeSpecCI: dPrimeSpecSamples.length > 0 ? getCI(dPrimeSpecSamples) : [0, 0],
      dPrime2NyqCI: config.task2Def && dPrime2NyqSamples.length > 0 ? getCI(dPrime2NyqSamples) : [0, 0],
      dPrime2SpecCI: config.task2Def && dPrime2SpecSamples.length > 0 ? getCI(dPrime2SpecSamples) : [0, 0],
      iterationsData: {
        f50Samples, f10Samples, f5Samples,
        sdSamples, fPeakSamples, fAveSamples,
        dPrimeSamples: dPrimeNyqSamples,
        dPrimeNyqSamples, dPrimeSpecSamples,
        dPrime2NyqSamples, dPrime2SpecSamples
      }
    };
  }
}

if (typeof window !== 'undefined') {
  window.BootstrapEngine = BootstrapEngine;
}
if (typeof globalThis !== 'undefined') {
  globalThis.BootstrapEngine = BootstrapEngine;
}
