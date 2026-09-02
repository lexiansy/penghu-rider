export const STORAGE_KEY = 'penghu-rider-progress-v1';
export const CLEAR_SCORE = 90;

export function makeInitialProgress() {
  return {
    version: 1,
    activeDay: 1,
    completedDays: [],
    stats: {},
    categoryStats: {},
    session: null,
    lastBossMisses: [],
    bossRetryAvailable: false,
    clear: false,
  };
}

export function serializeProgress(progress) {
  return JSON.stringify(progress);
}

export function restoreProgress(serialized) {
  if (!serialized) return makeInitialProgress();
  try {
    const value = JSON.parse(serialized);
    if (value?.version !== 1 || typeof value?.activeDay !== 'number') {
      return makeInitialProgress();
    }
    return { ...makeInitialProgress(), ...value };
  } catch {
    return makeInitialProgress();
  }
}

export function seededRandom(seed = 1) {
  let state = Math.abs(Number(seed)) || 1;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

export function shuffled(items, random = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export function questionWeight(question, progress) {
  const stat = progress.stats?.[question.id] ?? { attempts: 0, wrong: 0, streak: 0 };
  const category = progress.categoryStats?.[question.category] ?? { attempts: 0, correct: 0 };
  const accuracy = category.attempts ? category.correct / category.attempts : 0.65;
  let weight = 1;
  weight += stat.wrong * 6;
  if (stat.wrong > 0 && stat.mastery !== 'defeated') weight += 4;
  weight += Math.max(0, 0.75 - accuracy) * 8;
  if (question.tags?.includes('numeric')) weight += 2.5;
  if (question.tags?.includes('visual') && accuracy < 0.7) weight += 1.5;
  return weight;
}

export function weightedSample(items, count, progress, seed = 1) {
  const random = seededRandom(seed);
  const pool = [...items];
  const chosen = [];
  while (pool.length && chosen.length < count) {
    const weights = pool.map((item) => questionWeight(item, progress));
    const total = weights.reduce((sum, value) => sum + value, 0);
    let target = random() * total;
    let selected = 0;
    for (let index = 0; index < pool.length; index += 1) {
      target -= weights[index];
      if (target <= 0) {
        selected = index;
        break;
      }
    }
    chosen.push(pool.splice(selected, 1)[0]);
  }
  return chosen;
}

function sampleBy(items, count, seed) {
  return shuffled(items, seededRandom(seed)).slice(0, count);
}

export function makeDiagnostic(questions, seed = 20260902) {
  const standard = questions.filter((item) => item.type === 'standard');
  const categories = ['正確觀念與態度', '主動停讓文化', '安全駕駛能力'];
  const selected = categories.flatMap((category, index) =>
    sampleBy(standard.filter((item) => item.category === category), 3, seed + index),
  );
  selected.push(...sampleBy(questions.filter((item) => item.type === 'hazard'), 3, seed + 10));
  selected.push(...sampleBy(questions.filter((item) => item.type === 'scenario'), 3, seed + 20));
  return shuffled(selected, seededRandom(seed + 30));
}

export function makeTargetedSet(questions, progress, count = 18, seed = Date.now()) {
  return weightedSample(questions, count, progress, seed);
}

export function makeRevengeSet(questions, progress, missedIds = [], count = 10, seed = Date.now()) {
  const missed = missedIds.map((id) => questions.find((item) => item.id === id)).filter(Boolean);
  const rest = questions.filter((item) => !missedIds.includes(item.id));
  const chosen = missed.slice(0, count);
  if (chosen.length < count) {
    chosen.push(...weightedSample(rest, count - chosen.length, progress, seed));
  }
  return shuffled(chosen, seededRandom(seed + 1));
}

export function makeBossExam(questions, seed = Date.now()) {
  const standard = sampleBy(questions.filter((item) => item.type === 'standard'), 35, seed + 1);
  const hazard = sampleBy(questions.filter((item) => item.type === 'hazard'), 10, seed + 2);
  const scenario = sampleBy(questions.filter((item) => item.type === 'scenario'), 5, seed + 3);
  return shuffled([...standard, ...hazard, ...scenario], seededRandom(seed + 4));
}

export function recordAnswer(progress, question, isCorrect) {
  const next = structuredClone(progress);
  const current = next.stats[question.id] ?? {
    attempts: 0,
    wrong: 0,
    streak: 0,
    mastery: 'learning',
  };
  current.attempts += 1;
  if (isCorrect) current.streak += 1;
  else {
    current.wrong += 1;
    current.streak = 0;
  }
  current.mastery = current.wrong > 0 && current.streak >= 2 ? 'defeated' : current.wrong > 0 ? 'monster' : 'learning';
  next.stats[question.id] = current;

  const category = next.categoryStats[question.category] ?? { attempts: 0, correct: 0 };
  category.attempts += 1;
  if (isCorrect) category.correct += 1;
  next.categoryStats[question.category] = category;
  return next;
}

export function bossScore(correctCount) {
  return correctCount * 2;
}

export function isClear(score) {
  return score >= CLEAR_SCORE;
}

export function weakCategories(progress) {
  return Object.entries(progress.categoryStats ?? {})
    .map(([name, stats]) => ({
      name,
      attempts: stats.attempts,
      accuracy: stats.attempts ? stats.correct / stats.attempts : 0,
    }))
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts);
}
