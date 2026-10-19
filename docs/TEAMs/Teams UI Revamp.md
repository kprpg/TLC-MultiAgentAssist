# Teams UI Revamp

**Status:** Implemented locally in sample mode using test-first increments. All UI-R0 through UI-R8 work is complete. Live identity, source-access, disclosure and hosted-dashboard gates remain unchanged.

**Verification:** `phase0:check` passed with 970 tests and 15 explicit skips; `validate:major`, the extension build, all 108 cross-surface smoke journeys, all 24 Teams browser journeys, and the runner's 227 Teams tests passed. The rebuilt app was exercised inside native Teams, including guidance, MCEM, all destinations and the original Go to website action. The installed frontend, website and API use `https://localhost:3978`; the persistent backend and native Portfolio / Overview were left running. Changes are uncommitted.

**Goal:** Make TLC Assist in Teams recognizably the same product as the VS Code extension: the same navigation vocabulary, compact workbench hierarchy, account/opportunity context, milestone presentation, guidance, and role-based Next Best Actions. Adapt that experience to each Teams canvas rather than transplanting the extension or copying VS Code chrome.

**Inspected baseline:** `feature/vscode-extension-Teams`, commit `2152e73`; the working tree was clean at the planning baseline. Recheck checkout identity and changes before implementation.

## 1. Confirmed decisions and boundaries

The user confirmed:

1. Cover **all Teams surfaces**, with an extension-like personal/wide workbench and appropriate adaptations for bound tabs, meeting panels, shared stage, cards, and notifications.
2. Use **New | Discover | Portfolio | Plays | Dashboards** in the personal application, with **Portfolio selected by default**.
3. Retain Teams **Meetings, Activity, Context settings**, and existing workflow/history functionality as contextual or utility destinations.
4. Limit dashboard work to presentation and existing-service wiring. Support the canonical sample dashboard and preserve an explicit live-unavailable state until caller-bound hosted access is separately approved.

### In scope

- Navigation, visual hierarchy, information density, responsive layout, theme integration, and accessible interactions.
- Presentation of existing account/discovery, opportunity, milestone, MCEM, guidance, workflow, and meeting capabilities.
- Focused browser-safe component reuse, typed UI state, and a narrow dashboard adapter using existing contracts and orchestrator-owned services.
- Preservation of current Teams routes, private reviews, disclosure controls, authentication, and backend origin alignment.
- Regression tests, native Teams visual verification, documentation synchronization, and refreshed release artifacts.

### Out of scope

- New reasoning agents, prompts, autonomous actions, source-system permissions, or a second orchestrator.
- New live opportunity/milestone creation, automatic email sending, transcript recording, or microphone infrastructure.
- A new hosted seller-earnings/profile service or reading the runtime operator's Windows profile on behalf of a Teams viewer.
- Copying the VS Code activity bar, editor/window controls, command bridge, or host-specific credential mechanisms.
- Redesigning Desktop/Web or opportunistically refactoring the extension's large application component.
- Changing installed URLs, certificate trust, tenant registrations, or running servers during planning.

## 2. Relationship to the three Teams documents

These documents remain the requirements baseline, with their historical planning status distinguished from the implemented application:

| Reference | Retained requirements | Presentation change proposed here |
| --- | --- | --- |
| [Teams architecture][teams-architecture], sections 6-7 | One core; private per-viewer data; governed publication; independent meeting-stage admission; browser-safe reuse | Replace the personal app's original four-destination IA with the confirmed extension-first navigation. Keep surface-specific collaboration boundaries. |
| [Teams design][teams-design], sections 3 and 6 | Visible scope, evidence/freshness, responsive master/detail, accessible themes, reviewed changes | Specify a three-region Portfolio workbench, compact header, extension-style contextual tabs, and coherent narrow adaptations. |
| [Teams implementation plan][teams-original-plan], P03/P08/P09/P12 and validation sections | Incremental delivery, shared contracts, no cross-app private imports, realistic client tests | Add a focused UI-revision increment over the implemented Teams app, not a restart of the original full-suite project. |

