import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  bossScore,
  clearSession,
  isClear,
  makeBossExam,
  makeInitialProgress,
  questionWeight,
  recordAnswer,
  restoreProgress,
  serializeProgress,
  storeSession,
  updateSession,
} from '../lib/game.mjs';

const dataset = JSON.parse(
  await readFile(new URL('../public/data/questions.json', import.meta.url), 'utf8'),
);
const questions = dataset.questions;

test('official dataset schema and exact snapshot counts', () => {
  assert.deepEqual(dataset.meta.counts, { standard: 806, hazard: 126, scenario: 120, total: 1052 });
  assert.equal(questions.length, 1052);
  for (const question of questions) {
    assert.equal(typeof question.id, 'string');
    assert.equal(question.options.length, 3, question.id);
    assert.ok(question.options.every(Boolean), question.id);
    assert.ok([0, 1, 2].includes(question.answerIndex), question.id);
  }
});

test('no duplicate IDs within each normalized source', () => {
  for (const type of ['standard', 'hazard', 'scenario']) {
    const source = questions.filter((question) => question.type === type);
    assert.equal(new Set(source.map((question) => question.id)).size, source.length, type);
  }
});

test('mock exam composition is exactly 50 / 10 / 5 / 35', () => {
  const exam = makeBossExam(questions, 42);
  assert.equal(exam.length, 50);
  assert.equal(exam.filter((question) => question.type === 'hazard').length, 10);
  assert.equal(exam.filter((question) => question.type === 'scenario').length, 5);
  assert.equal(exam.filter((question) => question.type === 'standard').length, 35);
});

test('weak and missed material receives greater sampling weight', () => {
  const question = questions.find((item) => item.type === 'standard' && item.tags.includes('numeric'));
  let progress = makeInitialProgress();
  const base = questionWeight(question, progress);
  progress = recordAnswer(progress, question, false);
  progress = recordAnswer(progress, question, false);
  assert.ok(questionWeight(question, progress) > base + 10);
});

test('localStorage payload resumes active session exactly', () => {
  const progress = makeInitialProgress();
  progress.activeDay = 2;
  progress.journeySession = { kind: 'targeted', ids: ['standard-001'], index: 0, answers: {}, startedAt: null };
  progress.sideSession = { kind: 'review', ids: ['standard-002'], index: 0, answers: {}, startedAt: null };
  assert.deepEqual(restoreProgress(serializeProgress(progress)), progress);
  assert.deepEqual(restoreProgress('{bad json'), makeInitialProgress());
});

test('legacy shared session migrates without resetting the saved journey', () => {
  const legacy = {
    ...makeInitialProgress(),
    session: {
      kind: 'targeted',
      ids: ['standard-001', 'standard-002', 'standard-003', 'standard-004'],
      index: 3,
      answers: { 'standard-001': 1, 'standard-002': 1, 'standard-003': 1 },
      startedAt: null,
    },
  };
  delete legacy.journeySession;
  delete legacy.sideSession;
  const restored = restoreProgress(serializeProgress(legacy));
  assert.deepEqual(restored.journeySession, legacy.session);
  assert.equal(restored.sideSession, null);
  assert.equal('session' in restored, false);
  assert.equal('activeSession' in restored, false);
});

test('attempted activeSession schema migrates journey and side sessions separately', () => {
  const journey = {
    kind: 'diagnostic',
    ids: ['standard-001', 'standard-002', 'standard-003', 'standard-004'],
    index: 3,
    answers: { 'standard-001': 1, 'standard-002': 1, 'standard-003': 1 },
    startedAt: null,
  };
  const side = { kind: 'monster', ids: ['standard-005'], index: 0, answers: {}, startedAt: null };
  const attempted = { ...makeInitialProgress(), session: side, activeSession: journey };
  delete attempted.journeySession;
  delete attempted.sideSession;
  const restored = restoreProgress(serializeProgress(attempted));
  assert.deepEqual(restored.journeySession, journey);
  assert.deepEqual(restored.sideSession, side);
});

test('live legacy journey wins over its stale activeSession snapshot', () => {
  const seed = {
    kind: 'diagnostic',
    ids: ['standard-001', 'standard-002', 'standard-003', 'standard-004'],
    index: 0,
    answers: {},
    startedAt: null,
  };
  const live = {
    ...seed,
    index: 3,
    answers: { 'standard-001': 1, 'standard-002': 1, 'standard-003': 1 },
  };
  const attempted = { ...makeInitialProgress(), session: live, activeSession: seed };
  delete attempted.journeySession;
  delete attempted.sideSession;
  const restored = restoreProgress(serializeProgress(attempted));
  assert.deepEqual(restored.journeySession, live);
});

test('Day1 question 4 survives Monster Book battle, persistence, and resume', () => {
  const ids = questions.slice(0, 15).map((question) => question.id);
  const answers = Object.fromEntries(ids.slice(0, 3).map((id, index) => [id, questions[index].answerIndex]));
  const journey = { kind: 'diagnostic', ids, index: 3, answers, startedAt: null };
  let progress = storeSession(makeInitialProgress(), journey);
  const before = structuredClone(progress.journeySession);

  const monster = questions[20];
  progress = storeSession(progress, {
    kind: 'monster',
    ids: [monster.id],
    index: 0,
    answers: {},
    startedAt: null,
  });
  progress = recordAnswer(progress, monster, true);
  progress = updateSession(progress, 'side', (session) => ({
    ...session,
    answers: { [monster.id]: monster.answerIndex },
  }));
  progress = clearSession(progress, 'side');

  const reopened = restoreProgress(serializeProgress(progress));
  assert.deepEqual(reopened.journeySession, before);
  assert.deepEqual(reopened.journeySession.ids, ids);
  assert.equal(reopened.journeySession.index, 3);
  assert.deepEqual(reopened.journeySession.answers, answers);
  assert.equal(reopened.journeySession.ids.length - reopened.journeySession.index, 12);
  assert.equal(reopened.journeySession.ids[reopened.journeySession.index], ids[3]);
  assert.equal(reopened.sideSession, null);
});

test('monster requires repeated correct answers to be defeated', () => {
  const question = questions[0];
  let progress = recordAnswer(makeInitialProgress(), question, false);
  progress = recordAnswer(progress, question, true);
  assert.equal(progress.stats[question.id].mastery, 'monster');
  progress = recordAnswer(progress, question, true);
  assert.equal(progress.stats[question.id].mastery, 'defeated');
});

test('CLEAR threshold is exactly 90', () => {
  assert.equal(bossScore(44), 88);
  assert.equal(bossScore(45), 90);
  assert.equal(isClear(89), false);
  assert.equal(isClear(90), true);
});
