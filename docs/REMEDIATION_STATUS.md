# Audit remediation status — 2026-11-10

This implements the prioritized remediation work from the [project audit](../AUDIT_REVIEW.md) and [browser failure inventory](AUDIT_BROWSER_FAILURES.md). Those documents retain the original findings; this document records the current state.

## Implemented

| Priority | Audit item | Result |
| --- | --- | --- |
| High | R1 — spreadsheet dependencies | SheetJS uses the patched 0.20.3 vendor distribution, pinned in the lockfile. Dates, cached formulas, CSV, empty/offset sheets and the 1,000-row conversion bound have regression coverage. |
| High | R2 — PowerPoint parser | Override `image-size` to 2.1.0; exercise a real PPTX with an embedded PNG and validate the archive relationships. |
| High | R3 — public Wiki scope | Explicit page/subtree links with persisted, opaque tokens and revocation. Existing links without tokens must be recreated. Newly created descendants are excluded from existing links; saved content updates remain live. |
| High | R4 — attachment authorization | Workspace-owned, immutable host files; authenticated private reads; selected-share reference checks on public reads. Legacy migration claims only unambiguous pre-existing references and keeps other files private. |
| Medium | R5 — asset lifecycle | User/workspace-scoped IndexedDB, Blob URL release on detachment, workspace invalidation and page exit. Public viewers bypass private caches. Durable file retention remains a review item below. |
| Medium | R6 — type checking | Install React typings and repair resulting errors. Add explicit strict and prototype checks under `lint:all`; strict coverage can expand incrementally. |
| Medium | R7 — browser regressions | Update calendar, project settings, mobile navigation and theme assertions to the current UI. Repair actual navigation, popup zoom, theme inheritance and chat conversation-reference defects. |
| Medium | R8 — loading cost | Defer PDF/PPT and optical modules; measure static startup imports from Vite manifests and enforce three gzip budgets. Deferred engines and total memory remain outside this metric. |
| Medium | R9 — refresh/parsing cost | Pause hidden-window polling and coalesce overlapping refreshes. Parse workbooks in a Worker, return at most 1,000 rows and render visible columns. Discard outdated sheet replies. |
| Low | R10 — legacy code | Move the former AI renderer into browser fixtures; retain migration readers and separately type-check the Express/JSON prototype pending a support decision. |
| Medium | R11 — quality gates | Add PR/main-branch checks for frontend types, unit/browser/optical tests, build/budgets, npm advisories, Windows/Linux Rust tests and Rust advisories. Native acceptance remains below. |

The initial audit's fixes are also retained: read-only upload enforcement, safe optical publication/cancellation, vault unlock clocks, disabled AI selections, local calendar arithmetic, portal positioning, offline-cache invalidation, complete unit discovery, screenshot generation isolation and removal of confirmed unused components/dependencies.

Rust dependencies were additionally patched, including document extraction, ZIP/XML parsing, SQLite and network/TLS dependencies. Unused RSA signing/generation is disabled; encrypted and plain RSA imports, public keys, fingerprints and incorrect passphrases remain covered.

## Remaining review, in priority order

1. **Before release — native acceptance.** Run the six opt-in native checks with the current desktop binary and graphical session. Complete two-device LAN/workspace/revocation tests, real AI-provider/tool flows and clean Windows/Linux installer upgrades. Browser fixtures and local protocol tests do not establish these results. macOS release publishing remains disabled pending signing/notarization and platform acceptance.
2. **High — upstream Rust warnings.** `glib 0.18.5` reports RUSTSEC-2024-0429 (unsound `VariantStrIter` iteration) through the Linux GTK/Tauri chain. Maintenance warnings remain in GTK/text, YAML and zbus/zvariant dependencies. Review an upstream Tauri/GTK upgrade and YAML replacement separately; incompatible transitive overrides are not applied.
3. **Medium — durable attachment retention and migration reconciliation.** Choose retention periods and a reference index covering saved pages, drafts, history, exports and other webviews before deleting host files or stored blobs. Ambiguous/unreferenced legacy files remain private and preserved. Review how to recover files referenced only by old browser history. Blob URL release already limits live binary retention; it does not delete durable files.
4. **Medium — measured performance on real workloads.** Record idle CPU/traffic, hidden-window wake-up behavior, startup/route timing, receiver precache size and peak memory with representative large files/workspaces. The workbook is still parsed in full inside its Worker, and searching scans the selected bounded grid. Use those measurements to choose file limits, further virtualization or additional engine splitting.
5. **Medium — expand strict checking.** `tsconfig.strict.json` covers refresh, spreadsheet and workspace-boundary utilities. Expand it module by module; the entire application is not yet strict. The base React/JSX and prototype checks are enforced now.
6. **Low — prototype and upgrade support policy.** Decide whether `server.ts`/the JSON store is a supported runtime and which old data formats must migrate. Remove their remaining dependencies only after that decision and migration acceptance.

## Security gate behavior

`npm run audit:rust` requires `cargo-audit 0.23.0`. It resolves normal, build and dev dependencies for **all** target platforms using the selected features, then compares the full advisory report with that graph. Active vulnerabilities fail the check. Findings in disabled optional dependencies remain printed and become blocking if those dependencies are enabled; there is no advisory-ID allowlist.

`crypto-bigint 0.5.5` (RUSTSEC-2026-0387) and `rsa 0.9.10` (RUSTSEC-2023-0071) remain in Cargo.lock as optional dependencies of SSH key support but are absent from the selected build graph. Rust maintenance/unsound warnings are reported separately and remain open as described above.

## Verification

| Check | Local result |
| --- | --- |
| `npm test` | 267 passed, 0 failed |
| `npm run lint:all` | Base, staged strict and prototype checks passed |
| `cargo test --locked --lib -- --test-threads=4` | 265 passed, 0 failed, 6 ignored |
| `npm run build` | Main application and standalone receiver production builds passed |
| `npm run check:bundles` | All three startup JavaScript budgets passed; measurements below |
| `npm audit --registry=https://registry.npmjs.org` | 0 advisories |
| `npm run audit:rust` | 818 active packages, 0 active vulnerabilities, 2 findings in disabled optional dependencies; 15 maintenance warnings and 1 unsoundness warning remain |
| Full browser suite | 429 passed, 4 failed before the final fixes |
| Browser follow-ups after fixes | 23 passed across screenshot, discussion, spreadsheet Worker and asset suites; the remaining workspace-upload regression passed separately |
| Standalone optical receiver browser check | 1 passed |
| Python release-script tests | 10 passed |
| Documentation/configuration checks | Local Markdown targets, JSON configuration and workflow YAML passed |

All four failures from the full browser run passed in the focused follow-ups. The full suite was not rerun after those fixes. The six ignored Rust checks require the native worker binary, an interactive Windows calendar session (three checks), system image clipboard or screen capture.

Startup JavaScript measurements follow each entry's static imports in the Vite manifests and sum the gzip size of the unique JavaScript files. CSS, WASM, dynamically loaded engines, receiver precaching and peak memory require separate measurements.

| Entry | Initial audit (gzip bytes) | Current (gzip bytes) | Budget (gzip bytes) |
| --- | ---: | ---: | ---: |
| Main application | 1,082,262 | 639,459 | 740,000 |
| Network view | 1,053,100 | 613,535 | 710,000 |
| Standalone receiver | 403,042 | 299,213 | 350,000 |

Current commands and native acceptance instructions are in the [testing guide](TESTING.md). Browser checks use installed Google Chrome in this environment; CI installs Playwright Chromium. The GitHub Actions workflow is configured and locally validated, but has not been executed remotely as part of this remediation.
