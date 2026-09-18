/**
 * Task Function Module
 * Computes Fourier spectrum W_task(f) for circular disk tasks of diameter D (mm) and contrast Delta_HU.
 * Strictly matches dPrimeCalc.exe / AAPM TG233 definitions.
 */
class TaskFunction {
  /**
   * Calculate Task Fourier Spectrum W_task(f)
   * @param {Array<number>|Float32Array} frequencies Spatial frequency array (cycles/mm)
   * @param {number} diameter Task diameter in mm
   * @param {number} contrast Task contrast in HU
   * @returns {Float32Array} W_task spectrum values
   */
  static computeSpectrum(frequencies, diameter, contrast) {
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

  /**
   * High-precision First-order Bessel function J1(x) (15-degree polynomial fit on [0, 15.0])
   */
  static besselJ1(x) {
    const ax = Math.abs(x);
    if (ax < 1e-15) return 0.0;
    const sign = x >= 0 ? 1.0 : -1.0;

    if (ax <= 15.0) {
      // 15-degree polynomial fit for J1(x)/x on [0, 15.0] with y = (x/15)^2
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
      // Asymptotic expansion for large x
      const beta = ax - 0.75 * Math.PI;
      const amp = Math.sqrt(2.0 / (Math.PI * ax));
      return sign * amp * Math.cos(beta);
    }
  }
}

if (typeof window !== 'undefined') {
  window.TaskFunction = TaskFunction;
}
if (typeof globalThis !== 'undefined') {
  globalThis.TaskFunction = TaskFunction;
}
