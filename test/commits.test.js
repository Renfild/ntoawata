import assert from "node:assert/strict";
import test from "node:test";
import { COMMITS_KEY, COMMITS_TTL, COMMITS_URL, loadLatestCommits, pickCommits } from "../js/commits.js";

const pushEvent = (repo, messages) => ({
  type: "PushEvent",
  repo: { name: `Renfild/${repo}` },
  payload: { commits: messages.map((message) => ({ message })) },
});

const memoryStorage = (seed = null) => {
  const data = new Map(seed ? [[COMMITS_KEY, JSON.stringify(seed)]] : []);
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
};

const okFetch = (events, calls = []) => async (url, options) => {
  calls.push({ url, options });
  return { ok: true, status: 200, json: async () => events };
};

const failingFetch = (status = 403) => async () => ({ ok: false, status, json: async () => [] });

test("pickCommits keeps push commits, first line only, short messages", () => {
  const long = "x".repeat(60);
  const commits = pickCommits([
    pushEvent("pcai", ["Fix chunking\n\nlong body"]),
    { type: "WatchEvent", repo: { name: "Renfild/nope" } },
    pushEvent("shop", [long, "   "]),
  ]);
  assert.deepEqual(commits[0], { repo: "pcai", message: "Fix chunking" });
  assert.equal(commits.length, 2);
  assert.equal(commits[1].message.length, 46);
  assert.ok(commits[1].message.endsWith("…"));
});

test("pickCommits caps the billboard at six commits", () => {
  const events = [pushEvent("a", Array.from({ length: 10 }, (_, i) => `c${i}`))];
  assert.equal(pickCommits(events).length, 6);
});

test("a fresh cache answers without asking GitHub", async () => {
  const cached = [{ repo: "pcai", message: "cached" }];
  const storage = memoryStorage({ at: 1000, commits: cached });
  const calls = [];
  const commits = await loadLatestCommits({ fetchImpl: okFetch([], calls), storage, now: 1000 + COMMITS_TTL - 1 });
  assert.deepEqual(commits, cached);
  assert.equal(calls.length, 0);
});

test("an expired cache is refreshed and stored", async () => {
  const storage = memoryStorage({ at: 0, commits: [{ repo: "old", message: "old" }] });
  const calls = [];
  const events = [pushEvent("pcai", ["new one"])];
  const commits = await loadLatestCommits({ fetchImpl: okFetch(events, calls), storage, now: COMMITS_TTL + 5 });
  assert.deepEqual(commits, [{ repo: "pcai", message: "new one" }]);
  assert.equal(calls[0].url, COMMITS_URL);
  assert.deepEqual(JSON.parse(storage.getItem(COMMITS_KEY)), { at: COMMITS_TTL + 5, commits });
});

test("rate limit falls back to the stale cache instead of an empty billboard", async () => {
  const stale = [{ repo: "pcai", message: "stale" }];
  const storage = memoryStorage({ at: 0, commits: stale });
  const commits = await loadLatestCommits({ fetchImpl: failingFetch(403), storage, now: COMMITS_TTL * 3 });
  assert.deepEqual(commits, stale);
});

test("no cache and no network returns an empty list", async () => {
  assert.deepEqual(await loadLatestCommits({ fetchImpl: failingFetch(), storage: memoryStorage(), now: 1 }), []);
  const broken = async () => {
    throw new TypeError("offline");
  };
  assert.deepEqual(await loadLatestCommits({ fetchImpl: broken, storage: null, now: 1 }), []);
});

test("blocked or junk storage never throws", async () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  const events = [pushEvent("pcai", ["works anyway"])];
  const commits = await loadLatestCommits({ fetchImpl: okFetch(events), storage: blocked, now: 1 });
  assert.deepEqual(commits, [{ repo: "pcai", message: "works anyway" }]);
  const junk = memoryStorage();
  junk.setItem(COMMITS_KEY, "{not json");
  assert.deepEqual(await loadLatestCommits({ fetchImpl: failingFetch(), storage: junk, now: 1 }), []);
});