On implementation, update the affected layout sections of those documents and the [Teams runbook][teams-runbook]. Preserve their historical rationale and unrelated identity/Graph/operational requirements. This plan supersedes their original personal-navigation proposal only after approval.

## 3. Findings from the current implementation

| Area | Evidence | Consequence |
| --- | --- | --- |
| Extension navigation | [App header][extension-header] and [application composition][extension-app] already implement the five requested destinations and a Portfolio default | Reuse the vocabulary and hierarchy rather than inventing another product map. |
| Extension Portfolio | [Portfolio composition][extension-app], [layout controls][extension-layout], and [Next Best Actions][extension-actions] separate scope, opportunity details, and recommendations | Use these as behavioral/design references; extract only genuinely reusable presentation. |
| Current Teams shell | [Shell][teams-shell] uses My work, Accounts, Workflows, Meetings, Activity; [styles][teams-styles] emphasize a large hero and spacious cards | This is an information-architecture change, not merely a color refresh. |
| Current Teams accounts | [Accounts workspace][teams-accounts] nests Portfolio/Discovery/New under Accounts, uses account/opportunity selectors above guidance, and places milestones in an aside | Promote destinations; move milestones into the center Overview; reserve the right region for recommendations/evidence. |
| Workflows | [Workflow workspace][teams-workflows] already supports shared run/cancel/poll operations but displays output as JSON | Preserve execution semantics while presenting Plays, structured results, queues, evidence, and history. |
| Existing shared UI | [Shared UI][shared-ui] already contains account controls, discovery/search helpers, creation, dashboards, voice abstractions, and markdown utilities | Reuse those before introducing new helpers or components. |
| MCEM operation | [Shared operation registry][operation-registry] already exposes `runMcemCoach` | Produce recommendations from the existing typed result, not from new Teams-specific inference. |
| Dashboard gap | [Shared dashboard workspace][dashboard-workspace] and [dashboard host][dashboard-host] exist, but [Teams application services][application-services] and [operation registry][operation-registry] do not currently expose that host | Add a narrow service/transport seam; changing a tab label alone would leave Dashboards nonfunctional. |
| Host lifecycle | [Authentication adapter][teams-browser-auth] retains `frameContext`; [context workspace][teams-context] gates configuration APIs to settings frames | Preserve this fix and test it during navigation/layout changes. |

The supplied [VS Code screenshot][reference-screenshot] is the visual reference for hierarchy and density, not a requirement to reproduce clipped columns, hardcoded dark colors, or editor chrome.

## 4. Alternatives considered

| Approach | Benefits | Trade-offs | Decision |
| --- | --- | --- | --- |
| Extension-aligned IA and workbench, Teams-native adapters | Familiar mental model; shared components; preserves collaboration semantics | Requires navigation/state work and deliberate extraction | **Selected** |
| Cosmetic refresh of existing Teams screens | Smallest styling change | Retains nested navigation, hero-first landing, and different workbench organization | Rejected: insufficient similarity |
| Embed/transplant the complete extension webview | Superficial visual fidelity | Imports a host bridge and private app internals; creates coupling; ignores meeting and disclosure constraints | Rejected: violates boundaries |

## 5. Target personal-app layout

### 5.1 Compact header and navigation

- One compact TLC command/header area below the Teams-managed app header.
- Five primary destinations in the confirmed order; Portfolio active on a fresh, unbound open.
- A **Search accounts and opportunities** field local to TLC, visually distinct from Teams global search.
- Labeled controls to show/hide Accounts, opportunity details, and Next Best Actions, following the extension's model.
- An always-visible Sample/Live indicator. Put Activity, Meetings, My work/recent work, Context settings, source diagnostics, help, and feedback in a small utility menu or contextual actions.
- Keep current pending-review, error, source-health, and activity affordances discoverable; removing a primary tab must not remove its functionality.
- Do not copy the screenshot's microphone as a decorative button. Reuse existing voice capabilities only if already supported by the browser/Teams host; otherwise retain complete keyboard search without requesting new permissions.

