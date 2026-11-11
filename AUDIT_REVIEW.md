# Project audit — 2026-11-10

> Historical audit findings. The [remediation status](docs/REMEDIATION_STATUS.md) supersedes the remaining-work list and validation results below. The original findings are retained for traceability.

This audit covers the tracked application, native backend, plugins, build and release scripts, tests, and documentation. It combines source review, import/reference searches, dependency auditing, and execution of the available checks. Generated output, installed dependencies, and local application data were excluded from source cleanup. This is a working-tree review, not a guarantee that every runtime path or platform has been exercised.

## Fixed in this change

- **Read-only web access:** Wiki attachment uploads now reject writes in read-only mode and validate the server's workspace authorization. Regression coverage exercises POST and PUT through both upload routes.
- **Native optical exports:** Files stage beside their destination, so publication works across drives. Temporary files are cleaned up on abort, failure, and deactivation; publication refuses to overwrite an existing destination. Writes no longer remove and reinsert sessions across cancellation.
- **Vault authentication:** Successful creation and unlocking reset the sleep-detection clocks. Slow password derivation could otherwise cause the next timer check to immediately lock the vault again. Added a regression that also verifies actual later pauses still invalidate the session.
- **AI selections:** Disabled or removed Skills and MCP configurations are cleared from the selected run scope after settings refresh and conversation restoration, without deleting their saved configuration.
- **Calendar dates:** Postponing a task uses local calendar dates, avoiding UTC parsing errors west of UTC. Browser regressions cover date-only values, daylight-saving time, and year rollover.
- **Floating controls:** Date picker, task filters, context menus, and calendar popovers follow the portal positioning rules: synchronous placement, guarded rendering, no coordinate transitions, and appropriate transform origins. Closed menus clear their coordinates; date-picker clearing restores focus.
- **Offline receiver:** Cache versions include resource contents and service-worker source, so updates to fixed-name files invalidate stale caches. Added cache-invalidation tests.
- **Spreadsheet preview:** The existing 1,000-row display limit now bounds conversion itself instead of allocating the entire worksheet and then slicing it.
- **Unit-test discovery:** `npm test` discovers the test files in `src`, `plugins`, and `scripts`, including suites omitted by the previous hard-coded command. The default run increased from 171 to 258 passing tests.
- **Screenshot isolation:** Routine browser tests no longer regenerate tracked documentation screenshots. Use `npm run screenshots:generate` explicitly. The optical browser config also accepts `PLAYWRIGHT_EXECUTABLE_PATH`.
- **Unused code:** Removed unreferenced `LANNodesRightPanel`, `LocalDirectoryModal`, `workitem/IssueBlock`, `workitem/IssueCard`, their unused barrel, two unused Rust report helpers, and unused/redundant dependency declarations (`motion`, `@types/dompurify`, production Vite).
- **Dependency patches:** Applied compatible npm security updates without forced major changes. Audit findings fell from 11 (including 2 critical) to 3 high; the remaining packages are listed below.
- **Documentation:** Repaired links to missing documents; corrected the MCP tool count to 25; aligned release instructions with the actual Windows/Linux matrix and optional Apple credential checks.

## Decisions and remaining work

### R1 — High: replace or update the spreadsheet library

[`ExcelPreview.tsx`](lanmind/src/components/preview/ExcelPreview.tsx) imports npm `xlsx@0.18.5`. The audit reports [prototype pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) and [regular-expression denial of service](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9). npm reports no patched version in its registry distribution.

**Review:** Choose a supported SheetJS distribution or a replacement library, then verify imported spreadsheets, dates, formulas, CSV, and export compatibility. This requires a dependency and distribution decision, so it was not replaced automatically.

### R2 — High: review the PowerPoint dependency chain

`pptxgenjs@4.0.1` depends on vulnerable `image-size` parsers. The audit reports infinite loops for [JXL/HEIF](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) and [ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr). These account for the other two high findings, including the parent package.

**Review:** Select a compatible patched dependency chain and exercise presentations containing images. npm's proposed forced fix downgrades `pptxgenjs` to 4.0.0; that change was not applied without compatibility evidence.

