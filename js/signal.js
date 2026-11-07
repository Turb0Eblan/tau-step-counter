/*
 * Signal processing used by the reviewer.
 *
 * Both functions are line-by-line ports of what python/parse_tau.py does,
 * so the web app and the Python script give the same filtered traces.
 */
(function (root) {
  "use strict";

  function median(arr) {
    const s = Float64Array.from(arr).sort();
    const n = s.length;
    if (n === 0) return NaN;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  /*
   * Robust noise estimate from successive differences.
   * For white noise with std s, diff(y) has std s*sqrt(2), and
   * MAD / 0.6745 is a robust estimate of std. Photobleaching steps
   * are rare outliers in diff(y), so they barely affect the median.
   */
  function estimateNoiseStd(y) {
    if (y.length < 3) return 1.0;
    const dy = new Float64Array(y.length - 1);
    for (let i = 0; i < dy.length; i++) dy[i] = y[i + 1] - y[i];
    const m = median(dy);
    const mad = median(dy.map((v) => Math.abs(v - m)));
    if (mad > 0) return mad / 0.6745 / Math.SQRT2;

    let mean = 0;
    for (const v of dy) mean += v;
    mean /= dy.length;
    let ss = 0;
    for (const v of dy) ss += (v - mean) * (v - mean);
    const alt = Math.sqrt(ss / dy.length) / Math.SQRT2;
    return Math.max(alt, 1.0);
  }

  /*
   * 1-D total variation denoising, Chambolle's projection algorithm.
   * Mirrors skimage.restoration.denoise_tv_chambolle for a 1-D float
   * array (same step size, same stopping rule), so results match.
   */
  function tvDenoise(y, weight, eps = 1e-6, maxIter = 200) {
    const n = y.length;
    const p = new Float64Array(n);
    const g = new Float64Array(n);
    const d = new Float64Array(n);
    const out = Float64Array.from(y);
    const tau = 0.5; // 1 / (2 * ndim)
    let eInit = 0;
    let ePrev = 0;

    for (let i = 0; i < maxIter; i++) {
      if (i > 0) {
        // d = div(p); out = y + d
        for (let j = 0; j < n; j++) {
          d[j] = (j > 0 ? p[j - 1] : 0) - p[j];
          out[j] = y[j] + d[j];
        }
      }

      let e = 0;
      for (let j = 0; j < n; j++) e += d[j] * d[j];

      for (let j = 0; j < n - 1; j++) g[j] = out[j + 1] - out[j];
      g[n - 1] = 0;

      for (let j = 0; j < n; j++) {
        const norm = Math.abs(g[j]);
        e += weight * norm;
        p[j] = (p[j] - tau * g[j]) / (1 + (norm * tau) / weight);
      }
      e /= n;

      if (i === 0) {
        eInit = e;
        ePrev = e;
      } else if (Math.abs(ePrev - e) < eps * eInit) {
        break;
      } else {
        ePrev = e;
      }
    }
    return out;
  }

  const api = { median, estimateNoiseStd, tvDenoise };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Signal = api;
})(typeof window !== "undefined" ? window : globalThis);