### 5.2 Three-region Portfolio workbench

```text
 Teams-managed rail, title and global search remain outside TLC content.

+----------------------------------------------------------------------------------+
| New  Discover  PORTFOLIO  Plays  Dashboards | Search accounts/opportunities        |
| Scope/status where needed                 | Pane controls | Utilities | Sample    |
+------------------------+-----------------------------------+---------------------+
| ACCOUNTS               | EXAMPLE OPPORTUNITY               | ROLE BASED          |
| Add / curate customer  | Owner | Stage | Close | Sources   | NEXT BEST ACTIONS   |
| Account selector       | Overview | Guidance | MCEM Stages| Count / source state|
| Hidden-account controls+-----------------------------------+---------------------+
| OPPORTUNITIES          | Milestones             Meeting   | Role / action       |
| Sort / direction       | Name, status, dates, risk, notes | | Rationale / evidence|
| Name / intent / stage  | Expand row for activities/actions | Assumptions         |
| Selected row           |                                   | Run MCEM Coach      |
|                        | Reviewed field actions            | Read-only guidance  |
+------------------------+-----------------------------------+---------------------+
```

**Left: Accounts and opportunities**

- Preserve add/curation, hidden-account, discovery, Deal Team, and milestone-team semantics. Hiding/removing from a TLC portfolio must not be presented as deleting an MSX account.
- Show a sortable opportunity table with selected-row state, name/value, intent, stage, and accessible comments action when supported.
- Use current shared formatting/sort helpers. Full names remain available through accessible labels/details; truncation must not make records indistinguishable.
- Keep no-accounts, no-eligible-opportunities, hidden-only, access-denied, and source-error states distinct.

**Center: Opportunity details**

- Persistent account/opportunity scope header with owner, recorded stage, close date, and source state.
- **Overview:** milestones first, expandable activities and current reviewed editing affordances; contextual Meeting capture/follow-up action.
- **Guidance:** existing capability selection, task starters, prompt input, grounded response, evidence, source health, explicit document export, and unsent email drafts.
- **MCEM Stages:** existing recorded/evidence-based stage, criteria/gaps, team/activity context, and reviewed supported stage transitions.
- Keep team membership and opportunity-note controls in contextual sections/drawers instead of hiding them behind unrelated navigation.

**Right: Next Best Actions**

- Use the existing MCEM response: owner role, recommendation, rationale, citations, assumptions, freshness, and read-only status.
- Show zero recommendations honestly before evaluation, with **Run MCEM Coach** as the primary action.
- Use one result/state source for the recommendation rail and central MCEM view; neither should run its own duplicate evaluation.
- Evidence details can expand within the region or open a labeled drawer; do not add a fourth permanent column.
- Recommendations never commit source changes directly. A proposed mutation opens the existing private review path.

### 5.3 Other personal destinations

| Destination | Planned content | Preserved boundary |
| --- | --- | --- |
| New | Existing [record-creation workspace][creation-workspace], positioned as a top-level destination; confirmed sample creation returns to the created opportunity in Portfolio | Live remains reviewed draft/export only. |
| Discover | Existing domain filters, accessible opportunity/milestone discovery, and explicit join/leave/curation actions, with the same table density as Portfolio | Discovery does not silently enroll the user or broaden source access. |
| Portfolio | Three-region workbench, account/opportunity focus, guidance and MCEM | Private view; scope and authorization govern every result. |
| Plays | Existing workflow catalog grouped into readable cards/list, scope selector, run/cancel, structured result/queue details, guidance handoff and history | Keep shared workflow operations, partial/failed/cancelled states, and current run ownership. |
| Dashboards | Reuse [DashboardWorkspace][dashboard-workspace] and its Seller Dashboard sections via existing strict contracts | Sample is functional; live is explicitly unavailable under the protected hosted-profile policy. No fabricated live totals or sample fallback. |

My work/recent priorities and Activity remain reachable from Utilities; existing deep links to pending reviews and runs retain their original intent instead of resetting to Portfolio.

