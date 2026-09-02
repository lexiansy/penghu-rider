# DATA SOURCE REPORT

Status: **validated against the retained official-source snapshot; import complete.**

Checked on 2026-09-02 (Asia/Taipei). The downloaded question artifacts themselves are the operative source of truth for this build.

## Official sources

Only Taiwan Ministry of Transportation and Communications, Highway Bureau sources were used.

| Component | Official listing | Retained source | Imported count |
| --- | --- | --- | ---: |
| Standard Chinese multiple-choice bank | [機車題庫／Motorcycles](https://www.thb.gov.tw/News_Download.aspx?Create=1&PageSize=200&n=82&page=1&sms=12823), item NTM-00725 | `sources/standard-1150218.pdf`, 63 pages, IDs 1–806 | **806** |
| Motorcycle hazard-perception video bank | Same official listing, item NTM-00714 | `sources/hazard-1130816.pdf`, 14 pages, IDs 001–126 | **126** |
| Motorcycle scenario/image bank | Same official listing, item NTM-00366 | `sources/scenario-all.pdf`, 120 pages; two 60-item sections | **120** |
| January 2026 new-system rules | [115年1月實施駕照管理4項改革措施](https://www.thb.gov.tw/News_Content_table.aspx?n=12181&s=288181) and official Q&A | Effective 2026-01-30 | Announcement states 1,050 total; 50 questions, 30 minutes, pass at 85; 10 hazard + 5 scenario |

Retained PDFs and SHA-256 hashes:

- `standard-1150218.pdf`: `5cc26f7adbbfd85a26a7ce1fa06cd12abe321bc8bd33629d12ce0c055f999422`
- `hazard-1130816.pdf`: `da9bd132ed69ae82d5207f6880fae6f0732424434fa696be7d3678ba2e259e3d`
- `scenario-all.pdf`: `bed39ec9b0755b24ffeb242100873edc82d99f1330af4d631edddfa889ff8907`

## Snapshot count and documentation drift

| Standard | Hazard video | Scenario/image | Current artifact total |
| ---: | ---: | ---: | ---: |
| **806** | **126** | **120** | **1,052** |

Important: this report does **not** claim that the Highway Bureau officially announced a change to 1,052. The January 2026 announcement states 1,050, while the currently downloadable artifacts retained for this snapshot contain 1,052 questions. The current Chinese standard bank runs through questions 805 and 806; manual comparison also found the corresponding 805 and 806 in the current official English standard bank. Some official labels still say “804 questions” although the body contains 806.

Questions 805 and 806 are complete official-format OECD speed-risk questions with valid answers. No question was deleted, excluded, renumbered, or modified merely to force the artifact total to match the older announced total. This is recorded as official metadata/documentation drift.

The scenario PDF reuses local numbers 1–60 in two sections. The importer preserves the source-local number and assigns stable namespaced IDs (`scenario-a-001` through `scenario-b-060`).

## Import and validation

`scripts/import_official_questions.py` preserves official text and answers, extracts the 126 official hazard-video links, and produces:

- `site/public/data/questions.json`: 1,052 normalized questions.
- `site/public/assets/questions/`: 148 standard-question images and 120 scenario images, encoded as local WebP assets.
- `site/public/precache-assets.json`: the generated local asset inventory used by the service worker.

`scripts/validate_official_sources.py` now validates this exact retained snapshot: standard 806, hazard 126, scenario 120, total 1,052. It also checks file hashes, page counts, contiguous IDs, duplicates, valid answer values, and all three option markers. A parsed count that differs from the retained artifacts is a failure; 1,052 is not itself an error.

Reproduce with the bundled Python runtime (or substitute a Python 3 environment with `requirements-import.txt` installed):

```powershell
$python = 'C:\Users\Gail\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $python scripts/validate_official_sources.py
& $python scripts/import_official_questions.py
```

## Exclusions and human review

No published question was excluded. Remaining human-verification work is limited to future source maintenance: recheck wording, links, hashes, and counts whenever the Highway Bureau republishes any source artifact or clarifies the 1,050/1,052 metadata discrepancy.
