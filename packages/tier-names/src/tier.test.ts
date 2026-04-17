import { describe, expect, it } from "bun:test";
import { computeTier } from "./tier";
import { nextName } from "./next-name";
import { TIER_POOLS, isValidName } from "./pools";

describe("computeTier", () => {
  it("starts new users at tier 1 with zero progress", () => {
    const { tier, score } = computeTier(0, 0, 0);
    expect(tier).toBe(1);
    expect(score).toBe(0);
  });

  it("clamps per-component so heavy commits alone cannot blow past tier 4", () => {
    const { tier } = computeTier(1_000_000, 0, 0);
    expect(tier).toBeLessThanOrEqual(4);
  });

  it("reaches tier 7 only with balanced activity", () => {
    const { tier } = computeTier(5_000, 100_000_000, 500);
    expect(tier).toBe(7);
  });

  it("reports tierProgress in [0,1)", () => {
    const { tierProgress } = computeTier(100, 1_000_000, 10);
    expect(tierProgress).toBeGreaterThanOrEqual(0);
    expect(tierProgress).toBeLessThan(1);
  });
});

describe("nextName", () => {
  it("picks an unused name from the current tier", () => {
    const { name, suffixed } = nextName({ tier: 1, usedNames: [], random: () => 0 });
    expect(suffixed).toBe(false);
    expect(TIER_POOLS[1]).toContain(name);
  });

  it("avoids already-used names (case-insensitive)", () => {
    const used = TIER_POOLS[1].slice(0, 5).map((n) => n.toLowerCase());
    const { name } = nextName({ tier: 1, usedNames: used, random: () => 0 });
    expect(used).not.toContain(name.toLowerCase());
  });

  it("falls back to numeric suffix when pool exhausted", () => {
    const { name, suffixed, poolExhausted } = nextName({
      tier: 1,
      usedNames: [...TIER_POOLS[1]],
      random: () => 0,
    });
    expect(suffixed).toBe(true);
    expect(poolExhausted).toBe(true);
    expect(name).toMatch(/-\d+$/);
  });
});

describe("isValidName", () => {
  it("accepts a base name from the tier pool", () => {
    expect(isValidName(1, "Sequoia")).toBe(true);
  });

  it("accepts a suffixed name from the tier pool", () => {
    expect(isValidName(1, "Sequoia-3")).toBe(true);
  });

  it("rejects a name from a different tier", () => {
    expect(isValidName(1, "Andromeda")).toBe(false);
  });
});
