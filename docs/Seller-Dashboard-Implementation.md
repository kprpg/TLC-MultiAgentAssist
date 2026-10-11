# Seller Dashboard: source analysis and implementation plan

## Objective and scope

Implement the MCAPS seller-performance experience as a separate **Seller Dashboard**
workspace, alongside Portfolio/Plays/Discovery, across Desktop, Web, and the VS Code
webview. Existing panes, CRM writes, agent prompts, compensation contracts, and
authentication remain unchanged. Implementation and tests belong to this linked
worktree; only requested proof screenshots are written to the supplied source folder.

Baseline: branch `agents/mcap-seller-dashboard-implementation`, commit
`ad1a0d3c6663fb9e52b395da6a0830ca0f1d0458`, initially clean.

## Source inventory and findings

Source package: `scripts\MCAP-Seller-Performance-Dashboard` in the primary checkout.
It is input/reference material, not a runtime dependency installed automatically.

| File | Analysis and implementation consequence |
| --- | --- |
| `SKILL.md` | Defines own-export onboarding, USD/account-grain limits, official MINT accounting, accessible quota-TPID pipeline scope, explicit refresh, encrypted storage, freshness, optional scenarios, and no sharing/writes. These are requirements, not merely presentation suggestions. |
| `README.md` | Describes a private manager-ready attainment/quota/pipeline viewer. No personal source data should ship. |
| `manifest.json` | Documents Windows/Python/Node/Azure CLI/Edge/trusted MSX MCP dependencies, up to 200 TPIDs, private-state exclusions, and generic package hashes. It does not grant access or establish the reference HTML as synthetic. |
| `build_dashboard.py` | A tiny entry point delegating to `manager_runner.main`; it is not the report-generation logic. |
| `dashboard_config.py` | Validates UTF-8/BOM/optional Excel `sep=,` CSVs, nine required columns, one fiscal year, English month labels, USD amounts, `EndCustomerTopParentName`, numeric TPIDs, duplicate keys, account names, and metric/bucket mappings. It validates explicit tenant/org/runtime/timezone/profile configuration; it never guesses an organization. |
| `manager_sources.py` | Separately authenticates to MINT through the trusted installed `get_earnings` MCP runtime and to Dataverse through the configured organization. Selects the actual quarterly partition with YTD dates and normalizes its inclusive/exclusive end boundary. Rejects missing/truncated/foreign-period summary data. Dataverse uses same-origin pagination, bounded retries/record limits, all accessible quota-account records, canonical parent attribution, deduplication, currency metadata, and explicit per-account completeness. Open and won parents remain distinct. Unknown milestone statuses survive as uncertainty. |
| `manager_model.py` | Reconciles full quota mappings, monthly official calculations, account totals, bucket weights, and reporting boundaries. Preserves source-reported attainment, signed calculated actuals, recurring baselines, genuine zero targets, and unknown account actuals. Gap is `max(quota - actual, 0)` after aggregation; overlapping buckets are never merged. Workload mappings are tentative. Eligible production, timing, commitment, source completeness, and unverified credit are distinct. Optional credit is calendar-day-prorated, not an earnings forecast. |
| `manager_runner.py` | Setup imports a pending quota without live reads; refresh commits accepted quota, source snapshots, model, and status atomically under a profile lock. Failure retains the last good report and records a failed run. Rebuild uses recorded sources without changing freshness. No action means no fetch. |
| `secure_dashboard.py` | DPAPI encryption tied to the Windows user; safe dedicated profile storage; atomic replacement and inter-process locks; an expiring loopback capability viewer; no-store/CSP; safe JSON injection; no plaintext report export. The integration must preserve this privacy boundary. |
| `manager_dashboard.html` | Generic renderer of the hardened model: fixed official headline/buckets, closed-month comparison, account/bucket/metric/state/search filters, net account gaps, reconciliation, production candidates, opportunities/milestones, next actions, freshness/methodology, and opt-in scenario. Text-safe rendering, pagination/display limits, and unknown states are deliberate. |
| `test_manager_model.py` | Covers multiple plan shapes, source-reported rather than gross attainment, zero/negative values, duplicate/truncated/foreign-period data, missing actuals/access/status/commitment/mapping, partial-month intervals, scenario proration, XSS-safe text, currency guards, filter invariance, and complete totals despite display limits. |
| `test_onboarding.py` | Covers CSV validation, explicit trusted config, isolated DPAPI state, profile locks, transactional retention, authentication/same-origin/pagination, MINT partition dates, and the private viewer. |
| `automation-template.txt` | Scheduling and sharing are separate explicit approvals. No schedule, notification, CRM write, email, or upload is created by this feature. |
| `review-packet.txt` | Confirms narrow supported monetary plans, private output, synthetic test coverage, dependency routing, and human review. Source access is still unproven without the user's own environment. |
| `wbu_cvanheusen_2026-08-30.html` | A materially different, richer weekly-business-update report. Used for information architecture and interactions only; no customer names, identifiers, financial amounts, or embedded data are copied into distributable code or screenshots. |

