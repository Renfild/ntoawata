// Chooses how many pixels the scene is drawn with, from how long frames actually take. A phone that
// cannot hold 40 fps at full resolution drops a step at a time; a machine that keeps up is given the
// sharpness back, unless going up already proved too much. The logic is pure (times come in as arguments),
// so it can be tested without a browser.

const PIXEL_RATIOS = [1.5, 1.25, 1, 0.85, 0.7];

/**
 * Pixel ratios the scene may use, best first, capped by what the screen can show.
 * @param {number} cap highest pixel ratio allowed on this device
 */
export function pixelRatioSteps(cap) {
  const steps = PIXEL_RATIOS.filter((ratio) => ratio < cap);
  return [cap, ...steps];
}

/**
 * @param {{ steps: number[], window?: number, slowMs?: number, upWaitMs?: number, settleMs?: number }} options
 * `steps` are pixel ratios, best first. `window` is how many frames make one measurement.
 */
export function createGovernor({ steps, window = 45, slowMs = 24, upWaitMs = 6000, settleMs = 1500 }) {
  let level = 0;
  // The best level this session may use again: lowered when a step up was undone within a few seconds.
  let ceiling = 0;
  let sum = 0;
  let count = 0;
  let calm = 0;
  let lastChange = -Infinity;
  let lastUp = -Infinity;
  let climbedTo = -1;
  // The refresh interval of the display: the fastest window seen so far, never slower than 60 Hz and never past 150 Hz.
  let refresh = 1000 / 60;

  return {
    get level() {
      return level;
    },
    get pixelRatio() {
      return steps[level];
    },
    /**
     * Feed one frame. Returns the new pixel ratio when it changes, otherwise null.
     * @param {number} frameMs time since the previous frame
     * @param {number} nowMs a monotonic clock
     */
    sample(frameMs, nowMs) {
      // A hitch (tab switch, garbage collection, a dialog) says nothing about how heavy the scene is.
      if (!(frameMs > 0) || frameMs > 250) return null;
      sum += frameMs;
      count += 1;
      if (count < window) return null;
      const mean = sum / count;
      sum = 0;
      count = 0;
      refresh = Math.max(6.5, Math.min(refresh, mean));

      const settled = nowMs - lastChange > settleMs;
      if (mean > Math.max(slowMs, refresh * 1.5) && level < steps.length - 1 && settled) {
        // Climbing to a level and being pushed off it within seconds means it is more than the device can carry.
        // Only that level is closed: a second slow measurement one step lower says nothing new about the first.
        if (level === climbedTo && nowMs - lastUp < 8000) ceiling = Math.max(ceiling, level + 1);
        level += 1;
        lastChange = nowMs;
        calm = 0;
        return steps[level];
      }
      calm = mean < refresh * 1.15 ? calm + 1 : 0;
      if (calm >= 3 && level > ceiling && nowMs - lastChange > upWaitMs) {
        level -= 1;
        climbedTo = level;
        lastChange = nowMs;
        lastUp = nowMs;
        calm = 0;
        return steps[level];
      }
      return null;
    },
  };
}

/**
 * `?q=high|medium|low` pins the quality (for screenshots and tests); anything else leaves it automatic.
 * @returns {number | null} the pixel ratio to pin, or null for automatic
 */
export function pinnedPixelRatio(search, cap) {
  const q = new URLSearchParams(search).get("q");
  if (q === "high") return cap;
  if (q === "medium") return Math.min(cap, 1);
  if (q === "low") return Math.min(cap, 0.75);
  return null;
}
