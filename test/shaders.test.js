import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// A uniform that is declared in JavaScript but never in the GLSL (or the other way round) does not fail:
// three.js silently skips it and the effect just stops working. The shader modules import three.js, which
// has no home in node, so this reads their source and compares the two lists.
function read(name) {
  return readFileSync(new URL(`../js/${name}`, import.meta.url), "utf8");
}

function jsUniforms(source) {
  const names = new Set();
  for (const block of source.matchAll(/uniforms:\s*\{([\s\S]*?)\n\s{2,4}\},/g)) {
    for (const key of block[1].matchAll(/\b(u[A-Z]\w*|tDiffuse)\s*:/g)) names.add(key[1]);
  }
  return names;
}

function glslUniforms(source) {
  const names = new Set();
  for (const decl of source.matchAll(/\buniform\s+(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+(\w+)\s*;/g)) names.add(decl[1]);
  return names;
}

for (const file of ["finish.js", "rain.js"]) {
  test(`${file}: every uniform set from JavaScript is declared in the shaders`, () => {
    const source = read(file);
    const declared = glslUniforms(source);
    // A parser that finds nothing would pass every comparison below.
    assert.ok(declared.size >= 5 && jsUniforms(source).size >= 5, "the uniform lists were not found in the source");
    const missing = [...jsUniforms(source)].filter((name) => !declared.has(name));
    assert.deepEqual(missing, [], `uniforms with no GLSL declaration: ${missing.join(", ")}`);
  });

  test(`${file}: every uniform declared in the shaders is supplied from JavaScript`, () => {
    const source = read(file);
    const supplied = jsUniforms(source);
    const unused = [...glslUniforms(source)].filter((name) => !supplied.has(name));
    assert.deepEqual(unused, [], `GLSL uniforms nobody sets: ${unused.join(", ")}`);
  });
}

test("the final pass keeps its tunables behind uniforms, not constants", () => {
  const source = read("finish.js");
  for (const name of ["uFxaa", "uGrade", "uAberration", "uGrain", "uTime", "uTexel"]) {
    assert.match(source, new RegExp(`\\b${name}\\b`));
  }
});
