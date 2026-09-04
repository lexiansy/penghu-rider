# Question image assets + journey/side session root-cause repair

Date: 2026-09-04  
Status: local implementation and deterministic verification complete; not committed, pushed, or deployed

## 1. Working-tree audit before this repair

The repository `.git` directory is readable only by the host account and is inaccessible to the current sandbox identity, so ordinary `git status` / `git diff` cannot traverse it. I reconstructed the comparison base from deployed `main` commit `e1c12bde51c819a1655ea70be42402568096e514` and compared each file with `git diff --no-index`.

The uncommitted attempt present at the start of this task changed exactly these product files:

- `site/components/game-app.tsx`
  - added `activeSession` alongside the existing shared `session`;
  - saved only the initial journey session into `activeSession`;
  - copied `activeSession` back into `session` when continuing;
  - changed question artwork from Next `<Image width={1200} height={900}>` to a native `<img>`.
- `site/lib/game.mjs`
  - added `activeSession: null`;
  - migrated an old journey-like `session` into `activeSession`.
- `site/public/styles.css`
  - removed the image `max-height: 46svh` constraint;
  - made the question image use its decoded natural width/height;
  - removed the clipping boundary around the image wrapper.
- `site/tests/game.test.mjs`
  - added only a shallow `activeSession` migration assertion.

The supplied `agent_reply_20.md` was not used. It described the older SW v9 deployment and did not describe this repair.

## 2. Bug A — question image root cause

### Reproduced official records

| Prompt | Normalized ID | `media.src` | Source |
|---|---|---|---|
| 依據圖示，機車駕駛人的行駛方式何者容易發生危險？ | `scenario-a-021` | `/assets/questions/scenario/scenario-a-021.webp` | `scenario-all.pdf`, page 21 |
| 依據圖示，機車駕駛人A，發現違規車輛，應如何安全行駛？ | `scenario-b-027` | `/assets/questions/scenario/scenario-b-027.webp` | `scenario-all.pdf`, page 87 |

### Direct PDF-object versus WebP measurements

| ID | PDF object box (points: x0, top, x1, bottom) | PDF crop / WebP pixels | Actual non-background content box in WebP | Mean absolute RGB error | Max edge error |
|---|---:|---:|---:|---:|---:|
| `scenario-a-021` | `76.40, 77.40, 518.90, 407.10` | `1168 × 870` / `1168 × 870` | `0, 0, 1168, 870` | `1.303` | `2.457` |
| `scenario-b-027` | `119.04, 74.64, 600.96, 437.40` | `1271 × 957` / `1271 × 957` | `0, 0, 1271, 957` | `0.974` | `0.838` |

The full-art bounding box reaches every edge in both generated files. The independent PDF raster and WebP dimensions match exactly. The small pixel error is the expected WebP quality-84 compression difference. The partial rider at the lower-right edge of page 21 and the roadway edges on page 87 are already clipped at the official embedded-image boundary; no importer crop removed them.

A representative standard embedded image was also tested:

| ID | Source | PDF crop / WebP pixels | Content box | Mean error | Max edge error |
|---|---|---:|---:|---:|---:|
| `standard-009` | `standard-1150218.pdf`, page 2 | `138 × 138` / `138 × 138` | `19, 0, 121, 138` | `2.167` | `2.237` |

### Proven branch and fix

The generated assets are correct, so `scripts/import_official_questions.py`, normalized IDs, question text, data, and all official image files are unchanged.

The renderer was the faulty layer. It declared every official image as `1200 × 900`, even when the decoded asset was square or had another source aspect ratio, and combined that declared 4:3 geometry with a viewport-height cap. `object-fit: contain` cannot make incorrect element geometry represent the source image's real ratio; it can only fit pixels inside that geometry.

The repaired renderer:

- uses a native `<img>` with no fabricated width/height attributes;
- lets the decoded file provide its real aspect ratio;
- uses `width: 100%; height: auto; max-height: none` inside the existing internally scrollable question card;
- does not crop or regenerate any official artwork.

### Diagnostic comparisons

- [Page 21 — full official source page](screenshots/root-cause-repair/source-page-021.png)
- [scenario-a-021 — PDF crop versus generated WebP](screenshots/root-cause-repair/scenario-a-021-pdf-vs-webp.png)
- [Page 87 — full official source page](screenshots/root-cause-repair/source-page-087.png)
- [scenario-b-027 — PDF crop versus generated WebP](screenshots/root-cause-repair/scenario-b-027-pdf-vs-webp.png)
- [standard-009 — PDF crop versus generated WebP](screenshots/root-cause-repair/standard-009-pdf-vs-webp.png)

The generated WebPs are also exported directly beside the source crops in `screenshots/root-cause-repair/`.

An actual local-browser screenshot could not be captured in this run because browser control denied access to `http://localhost:4192/`. Per the browser security policy, no CDP/alternate-browser workaround was attempted. The production build and all non-browser checks completed; visual browser capture remains the only blocked deliverable and must be performed after local-browser access is allowed.

