export interface GameLoopHooks {
  fixedUpdate?: (dt: number) => void;
  variableUpdate?: (dt: number, alpha: number) => void;
  render?: (dt: number) => void;
}

const MAX_FIXED_STEPS = 20;
const MAX_FRAME_SECONDS = 0.25;

export class GameLoop {
  private readonly fixedDt: number;
  private readonly hooks: GameLoopHooks;
  private running = false;
  private paused = false;
  private lastTime = 0;
  private accumulator = 0;
  private rafId = 0;

  constructor(hooks: GameLoopHooks, fixedDt = 1 / 60) {
    this.hooks = hooks;
    this.fixedDt = fixedDt;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.lastTime = performance.now();
    this.accumulator = 0;

    const tick = (now: number): void => {
      if (!this.running) return;
      const frameSeconds = Math.min(MAX_FRAME_SECONDS, (now - this.lastTime) / 1000);
      this.lastTime = now;

      if (!this.paused) {
        this.accumulator += frameSeconds;
        let steps = 0;
        while (this.accumulator >= this.fixedDt && steps < MAX_FIXED_STEPS) {
          this.hooks.fixedUpdate?.(this.fixedDt);
          this.accumulator -= this.fixedDt;
          steps++;
        }
        if (steps === MAX_FIXED_STEPS) this.accumulator = 0;

        const alpha = Math.min(1, this.accumulator / this.fixedDt);
        this.hooks.variableUpdate?.(frameSeconds, alpha);
      }

      this.hooks.render?.(frameSeconds);
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.lastTime = performance.now();
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.paused;
  }
}
