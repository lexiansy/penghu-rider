# QA REPORT

Status: **implementation complete; static output generated and mobile flow verified. No deployment performed.**

Checked on 2026-09-02 (Asia/Taipei).

## Automated results

| Check | Result |
| --- | --- |
| Official-source snapshot validator | PASS — 806 standard + 126 hazard + 120 scenario = 1,052 |
| Normalized dataset/schema | PASS |
| Duplicate normalized IDs | PASS — none within any source |
| Boss Rush composition | PASS — exactly 50: 35 standard + 10 hazard + 5 scenario |
| Weak/missed-question weighting | PASS |
| `localStorage` exact session resume | PASS |
| Monster defeat rule | PASS — prior miss plus two consecutive correct answers |
| CLEAR threshold | PASS — exactly 90 points |
| TypeScript (`npx tsc --noEmit`) | PASS |
| Lint (`npm run lint`) | PASS |
| Deterministic tests (`npm test`) | PASS — 10/10 |

The data importer also verified 1,052 records, valid answer indices, complete option sets, and generated all 268 local image assets.

## Build result

`npm run build` completed every Vinext/Vite build and prerender stage and generated `site/dist/client/index.html`, the stylesheet and hashed JavaScript chunks, the question dataset, all local images, manifest, and service worker. On this Windows host the Vinext process then exits with code 1 during shutdown because of a Node/libuv assertion (`UV_HANDLE_CLOSING`), after printing `Build complete`. The generated static output was independently served with Vite preview and returned HTTP 200 with `/styles.css` loaded as `text/css`.

This cleanup assertion is the only build-tool issue observed; it does not indicate a missing output artifact. It should be rechecked against a newer Vinext/Node release before CI treats this build command as clean.

## Browser and mobile QA

Verified at a 390×844 mobile viewport against the generated static output:

- Home screen, three-day journey, large tap targets, and no horizontal overflow.
- Day 1 starts a 15-question diagnostic and displays official question wording.
- Selecting an answer locks the choices, identifies the correct answer, updates the Monster Book, and enables Next.
- Hazard questions expose the retained official video URL; offline handling clearly says the video requires a network connection.
- WebMCP `start_study_session` accepts `current`/`review`, starts the shared UI flow, and rejects invalid input without changing the active session.
- Progress survives reload through `localStorage`; a resumable session is shown on the home screen.
- Manifest, app icon, theme metadata, and service-worker registration are present. The service worker precaches the app shell, question text, and 268 local images; external hazard videos are intentionally network-only.

## Phase 2 visual-game pass

- Replaced the vertical day dashboard with a three-island Penghu adventure map. The HTML status overlays identify the current, completed, and locked stages, while the scooter/Hono token follows `activeDay`.
- Added one locked flat hand-drawn illustration system: map, scooter token, Day 1 lookout, Day 2 lair, traffic-rule Boss, eight source-category bestiary icons, CLEAR coast, and matching PWA icon.
- Public decorative assets total about 1.11 MiB. They are explicitly included in service-worker cache `penghu-rider-v3`; a deterministic test verifies every file is present in the offline list.
- Gameplay keeps official material visually dominant. The added UI is limited to the route HUD, encounter count, combo chip, and categorical Monster Book feedback.
- Monster Book now derives four presentation states from the existing stats—discovered, active threat, weakened, defeated—without changing the stored mastery model.
- Boss intro uses the existing 50-question launch and states the unchanged 10 hazard + 5 scenario + 35 standard composition. Boss question cards remain uncluttered.
- CLEAR uses the required `筆試篇 CLEAR` and `澎湖地圖解鎖準備中` copy with the completed coastal journey illustration.

Responsive browser measurements passed at widths 320, 375, 390, and 430 px: document `scrollWidth` equalled viewport width and all three map labels remained inside the viewport. At 390×844, question choices measured 70–93 px high with 16 px type. Six requested visual states were inspected: home map, Day 1 question, wrong-answer capture, Monster Book, Boss intro, and CLEAR.

The six review captures are saved in `screenshots/`; the complete generated art contact sheet is `visual-assets/visual-asset-set.webp`.

Automated coverage is now 10/10 tests: the original seven logic/data tests plus art-size, offline-art inventory, and manifest-icon checks.

## Mobile home layout refinement

The Phase 2 home screen received a presentation-only mobile-density patch. At 390×844 the map is 380 px tall and the primary mission CTA ends at 719 px, so the title, complete route, mission summary, encounter count, and CTA are all visible in the first viewport. Locked Day 2 and Day 3 markers are compact 94×34 px badges with 28 px of clearance from the map's right edge.

At 375×844 the mission CTA ends at 697 px, the mission title stays on one line, the locked badges remain inside the map, and document width remains within the viewport. Monster Book and Free Review are now equal-height card actions with 52–70 px tap targets. The question flow, progress schema, source data, service worker, and exam composition were not changed.

Review captures are saved in `screenshots/mobile-layout/`: above-the-fold home, complete scrolling home, mission card section, and the lower Monster Book/Review action area.

## Known limitations / human verification

- Hazard videos are official remote media and cannot work offline; availability depends on the Highway Bureau host.
- The PWA uses the matching generated scooter/wave/fox-tail icon at 192 px and 512 px. Platform-specific install presentation should receive a final human check on iOS Safari and Android Chrome.
- A real-device pass should confirm safe-area spacing, add-to-home-screen prompts, video playback, and the full 30-minute Boss timer behavior.
- The January announcement says 1,050 while retained source artifacts total 1,052; see `DATA_SOURCE_REPORT.md`. This is documented as metadata drift, not as an announced official change.
- Dependency installation reported 11 transitive audit findings (1 low, 2 moderate, 8 high); no forced dependency rewrite was applied.
- No Cloudflare or other deployment was attempted.