### R3 — High: confirm the intended public Wiki sharing scope

[`web_server.rs`](lanmind/src-tauri/src/web_server.rs) exposes `/api/public/wiki` and `/api/public/wiki/{doc_id}` without a browser session. They return Wiki content available to the desktop user's authorized workspace, including a list of pages. AI sharing instead uses a selected snapshot and share ID. An existing backend test explicitly expects Wiki reads without a session cookie.

**Review:** Decide whether enabling the web server should publish the accessible Wiki library, or whether each page/subtree should require an explicit share with an opaque token and revocation. Changing this silently would alter an established sharing contract.

### R4 — High: scope Wiki attachments to pages and workspaces

The Wiki asset handler in [`web_server.rs`](lanmind/src-tauri/src/web_server.rs), native `save_wiki_asset` in [`lib.rs`](lanmind/src-tauri/src/lib.rs), and [`wikiAssetStore.ts`](lanmind/src/components/wiki/wikiAssetStore.ts) use a shared asset namespace. Backend files live in a sibling `wiki_assets` directory; browser IndexedDB records use only the asset path as their key. `/assets/...` can serve Wiki attachments without a session or an owning page's authorization check. Uploads can replace a known asset name.

**Review:** Define attachment ownership, public-share access, replacement permissions, and legacy-file migration together. Merely moving the directory would break existing Markdown references. The read-only upload bypass has been fixed, but this broader authorization and migration work remains.

### R5 — Medium: add a Wiki asset lifecycle

[`wikiAssetStore.ts`](lanmind/src/components/wiki/wikiAssetStore.ts) retains Blob URLs in a process-wide map with no `URL.revokeObjectURL` path. It also retains stored assets independently of page deletion. Repeated rendering and sharing can keep binary data alive for the session and leave orphaned files.

**Review:** Choose a page/workspace lifecycle for URL release, and a reference-aware cleanup policy that preserves assets used by history snapshots, exports, and shared pages. Cache eviction must also account for Markdown URL canonicalization, which currently depends on the map.

### R6 — Medium: strengthen TypeScript checks

[`tsconfig.json`](lanmind/tsconfig.json) disables strict checking by omission, excludes `server.ts` and `src/db`, and uses `skipLibCheck`. `@types/react` and `@types/react-dom` are absent. Consequently the passing `npm run lint` command (`tsc --noEmit`) provides less React/JSX validation than its name suggests.

**Review:** Add the React typings and establish staged strict checks, including the retained server/storage code if it remains supported. This is likely to reveal a substantial backlog; simply enabling strict mode would leave the project uncompilable without completing that work.

### R7 — Medium: reconcile browser tests with the current UI

The broad run completed with 378 passing tests and 52 failures across 18 files. Some tests still expect the former calendar day-details panel, former calendar CSS classes, duplicate global navigation labels, or removed sidebar-collapse controls. Others fail during behavior checks or browser teardown. Examples are [`calendar-filters.spec.ts`](lanmind/tests/theme/calendar-filters.spec.ts) and [`ui-refinements.spec.ts`](lanmind/tests/theme/ui-refinements.spec.ts).

The AI selection failure was fixed and its regression passes. Four original failures pass in a focused single-worker follow-up. The notification case still fails while waiting for its sender fixture to finish startup, before reaching the snooze/theme assertion. The remaining 47 original cases need review or individual reproduction; they include obsolete tests and unresolved behavior checks.

**Review:** Confirm the intended calendar/navigation interactions, then update assertions to verify those behaviors. Reproduce the other cases individually before changing product behavior. The [complete failure inventory](docs/AUDIT_BROWSER_FAILURES.md) lists every failing case, its source line, the observed failure, and follow-up status.

### R8 — Medium: measure and reduce frontend loading cost

The production build reports several large minified chunks: approximately 3.06 MB for PlantUML, 2.01 MB for a chunk named `calendarLayout`, 1.35 MB for `viz`, and 1.38 MB for the standalone receiver entry. Diagram engines already use lazy loading in places, so chunk names alone do not establish the startup cost.

