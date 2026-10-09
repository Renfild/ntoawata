import assert from "node:assert/strict";
import test from "node:test";
import { mergeBuffers } from "../js/merge.js";

const quad = (offset, extra = {}) => ({
  attributes: {
    position: { array: new Float32Array([offset, 0, 0, offset + 1, 0, 0, offset + 1, 1, 0, offset, 1, 0]), itemSize: 3 },
    uv: { array: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), itemSize: 2 },
    ...extra,
  },
  index: [0, 1, 2, 0, 2, 3],
});

test("merged parts keep their vertices and shift their indices", () => {
  const merged = mergeBuffers([quad(0), quad(5)]);
  assert.equal(merged.vertexCount, 8);
  assert.equal(merged.attributes.position.array.length, 24);
  assert.equal(merged.attributes.uv.array.length, 16);
  assert.deepEqual([...merged.index], [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  // The second quad starts at x = 5: its first vertex is vertex 4 of the merged buffer.
  assert.equal(merged.attributes.position.array[4 * 3], 5);
});

test("custom per-vertex attributes are carried along", () => {
  const glow = (v) => ({ aGlow: { array: new Float32Array([v, v, v, v]), itemSize: 1 } });
  const merged = mergeBuffers([quad(0, glow(0.25)), quad(2, glow(1))]);
  assert.deepEqual([...merged.attributes.aGlow.array], [0.25, 0.25, 0.25, 0.25, 1, 1, 1, 1]);
});

test("parts with different attribute layouts are refused", () => {
  const plain = quad(0);
  const withGlow = quad(1, { aGlow: { array: new Float32Array(4), itemSize: 1 } });
  assert.throws(() => mergeBuffers([plain, withGlow]), /attribute sets differ/);
});

test("a part whose attribute length disagrees with its positions is refused", () => {
  const broken = quad(0);
  broken.attributes.uv = { array: new Float32Array([0, 0, 1, 0]), itemSize: 2 };
  assert.throws(() => mergeBuffers([broken]), /does not match/);
});

test("merging nothing is an error, not an empty mesh", () => {
  assert.throws(() => mergeBuffers([]), /at least one part/);
});
