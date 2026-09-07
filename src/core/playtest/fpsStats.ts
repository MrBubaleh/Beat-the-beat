export interface FpsStats {
  samples: number;
  avg: number;
  min: number;
  p10: number;
}

export class FpsTracker {
  private samples: number[] = [];

  reset(): void {
    this.samples = [];
  }

  sample(fps: number): void {
    if (!Number.isFinite(fps) || fps <= 0) return;
    this.samples.push(fps);
    if (this.samples.length > 3600) {
      this.samples.splice(0, this.samples.length - 3600);
    }
  }

  finish(): FpsStats {
    if (this.samples.length === 0) {
      return { samples: 0, avg: 0, min: 0, p10: 0 };
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    const sum = sorted.reduce((total, value) => total + value, 0);
    const p10Index = Math.max(0, Math.floor((sorted.length - 1) * 0.1));
    return {
      samples: sorted.length,
      avg: round1(sum / sorted.length),
      min: round1(sorted[0]),
      p10: round1(sorted[p10Index]),
    };
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
