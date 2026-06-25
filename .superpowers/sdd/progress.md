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
Task 7: IN PROGRESS (multi-unit project UI in index.html + src/app.js).