## 6. Adaptation for every Teams surface

| Surface | Layout adaptation | Actions and privacy |
| --- | --- | --- |
| Personal app | Full five-destination shell and responsive Portfolio workbench | Private scope, existing reviews, full supported navigation |
| Bound channel/account or group-chat tab | Same typography, opportunity header, detail tabs, milestone rows and optional action rail; binding replaces unrelated account browsing | Bound account cannot be escaped by global search or a picker. Open private workbench is an explicit handoff. Per-viewer source rights remain independent. |
| Meeting details/chat tab | Same opportunity workbench with meeting context and Prep/Capture/Follow-up entry points | Preserve automatic acquisition, denied/not-ready/expired states, evidence, and existing review |
| Meeting side panel | Single-column, context-pinned summary; segmented Prep/Capture/Follow-up; collapsed milestones and actions; no full five-tab application navigation | Private detail only; offer an authorized private workspace handoff when complex work does not fit. Do not send sensitive review content onto a public stage. |
| Meeting stage | Large, presentation-focused approved summary with recommendations, evidence, and source freshness | Approved projection only. No account browser, private dashboard, raw transcript, unreviewed text, or commit controls. Existing fail-closed audience checks remain. |
| Configuration frame | Same labels, spacing and form treatment with compact bound-context summary | Teams configuration save APIs run only in the actual SDK settings frame. |
| Personal bot/chat and notifications | Matching status vocabulary, concise task/result cards, clear Open in Portfolio/Plays/Review links | Retain actor-bound access and personal handoff; cosmetic changes do not change bot behavior. |
| Shared chat/channel cards and message extension | Consistent account/result headings, source/freshness/status and reviewed snapshot labels | Search/insert preview and disclosure checks remain independent. No raw account IDs or private payloads exposed as display substitutes. |

Bound tabs intentionally do not reproduce the entire personal application's multi-level navigation. "Similar" means consistent components and hierarchy, not identical controls in every canvas.

### Narrow meeting-side-panel wireframe

```text
+------------------------------------+
| TLC Assist          Private/Sample  |
| Example account > opportunity      |
| Prep | Capture | Follow-up          |
+------------------------------------+
| Transcript / source status         |
| Summary / selected milestone       |
| Proposed actions (count)           |
| [Review privately]                 |
| Evidence and next actions [expand] |
| [Open full private workspace]      |
+------------------------------------+
```

The shared stage is a separate approved-artifact route, never a resized version of this private panel.

## 7. Responsive, visual, and accessibility contract

### 7.1 Proposed content-width rules

These are testable design starting points, not claims about fixed Teams client dimensions. Apply them to the actual TLC content container.

| Available content width | Layout |
| --- | --- |
| At least 1200 CSS px | Three regions; initial Accounts width about 280 px, Actions about 300 px, remaining width for details; center minimum about 480 px. Collapse side regions before squeezing the detail area. |
| 900-1199 px | Account master/detail; Next Best Actions in a labeled drawer/disclosure. |
| 600-899 px | One principal content region, compact scope picker/drawer, inline or drawer-based evidence/actions. |
| Below 600 px; narrow meeting frame regardless of width | Single-column task flow, stacked controls, compact contextual navigation, no page-level horizontal scroll. |

- Capability and SDK frame context choose the surface; container width chooses its responsive layout. Width alone cannot identify a meeting frame.
- Collapsing every pane must not leave an empty screen: keep a clear restore affordance and a usable detail/scope fallback.
- Preserve scope, drafts, and focus across resizing and panel collapse. Record tables may scroll locally on wider canvases; narrow/mobile panels use stacked records instead.
- Avoid obligatory drag-resize behavior. Independent show/hide controls are sufficient for the first revision.

### 7.2 Visual system

