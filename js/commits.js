// Latest public commits for the billboard. GitHub allows 60 anonymous requests an hour per IP,
// so answers are kept in the browser for a while and an old answer is used when GitHub refuses.
export const COMMITS_URL = "https://api.github.com/users/Renfild/events/public?per_page=40";
export const COMMITS_KEY = "renfild:commits";
export const COMMITS_TTL = 30 * 60 * 1000;

export function pickCommits(events) {
  const commits = [];
  for (const event of events) {
    if (event.type !== "PushEvent") continue;
    const repo = String(event.repo?.name ?? "").split("/").pop();
    for (const commit of event.payload?.commits ?? []) {
      const message = String(commit.message ?? "").split("\n")[0].trim();
      if (message) commits.push({ repo, message: message.length > 46 ? `${message.slice(0, 45)}…` : message });
    }
  }
  return commits.slice(0, 6);
}

function readCache(storage) {
  try {
    const cached = JSON.parse(storage.getItem(COMMITS_KEY) || "null");
    if (cached && Array.isArray(cached.commits) && typeof cached.at === "number") return cached;
  } catch {
    // Storage can be blocked or hold junk; treat it as empty.
  }
  return null;
}

function writeCache(storage, commits, at) {
  try {
    storage.setItem(COMMITS_KEY, JSON.stringify({ at, commits }));
  } catch {
    // Storage can be blocked; the next visit simply asks GitHub again.
  }
}

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Reading localStorage itself throws when the browser blocks site data.
    return null;
  }
}

export async function loadLatestCommits({
  fetchImpl = globalThis.fetch,
  storage = browserStorage(),
  now = Date.now(),
} = {}) {
  const cached = storage ? readCache(storage) : null;
  if (cached && now - cached.at < COMMITS_TTL) return cached.commits;

  try {
    const response = await fetchImpl(COMMITS_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const commits = pickCommits(await response.json());
    if (storage && commits.length) writeCache(storage, commits, now);
    return commits.length ? commits : cached?.commits ?? [];
  } catch {
    return cached?.commits ?? [];
  }
}
