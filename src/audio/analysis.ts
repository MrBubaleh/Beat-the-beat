export interface AnalysisResult {
  rms: number;
  spectralCentroid: number;
  spectralFlux: number;
  magnitudes: Float32Array;
}

export function computeAnalysis(
  samples: Float32Array,
  fftSize: number,
  sampleRate: number,
  prevMagnitudes: Float32Array | null,
): AnalysisResult {
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  for (let i = 0; i < fftSize && i < samples.length; i++) re[i] = samples[i];
  applyHann(re);

  fft(re, im);

  const bins = fftSize / 2;
  const magnitudes = new Float32Array(bins);
  let sumPower = 0;
  let weighted = 0;
  const binWidth = sampleRate / fftSize;
  for (let i = 0; i < bins; i++) {
    const m = Math.hypot(re[i], im[i]) / fftSize;
    magnitudes[i] = m;
    const power = m * m;
    sumPower += power;
    weighted += i * binWidth * power;
  }
  const spectralCentroid = sumPower > 1e-9 ? weighted / sumPower : 0;

  let spectralFlux = 0;
  if (prevMagnitudes && prevMagnitudes.length === bins) {
    for (let i = 0; i < bins; i++) {
      spectralFlux += Math.max(0, magnitudes[i] - prevMagnitudes[i]);
    }
    spectralFlux /= bins;
  }

  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
  const rms = Math.sqrt(sumSquares / samples.length);

  return { rms, spectralCentroid, spectralFlux, magnitudes };
}

export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      swap(re, i, j);
      swap(im, i, j);
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const vIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

function swap(values: Float32Array, a: number, b: number): void {
  const tmp = values[a];
  values[a] = values[b];
  values[b] = tmp;
}

function applyHann(values: Float32Array): void {
  const n = values.length;
  for (let i = 0; i < n; i++) {
    values[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
}