- Match the extension's compact information density, borders, modest corner rounding, restrained spacing, selected rows, blue active-tab underline, and clearly separated section headings.
- Use Fluent/Teams semantic tokens rather than copying `--vscode-*` variables or hardcoding the dark screenshot palette.
- Dark Teams should resemble the supplied screenshot; light Teams remains light. Handle live theme changes and high contrast without a new theme setting.
- Establish a small scoped TLC token layer for spacing, density, headings, focus, panel borders, and selection, backed by Fluent tokens. Avoid global shared CSS that unexpectedly changes existing hosts.
- Remove the large hero as the default landing experience and reduce duplicated branding/footer space, without removing the Sample/Live or privacy signals.

### 7.3 Acceptance requirements

- Semantic landmarks, properly associated tab/tab-panel roles, labeled inputs, keyboard-complete tables/actions, accessible record names, and status announcements.
- Visible focus; Escape closes transient drawers; opening/closing a drawer or review restores focus to its trigger.
- At least WCAG 2.2 AA contrast; non-color-only stage/source/status indicators; touch targets at least 44 CSS px in mobile/narrow modes.
- At 200% zoom, controls remain reachable and content can reflow into a narrower layout.
- No hidden focusable content in collapsed regions and no unnecessary page-wide horizontal overflow.
- Manual keyboard and screen-reader checks accompany automated/static tests; a visual screenshot alone is insufficient.

## 8. Architecture and file-level approach

### 8.1 Teams presentation ownership

Keep [TeamsApp][teams-app] as composition, not an accumulating set of layout state variables.

- Adjust [TeamsShell][teams-shell] for the five destinations and utilities.
- Introduce a focused typed navigation/scope hook, such as `use-workspace-navigation.ts`, for destination, selection, detail tab, panel visibility, and existing deep-link intent.
- Split [AccountsWorkspace][teams-accounts] into focused workbench, scope list, details, and recommendation presentation as needed. Candidate names: `portfolio-workbench.tsx`, `portfolio-scope-pane.tsx`, and `opportunity-details.tsx`; finalize names after the extraction census.
- Keep [TeamsApiClient][teams-data-client] as the authenticated typed transport. Do not move HTTP/authentication into presentational components.
- Retain dedicated meeting, activity, review, context, and approved-stage components, adapting their presentation rather than duplicating their business behavior.

### 8.2 Reuse without cross-app coupling

- Reuse [shared search][shared-search], account controls, [creation][creation-workspace], [dashboard UI][dashboard-workspace], [prompt catalog][prompt-catalog], and safe response-rendering helpers.
- Extract browser-safe presentational pieces from extension-only implementations only where Teams and the extension will both consume them: pane controls, recommendation rendering, or record formatting as justified.
- Pass data and callbacks into shared components. Never import extension `dataClient`, `acquireVsCodeApi`, Electron APIs, or Node-backed common barrels.
- Keep pure view mapping separate from host credentials and orchestration; use existing leaf schemas/types.
- Preserve extension behavior and visual layout when changing it to consume an extracted component. Do not lift its entire application component.

### 8.3 Narrow dashboard seam

1. Reuse [Seller Dashboard contracts][dashboard-contracts], [SharedSellerDashboardHost][dashboard-host], and the existing UI.
2. Add the necessary orchestrator-owned service/operation wiring at the existing [application services][application-services] and [operation registry][operation-registry] seams, then a thin Teams data-client adapter.
3. Configure live Teams to deny local-profile reads (`allowLocalProfile: false`) even when the Teams runtime is on a laptop. The HTTP viewer must not inherit the operator's earnings identity.
4. Keep strict request/response parsing and confirmed-refresh semantics; reject caller-supplied profile overrides and malformed/version-mismatched input.
5. Extend [dashboard transport-parity tests][dashboard-parity-tests] to include Teams; preserve current Desktop/Web/VS Code behavior.
6. Prefer unchanged existing wire shapes. If an envelope/schema actually changes, bump the relevant contract version and update all consumers and contract tests.

No new business algorithms, profile collector, permission grants, or live dashboard source are part of this seam.

### 8.4 State, failures, and trust preservation