The source Python suite was executed read-only with `python -B -m unittest discover`
against the supplied scripts: **86 tests passed**.

### Weekly-business-update information architecture

The reference HTML has four keyboard-addressable report tabs, fiscal-quarter
filtering, sortable tables, metric cards, insights, and contextual record details:

1. **Pipeline & Hygiene**: qualified/early/uncommitted/committed pipeline and
   concentration; past-due and stale uncommitted milestones; qualified, stage-1,
   owned/recently committed and blocked inventory; MACC and SQL opportunity views.
2. **ACR & Insights**: account/pillar results, current-quarter/full-year views,
   recurring baselines, gaps, projected-business-outcome fields, and recovery priorities.
3. **Consumption & Growth**: SL4 consumption, average daily ACR and projected landing,
   service movers/new services/new subscriptions, strategic pillars, Arc/SQL reclassification.
4. **U2C Progress**: starting uncommitted inventory, total/in-quarter/shifted-out
   conversion, dollar and milestone-count conversion percentages.

The hardened collector does **not** provide Fabric SL4/service/subscription data,
U2C historical baselines, comment-update timestamps, region readiness, SQL
reclassification, or certified projected-business-outcome credit. Current committed
milestones cannot establish historical conversion. These fields must be explicitly
unavailable unless supplied by a separately validated source. Gross consumption,
nominal opportunity dollars, and monthly run-rate must not masquerade as earnings.

## Architecture and implementation decisions

### Shared contract and harness

- Add an additive, independently versioned `sellerDashboardContractVersion = '1.0'`
  contract in a **browser-safe** common module importing only Zod.
- Validate the collector's `schemaVersion: 1` model, including nested fields,
  finite values, USD units, unique record IDs, account attribution, periods, bucket
  weights/mappings, and calculated gaps. Never forward tokens, config, raw sources,
  or Python diagnostic output.
- Optional typed consumption and conversion supplements carry their own source
  timestamps, period, account attribution, and data-quality constraints.
- Use one `SharedSellerDashboardHost` with identical `get` and `refresh` requests
  on Electron IPC, authenticated/no-store HTTP, and the strict webview bridge.
  This is an additive read-only capability, not a per-UI orchestrator fork.
- Sample mode uses one canonical, fictitious snapshot shared by all surfaces.
  The sample is explicitly labelled and never used as a live fallback.

### Live integration and privacy

- Reuse the existing collector instead of reproducing MINT APIs, Dataverse scope,
  cryptography, or credential handling in a new UI.
- The Windows adapter requires explicitly configured trusted skill root, profile,
  and owner email. The current authenticated identity must match the configured
  owner before any private read or refresh.
- Read the encrypted state through the collector's own loader, passing only the
  normalized dashboard/supplement and public run status over the private process
  pipe. No source payloads are persisted in this repository, logs, browser storage,
  downloads, or telemetry.
- `get` reads a snapshot without network/sign-in. **Reload dashboard** does not
  mean refresh source data. **Refresh live sources** requires confirmation and
  explains possible corporate sign-in; the collector performs the transaction.
- A failed refresh returns the previous report as visibly stale, not current.
  Read/validation failures produce explicit errors; the UI labels retained data stale.
