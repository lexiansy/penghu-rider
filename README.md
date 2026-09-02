# 澎湖騎士｜3-Day License Rush

Mobile-first Traditional Chinese PWA for a three-day Taiwan motorcycle written-test sprint. It uses the retained Highway Bureau source snapshot: **806 standard + 126 hazard video + 120 scenario/image = 1,052 questions**.

The Phase 2 interface presents the three-day flow as a small Penghu scooter adventure. Its complete generated art set and direction notes are in `visual-assets/`; optimized PWA assets live in `site/public/art/` and are prepared reproducibly by `scripts/process_game_art.py`.

The 1,050 figure in the January 2026 announcement differs from the currently published artifacts. Questions 805 and 806 are retained unchanged; see `DATA_SOURCE_REPORT.md` for the evidence and wording of that discrepancy.

## Run locally

```powershell
cd site
npm install
npm run dev
```

Open `http://localhost:3000`. If port 3000 is already in use, use the URL printed by Vinext.

To inspect the generated static output instead:

```powershell
cd site
npm run preview
```

Open the URL printed by Vite (normally `http://127.0.0.1:4173`).

## Validate and rebuild the official dataset

Use Python 3 with the packages from `requirements-import.txt`. In Codex's bundled workspace runtime:

```powershell
$python = 'C:\Users\Gail\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $python scripts/validate_official_sources.py
& $python scripts/import_official_questions.py
```

## Test and build

```powershell
cd site
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Static output is written to `site/dist/client`. On this Windows environment, Vinext currently emits complete static output and then hits a Node/libuv shutdown assertion; details and independent static-output verification are recorded in `QA_REPORT.md`.

No deployment configuration has been executed. `.openai/hosting.json` points to `dist/client` for a later, explicitly authorized deployment.