- Scope all in-memory data/results to the current principal, mode, environment, account, opportunity, and binding.
- Clear or cancel stale work on a scope/auth change; responses for a previous selection cannot replace current results. Preserve unsent drafts per scope or obtain an explicit discard decision before changing scope.
- Persist only non-sensitive layout preferences if persistence is needed. Never put tokens, private results, prompt text, account names, or transcript contents in browser storage or URLs.
- Preserve existing `surface`, `bindingId`, `referenceId`, and approved-artifact deep links; the default Portfolio route must not override them.
- Show loading, empty, denied, unavailable, partial, stale, conflict, and effect-unknown distinctly. Preserve usable partial results with their source state; never mask errors with a fresh-looking empty panel.
- Keep preview/confirm/digest/actor/expiry/concurrency controls. Screenshot-style inline edits still enter the current Teams review flow rather than copying an extension's direct Save behavior.
- Never automatically run guidance because a user opens a recommendation pane, and never auto-resubmit an unknown-outcome action.

## 9. Implementation todos and dependencies

Tracking belongs in the session SQL database; this table is the human-readable execution contract.

| ID | Todo | Dependencies | Deliverable / completion evidence |
| --- | --- | --- | --- |
| UI-R0 | Re-establish baseline and feature census | None | Checkout/branch/dirty baseline; source/route/operation inventory; reference screenshots; existing test results; no surprise backend scope. |
| UI-R1 | Establish scoped visual tokens and focused reusable primitives | UI-R0 | Header/panes/status/actions consistent with the reference; browser-safe extraction tests; existing extension unaffected. |
| UI-R2 | Implement navigation, utilities, scope, and responsive layout state | UI-R1 | Five destinations; Portfolio default; preserved deep links and utility routes; keyboard-accessible pane controls; stale-scope protection. |
| UI-R3 | Wire existing dashboard service safely for Teams | UI-R0 | Functional sample dashboard; explicit live denial; strict contract and four-transport parity tests. |
| UI-R4 | Rebuild Portfolio as the three-region workbench | UI-R1, UI-R2 | Left account/opportunity list; central Overview/Guidance/MCEM; single-source Next Best Actions; existing reviewed actions and meetings accessible. |
| UI-R5 | Align New, Discover, Plays, and Dashboards | UI-R2, UI-R3, UI-R4 | Real supported workflows and readable result/history views; no fake tabs, lost features, or raw-JSON-only primary results. |
| UI-R6 | Adapt bound tabs, meetings, configuration, cards, and stage | UI-R1, UI-R2, UI-R4 | Consistent surface variants, narrow layout, context/settings-frame safety, and preserved private/shared separation. |
| UI-R7 | Verify cross-surface behavior and visual acceptance | UI-R3, UI-R4, UI-R5, UI-R6 | Automated suites, viewport/theme evidence, native Teams interaction, existing-host regression checks. |
| UI-R8 | Synchronize docs, package, and perform controlled rollout | UI-R7 | Updated three-doc layout baseline/runbook, tested runtime assets, correct installed/backend origin, actual in-Teams acceptance evidence. |

UI-R3 can proceed independently of UI-R1/UI-R2 after the baseline. Do not parallelize edits to the same application/shell or merge before shared interfaces are stable.

## 10. Verification plan

### 10.1 Discriminating acceptance scenarios