- Multi-user Easy Auth must never read a server user's DPAPI earnings profile.
  The local adapter is deliberately unavailable there. Local loopback Web,
  Desktop, and local VS Code can use the Windows adapter. Other live providers
  may implement the same contract without changing the UI.
- No automation, sharing/export, new CRM write, or account-scope expansion is added.

### UI boundaries and presentation

- New focused shared components own dashboard state; top-level App changes are
  limited to navigation and mounting.
- Desktop/Web get a labelled Seller Dashboard navigation entry and mobile access;
  VS Code gets a fourth top-level tab.
- All four sections use the same filters, accessible tabs, paginated/sortable
  record tables, source-quality badges, empty/unknown states, and methodology.
- Existing Fluent/VS Code theme tokens are mapped into the feature stylesheet.
  No global theme replacement or artifact scaffolding is needed.
- Official headline and bucket cards stay invariant under working-view filters.
  The quarter selector filters inventory dates; it does not rewrite MINT's
  reporting interval or prorate source financial amounts.
- Earnings gaps aggregate signed account values before clamping and retain unknowns.
  Opportunity value, monthly usage, and hypothetical period credit are displayed
  separately, with explicit units.
- The scenario is off by default, supports only known compatible metrics,
  excludes unknown commitment/status/currency/date/mapping, and never changes official cards.
- Missing live supplemental data has an actionable source-unavailable panel, not
  an empty table suggesting zero activity.

## Delivery sequence

1. **Analysis/plan**: source inventory, reference-section mapping, boundaries, risks,
   exact acceptance criteria, and initial source-suite evidence (this document).
2. **Contracts/data**: strict report/supplement/envelope schemas; one sanitized fixture;
   contract tests for supported/unsupported/unknown data.
3. **Connector/harness**: identity-checked protected-profile reader and explicit
   refresh; shared versioned host; connector/operation/retention tests.
4. **Transport wiring**: same host operation over IPC/HTTP/webview; preserve sender,
   origin, auth, validation, privacy, and sample/live separation; parity tests.
5. **UI**: focused shared pane, summary/cards, four tabs, filters, analysis helpers,
   table interactions, explicit unknowns, optional scenario, and responsive theming.
6. **Validation**: targeted Vitest/typecheck/lint; touched-surface builds; dashboard
   Playwright journeys on Web, Electron, and the compiled VS Code webview; repository
   phase-zero/major gates where practical; distinguish existing failures.
7. **Proof/documentation**: after passing the UI checks, capture synthetic-only
   section, mobile, theme, and surface screenshots into the originally specified
   `MCAP-Seller-Performance-Dashboard` folder; document results and live prerequisites.
   Leave implementation changes uncommitted.

## Acceptance criteria

- Seller Dashboard is independent and reachable on all three surfaces; navigation
  back to existing panes still works.
- Offline/sample mode renders four populated report sections with clearly synthetic data.
- Configured local live mode reads the actual protected collector output and uses the
  same validated UI, with no sample substitution.
- Unsupported/unconfigured/identity-mismatched sources fail explicitly before private reads.
- Official source-reported attainment, negative actuals, zero targets, unknowns,
  net-clamped account gaps, and period boundaries are preserved.
- Unknown/partial inventory is never labelled "no pipeline"; won nominal value is
  excluded from open inventory; unknown mapping is not certified coverage.
- Quarter/account/bucket/metric/state/search filters, table sorting/pagination,
  accessible section navigation, and scenario opt-in work and are tested.
- Historical U2C and consumption require actual source evidence; no live invented projections.
- Failed reload/refresh retains the last valid displayed data with a stale/error warning.
- No private reference content is copied to code, fixtures, logs, or proof screenshots.
- Validated screenshots exist in the user's specified source folder.

## Verification results

### Implemented files and integration

