/**
 * Trend Removal Module
 * Removes background trend (Mean, 2D Plane, or 2D Polynomial) from ROI pixel arrays.
 */
class TrendRemoval {
  /**
   * Remove trend from 2D ROI pixel array
   * @param {Float32Array} roiPixels 
   * @param {number} roiSize ROI width/height in pixels
   * @param {string} method "mean" | "plane" | "poly"
   * @returns {Float32Array} Trend-removed pixel array
   */
  static process(roiPixels, roiSize, method = "mean") {
    const N = roiSize * roiSize;
    const output = new Float32Array(N);

    if (method === "plane") {
      return this.removePlaneTrend(roiPixels, roiSize);
    } else if (method === "poly") {
      return this.removePolyTrend(roiPixels, roiSize);
    } else {
      // Default: Mean Subtraction (AAPM TG233 Standard)
      let sum = 0.0;
      for (let i = 0; i < N; i++) sum += roiPixels[i];
      const mean = sum / N;
      for (let i = 0; i < N; i++) output[i] = roiPixels[i] - mean;
      return output;
    }
  }

  /**
   * Least Squares 2D Plane Fit: z = a*x + b*y + c
   */
  static removePlaneTrend(roiPixels, roiSize) {
    const N = roiSize * roiSize;
    const output = new Float32Array(N);

    // Sum accumulators for normal equation [A^T A] [a, b, c]^T = [A^T Z]
    let sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0;
    let sumZ = 0, sumXZ = 0, sumYZ = 0;

    for (let y = 0; y < roiSize; y++) {
      for (let x = 0; x < roiSize; x++) {
        const z = roiPixels[y * roiSize + x];
        sumX += x;
        sumY += y;
        sumXX += x * x;
        sumYY += y * y;
        sumXY += x * y;
        sumZ += z;
        sumXZ += x * z;
        sumYZ += y * z;
      }
    }

    // Solve 3x3 System using Cramer's Rule
    // Matrix A:
    // [ sumXX  sumXY  sumX ] [ a ]   [ sumXZ ]
    // [ sumXY  sumYY  sumY ] [ b ] = [ sumYZ ]
    // [ sumX   sumY   N    ] [ c ]   [ sumZ  ]

    const det = sumXX * (sumYY * N - sumY * sumY) -
                sumXY * (sumXY * N - sumY * sumX) +
                sumX  * (sumXY * sumY - sumYY * sumX);

    if (Math.abs(det) < 1e-12) {
      // Degenerate case fallback to mean subtraction
      const mean = sumZ / N;
      for (let i = 0; i < N; i++) output[i] = roiPixels[i] - mean;
      return output;
    }

    const detA = sumXZ * (sumYY * N - sumY * sumY) -
                 sumXY * (sumYZ * N - sumY * sumZ) +
                 sumX  * (sumYZ * sumY - sumYY * sumZ);

    const detB = sumXX * (sumYZ * N - sumY * sumZ) -
                 sumXZ * (sumXY * N - sumY * sumX) +
                 sumX  * (sumXY * sumZ - sumYZ * sumX);

    const detC = sumXX * (sumYY * sumZ - sumYZ * sumY) -
                 sumXY * (sumXY * sumZ - sumYZ * sumX) +
                 sumXZ * (sumXY * sumY - sumYY * sumX);

    const a = detA / det;
    const b = detB / det;
    const c = detC / det;

    for (let y = 0; y < roiSize; y++) {
      for (let x = 0; x < roiSize; x++) {
        const idx = y * roiSize + x;
        const trend = a * x + b * y + c;
        output[idx] = roiPixels[idx] - trend;
      }
    }

    return output;
  }

  /**
   * Least Squares 2D 2nd-Degree Polynomial Fit: z = a*x^2 + b*y^2 + c*x*y + d*x + e*y + f
   */
  static removePolyTrend(roiPixels, roiSize) {
    const N = roiSize * roiSize;
    const output = new Float32Array(N);

    // Build 6x6 normal matrix for polynomial fitting
    const A = Array.from({ length: 6 }, () => new Float64Array(6));
    const B = new Float64Array(6);

    for (let y = 0; y < roiSize; y++) {
      for (let x = 0; x < roiSize; x++) {
        const z = roiPixels[y * roiSize + x];
        const terms = [x * x, y * y, x * y, x, y, 1.0];

        for (let i = 0; i < 6; i++) {
          for (let j = 0; j < 6; j++) {
            A[i][j] += terms[i] * terms[j];
          }
          B[i] += terms[i] * z;
        }
      }
    }

    // Solve 6x6 linear system via Gaussian Elimination
    const coeff = this.solveLinearSystem(A, B);

    if (!coeff) {
      // Fallback if singular matrix
      return this.removePlaneTrend(roiPixels, roiSize);
    }

    for (let y = 0; y < roiSize; y++) {
      for (let x = 0; x < roiSize; x++) {
        const idx = y * roiSize + x;
        const trend = coeff[0] * x * x + coeff[1] * y * y + coeff[2] * x * y +
                      coeff[3] * x + coeff[4] * y + coeff[5];
        output[idx] = roiPixels[idx] - trend;
      }
    }

    return output;
  }

  static solveLinearSystem(A, B) {
    const n = B.length;
    const M = A.map((row, i) => [...row, B[i]]);

    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
      }
      [M[i], M[maxRow]] = [M[maxRow], M[i]];

      if (Math.abs(M[i][i]) < 1e-12) return null;

      for (let k = i + 1; k < n; k++) {
        const c = -M[k][i] / M[i][i];
        for (let j = i; j <= n; j++) {
          if (i === j) M[k][j] = 0;
          else M[k][j] += c * M[i][j];
        }
      }
    }

    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      x[i] = M[i][n] / M[i][i];
      for (let k = i - 1; k >= 0; k--) {
        M[k][n] -= M[k][i] * x[i];
      }
    }
    return x;
  }
}

window.TrendRemoval = TrendRemoval;