| Check | Required result |
| --- | --- |
| Fresh personal open | Portfolio is active; all five destinations are visible; no hero-first detour. |
| Wide reference | At 1440x900 and the reference 1556x768 fixture, scope, opportunity detail, milestones, and Next Best Actions fit without clipped primary controls. |
| Resize/reflow | At 1280x800, 1024x768, 768x1024, 390x844, 360x800, and 320x640, the expected region/drawer variant works and the document does not overflow horizontally. |
| Navigation and deep links | Existing binding/reference/review/run/stage intent wins over the default; utility Meetings/Activity remain directly reachable. |
| Scope freshness | Switching opportunities during an in-flight request never shows the old guidance or recommendations as current. |
| MCEM | One explicit evaluation updates both central criteria and recommendation rail; recorded stage and inferred evidence stage are not conflated. |
| Existing actions | Add/hide/unhide and supported team/milestone/opportunity actions preserve their current confirmation/review semantics; cancelled reviews write nothing. |
| New | Sample creation returns to the correct Portfolio record; live creation remains disabled/draft-only. |
| Plays | Scoped run/cancel/history, partial/failed states, queue navigation and guidance handoff work without inventing completion. |
| Dashboard | Sample snapshot matches existing hosts; live denial returns no private report and does not touch the host profile/collector. |
| Bound tab | Switching accounts/search cannot escape its binding; another viewer cannot inherit the publisher's private results. |
| Meeting/configuration | SDK content/settings/side-panel/stage cases are distinct; Context settings never blanks the personal app. |
| Stage/cards | Unapproved/private information and mutation controls never appear in the shared projection; no broader audience permission is inferred from visual similarity. |
| Theme/accessibility | Light/dark/high-contrast, dynamic theme change, keyboard focus, screen-reader labeling, drawers, and 200% zoom pass. |
| Native Teams and website | Full UI renders inside the installed app; **Go to website** opens the same healthy configured HTTPS origin; served assets match the tested build. |

Use canonical sanitized data and mocked failure/authorization cases. Live validation remains opt-in and requires approved access/test records. Layout parity is not evidence of corporate live-data readiness.

### 10.2 Existing and targeted tests

- Extend [Teams UI tests][teams-ui-tests] and [browser-host/frame tests][teams-frame-tests].
- Extend [Teams browser journeys][teams-e2e] for the new navigation, responsive panes, and actual context variants. Do not just rename old selectors until they pass; retain equivalent end-user assertions.
- Add focused unit tests for new pure state/mapping helpers and affected shared primitives.
- Extend [extension layout tests][extension-layout-tests], [shared search tests][shared-search-tests], and [dashboard parity tests][dashboard-parity-tests] when those components/seams change.
- Use the existing [Teams Playwright configuration][teams-playwright] for isolated sample journeys. Its HTTP test listener and ephemeral unit-test ports are not installed Teams app URLs.
- Add targeted visual assertions/screenshots through existing Playwright infrastructure, not a new snapshot/DOM tooling stack without a demonstrated need.

Run the smallest affected selections first, then applicable integration gates:

```powershell
npm run teams:typecheck
npm run teams:build
npm run test:teams
npm run test:smoke:teams
npm run typecheck
npm run lint
```

Before a major check-in, run the repository-required broader gates:

```powershell
npm run phase0:check
npm run validate:major
```

If shared extraction changes extension/Desktop/Web consumers, also run their relevant builds, targeted tests, and required smoke journeys, including `npm run ext:build` and `npm run test:smoke:revamp` where applicable. The implementation verification above records the completed gates; the original planning task did not execute them.

## 11. Documentation, packaging, and operational acceptance

- Revise the architecture/design/implementation documents' UI sections together, describing this extension-aligned presentation without claiming new live feature authorization.
- Update the [Teams runbook][teams-runbook] for the new navigation and utility locations; update the [folder structure][folder-structure] only if new shared/component layout warrants it.
- Rebuild the runtime ZIP as well as the app-package ZIP where required. A manifest refresh alone does not deploy new client assets.
- Keep app identity, approved route/deep-link structure, CSP, authentication and certificate validation intact.
- Current local acceptance has used HTTPS 3978 for the installed app and 3979 for the newer package. Choose the intended configured origin for each runtime/package pair and verify every tab/website URL; do not silently switch an installed app to another listener.
- Do not stop unrelated servers, infer readiness from logs, or point Teams at an ephemeral test port. Verify health, HTML, JavaScript/CSS assets, and actual embedded interaction.
- Keep a known-good runtime/package for rollback. A presentation rollback must not rewrite user state or replay reviewed effects.
- Leave implementation changes uncommitted unless Git operations are explicitly requested.

## 12. Definition of done

