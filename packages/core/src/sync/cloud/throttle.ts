function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lightweight transfer throttle. This is approximate pacing rather than
 * socket-level traffic shaping.
 */
export class BandwidthThrottle {
  private readonly limitBytesPerSecond: number | null;
  private windowStart = Date.now();
  private bytesInWindow = 0;

  constructor(limitKBps?: number) {
    this.limitBytesPerSecond =
      typeof limitKBps === "number" && limitKBps > 0
        ? limitKBps * 1024
        : null;
  }

  async consume(bytes: number): Promise<void> {
    if (!this.limitBytesPerSecond || bytes <= 0) {
      return;
    }

    const now = Date.now();
    const elapsedMs = now - this.windowStart;
    if (elapsedMs >= 1000) {
      this.windowStart = now;
      this.bytesInWindow = 0;
    }

    this.bytesInWindow += bytes;

    if (this.bytesInWindow <= this.limitBytesPerSecond) {
      return;
    }

    const excess = this.bytesInWindow - this.limitBytesPerSecond;
    const waitMs = Math.ceil((excess / this.limitBytesPerSecond) * 1000);
    if (waitMs > 0) {
      await sleep(waitMs);
      this.windowStart = Date.now();
      this.bytesInWindow = 0;
    }
  }
}

