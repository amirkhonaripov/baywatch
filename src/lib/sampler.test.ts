import { describe, expect, it } from "vitest";
import { MAX_FRAMES, monotonic, sampleTimes, targetSize } from "./sampler";

describe("sampleTimes", () => {
  it("samples at 2 fps strictly before the end", () => {
    expect(sampleTimes(3)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    expect(sampleTimes(3.2)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
  });
  it("caps at 60 s / 120 frames", () => {
    const t = sampleTimes(600);
    expect(t.length).toBe(MAX_FRAMES);
    expect(t[t.length - 1]).toBe(59.5);
    expect(sampleTimes(60).length).toBe(120);
  });
  it("always returns at least one frame", () => {
    expect(sampleTimes(0.2)).toEqual([0]);
    expect(sampleTimes(0)).toEqual([0]);
    expect(sampleTimes(Number.NaN)).toEqual([0]);
    expect(sampleTimes(Number.POSITIVE_INFINITY)).toEqual([0]);
  });
});

describe("targetSize", () => {
  it("caps the long side at 720 keeping aspect (landscape and rotated portrait)", () => {
    expect(targetSize(1920, 1080)).toEqual([720, 406]);
    expect(targetSize(1080, 1920)).toEqual([406, 720]);
    expect(targetSize(3840, 2160)).toEqual([720, 406]);
  });
  it("never upscales", () => {
    expect(targetSize(640, 360)).toEqual([640, 360]);
    expect(targetSize(720, 720)).toEqual([720, 720]);
  });
  it("handles missing dimensions", () => {
    expect(targetSize(0, 0)).toEqual([0, 0]);
  });
});

describe("monotonic", () => {
  it("rounds to ms and never decreases", () => {
    expect(monotonic([0, 0.50001, 0.4999, 1.0004])).toEqual([0, 0.5, 0.5, 1]);
  });
});
