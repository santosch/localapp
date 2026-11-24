import { describe, expect, it } from "vitest";
import { idleCountdown } from "../src/idle.ts";

describe("the idle countdown", () => {
  it("runs out after the idle time in ticks, and starts over on use", () => {
    const countdown = idleCountdown(30 * 60_000);
    expect(countdown.tickMs).toBe(60_000);
    for (let i = 0; i < 29; i++) expect(countdown.tick(false)).toBe(false);
    countdown.use();
    for (let i = 0; i < 29; i++) expect(countdown.tick(false)).toBe(false);
    expect(countdown.tick(false)).toBe(true);
  });

  it("doesn't run out while connections are open or work is busy", () => {
    const countdown = idleCountdown(1000);
    for (let i = 0; i < 10; i++) expect(countdown.tick(true)).toBe(false);
    for (let i = 0; i < 3; i++) expect(countdown.tick(false)).toBe(false);
    expect(countdown.tick(false)).toBe(true);
  });

  it("counts a night asleep as one tick: what isn't ticked didn't pass", () => {
    // A tick that fires late (the machine slept for hours) is one tick, whatever a clock says.
    const countdown = idleCountdown(30 * 60_000);
    countdown.use();
    expect(countdown.tick(false)).toBe(false);
  });

  it("never runs out without an idle time", () => {
    const countdown = idleCountdown(0);
    for (let i = 0; i < 100; i++) expect(countdown.tick(false)).toBe(false);
  });
});
