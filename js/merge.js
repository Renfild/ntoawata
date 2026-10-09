// Concatenates indexed geometries that share one attribute layout into a single set of arrays, so a
// hundred static boxes can be drawn with one call. It works on plain typed arrays and knows nothing about
// three.js, which keeps it testable without a GPU: world.js wraps the result in a BufferGeometry.

/**
 * @param {{ attributes: Record<string, { array: ArrayLike<number>, itemSize: number }>, index: ArrayLike<number> }[]} parts
 * @returns {{ attributes: Record<string, { array: Float32Array, itemSize: number }>, index: Uint32Array, vertexCount: number }}
 */
export function mergeBuffers(parts) {
  if (!parts.length) throw new Error("mergeBuffers needs at least one part");
  const names = Object.keys(parts[0].attributes);
  let vertexCount = 0;
  let indexCount = 0;
  for (const part of parts) {
    const keys = Object.keys(part.attributes);
    if (keys.length !== names.length || !names.every((name) => keys.includes(name))) {
      throw new Error(`attribute sets differ: ${keys.join(",")} vs ${names.join(",")}`);
    }
    const count = part.attributes[names[0]].array.length / part.attributes[names[0]].itemSize;
    for (const name of names) {
      const { array, itemSize } = part.attributes[name];
      if (itemSize !== parts[0].attributes[name].itemSize || array.length / itemSize !== count) {
        throw new Error(`attribute "${name}" does not match the rest of the part`);
      }
    }
    vertexCount += count;
    indexCount += part.index.length;
  }

  const attributes = {};
  for (const name of names) {
    const itemSize = parts[0].attributes[name].itemSize;
    const array = new Float32Array(vertexCount * itemSize);
    let offset = 0;
    for (const part of parts) {
      array.set(part.attributes[name].array, offset);
      offset += part.attributes[name].array.length;
    }
    attributes[name] = { array, itemSize };
  }

  const index = new Uint32Array(indexCount);
  let base = 0;
  let at = 0;
  for (const part of parts) {
    for (let i = 0; i < part.index.length; i += 1) index[at + i] = part.index[i] + base;
    at += part.index.length;
    base += part.attributes[names[0]].array.length / part.attributes[names[0]].itemSize;
  }
  return { attributes, index, vertexCount };
}
