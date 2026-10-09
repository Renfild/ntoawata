import assert from "node:assert/strict";
import test from "node:test";
import { createGovernor, pinnedPixelRatio, pixelRatioSteps } from "../js/quality.js";

// Feeds `frames` frames of `ms` each and returns every change the governor announced, with the time of it.
function run(governor, state, frames, ms) {
  const changes = [];
  for (let i = 0; i < frames; i += 1) {
    state.now += ms;
    const next = governor.sample(ms, state.now);
    if (next !== null) changes.push({ at: Math.round(state.now), ratio: next });
  }
  return changes;
}

test("steps run from the device cap down to a floor, without duplicates", () => {
  assert.deepEqual(pixelRatioSteps(1.5), [1.5, 1.25, 1, 0.85, 0.7]);
  assert.deepEqual(pixelRatioSteps(1.25), [1.25, 1, 0.85, 0.7]);
  assert.deepEqual(pixelRatioSteps(1), [1, 0.85, 0.7]);
});

test("a device that holds 60 fps keeps full resolution", () => {
  const g = createGovernor({ steps: pixelRatioSteps(1.5) });
  const state = { now: 0 };
  assert.deepEqual(run(g, state, 2000, 16.7), []);
  assert.equal(g.pixelRatio, 1.5);
});

test("a slow device steps down one level per measurement until the floor", () => {
  const g = createGovernor({ steps: pixelRatioSteps(1.5) });
  const state = { now: 0 };
  const changes = run(g, state, 3000, 45);
  assert.deepEqual(changes.map((c) => c.ratio), [1.25, 1, 0.85, 0.7]);
  // Never two steps inside the settling time.
  for (let i = 1; i < changes.length; i += 1) assert.ok(changes[i].at - changes[i - 1].at >= 1500);
  assert.equal(g.pixelRatio, 0.7);
});

test("resolution comes back once frames are comfortably fast for a while", () => {
  const g = createGovernor({ steps: pixelRatioSteps(1.5) });
  const state = { now: 0 };
  run(g, state, 400, 45);
  assert.ok(g.level > 0);
  const slowLevel = g.level;
  run(g, state, 3000, 16.7);
  assert.ok(g.level < slowLevel, "should have stepped back up");
});

test("a step up that is undone within seconds is never tried again", () => {
  const g = createGovernor({ steps: pixelRatioSteps(1.5) });
  const state = { now: 0 };
  // Two full measurements of slow frames: down to level 2.
  run(g, state, 90, 45);
  assert.equal(g.level, 2);
  // Calm until the governor climbs one level (it waits for three calm measurements and a quiet spell).
  let climbed = false;
  for (let i = 0; i < 4000 && !climbed; i += 1) {
    state.now += 16.7;
    climbed = g.sample(16.7, state.now) !== null;
  }
  assert.ok(climbed);
  assert.equal(g.level, 1);
  // The better level is too heavy: two slow measurements right after the climb.
  run(g, state, 90, 45);
  assert.equal(g.level, 3);
  // A long calm stretch brings back level 2 (proven fine) but never level 1 (proven too heavy).
  run(g, state, 6000, 16.7);
  assert.equal(g.level, 2);
});

test("hitches do not count: a tab switch must not cost resolution", () => {
  const g = createGovernor({ steps: pixelRatioSteps(1.5) });
  const state = { now: 0 };
  for (let i = 0; i < 200; i += 1) {
    state.now += 16.7;
    g.sample(i % 10 === 0 ? 4000 : 16.7, state.now);
  }
  assert.equal(g.pixelRatio, 1.5);
});

test("a 120 Hz screen that drops to 50 fps is not treated as slow", () => {
  const g = createGovernor({ steps: pixelRatioSteps(1.5) });
  const state = { now: 0 };
  run(g, state, 600, 8.3);
  assert.deepEqual(run(g, state, 1500, 20), []);
});

test("?q pins the quality, anything else is automatic", () => {
  assert.equal(pinnedPixelRatio("?q=high", 1.5), 1.5);
  assert.equal(pinnedPixelRatio("?q=medium", 1.5), 1);
  assert.equal(pinnedPixelRatio("?q=low", 1.5), 0.75);
  assert.equal(pinnedPixelRatio("?q=low", 0.7), 0.7);
  assert.equal(pinnedPixelRatio("?q=ultra", 1.5), null);
  assert.equal(pinnedPixelRatio("", 1.5), null);
});