1. The personal Teams app uses the confirmed five destinations and Portfolio default.
2. Its wide workbench resembles the supplied VS Code screenshot in structure and density while respecting Teams theming.
3. Every existing Teams function remains reachable, with purposeful adaptations on narrow and shared surfaces.
4. The MCEM/recommendation, reviewed-write, source-health, private/shared, and dashboard privacy boundaries are preserved.
5. The tested build renders inside native Teams and from its actual website URL, not only a standalone sample preview.
6. Required automated, accessibility, visual, transport-parity, and affected-host regression checks pass.
7. Release artifacts and the three source documents/runbook agree with the shipped UI.

Remaining live identity, source access, transcript, disclosure, and hosted-dashboard feasibility gates are reported honestly; they are not resolved by this layout revision.

## Reference index

Workspace links below are relative to this Teams documentation folder. Proposed new filenames above are illustrative, not files already created.

[teams-architecture]: ./Teams-UI-TLC-Assist-Architecture.md
[teams-design]: ./Teams-UI-TLC-Assist-Design.md
[teams-original-plan]: ./Teams-UI-TLC-Assist-Implementation-Plan.md
[teams-runbook]: ../runbooks/teams-app.md
[extension-header]: ../../apps/vscode-extension/src/webview/app-header.tsx
[extension-app]: ../../apps/vscode-extension/src/webview/app.tsx
[extension-layout]: ../../apps/vscode-extension/src/webview/portfolio-layout-controls.tsx
[extension-actions]: ../../apps/vscode-extension/src/webview/next-best-actions.tsx
[teams-shell]: ../../apps/teams/src/client/shell.tsx
[teams-styles]: ../../apps/teams/src/client/styles.css
[teams-accounts]: ../../apps/teams/src/client/accounts.tsx
[teams-workflows]: ../../apps/teams/src/client/workflows.tsx
[shared-ui]: ../../apps/shared
[operation-registry]: ../../packages/orchestrator/operations.ts
[application-services]: ../../packages/orchestrator/application-runtime.ts
[dashboard-workspace]: ../../apps/shared/dashboard-workspace.tsx
[dashboard-host]: ../../packages/orchestrator/seller-dashboard.ts
[dashboard-contracts]: ../../packages/common/contracts/seller-dashboard.ts
[teams-browser-auth]: ../../apps/teams/src/client/authentication.ts
[teams-context]: ../../apps/teams/src/client/context.tsx
[teams-app]: ../../apps/teams/src/client/app.tsx
[teams-data-client]: ../../apps/teams/src/client/data-client.ts
[creation-workspace]: ../../apps/shared/record-creation/new-workspace.tsx
[shared-search]: ../../apps/shared/portfolio-search.ts
[prompt-catalog]: ../../apps/shared/prompt-catalog.ts
[dashboard-parity-tests]: ../../tests/unit/hosts/seller-dashboard-transport-parity.test.ts
[teams-ui-tests]: ../../tests/unit/teams/ui.test.ts
[teams-frame-tests]: ../../tests/unit/teams/browser-host.test.ts
[teams-e2e]: ../../tests/e2e/teams/surface.spec.ts
[extension-layout-tests]: ../../tests/unit/vscode-extension/portfolio-layout-controls.test.ts
[shared-search-tests]: ../../tests/unit/shared/portfolio-search.test.ts
[teams-playwright]: ../../playwright.teams.config.ts
[folder-structure]: ../Folder-structure.md
[reference-screenshot]: <../../../../../AppData/Roaming/Code - Insiders/agentSessionData/ebb573aa-53ac-4f44-85ae-5aeb9220e1dd/attachments/296d3eb3-e796-498a-8d48-de11e7dd7e30/Pasted Image.png>

Official design guidance reviewed:

- [Design your tab for Microsoft Teams](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/design/tabs): contextual tab content, limited tab navigation, and theme-token integration.
- [Designing your Teams meeting extension](https://learn.microsoft.com/en-us/microsoftteams/platform/apps-in-teams-meetings/design/designing-apps-in-meetings): task-focused meeting canvases, vertical flow, and intentional shared-stage content.
- [Teams app design fundamentals](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/design/design-teams-app-fundamentals): typography and visual-system reference, identified through Microsoft Learn search.