| Layer | Files |
| --- | --- |
| Contracts | [seller-dashboard.ts](../packages/common/contracts/seller-dashboard.ts), exported from common contracts; strict independently versioned request/response/report/supplement schemas. |
| Canonical sample | [seller-dashboard.ts](../packages/common/fixtures/seller-dashboard.ts); fictitious accounts, signed/missing actuals, multiple buckets, pipeline queues, consumption and historical U2C evidence. |
| Connector | [seller-dashboard.ts](../packages/connectors/common/seller-dashboard.ts); explicit trusted configuration, owner matching, protected loader, public-only errors, stale-period checks, confirmed-date matching, and Windows kill-on-close job isolation for collector descendants. |
| Shared harness | [seller-dashboard.ts](../packages/orchestrator/seller-dashboard.ts); identical validated get/confirmed-refresh operations and deliberate hosted-profile denial. |
| Shared presentation | [pane](../apps/shared/seller-dashboard.tsx), [sections](../apps/shared/seller-dashboard-sections.tsx), [analysis](../apps/shared/seller-dashboard-analysis.ts), [table](../apps/shared/seller-dashboard-table.tsx), [styles](../apps/shared/seller-dashboard.css). |
| Desktop/Web navigation | Focused mounting in the shared renderer, chart navigation entry, mobile command entry and return navigation; existing pane state is not repurposed. |
| Desktop transport | [IPC adapter](../apps/desktop/electron/main/seller-dashboard-ipc.ts), main composition and trusted-sender registration, preload/client method. |
| Web transport | Authenticated same-origin/no-store API and local/sample composition; Easy Auth explicitly denies a server-user financial profile. |
| VS Code transport/UI | Provider composition, strict message/host routing, schema-validated browser client, fourth header tab, and shared pane mounting. |
| Documentation | This source analysis/plan, [user setup guide](user-guide/SELLER-DASHBOARD.md), README, user-guide navigation and folder-structure updates. |
| Tests | [contract](../tests/contract/seller-dashboard.test.ts), [analysis/static render](../tests/unit/shared/seller-dashboard.test.ts), [connector/lifecycle](../tests/unit/connectors/seller-dashboard.test.ts), [harness](../tests/unit/orchestrator/seller-dashboard.test.ts), [transport parity](../tests/unit/hosts/seller-dashboard-transport-parity.test.ts), [three-surface interaction/proof](../tests/e2e/revamp/seller-dashboard.spec.ts), and existing header test. |

No agent prompts, golden scenarios, existing CRM operations, MCP allowlists,
authentication defaults, automation, or Git integration were changed.
The builds also regenerate the repository's tracked Desktop host/preload bundles
and TypeScript build metadata.

### Executed validation

| Command / check | Actual result |
| --- | --- |
| Source `python -B -m unittest discover ... -p "test_*.py"` | 86 source-package synthetic tests passed; input files were read-only. |
| Targeted Vitest contracts/UI/connector/harness/transport/client tests | 41 tests passed in the initial integration pass; further boundary/lifecycle cases were added and passed in the final gates. |
| `npm run typecheck` and targeted ESLint | Passed. |
| `npm run desktop:build` | Passed; main, preload, legacy renderer and shared revamp renderer built. |
| `npm run ext:build` | Passed; actual host and browser-only webview bundles built. |
| `npm run web:build` | Passed; shared renderer and HTTP host built. Final host-only rebuild also passed. |
| `npm run validate:major` | Passed: 110 Vitest files, 618 tests and 5 skips, plus the existing secure Desktop Playwright smoke. The two Windows-specific collector lifecycle checks are opt-in in this default gate. |
| `npm run test:smoke:revamp` | **52 Playwright tests passed**, including all existing revamp/voice/discovery/portfolio/workflow journeys and the new three-surface dashboard journeys. |
| `$env:TLC_RUN_SELLER_COLLECTOR_SMOKE='1'; npm run phase0:check` | Final gate passed: structure/preflight/lint/typecheck plus **620 tests passed, 3 skipped, 110 files**. Windows normal-completion and parent-timeout descendant cleanup were actually exercised against synthetic processes. |
| Dashboard Playwright proof rerun | All three journeys passed after capturing the final images. Checks include keyboard tabs, filters, sorting, complete totals under pagination, unchanged official attainment, scenario approval, failed reload retention, missing live supplements, dark theme and mobile overflow. |
| Actual local Web HTTP host | Health ready; authenticated sample API returned the strict five-account snapshot with 78% synthetic weighted attainment. Browser rendered the API result with no page errors and captured the HTTP proof image. |
| Proof verification | All nine PNG signatures, nonzero dimensions and SHA-256 hashes verified; images visually inspected. |
| `git diff --check` and checkout identity | Passed; the assigned linked-worktree branch and starting commit remain unchanged. Changes are uncommitted. |

