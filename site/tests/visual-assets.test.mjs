import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const art = [
  'adventure-map.webp',
  'player-scooter-hono.webp',
  'day1-lookout.webp',
  'day2-lair.webp',
  'boss-roadkeeper.webp',
  'clear-coast.webp',
  'app-icon-192.png',
  'app-icon-512.png',
  'monster-following-distance.webp',
  'monster-intersection.webp',
  'monster-vehicle-check.webp',
  'monster-distracted-driving.webp',
  'monster-accident-response.webp',
  'monster-large-vehicle.webp',
  'monster-bad-weather.webp',
  'monster-hazard-perception.webp',
];

test('complete Phase 2 art set is present and mobile-sized', () => {
  const sizes = art.map((name) => statSync(resolve('public/art', name)).size);
  assert.ok(sizes.every((size) => size > 1_000));
  assert.ok(sizes.reduce((total, size) => total + size, 0) < 1_250_000);
});

test('every decorative asset is explicitly available offline', () => {
  const worker = readFileSync(resolve('public/sw.js'), 'utf8');
  for (const name of art) assert.match(worker, new RegExp(`/art/${name.replaceAll('.', '\\.')}`));
});

test('manifest uses the matching generated PWA icons', () => {
  const manifest = JSON.parse(readFileSync(resolve('public/manifest.webmanifest'), 'utf8'));
  assert.deepEqual(manifest.icons.map((icon) => icon.src), [
    '/art/app-icon-192.png',
    '/art/app-icon-512.png',
  ]);
  assert.match(manifest.icons[1].purpose, /maskable/);
});
