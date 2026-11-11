# Browser audit failure inventory

> Historical failure inventory from the initial audit. Current fixes and verification results are tracked in [remediation status](REMEDIATION_STATUS.md); the failures and follow-up counts below describe the original run.

See [the prioritized project audit](../AUDIT_REVIEW.md) for the fixes and remaining design decisions.

The broad run used installed Google Chrome, four workers, and no retries. It ran 430 tests: **378 passed, 52 failed, 0 skipped**. The production screenshot generator was excluded. Concurrent validation and several obsolete UI assertions limit how many failures can be treated as product defects.

Follow-up: the AI selection defect is fixed and its existing regression passes. A separate single-worker run of nine behavior/startup checks passed eight and failed one. Of the original failures, **4 did not reproduce** in that follow-up; **47 still require review or individual reproduction**. The full suite has not been rerun after the AI fix.

The notification follow-up fails while waiting for the sender fixture to register its listener, before it tests snoozing or theme changes. Do not infer a snooze/theme product regression from that result alone.

## Files and primary findings

| Test file | Broad-run failures | Review notes |
| --- | ---: | --- |
| [ai-enabled.spec.ts](../lanmind/tests/theme/ai-enabled.spec.ts) | 1 | Fixed disabled Skill/MCP selections; independently verified. |
| [app-lock.spec.ts](../lanmind/tests/theme/app-lock.spec.ts) | 1 | The failing startup check passes with one worker. |
| [calendar-filters.spec.ts](../lanmind/tests/theme/calendar-filters.spec.ts) | 2 | Expects the removed day-details panel and counts. |
| [features.spec.ts](../lanmind/tests/theme/features.spec.ts) | 1 | Aborted navigation in broad run; camera cleanup check passes with one worker. |
| [group-actions.spec.ts](../lanmind/tests/theme/group-actions.spec.ts) | 1 | Menu/conversation-change timeout; investigate individually. |
| [i18n.spec.ts](../lanmind/tests/theme/i18n.spec.ts) | 1 | Standalone English surface timeout; investigate individually. |
| [log-pagination.spec.ts](../lanmind/tests/theme/log-pagination.spec.ts) | 1 | Transient disabled-button assertion around a 700 ms mock response; passes with one worker. |
| [network.spec.ts](../lanmind/tests/theme/network.spec.ts) | 3 | Clipboard failure check passes with one worker; two calendar cases expect the old overflow control. |
| [notification.spec.ts](../lanmind/tests/theme/notification.spec.ts) | 1 | Fails before the snooze behavior assertion: the sender fixture does not finish startup. |
| [project-layout.spec.ts](../lanmind/tests/theme/project-layout.spec.ts) | 14 | Includes removed collapse controls, old project-menu/status labels, and an ambiguous navigation selector. |
| [screenshot.spec.ts](../lanmind/tests/theme/screenshot.spec.ts) | 4 | Capture/chat image flows and browser teardown time out; investigate separately from native clipboard tests. |
| [task-layout-refinements.spec.ts](../lanmind/tests/theme/task-layout-refinements.spec.ts) | 6 | Includes old date-field selectors and narrow kanban controls. |
| [task-multi-filters.spec.ts](../lanmind/tests/theme/task-multi-filters.spec.ts) | 4 | Includes ambiguous navigation, removed calendar classes, and narrow-layout controls. |
| [theme.spec.ts](../lanmind/tests/theme/theme.spec.ts) | 2 | Mixed visual assertion and removed desktop-calendar selector; investigate individually. |
| [timeline.spec.ts](../lanmind/tests/theme/timeline.spec.ts) | 3 | Navigation and narrow-layout timeouts; confirm current UI interactions. |
| [ui-refinements.spec.ts](../lanmind/tests/theme/ui-refinements.spec.ts) | 4 | Old calendar overflow/day-details expectations, removed collapse controls, and ambiguous navigation. |
| [wiki-discussion.spec.ts](../lanmind/tests/theme/wiki-discussion.spec.ts) | 2 | Two discussion/reply flows time out after 90 seconds; investigate individually. |
| [wiki-editor.spec.ts](../lanmind/tests/theme/wiki-editor.spec.ts) | 1 | Browser trace artifact ENOENT during teardown; no product defect established by that failure. |

## Every failing case

