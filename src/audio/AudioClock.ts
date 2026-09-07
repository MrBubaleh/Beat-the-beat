export interface TimeSource {
  readonly currentTime: number;
}

export class AudioClock {
  private readonly timeSource: TimeSource;
  private offsetSeconds: number;
  private baseSeconds = 0;

  constructor(timeSource: TimeSource, latencyOffsetSeconds = 0) {
    this.timeSource = timeSource;
    this.offsetSeconds = latencyOffsetSeconds;
  }

  get currentTime(): number {
    return this.timeSource.currentTime;
  }

  get latencyOffset(): number {
    return this.offsetSeconds;
  }

  set latencyOffset(seconds: number) {
    this.offsetSeconds = seconds;
  }

  getTrackTime(): number {
    return this.currentTime - this.baseSeconds - this.offsetSeconds;
  }

  restart(): void {
    this.baseSeconds = this.currentTime;
  }
}
