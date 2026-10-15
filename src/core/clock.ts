// Time, behind an interface so tests can move it forward (FakeClock) instead of
// waiting. Code that needs "now" or a timer takes a Clock: never call
// Date.now() or setTimeout() directly in features.

export interface Clock {
  now(): number;
  setTimer(fn: () => void, ms: number): () => void; // returns a cancel function
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimer(fn, ms) {
    // Node timers overflow above ~24.8 days; the scheduler re-checks sooner anyway.
    const t = setTimeout(fn, Math.min(Math.max(ms, 0), 2_147_000_000));
    t.unref?.();
    return () => clearTimeout(t);
  },
};

export class FakeClock implements Clock {
  #now: number;
  #timers: { at: number; fn: () => void; id: number }[] = [];
  #next = 1;

  constructor(start: number | Date = Date.UTC(2026, 9, 14, 12, 0, 0)) {
    this.#now = typeof start === 'number' ? start : start.getTime();
  }

  now(): number {
    return this.#now;
  }

  setTimer(fn: () => void, ms: number): () => void {
    const id = this.#next++;
    this.#timers.push({ at: this.#now + Math.max(ms, 0), fn, id });
    return () => {
      this.#timers = this.#timers.filter((t) => t.id !== id);
    };
  }

  // Moves time forward, firing due timers in order.
  advance(ms: number): void {
    const end = this.#now + ms;
    for (;;) {
      const due = this.#timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.#timers = this.#timers.filter((t) => t !== due);
      this.#now = Math.max(this.#now, due.at);
      due.fn();
    }
    this.#now = end;
  }

  get pendingTimers(): number {
    return this.#timers.length;
  }
}
