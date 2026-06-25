# Progress Ledger — sections, units, About page, red theme

Plan: docs/superpowers/plans/2026-06-24-sections-units-about-theme.md
Branch: feature/sections-units-about-theme

## Tasks
Task 1: complete (commits 3fa0745..0d50f2a, review clean)
  Minor: test for "prefix present but unlisted in Sections sheet" branch not explicit; SECTION_COLS naming nit.
Task 2: complete (commits 0d50f2a..5d209a3, review clean)
  Reviewer "Important" (meaning undefined) = FALSE POSITIVE: cell() returns '' for blank cells. No fix.
  Minor: no test for blank-meaning row / header-only Glossary.
Task 3: complete (commit fd949fe, integration-verified: workbook builds in buildModel, 9 items, sections A/B/C, 7 glossary terms, conditions parse)
Task 4: complete (commits 5d209a3..ddd1315, store correct per spec)
  CROSS-TASK INVARIANT: app.js + exporter.js still read flat project.inputs/checks (broken at runtime NOW by design).
    MUST be fully migrated to project.units[*] by end of Task 7. Verify at final review: no flat project.inputs/checks/comments access remains.
  Reviewer "Critical" = expected transitional state (consumers updated in Tasks 5-7). Important findings match planned design.
  Minor: DRY migrateProject/normalizeUnit; empty-units import guard untested.
Task 5: complete (commit ddd1315..8181059, review clean, Approved)
  Minor: test local var still named 'project'; no explicit zero-units progress test.
Task 6: complete (commit 8181059..16d49b0; npm test 36/36; node --check clean; review APPROVED)
  Review verdict: all 4 functions (optionalSheetToRows, loadModelFromWorkbook, persistModel, restoreModel) match plan verbatim; round-trip field-consistent; no xlsx re-import; cross-task invariant respected.
Task 7: complete (commit 58eb497; unit selector + per-unit render; node --check clean, 36/36).
Task 8: complete (commit 1c9af98; section filter + grouped headings).
Task 9: complete (commit 96f8fdb; About page with sections/glossary tables).
Task 10: complete (commit 03d225b; one worksheet per unit; CROSS-TASK INVARIANT RESOLVED — no flat project.inputs/checks/comments access remains in app.js, verified by grep).
Task 11: complete (commit f9e8306; red accent, green completion signals, new control styles).
Task 12: complete (README updated for optional sheets + units/About/Section; npm test 36/36, node --check clean).

ALL 12 TASKS COMPLETE.

Manual browser smoke test: AUTOMATED via CDP driver (Edge headless, zero deps) — 12/12 checks pass
(load, sections/glossary persist, units add/independence/PERSISTENCE, section filter+headings, About,
dashboard aggregate, multi-sheet export validated with openpyxl: cols Item ID/Description/Code/Comments/Example,
no Note, one sheet per unit; reload persistence).

REGRESSION FOUND & FIXED during smoke test (commit pending): Task 7 handlers called getCurrentProject()
twice (getCurrentUnit mutated one fresh copy, saveCurrent saved a different fresh copy), so ticks/comments/
input changes/renames were silently lost. getCurrentProject() returns a fresh object per call. Fixed by
reading the project once via new getCurrentProjectAndUnit()/unitOf(project) in updateInput, both renderItems
handlers, renderProject defaults, and rename-unit. Smoke check 6 caught it (was "0/12", now "1/8").
