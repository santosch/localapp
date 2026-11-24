/**
 * How long a server has gone unused, counted in ticks of its own timer rather than read off a
 * clock. A clock runs on while the machine sleeps (Node's monotonic clock on macOS does:
 * `mach_continuous_time`), so after a night with the lid closed every server would find itself
 * idle for hours and stop before the window that's still open could say it's there. A timer
 * doesn't tick while the machine sleeps: after waking it fires once, and the sleep counts as one
 * tick.
 */
export interface IdleCountdown {
  /** How often `tick` is to be called. */
  readonly tickMs: number;
  /** Something used the server: the countdown starts over. */
  use(): void;
  /** One tick passed; `inUse` (open connections, busy work) counts as use. Whether it's run out. */
  tick(inUse: boolean): boolean;
}

/** A countdown of `idleMs` (0: never runs out), in ticks of a quarter of it, at most a minute. */
export function idleCountdown(idleMs: number): IdleCountdown {
  const tickMs = Math.min(60_000, Math.max(200, idleMs / 4));
  const ticks = Math.ceil(idleMs / tickMs);
  let unused = 0;
  return {
    tickMs,
    use: () => {
      unused = 0;
    },
    tick: (inUse) => {
      unused = inUse ? 0 : unused + 1;
      return idleMs > 0 && unused >= ticks;
    },
  };
}
