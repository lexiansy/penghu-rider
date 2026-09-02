import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  bossScore,
  isClear,
  makeBossExam,
  makeInitialProgress,
  questionWeight,
  recordAnswer,
  restoreProgress,
  serializeProgress,
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
  progress.session = { kind: 'targeted', ids: ['standard-001'], index: 0, answers: {} };
  assert.deepEqual(restoreProgress(serializeProgress(progress)), progress);
  assert.deepEqual(restoreProgress('{bad json'), makeInitialProgress());
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

