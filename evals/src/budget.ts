/** Eval-only transport policy. Hosts, authentication and protocol stay in the adapter. */
export interface BudgetOptions {
  milliseconds?: number;
  maxCalls?: number;
  fetch?: typeof globalThis.fetch;
}
export class RunBudget {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  readonly maxCalls: number;
  readonly deadline: number;
  calls = 0;
  failure: Error | undefined;
  private readonly transport: typeof globalThis.fetch;
  private readonly timer: ReturnType<typeof setTimeout>;
  constructor(options: BudgetOptions = {}) {
    this.maxCalls = options.maxCalls ?? 200;
    const milliseconds = options.milliseconds ?? 180_000;
    this.deadline = Date.now() + milliseconds;
    this.transport = options.fetch ?? globalThis.fetch;
    this.timer = setTimeout(() => this.fail("eval run budget exceeded"), milliseconds);
  }
  fail(message: string): Error {
    this.failure ??= new Error(message);
    this.controller.abort(this.failure);
    return this.failure;
  }
  check(): void {
    if (Date.now() >= this.deadline) this.fail("eval run budget exceeded");
    if (this.failure) throw this.failure;
  }
  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    for (;;) {
      this.check();
      if (this.calls >= this.maxCalls) throw this.fail("eval transport call cap exceeded");
      this.calls++;
      const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      const signal = requestSignal ? AbortSignal.any([this.signal, requestSignal]) : this.signal;
      const response = await this.transport(input, { ...init, signal });
      this.check();
      if (response.status !== 429) return response;
      const header = response.headers.get("retry-after");
      const seconds = header === null ? NaN : Number(header);
      const delay = Number.isFinite(seconds)
        ? Math.max(0, seconds * 1000)
        : Math.max(0, header ? Date.parse(header) - Date.now() : 1000);
      await response.body?.cancel();
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(this.signal.reason as Error);
        };
        const timer = setTimeout(
          () => {
            this.signal.removeEventListener("abort", abort);
            resolve();
          },
          Number.isFinite(delay) ? Math.max(1, delay) : 1000,
        );
        this.signal.addEventListener("abort", abort, { once: true });
        if (this.signal.aborted) abort();
      });
    }
  };
  async run<T>(work: () => Promise<T>): Promise<T> {
    let abort: () => void = () => undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      abort = () => {
        reject(this.signal.reason as Error);
      };
      this.signal.addEventListener("abort", abort, { once: true });
      if (this.signal.aborted) abort();
    });
    try {
      return await Promise.race([work(), expired]);
    } finally {
      this.signal.removeEventListener("abort", abort);
      this.close();
    }
  }
  close(): void {
    clearTimeout(this.timer);
  }
}