| Source line | Test | Observed failure | Follow-up |
| --- | --- | --- | --- |
| ai-enabled.spec.ts:63 | keeps disabled Skills and MCP configurations and clears them from the next run's selected scope | getByRole('button', { name: 'Skills', exact: true }); expected "Skills"; received "Skills (1)" | Fixed; targeted regression passes. |
| app-lock.spec.ts:167 | startup read failures stay shielded without a lock-check page, then recover without flashing an error | getByRole('dialog', { name: '程序锁定' }).getByRole('alert'); expected 0; received 1 | Passed with one worker; investigate timing/reload sensitivity. |
| calendar-filters.spec.ts:17 | personal calendar and list share completed preferences and allow explicit status review | locator('.calendar-view').getByText('共 4 项', { exact: true }); expected visible | Needs review; no individual follow-up run. |
| calendar-filters.spec.ts:51 | completing a task removes it from the calendar and day details until completed tasks are shown | locator('.calendar-view').getByText('共 3 项', { exact: true }); expected visible | Needs review; no individual follow-up run. |
| features.spec.ts:44 | disabling the optical plugin releases an active camera stream | Error: page.goto: net::ERR_ABORTED at http://127.0.0.1:1421/tests/theme/features.html?locale=en-US&optical | Passed with one worker; investigate timing/reload sensitivity. |
| group-actions.spec.ts:10 | group menu keeps settings before more and closes on Escape, outside click and conversation change | Test timeout of 45000ms exceeded. | Needs review; no individual follow-up run. |
| i18n.spec.ts:43 | English standalone surfaces retain user content and show translated actions | Test timeout of 45000ms exceeded. | Needs review; no individual follow-up run. |
| log-pagination.spec.ts:82 | closing an activity request then opening another task resets paging and ignores the old response | getByRole('dialog', { name: '任务动态', exact: true }).getByRole('button', { name: '下一页' }); expected disabled; received enabled | Passed with one worker; investigate timing/reload sensitivity. |
| network.spec.ts:261 | copy failures and legacy hashes never show a false clipboard success | getByText('复制访问密码失败，请重试或点击查看后手动复制。', { exact: true }); expected visible | Passed with one worker; investigate timing/reload sensitivity. |
| network.spec.ts:274 | network calendar overflow is accessible in editable mode and after zoom | Timeout waiting for locator('[data-calendar-date="2026-09-30"]').getByRole('button', { name: '查看 2026-09-30 的全部 19 项任务', exact: true }) | Needs review; no individual follow-up run. |
| network.spec.ts:274 | network calendar overflow is accessible in read-only mode and after zoom | Timeout waiting for locator('[data-calendar-date="2026-09-30"]').getByRole('button', { name: '查看 2026-09-30 的全部 19 项任务', exact: true }) | Needs review; no individual follow-up run. |
| notification.spec.ts:161 | snoozed reminders survive theme changes and use the latest theme | Error: expect(received).toBe(expected) // Object.is equality | Still fails with one worker; sender fixture never registers its snooze listener. |
| project-layout.spec.ts:30 | layout filters stay consistent across all four project views | Timeout waiting for getByRole('listbox', { name: '项目状态' }).getByRole('option', { name: '已取消', exact: true }) | Needs review; no individual follow-up run. |
| project-layout.spec.ts:114 | files and more menu open management and transfer directly | Timeout waiting for getByRole('menu', { name: '项目更多操作' }).getByRole('menuitem', { name: '项目设置', exact: true }) | Needs review; no individual follow-up run. |
| project-layout.spec.ts:166 | dark: progress and project confirmation dialogs use clear themed surfaces | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| project-layout.spec.ts:166 | light: progress and project confirmation dialogs use clear themed surfaces | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| project-layout.spec.ts:199 | more menu respects creator, project admin and member roles | getByRole('menu', { name: '项目更多操作' }).getByRole('menuitem', { name: '项目设置', exact: true }); expected enabled | Needs review; no individual follow-up run. |
| project-layout.spec.ts:224 | global task views use the compact sorting and filtering panel | The global All Tasks locator matches both the rail and sidebar buttons. | Needs review; no individual follow-up run. |
| project-layout.spec.ts:292 | dark: task filter panel fits 390px viewport | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| project-layout.spec.ts:292 | dark: task filter panel fits 800px viewport | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| project-layout.spec.ts:292 | light: task filter panel fits 390px viewport | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| project-layout.spec.ts:292 | light: task filter panel fits 800px viewport | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| project-layout.spec.ts:324 | dark: project layout fits 390px viewport | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| project-layout.spec.ts:324 | dark: project layout fits 800px viewport | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| project-layout.spec.ts:324 | light: project layout fits 390px viewport | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| project-layout.spec.ts:324 | light: project layout fits 800px viewport | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| screenshot.spec.ts:109 | reverse selection uses native image pixels and Enter copies the region | Test timeout of 45000ms exceeded. | Needs review; no individual follow-up run. |
| screenshot.spec.ts:158 | clipboard images paste into a draft and send to the selected group | locator('textarea'); expected ""; received "保留输入草稿" | Needs review; no individual follow-up run. |
| screenshot.spec.ts:175 | image-only drafts can be removed, pasted again and sent with Enter | Tearing down "context" exceeded the test timeout of 45000ms. | Needs review; no individual follow-up run. |
| screenshot.spec.ts:188 | failed image sends keep the draft for retry without opening a modal | Test timeout of 45000ms exceeded. | Needs review; no individual follow-up run. |
| task-layout-refinements.spec.ts:6 | en-US: new task keeps long dropdowns on one line at 1440px | locator('.task-detail-panel').locator('.task-detail-date-fields .theme-date-picker-trigger'); expected 1; received 0 | Needs review; no individual follow-up run. |
| task-layout-refinements.spec.ts:6 | en-US: new task keeps long dropdowns on one line at 390px | locator('.task-detail-panel').locator('.task-detail-date-fields .theme-date-picker-trigger'); expected 1; received 0 | Needs review; no individual follow-up run. |
| task-layout-refinements.spec.ts:6 | zh-CN: new task keeps long dropdowns on one line at 1440px | locator('.task-detail-panel').locator('.task-detail-date-fields .theme-date-picker-trigger'); expected 1; received 0 | Needs review; no individual follow-up run. |
| task-layout-refinements.spec.ts:6 | zh-CN: new task keeps long dropdowns on one line at 390px | locator('.task-detail-panel').locator('.task-detail-date-fields .theme-date-picker-trigger'); expected 1; received 0 | Needs review; no individual follow-up run. |
| task-layout-refinements.spec.ts:55 | en-US: abandoned kanban stays to the right and is reachable at 390px | Timeout waiting for getByRole('button', { name: 'Collapse navigation', exact: true }) | Needs review; no individual follow-up run. |
| task-layout-refinements.spec.ts:55 | zh-CN: abandoned kanban stays to the right and is reachable at 390px | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| task-multi-filters.spec.ts:46 | personal multi-select filters persist across all views and reload | The global All Tasks locator matches both the rail and sidebar buttons. | Needs review; no individual follow-up run. |
| task-multi-filters.spec.ts:143 | shared descending priority sorts within calendar days, timeline rows and kanban columns | locator('[data-calendar-date="2026-09-14"] .calendar-task').first(); expected "今日交付进行中" | Needs review; no individual follow-up run. |
| task-multi-filters.spec.ts:172 | dark: narrow multi-select and keyboard selection stay usable | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| task-multi-filters.spec.ts:172 | light: narrow multi-select and keyboard selection stay usable | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| theme.spec.ts:79 | light llm renders without errors | Error: expect(received).not.toBe(expected) // Object.is equality; expected not "" | Needs review; no individual follow-up run. |
| theme.spec.ts:172 | calendar opacity and custom tone are independent of the outer application theme | locator('.desktop-cal-container'); expected "rgba(250, 250, 250, 0)" | Needs review; no individual follow-up run. |
| timeline.spec.ts:13 | personal timeline sorts and filters tasks using preferences shared with the list and calendar | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| timeline.spec.ts:107 | dark: timeline fits desktop and contains horizontal scrolling on a narrow screen | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| timeline.spec.ts:107 | light: timeline fits desktop and contains horizontal scrolling on a narrow screen | Timeout waiting for getByRole('button', { name: '收起左侧导航', exact: true }) | Needs review; no individual follow-up run. |
| ui-refinements.spec.ts:15 | filter dropdowns extend outside the panel without adding panel scrollbars | The global All Tasks locator matches both the rail and sidebar buttons. | Needs review; no individual follow-up run. |
| ui-refinements.spec.ts:43 | dark: compact project calendar keeps tasks and overflow entry inside each date | locator('[data-calendar-date="2026-09-14"]').getByRole('button', { name: /的全部 15 项任务/ }); expected visible | Needs review; no individual follow-up run. |
| ui-refinements.spec.ts:43 | light: compact project calendar keeps tasks and overflow entry inside each date | locator('[data-calendar-date="2026-09-14"]').getByRole('button', { name: /的全部 15 项任务/ }); expected visible | Needs review; no individual follow-up run. |
| ui-refinements.spec.ts:132 | project header owns the counts and icon-only creation across views | Trace recording file missing during browser context close (ENOENT). | Needs review; no individual follow-up run. |
| wiki-discussion.spec.ts:36 | dark: discussion floats without shrinking the document, keeps drafts and supports replies | Trace recording file missing during browser context close (ENOENT). | Needs review; no individual follow-up run. |
| wiki-discussion.spec.ts:36 | light: discussion floats without shrinking the document, keeps drafts and supports replies | Trace recording file missing during browser context close (ENOENT). | Needs review; no individual follow-up run. |
| wiki-editor.spec.ts:59 | light: Wiki icons update the tree and tags persist with removable controls | Trace recording file missing during browser context close (ENOENT). | Needs review; no individual follow-up run. |

## Reproduction and local evidence

From `lanmind/`, run a single case with the normal one-worker setting, for example:

```powershell
npx playwright test tests/theme/network.spec.ts:261 --workers=1 --reporter=line
```

Set `PLAYWRIGHT_EXECUTABLE_PATH` if using an installed browser instead of Playwright Chromium. The audit used `C:/Program Files/Google/Chrome/Application/chrome.exe`.

The ignored local artifacts are `lanmind/.tmp/full-browser.json`, `lanmind/.tmp/triage-browser.json`, `lanmind/.tmp/final-ai-enabled.log`, `lanmind/test-results/`, and `lanmind/.tmp/audit-triage-results/`. They are evidence from this checkout, not committed test baselines.