## 3. Bug B — exact session-state root cause

The application originally had one persistent `progress.session`. Starting `monster` or `review` replaced it, permanently discarding the current Day journey.

The previous attempted `activeSession` patch still did not work because it saved only the session's initial snapshot. All answers and index advances continued to update only `progress.session`. Continuing the journey then copied the stale initial `activeSession` back over the live state.

The pre-fix regression reproduction failed exactly as follows:

```json
{
  "beforeSideRun": {
    "kind": "diagnostic",
    "index": 3,
    "answers": { "q-1": 0, "q-2": 1, "q-3": 2 },
    "next": "q-4",
    "remaining": 12
  },
  "staleActiveSession": {
    "kind": "diagnostic",
    "index": 0,
    "answers": {}
  },
  "resumed": {
    "kind": "diagnostic",
    "index": 0,
    "answers": {}
  },
  "assertion": "EXPECTED FAIL: resumed index=0, expected=3"
}
```

## 4. Repaired session ownership and migration

Persistent state now has two explicit owners:

```json
{
  "journeySession": {
    "kind": "diagnostic",
    "index": 3,
    "answers": { "q-1": 0, "q-2": 1, "q-3": 2 },
    "next": "q-4",
    "remaining": 12
  },
  "sideSession": null
}
```

- Journey owner: `diagnostic`, `targeted`, `boss`, and Boss recovery `revenge`.
- Side owner: `monster` and `review`.
- Starting, answering, advancing, finishing, or exiting a side run only changes `sideSession` and global question/category stats.
- The Home mission card, remaining count, Continue CTA, and WebMCP “current” action read only `journeySession`.
- Leaving a journey screen preserves `journeySession`; leaving a side screen clears only `sideSession`.
- Completing Day 1/2 or Boss clears only the journey owner involved in that completion.

The localStorage key and version remain `penghu-rider-progress-v1` / version 1. `restoreProgress()` migrates without clearing storage:

1. current two-owner payloads are restored directly;
2. legacy shared journey `session` becomes `journeySession`;
3. legacy shared `monster`/`review` becomes `sideSession`;
4. the attempted `activeSession` schema preserves `activeSession` as the journey if the shared session is a side run;
5. if the attempted schema contains a live journey in `session` plus a stale snapshot in `activeSession`, the live journey wins;
6. legacy keys are removed from the normalized value before it is serialized again.

## 5. Regression coverage

### JavaScript suite

`site/tests/game.test.mjs` now covers:

- exact serialize/restore of both owners;
- migration of original shared-session payloads;
- migration of the attempted `activeSession` payload while preserving a simultaneous side session;
- precedence of the live legacy journey over its stale `activeSession` start snapshot;
- `Day1 question 4 -> Monster Book -> answer/complete -> serialize -> restore -> same Day1 question 4`;
- identical journey ID list, index, answers, remaining count, and next question;
- global Monster Book stats updating without journey mutation.

Result: **14 passed, 0 failed**.

### Image integrity suite

New deterministic test: `scripts/test_question_image_integrity.py`

It independently reopens the official PDFs, resolves the exact PDF image object, rerenders it, compares decoded dimensions and pixels, and checks all four source edges. It does not rely on CSS selector existence.

Result: **3 image cases passed** (`standard-009`, `scenario-a-021`, `scenario-b-027`).

## 6. Exact local product diff

Comparison base: `e1c12bde51c819a1655ea70be42402568096e514`.

| File | Exact local change | Diff stat versus base |
|---|---|---:|
| `site/components/game-app.tsx` | native-ratio official image renderer; replace shared/stale session handling with scoped journey/side reads, writes, completion, exit, resume, Home CTA | `+72 / -42` |
| `site/lib/game.mjs` | replace `session` / `activeSession` runtime model with `journeySession` / `sideSession`; add kind classification, store/update/clear helpers, backward migration | `+48 / -3` |
| `site/public/styles.css` | preserve intrinsic official image ratio and remove viewport cap/clipping | `+7 / -4` |
| `site/tests/game.test.mjs` | migration and full Day1/Monster Book isolation regressions | `+94 / -3` |
| `scripts/test_question_image_integrity.py` | new PDF-object/WebP pixel and edge integrity test plus diagnostic exporter | new, 168 lines |
| `ROOT_CAUSE_REPAIR_REPORT.md` | this new report | new |

There are no changes to the importer, official question JSON, official question images, gameplay composition, visual map assets, Service Worker, metadata, dependencies, or deployment configuration.

## 7. Verification results

| Check | Result |
|---|---|
| `node --test tests/*.test.mjs` | PASS — 14/14 |
| `oxlint app components/game-app.tsx lib tests public/sw.js` | PASS |
| `tsc --noEmit` | PASS |
| `scripts/test_question_image_integrity.py` | PASS — 3/3 |
| `vinext build` | PASS — all five build stages and two static routes; expected Windows libuv shutdown assertion printed after successful output |
| Commit / push / deployment | Not performed |