#### Validation-environment limitations

The clean worktree initially had no usable dependencies. Locked `npm ci` failed
because the configured feed could not serve `@modelcontextprotocol/sdk@1.32.1`;
the public-registry retry failed TLS negotiation. No TLS checks were disabled and
no dependency manifest/lockfile was changed. Validation used a separate worktree
copy of already-installed third-party packages (not source changes or primary
workspace junctions). Workspace links point only to this assigned worktree.

The installed set has the same Vite 8.2.2, TypeScript 6.0.3, React 19.2.8, Zod 4.4.3,
Vitest 4.1.11 and Playwright 1.62.1, but MCP SDK **1.29.0** and Electron **43.4.0**
rather than locked 1.32.1/43.5.0. Exact locked-dependency reproduction remains a
feed/environment issue to resolve before release. The ignored non-secret
Foundry configuration was seeded from the repository example, as documented
for source builds; no actual developer secrets or live seller profile were copied.

Existing build warnings about Vite config-loader features, chunk size and the
legacy renderer's Node-backed imports are unchanged by this feature. The
repository preflight still reports pre-existing unverified MSX/SharePoint access;
all executed journeys used authorized synthetic/sample sources.

### Screenshot proof

The following files were written directly into the **original user-specified**
`MCAP-Seller-Performance-Dashboard` folder, not the worktree's source package.
All show synthetic data and actual application navigation.

| Filename | Dimensions | Evidence |
| --- | --- | --- |
| `Seller-Dashboard-Web-Pipeline.png` | 1440 x 2160 | Official headline, filters, four tabs, pipeline cards/insights and milestone queue. |
| `Seller-Dashboard-Web-Earnings.png` | 1440 x 2160 | Net bucket gaps, unknown account actuals, official reconciliation and recovery table. |
| `Seller-Dashboard-Web-Consumption.png` | 1440 x 2160 | Posted consumption/daily/projected units, pillar allocation and service movers. |
| `Seller-Dashboard-Web-U2C.png` | 1440 x 2160 | Historical cohort cards, conversion pace and account-level conversion table. |
| `Seller-Dashboard-Web-Mobile.png` | 420 x 2400 | Mobile command access, responsive cards/filters and dashboard return navigation. |
| `Seller-Dashboard-Web-Dark.png` | 1440 x 1400 | Feature content adapts to the existing dark Fluent theme. |
| `Seller-Dashboard-VSCode.png` | 1440 x 1800 | Compiled VS Code webview, fourth top-level tab, same shared dashboard and bridge behavior. |
| `Seller-Dashboard-Desktop.png` | 1400 x 1600 | Actual Electron renderer, trusted IPC data and selected chart navigation. |
| `Seller-Dashboard-Web-HTTP.png` | 1440 x 2160 | Actual local HTTP-hosted Web UI, not only the static preview client. |

To reproduce proof in a deliberately selected existing directory:

```powershell
$env:TLC_SELLER_DASHBOARD_PROOF_DIR = '<confirmed-existing-proof-directory>'
npm exec -- playwright test 'seller-dashboard\.spec\.ts$' --config playwright.revamp.config.ts --reporter=line
```

The test hook never copies the reference HTML's private contents. The extra
real-HTTP capture was taken only after verifying the actual sample API response.

### Remaining live-environment prerequisites

- No own-quota CSV, configured protected profile or approved seller identity was
  supplied for this task. **Actual seller MINT/Dataverse access was not exercised.**
  The connector is implemented and tested; local live setup follows the
  [user guide](user-guide/SELLER-DASHBOARD.md).
- Fabric consumption, U2C history, update/commitment timestamps and certified
  credit rules are not created by the supplied collector. Live fields remain
  explicitly unavailable until an approved source supplies validated evidence.
- Hosted multi-user financial-data integration requires an identity-scoped
  provider; the Windows server-user profile path intentionally remains denied.
- Synthetic validation and screenshots do not certify compensation accuracy for
  an unsupported plan or grant access to a real seller's environment.