**Review:** Measure initial requests, route transitions, receiver startup, and low-memory behavior. Then split shared dependencies, defer unused engines/locales, and introduce bundle budgets based on those measurements. Avoid increasing the warning threshold to hide the problem.

### R9 — Medium: profile polling and large document parsing

[`App.tsx`](lanmind/src/App.tsx) polls network presence every three seconds and refreshes business data every five seconds in addition to event listeners. [`AgentWorkspace.tsx`](lanmind/src/components/ai/AgentWorkspace.tsx) also polls on a five-second interval. [`ExcelPreview.tsx`](lanmind/src/components/preview/ExcelPreview.tsx) still parses the entire workbook synchronously and can render arbitrarily many columns, even though row conversion is now bounded.

**Review:** Measure idle CPU, overlapping requests, large-workspace traffic, and large spreadsheet responsiveness. Consider request coalescing, visibility-aware backoff, worker parsing, and a documented column/size limit once acceptable behavior is agreed.

### R10 — Low: decide the compatibility floor for legacy code

[`server.ts`](lanmind/server.ts) and [`sqlite-store.ts`](lanmind/src/db/sqlite-store.ts) retain the Express/JSON prototype alongside the native backend; the architecture document explicitly acknowledges it. [`AIWorkspace.tsx`](lanmind/src/components/ai/AIWorkspace.tsx) exports the current `AgentWorkspace` but still contains the old renderer and related storage code. Some old storage logic supports migrations and tests.

**Review:** Decide whether the prototype remains a supported runtime and which upgrades/data formats must remain compatible. Retire legacy rendering separately from migration readers, then remove dependencies that become unused. These were retained because their support status is unclear.

### R11 — Medium: add continuous quality gates and complete native acceptance

The repository has a release workflow but no ordinary pull-request workflow running the complete lint/unit/browser checks. Release preparation runs the Python release-script tests; it does not substitute for application tests. macOS release builds are currently disabled.

**Review:** Add agreed quality gates and npm/Rust dependency advisory scans after resolving the browser backlog. Exercise the six opt-in native tests, current desktop binary/worker integration, real AI providers, two-device LAN workflows, and platform installers. Browser fixtures mock APIs and cannot validate those boundaries. Restore macOS publishing only when signing, notarization, and platform acceptance requirements are defined.

## Validation

| Check | Result |
| --- | --- |
| `npm test` | 258 passed, 0 failed |
| `cargo test --locked --lib -- --test-threads=4` | 260 passed, 0 failed, 6 ignored |
| `npm run lint` | Passed after the final frontend edits |
| `npm run build` | Passed; both main app and standalone receiver built; 9,080 translations verified |
| Python macOS release-script tests | 10 passed |
| Full theme/browser suite, four workers | 378 passed, 52 failed; see the [failure inventory](docs/AUDIT_BROWSER_FAILURES.md) |
| New calendar/date-picker browser regressions | All 4 passed in the full run |
| Disabled Skill/MCP regression after the fix | 1 passed |
| Focused behavior/startup follow-up, one worker | 8 passed, 1 failed during notification sender fixture startup |
| Standalone optical receiver browser check | 1 passed, including shell, manifest, and service worker |
| Spreadsheet conversion comparison | Empty, ordinary, and offset worksheets preserve the previous displayed results |
| Local Markdown targets and Git whitespace checks | Passed |

The full browser suite has not been rerun after fixing the AI selection failure. Its 52 failures include that resolved defect and the four cases that did not reproduce with one worker. No test assertions were removed to obtain passing results.

The six ignored Rust checks cover the native worker binary, three interactive Windows desktop-calendar cases, system image clipboard, and screen capture. Real LAN peers, external AI providers, platform installers, and macOS/Linux native behavior were not exercised. npm advisory results do not cover Rust crates; `cargo-audit` is not installed in this environment.

The dependency audit used `https://registry.npmjs.org` because the configured mirror's audit endpoint returned HTTP 404. Browser runs use installed Google Chrome through `PLAYWRIGHT_EXECUTABLE_PATH`; Playwright's Chromium download repeatedly failed in this environment.
