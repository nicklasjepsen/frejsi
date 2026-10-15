/** A token bucket; synchronous reservation also bounds concurrent requests. */
class Bucket {
  private tokens: number;
  private updated = Date.now();
  constructor(private readonly capacity: number) {
    this.tokens = capacity;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (Math.max(0, now - this.updated) * this.capacity) / 60_000,
    );
    this.updated = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
export class OffRateLimits {
  readonly search = new Bucket(10);
  // OFF now publishes 15 product reads/minute/IP, tighter than the original plan's 100.
  readonly product = new Bucket(15);
}
/** Registry factories create per-request sources; all use these process-wide budgets. */
export const processLimits = new OffRateLimits();
