// The desk cat as a tiny tamagotchi: two needs that drift down in real time and go up with care.
// Pure functions of (state, now) so the terminal can persist it and the tests can pin the clock.

export const PET_REPO = "https://github.com/Renfild/tamagotchi-bot";

// Points lost per second: a full bowl lasts about two and a half hours, a good mood about three.
const DECAY = { food: 1 / 90, joy: 1 / 110 };

export function createPet(now) {
  return { food: 70, joy: 60, at: now };
}

export function settle(pet, now) {
  const base = isPet(pet) ? pet : createPet(now);
  const seconds = Math.max(0, (now - base.at) / 1000);
  return {
    food: clamp(base.food - seconds * DECAY.food),
    joy: clamp(base.joy - seconds * DECAY.joy),
    at: now,
  };
}

// Returns the settled pet after the action and whether the cat actually went along with it.
export function act(pet, action, now) {
  const p = settle(pet, now);
  if (action === "feed") {
    if (p.food >= 95) return { pet: p, took: false };
    return { pet: { ...p, food: clamp(p.food + 35), joy: clamp(p.joy + 5) }, took: true };
  }
  if (action === "play") {
    if (p.food < 15) return { pet: p, took: false };
    return { pet: { ...p, joy: clamp(p.joy + 30), food: clamp(p.food - 8) }, took: true };
  }
  if (action === "pet") {
    return { pet: { ...p, joy: clamp(p.joy + 15) }, took: true };
  }
  return { pet: p, took: true };
}

export function mood(pet) {
  return Math.round((pet.food + pet.joy) / 2);
}

export function moodLabel(value) {
  if (value >= 80) return "счастлив";
  if (value >= 55) return "доволен";
  if (value >= 30) return "скучает";
  return "грустит";
}

export function bar(value) {
  const filled = Math.round(value / 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${Math.round(value)}%`;
}

function isPet(pet) {
  return Boolean(pet) && Number.isFinite(pet.food) && Number.isFinite(pet.joy) && Number.isFinite(pet.at);
}

function clamp(value) {
  return Math.min(100, Math.max(0, value));
}
