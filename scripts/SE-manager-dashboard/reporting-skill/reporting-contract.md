# Manager-Scoped Monthly ATU Report Contract

Schema version: `2.0`

## Purpose

This contract defines the required structure for colleague-generated monthly ATU-scoped pod summary reports and each colleague's consolidated person-monthly summary. It is designed so each colleague can independently generate self-describing JSON and HTML artifacts without writing shared manifests or shared config files.

The contract is owned at the selected manager's shared Pod Reports root so that manager can evolve reporting requirements over time.

## Manager Selection

Every published live contract must select exactly one manager:

```yaml
manager:
  manager_system_user_id: "<preferred stable systemuserid>"
  manager_alias: "<required fallback alias>"
  display_name: "<manager display name>"
```

`manager_system_user_id` is authoritative when present. `manager_alias` is the fallback selector and must be an exact alias, not a display-name fragment. At setup and before every run, resolve the selector against `AccountAssignmentsWithCustomerIds[ManagerSystemUserId]` or `AccountAssignmentsWithCustomerIds[ManagerAlias]`. The matching rows must resolve to exactly one distinct nonblank manager system user ID. A missing, unmatched, or ambiguous manager blocks the run; never guess or silently use another manager.

The placeholders above document the required shape. A live contract must contain real values.

## Global Principles

These apply to every visible part of the report (Executive Summary and HTML dashboard). Other sections reference them rather than restating them.

- **Business-facing.** The visible report reads as a business readout. Do not describe how the report was generated, how many items were read, which run was "better", or which source failed unless it changes business confidence, and do not use diagnostic labels (e.g. "MSX-heavy").
- **JSON holds the plumbing.** Source, coverage, and generation metadata live in the JSON only — never in visible dashboard copy.
- **No raw evidence.** Store durable summaries, source references, and confidence indicators only (see Privacy Rules).
- **Activity and milestone KPIs use explicit time scopes.** Accounts engaged and HoK activity require qualifying evidence within the reporting period. Milestone KPIs distinguish the current active snapshot, dated in-period commitment/completion events, and current-fiscal-year milestone inventory. Current-fiscal-year milestone inventory does not require reporting-period HoK or M365 activity.
- **Snapshot metrics disclose their date.** Current-state milestone metrics must include an `as_of_date`. They describe the state visible when the report is generated and must not be presented as a reconstructed historical month-end snapshot.
- **Account assignments gate the whole report.** Include MSX and M365 signals only for accounts where the reporter has a current `Primary` or `Backup` assignment for the reporting workload. Display `Backup` as **Secondary**. Milestone access-team presence, opportunity deal-team presence, or M365 activity alone does not make an account eligible.

## Valid Values

### ATUs

Allowed ATU values:

- `atu8`
- `atu9`
- `atu10`
- `atu17`
- `atu18`

### Pillars

Allowed pillar values:

- `data`
- `infra`
- `apps`
- `github`

### Multi-ATU and cross-ATU activity

Generate one report pair for every ATU containing either:

1. Qualifying reporter activity during the reporting period on an eligible Primary or Secondary account, or
2. Current-fiscal-year MSX milestone pipeline on an eligible Primary or Secondary account where the reporter is present on the milestone access team.

Each artifact belongs to exactly one ATU and includes only that ATU's activity and milestone pipeline inventory. The `atu_scope` object identifies the current ATU and the customers included in that slice.

Activity on Secondary accounts follows the existing reporting workflow and is additionally identified in the **Cross Collaboration** section. Signals for accounts where the reporter is neither Primary nor Secondary are excluded rather than treated as Cross Collaboration.

### Account Eligibility and Assignment Scope

Use `AccountAssignmentsWithCustomerIds` in semantic model `6df78dc8-768b-4fb7-b213-3ab6bfeb7c2f` as the authoritative source for manager membership, current account eligibility, assignment type, workload, and ATU.

Resolve the reporter's current account scope at the start of every run:

1. Resolve this contract's manager to one `ManagerSystemUserId`.
2. Resolve the reporter's `systemuserid` from their signed-in M365 email.
3. Query assignment rows where `ManagerSystemUserId` matches the resolved manager and `AssignedSystemUserId` matches the reporter.
4. Match `Workload` to the report pillar using the contract's allowed pillar values.
5. Treat `AssignmentType = "Primary"` as **Primary** ownership.
6. Treat `AssignmentType = "Backup"` as **Secondary** ownership in visible report copy.
7. If both Primary and Backup rows exist for the same account and workload, Primary takes precedence.
8. Derive the account's ATU from the matching assignment row.

An account is eligible only when a current assignment row matches the contract-selected manager, reporter, reporting workload, and one of the allowed assignment types:

- `Primary`
- `Backup` / Secondary

Apply this eligibility gate consistently before synthesizing any business section or metric:

- MSX opportunities, milestones, Monthly ACR, commitments, completions, risks, and pipeline
- MSX tasks and HoK activities
- M365 calendar, email, Teams, file, attachment, recap, action-item, and decision signals
- Executive Summary, Scorecard, Priority Initiatives, Customer Updates, Account Notes, Partners, themes, dependencies, next-month priorities, and dashboard sections

Signal resolution rules:

- Resolve MSX signals through `opportunity[customerid]` → `Accounts[DataverseAccountId]` → `AccountAssignmentsWithCustomerIds[DataverseAccountId]`, retaining only rows for the resolved `ManagerSystemUserId` and reporter `AssignedSystemUserId`.
- Resolve an MSX task through its engagement milestone and parent opportunity account before applying assignment eligibility.
- Resolve M365 evidence to an eligible assignment account using authoritative account identifiers where available. When only account-name context exists, match against the reporter's current eligible assignment list; do not infer an account from an opportunity-title fragment.
- Milestone access-team membership and opportunity deal-team membership are necessary ownership/context signals but are not substitutes for an eligible account assignment.

When no eligible assignment exists:

- Exclude the signal from all visible report content, customer counts, KPIs, pipeline totals, and ATU report-generation decisions.
- Do not classify the signal as Cross Collaboration.
- Record only a non-business-facing exclusion count and reason in the JSON `account_scope` metadata.

When the account or ATU cannot be resolved:

- Exclude the signal from visible report content and metrics.
- Record a mapping gap in JSON metadata.
- Do not guess the account or ATU.

Every report JSON must include:

```json
{
  "account_scope": {
    "assignment_source": "AccountAssignmentsWithCustomerIds",
    "manager_system_user_id": "<resolved manager systemuserid>",
    "manager_alias": "<resolved manager alias>",
    "eligible_assignment_types": ["Primary", "Backup"],
    "primary_accounts": [],
    "secondary_accounts": [],
    "excluded_signals_summary": [
      {
        "reason": "no_current_primary_or_backup_assignment",
        "count": 0
      }
    ],
    "mapping_gaps": []
  }
}
```

## Output Location

Final reports are written under the shared Pod Reports root, one JSON + HTML pair per ATU:

```text
Pod Reports\{atu}\{yyyy-mm}\{pillar}-{person_slug}.json
Pod Reports\{atu}\{yyyy-mm}\{pillar}-{person_slug}.html
```

Example:

```text
Pod Reports\atu17\2026-06\apps-jonathan-hernandez.json
Pod Reports\atu17\2026-06\apps-jonathan-hernandez.html
```

A multi-ATU colleague produces one pair per ATU (e.g. `atu17\2026-06\apps-kwame-lastname.*` and `atu10\2026-06\apps-kwame-lastname.*`). Local agent configuration does not belong in the shared folder.

### Consolidated Person-Monthly Output

After all eligible ATU report pairs for the run are complete, generate one consolidated person-monthly JSON + HTML pair:

```text
Pod Reports\persons\{person_slug}\{yyyy-mm}\person-summary.json
Pod Reports\persons\{person_slug}\{yyyy-mm}\person-summary.html
```

Example:

```text
Pod Reports\persons\jonathan-hernandez\2026-08\person-summary.json
Pod Reports\persons\jonathan-hernandez\2026-08\person-summary.html
```

Use the sortable `yyyy-mm` folder format. Do not use localized month-name folders or filenames such as `august2026`.

The person-monthly summary is owned by the same colleague reporting skill and has:

```json
{
  "artifact_type": "person_monthly_summary",
  "period": "2026-08",
  "owner": {
    "name": "Jonathan Hernandez",
    "alias": "jonathan-hernandez"
  },
  "atu_scope": {
    "type": "multi_atu",
    "included_atus": ["atu10", "atu17", "atu18"]
  },
  "included_pillars": ["apps"],
  "source_reports": [
    "atu10/2026-08/apps-jonathan-hernandez.json",
    "atu17/2026-08/apps-jonathan-hernandez.json",
    "atu18/2026-08/apps-jonathan-hernandez.json"
  ]
}
```

#### Person-Summary Generation Boundary

Build the person-monthly summary only from the colleague's completed ATU JSON artifacts from the same reporting run.

- Do not query, reread, reinterpret, or resynthesize raw MSX or M365 evidence for the person summary.
- Treat the ATU JSON artifacts as the canonical source facts.
- Do not include another colleague's report.
- Include all eligible Primary and Secondary activity represented by the source ATU reports.
- Preserve the originating ATU on every customer, initiative, milestone, dependency, collaboration item, and next action.
- Record every source ATU JSON path in `source_reports`.
- Do not create a person summary when no eligible ATU report was produced.

#### Person-Summary Deduplication

Consolidated metrics must be recomputed from the source report inventories rather than added blindly:

- Deduplicate accounts by resolved Dataverse account ID.
- Deduplicate milestones by `Milestone ID`.
- Deduplicate HoK activities by task/activity ID.
- Deduplicate opportunities by opportunity ID.
- Deduplicate initiatives or narrative items only when their source identifiers and business meaning are the same.
- Sum Monthly ACR only after milestone deduplication.
- Preserve separate ATU context when the same account legitimately appears in more than one ATU source artifact.

#### Person-Summary Status

- The person summary defaults to `draft`.
- It must not have a more final review status than any source ATU report.
- If any source report is draft, the person summary remains draft.
- Regenerating or replacing an approved/final person summary requires the same confirmation protections as an ATU report.

#### Person-Summary Content

The person summary uses the same KPI definitions, account-eligibility rules, business-facing principles, privacy rules, and reporter-owned Asks rules as the ATU reports.

Its HTML Primary view contains, in this order:

1. Consolidated KPI band across all source ATUs
2. Person-level Executive Summary
3. Priority Initiatives across ATUs
4. FY27 Milestone Inventory with an additional `ATU` column
5. Asks for Manager

The consolidated inventory table is:

| ATU | Account | Milestone | Category | Status | Commitment | Monthly ACR |
|---|---|---|---|---|---|---:|

Do not repeat KPI summaries around the inventory table. Follow the same sorting and current-state rules as the ATU inventory, grouping by ATU and then Account, with Monthly ACR descending within each account.

The person summary's single **See more** Secondary view contains:

- Customer Updates grouped by ATU
- Account Notes
- Partners
- Technical Win / Loss / Learning Themes
- Cross-Pillar Dependencies
- Cross Collaboration / Secondary contributions
- Next Month Priorities
- Leadership decisions
- Scrum rollup bullets
- Follow-up required

Do not add a 1:1 Talking Points section. Do not add, generate, or solicit a Personal Reflection section.

Asks for Manager appears once in the Primary view, using the contract-selected manager's display name in visible copy. It remains reporter-owned and must be copied from the reporter-authored asks captured during the run without rewriting, ranking, merging into invented asks, or inferring new content.

## Required Report Sections

Each report JSON must include the following sections, with artifact-specific metadata where noted.

### 1. Metadata

Required to make the file self-describing:

- `schema_version`
- `artifact_type`
- `report_id`
- `atu` — required for `person_pillar_report`; omitted for `person_monthly_summary`
- `atu_scope`
- `account_scope`
- `period`
- `report_period`
- `pillar` — required for `person_pillar_report`; omitted for `person_monthly_summary`
- `included_pillars` — required for `person_monthly_summary`
- `owner`
- `manager` — resolved manager name, alias, and system user ID; must match this contract's manager selector
- `status`
- `review`
- `schema_contract`
- `source_profile`
- `sources_requested`
- `sources_used`
- `sources_unavailable`
- `source_coverage`
- `companion_files`
- `generation`
- `source_reports` — required for `person_monthly_summary`

### 2. Executive Summary

Purpose: concise monthly readout for the contract-selected manager.

Required fields:

- `headline`
- `overall_status`
- `running_hot`
- `needs_attention`
- `next_month_focus`

Follow the **Global Principles** — business-facing, no generation detail, no raw evidence.

### 3. Scorecard

Purpose: a concise quantitative and qualitative summary of the colleague's ATU-scoped pod contribution for the reporting period.

Required metrics (one authoritative list):

- `accounts_engaged` — distinct accounts with qualifying M365 evidence or reporter-owned task activity during the reporting period. Do not use this metric as the milestone-pipeline account count.
- `active_milestones` — current active milestone snapshot plus the current-fiscal-year milestone total defined below.
- `milestone_pipeline_influenced` — displayed as **Monthly ACR represented**; report the period-snapshot Monthly ACR and current-fiscal-year milestone Monthly ACR defined below.
- `committed_milestones` — milestones whose `Committed On` date falls within the reporting period, with a current-fiscal-year-to-date secondary value.
- `owned_pipeline` — owned pipeline: POCs, pilots, and production milestones.
- `top_wins` — top wins this period.
- `top_risks_blockers` — top risks / blockers.
- `new_pipe_generation` — new MSX milestone pipeline generated / next-period pipe.
- `hok_activities` — completed Hands-on-Keyboard (HoK) High-Value Activities whose `task[actualend]` falls within the reporting period, with a current-fiscal-year-to-date secondary value and per-category breakdown where useful.

#### KPI Time Windows

The Microsoft fiscal year runs from July 1 through June 30. For a report:

- **Reporting period** means `report_period.start` through `report_period.end`, inclusive.
- **FYTD** means July 1 of the fiscal year containing the report period through `report_period.end`, inclusive.
- **Current snapshot** means the current state visible when the report is generated and is labeled with `as_of_date`.
- Distinct counts must be recomputed across the applicable population. Do not add monthly distinct counts together.
- A milestone included through more than one condition must be counted once by `Milestone ID`.

For every milestone KPI:

- The reporter must be present on the milestone access team (`PodMilestones[Pod Member ID]` matches the reporter's resolved `systemuserid`).
- The milestone's resolved account must pass the **Account Eligibility and Assignment Scope** gate.
- Exclude milestones whose current `Status` is `Cancelled` or `Hygiene/Duplicate`.
- Do not require an HoK task, meeting, email, or other reporting-period activity unless the individual metric explicitly requires it.

#### Accounts Engaged

`accounts_engaged` is a reporting-period activity metric.

Count a distinct account when at least one of these exists during the reporting period:

- Source-backed M365 customer activity or intent evidence.
- A reporter-owned task associated with the account or one of its engagement milestones.

The account must first pass the **Account Eligibility and Assignment Scope** gate. Use the task's actual activity date when available. Completed HoK tasks use `task[actualend]`. Calendar titles alone do not qualify as outcome evidence. Deduplicate accounts across M365 and task evidence.

The KPI displays only the reporting-period account count. It has no FYTD secondary value.

#### Active Milestones

`active_milestones` has two populations:

1. **Current active snapshot** — distinct milestones whose current `Status` is `On Track`, `At Risk`, or `Blocked`.
2. **FYTD milestone total** — distinct milestones whose `Milestone Date` falls within the fiscal year containing the report period, excluding only `Cancelled` and `Hygiene/Duplicate`. This population includes completed milestones and other valid fiscal-year milestone outcomes.

The JSON representation should preserve:

- current-snapshot `milestone_count`, `account_count`, `monthly_acr`, `status_breakdown`, and `as_of_date`
- FYTD `milestone_count`, `account_count`, `monthly_acr`, and fiscal-year boundaries
- the milestone-level inventory needed by the HTML dashboard and downstream rollups

#### Monthly ACR Represented

`milestone_pipeline_influenced` is displayed as **Monthly ACR represented**. "Monthly" describes the milestone's Monthly ACR rate, not a monthly revenue-recognition measure.

The primary reporting-period value is the sum of `Monthly ACR` across the deduplicated union of:

1. Milestones in the current active snapshot.
2. Milestones whose `Completed On` date falls within the reporting period.
3. Milestones whose `Committed On` date falls within the reporting period.

The FYTD secondary value is the sum of `Monthly ACR` across the FYTD milestone-total population defined under **Active Milestones**.

Deduplicate by `Milestone ID` before summing. Missing Monthly ACR contributes no amount and must not be imputed.

#### Committed Milestones

`committed_milestones` is an event-date metric sourced from `PodMilestones[Committed On]`.

- **Reporting-period value** — distinct milestones whose `Committed On` falls within the reporting period.
- **FYTD value** — distinct milestones whose `Committed On` falls within FYTD.

Report the distinct milestone count and, where useful, the associated distinct account count and total Monthly ACR. Do not infer commitment timing from the current `Commitment Recommendation` value when `Committed On` is blank.

#### High-Value Activity (HoK) Categories

`hok_activities` is sourced from the configured shared MSX semantic model — no separate configuration is required. A colleague's HoK activities are the **completed tasks they own** (`task[ownerid]` → their `systemuser`, `task[statecode] = 1`) whose regarding milestone resolves through the loaded `PodMilestones`/opportunity/account path to an eligible Primary or Secondary assignment under the contract-selected manager, and that have an `msp_taskcategory` in the High-Value Activity categories below.

Use `task[actualend]` as the authoritative completion date:

- **Reporting-period value** — distinct qualifying tasks whose `actualend` falls within the reporting period.
- **FYTD value** — distinct qualifying tasks whose `actualend` falls within FYTD.

Exclude a task when `actualend` is blank; do not substitute `scheduledend` for a completion date. Report the total and, where useful, the per-category breakdown; the friendly category name is available directly from the model as `msp_taskcategoryname`.

| High-Value Activity (HoK) category | `msp_taskcategory` code |
|---|---|
| PoC/Pilot | `861980005` |
| Architecture Design Session | `861980004` |
| Workshop | `861980001` |
| Demo | `861980002` |
| Consumption Plan | `861980007` |
| Blocker Escalation | `861980006` |
| Technical Close/Win Plan | `606820005` |

Tasks with no `msp_taskcategory` (untagged) are excluded by design — the codes above are the authoritative filter set.

### 4. Priority Initiatives

Purpose: capture the main territory/customer initiatives for the month.

Each initiative should include:

- `sales_territory_name`
- `customer`
- `big_bet_opportunity`
- `customer_need_business_outcome`
- `plan`
- `fy26_acr_year`
- `obstacles_help_needed`
- `confidence_level`
- `next_steps`
- `known_amounts`
- `ownership`
- `source_refs`

### 5. Customer Updates

Purpose: provide a detailed, filterable customer-by-customer section for the human dashboard and downstream rollups.

This section is required. Each customer update should include:

- `customer`
- `ownership`
- `status`
- `summary`
- `impact`
- `msx`
- `m365`
- `next_actions`
- `source_refs`
- `confidence`

`status` is one of: `running_hot`, `with_blocker`, `advisory`, `watchlist`. The dashboard's customer-update filters are **All** plus these four statuses.

`ownership` is `Primary` or `Secondary`. Do not create a customer update for an account outside the reporter's eligible account scope.

Card rendering (required behaviors, not styling):

- **Glance-first.** Show customer, ownership, status, summary, and impact up front; put longer detail (e.g. next actions) behind collapsible, keyboard-accessible controls (native `<details>` / `<summary>`), not open by default.
- **MSX vs M365 must be visually distinguishable** (labels or accents) so pipeline facts read separately from activity/intent context, and shown as compact rows.
- **Status is colour-indexed consistently:** `running_hot` = urgent, `with_blocker` = warning, `advisory` = positive, `watchlist` = neutral.

Each customer card should clearly separate:

- **MSX signals**: opportunities, ACR, milestones, stages, deal-team ownership, watchlist amounts, and pipeline facts.
- **M365 signals**: customer intent, meeting recap findings, action items, blockers, follow-up notes, decisions, and context from files/attachments.
- **Next actions**: concrete follow-up steps for the colleague or the contract-selected manager.

Example shape (structure only — placeholders, not sample data):

```json
{
  "customer": "<account name>",
  "ownership": "<your role / what you own on this account>",
  "status": "running_hot | with_blocker | advisory | watchlist",
  "summary": "<what's happening, 1-3 sentences>",
  "impact": "<why it matters to the business>",
  "msx":  [ { "label": "<signal>", "text": "<pipeline fact>", "amount": "<optional>" } ],
  "m365": [ { "label": "<signal>", "text": "<activity / intent / blocker>" } ],
  "next_actions": [ "<concrete follow-up>" ],
  "source_refs": [ "<source reference, not raw evidence>" ],
  "confidence": "high | medium | low"
}
```

### 6. Account Notes

Purpose: capture dated account activity, relationship momentum, source-backed notes, or scale motions.

Examples:

- Fairview/RSM architecture syncs
- OSF Document Intelligence follow-up
- BJC PoC retrospective
- Integris Foundry introduction
- DaVita Foundry access blocker

### 7. Partners

Purpose: identify partner/SI involvement.

Fields:

- `partner`
- `customer`
- `engagement_strategy`
- `solution_play`
- `source_refs`

### 8. Technical Win / Loss / Learning Themes

Purpose: capture reusable learning from the month.

Theme types:

- `win`
- `loss`
- `learning`
- `pattern`
- `risk`

Examples:

- Private networking is a recurring production blocker.
- Infrastructure-as-code is required to move PoCs into production reliably.
- Claude-on-Foundry PHI scenarios require a separate customer-to-Anthropic BAA.
- Agent explainability is emerging as a customer requirement beyond observability.

### 9. Cross-Pillar Dependencies

Purpose: make the report useful for pod-level collaboration within the current ATU scope.

Allowed dependency pillars:

- `data`
- `infra`
- `apps`
- `github`

Examples:

- Infra: private endpoint, DNS, ExpressRoute, network peering.
- Data: Fabric, RCM data, in-house data mining, Epic/FHIR.
- Apps: Teams integration, APIM gateway, bot service, Foundry agent architecture.
- GitHub: GitHub Enterprise, GitHub Copilot enablement, repository/IaC patterns.

### 10. Cross Collaboration

Purpose: highlight effort the reporter contributed on accounts where they hold a current Backup assignment, displayed as **Secondary**.

Use `AccountAssignmentsWithCustomerIds` as the authoritative source for manager membership, account assignments, and account-to-ATU mapping. Filter by the resolved `ManagerSystemUserId` and reporter `AssignedSystemUserId` before classifying ownership.

An activity is Cross Collaboration when:

- The reporter has qualifying activity associated with the account during the reporting period.
- The account and ATU can be resolved.
- The reporter has a matching current assignment row for the reporting workload.
- `AssignmentType = "Backup"`.

Only Backup/Secondary assignments qualify as Cross Collaboration. An account where the reporter has no current Primary or Backup assignment is out of scope and must be excluded from the report.

Cross Collaboration activity remains included in all existing applicable report sections. This section provides additional collaboration context and does not replace or remove the activity elsewhere.

The JSON section is required in every ATU report. Use an empty `items` array when no Cross Collaboration occurred.

Required structure:

```json
{
  "cross_collaboration": {
    "summary": {
      "account_count": 0,
      "milestone_count": 0,
      "hok_count": 0
    },
    "items": [
      {
        "atu": "atu8",
        "account": "<account name>",
        "ownership": "Secondary",
        "milestone": "<MSX milestone name>",
        "support_description": "<brief evidence-grounded description>",
        "hok_count": 0
      }
    ]
  }
}
```

Field definitions:

- `atu` — the ATU containing the account and activity.
- `account` — the customer account name.
- `ownership` — always `Secondary` for Cross Collaboration items.
- `milestone` — the associated MSX milestone.
- `support_description` — a brief evidence-grounded description of the reporter's contribution.
- `hok_count` — the reporter's HoK activities associated with this account and milestone, calculated using the existing **High-Value Activity (HoK) Categories** and reporting-period rules.

Create one item per account and milestone combination. Do not infer support details or HoK activity without supporting evidence.

### 11. Asks for Manager

Purpose: highlight where the contract-selected manager can help. Render the manager's contract-defined display name in the section heading.

Fields:

- `ask`
- `why_it_matters`
- `customer`
- `urgency`
- `source_refs`

### 12. Next Month Priorities

Purpose: identify the colleague's next-month focus.

Fields:

- `priority`
- `expected_outcome`
- `customer`
- `source_refs`

### 13. Dashboard Sections

Purpose: provide a clean human-readable HTML dashboard shape.

Required dashboard fields:

- `kpis`
- `customer_update_filters`
- `running_hot`
- `leadership_decisions`
- `customer_updates`
- `cross_collaboration`
- `scrum_rollup_bullets`
- `follow_up_required`

#### Primary and Secondary Views

The HTML dashboard uses progressive disclosure within one self-contained document. It does not create separate pages, files, or tabs for primary and secondary content.

The **Primary view** is visible by default and renders these sections in order:

1. KPI band
2. Executive Summary
3. Priority Initiatives
4. FY27 Milestone Inventory
5. Asks for Manager

The KPI band is the only visible quantitative summary of milestone counts, Monthly ACR, commitments, and HoK. Do not repeat KPI cards, totals, summary panels, category totals, or period/FYTD comparisons in the FY27 Milestone Inventory section.

The **FY27 Milestone Inventory** section displays only the full eligible milestone-level inventory required by the Scorecard, using this business table:

| Account | Milestone | Category | Status | Commitment | Monthly ACR |
|---|---|---|---|---|---:|

Inventory rendering rules:

- Render only milestones that pass the **Account Eligibility and Assignment Scope** gate.
- Include milestones in the contract-defined FY27 milestone-total population.
- Use the current milestone `Status` and `Commitment Recommendation` values; do not substitute an earlier snapshot value.
- Exclude `Cancelled` and `Hygiene/Duplicate`.
- Sort by Account ascending, then Monthly ACR descending within each account.
- Use compact, consistently styled Status and Commitment indicators.
- Do not display a total row or repeat KPI totals.
- Display only a short context caption: `Current milestone status as of <as_of_date>`.
- When the inventory is empty, display: `No eligible FY27 milestone pipeline.`

The **Secondary view** contains all remaining required dashboard content:

- Customer Updates
- Account Notes
- Partners
- Technical Win / Loss / Learning Themes
- Cross-Pillar Dependencies
- Cross Collaboration
- Next Month Priorities
- Leadership decisions
- Scrum rollup bullets
- Follow-up required

Place the entire Secondary view behind one native, keyboard-accessible disclosure:

```html
<details class="secondary-view">
  <summary>See more</summary>
  <!-- remaining required report sections -->
</details>
```

Secondary-view requirements:

- The disclosure is collapsed by default.
- All secondary content is present in the HTML document and available without another file, network request, or lazy-loading step.
- Expanding or collapsing the disclosure changes presentation only and must not alter, rederive, or omit report data.
- Customer-card `<details>` controls may remain nested inside the Secondary view.
- The report must remain fully usable without JavaScript. JavaScript may enhance the disclosure label or behavior but must not be required to access content.
- Print and export styles must render all Secondary-view content expanded, regardless of its interactive state on screen.
- The HTML renders directly from the canonical JSON. Moving a section between Primary and Secondary views does not change its JSON structure or ownership rules.

**Asks for Manager remains reporter-owned.** Its placement in the Primary view does not permit the agent to generate, infer, rank, rewrite, or pre-fill asks. When no ask was provided, show the contract-defined neutral empty state in the Primary view.

The `kpis` band contains exactly five top-line tiles in this order:

| KPI key | Display label | Primary value | Secondary display |
|---|---|---|---|
| `accounts_engaged` | Accounts engaged | Reporting-period distinct account count | `This period`; no FYTD value |
| `active_milestones` | Active milestones | Current active-snapshot milestone count | `FY<YY> total: <count>` |
| `milestone_pipeline_influenced` | Monthly ACR represented | Reporting-period snapshot/event union Monthly ACR | `FY<YY> milestone ACR: <amount>` |
| `committed_milestones` | Milestones committed | Reporting-period committed milestone count | `FY<YY> YTD: <count>` |
| `hok_activities` | HoK activities | Reporting-period completed HoK count | `FY<YY> YTD: <count>` |

Tile requirements:

- Show the display label, primary value, and secondary display text defined above.
- Keep secondary text visually subordinate to the primary value.
- Format currency consistently and compactly.
- Snapshot-backed tiles must make `as_of_date` available in the dashboard context, such as a KPI-band caption or accessible description.
- Do not show a duplicate FYTD value for Accounts engaged.
- Missing or unavailable values display as `Unavailable`, not `0`.
- Render these values directly from the canonical JSON; do not rederive them in HTML.

The Cross Collaboration dashboard section displays:

| ATU | Account | Milestone | Support Provided | HoK Count |
|---|---|---|---|---:|

When no qualifying activity exists, display: `No Cross Collaboration activity this period.`

Follow the **Global Principles** — the dashboard is business-facing, carries no report-generation commentary, and keeps source/generation metadata in the JSON. The `customer_update_filters` values are defined in **Customer Updates** (All plus the four statuses).

## Source Roles

| Source | Role |
|---|---|
| MSX | Pipeline, milestone, HoK, account-assignment, and account-to-ATU truth |
| M365 calendar | Activity index; do not treat title alone as outcome evidence |
| M365 email recaps | What happened, customer intent, action items, blockers |
| M365 Teams/chats | Discussion context and decisions where available |
| M365 files/attachments | Supporting decks, notes, collateral, briefings |
| Wiki/KB | Optional memory/context if colleague configured one |

All source roles are subordinate to the **Account Eligibility and Assignment Scope** gate. Evidence from an in-scope source is still excluded when its account is not currently assigned to the reporter as Primary or Backup for the reporting workload.

## Privacy Rules

- Do not retain raw email bodies by default.
- Do not retain raw Teams messages by default.
- Do not retain raw calendar dumps by default.
- Do not retain raw MSX payloads by default.
- Do not include HR, compensation, or legal content.
- Store durable summaries, source references, and confidence indicators only.

## Validation Rules

A report is valid only if:

1. `schema_version` matches a supported contract version.
2. `artifact_type` is `person_pillar_report` or `person_monthly_summary`.
3. `manager.system_user_id` and `manager.alias` match the uniquely resolved manager selected by this live contract.
4. A `person_pillar_report` has an `atu` from the allowed ATU list and `atu_scope.type = "single_atu"`.
5. A `person_monthly_summary` has no single `atu`, has `atu_scope.type = "multi_atu"`, and contains only allowed values in `atu_scope.included_atus`.
6. `pillar` or every value in `included_pillars` is one of the allowed pillars.
7. `period` matches the folder period.
8. The file includes required business sections.
9. The visible HTML dashboard follows the **Global Principles** (business-facing; no raw evidence or generation diagnostics).
10. Every ATU containing eligible qualifying activity or eligible current-fiscal-year milestone pipeline has its own report pair.
11. Every report includes the `cross_collaboration` JSON section.
12. Cross Collaboration items in an ATU report belong to the same ATU as the report artifact; person-summary items preserve their source ATU.
13. Every report includes `account_scope` metadata derived from current `AccountAssignmentsWithCustomerIds` rows matching the contract-selected manager, reporter, and reporting workload.
14. Every visible MSX and M365 signal resolves to an account where the reporter is currently Primary or Backup.
15. Primary takes precedence when both Primary and Backup assignments exist for the same account and workload.
16. Backup assignments are displayed as Secondary and are the only accounts eligible for Cross Collaboration.
17. Signals from accounts with no current Primary or Backup assignment are excluded from all visible sections, KPIs, pipeline totals, customer counts, and ATU report-generation decisions.
18. Unresolved account or ATU signals are excluded from visible content and recorded as mapping gaps in JSON metadata.
19. The KPI band contains the five required KPI tiles in the specified order, with matching labels and primary/secondary scopes.
20. `active_milestones` reports both the current active snapshot and FYTD milestone total using the contract-defined populations.
21. `milestone_pipeline_influenced` deduplicates the current active snapshot, reporting-period completions, and reporting-period commitments before summing Monthly ACR.
22. `committed_milestones` uses `Committed On` for period and FYTD attribution and does not infer timing from current commitment state.
23. `hok_activities` includes only completed qualifying tasks, uses `task[actualend]` for reporting-period and FYTD attribution, and resolves each task to an eligible account.
24. Milestone metrics exclude current `Cancelled` and `Hygiene/Duplicate` rows.
25. Snapshot metrics include `as_of_date` and do not claim to reconstruct an earlier historical snapshot.
26. HTML KPI values and labels exactly match the canonical JSON.
27. The HTML Primary view contains the KPI band, Executive Summary, Priority Initiatives, FY27 Milestone Inventory, and Asks for Manager in the specified order.
28. The FY27 Milestone Inventory includes only the full eligible milestone-level table with the required columns, context caption, sorting, and empty state.
29. The FY27 Milestone Inventory does not repeat KPI totals, summary cards, commitment summaries, HoK summaries, owned-pipeline totals, or period/FYTD comparisons.
30. All remaining dashboard sections appear inside one collapsed native `<details>` disclosure whose summary label is `See more`.
31. Secondary content is present in the same HTML document, remains accessible without JavaScript, and is expanded for print/export.
32. Asks for Manager remains reporter-owned even though it is displayed in the Primary view.
33. A `person_monthly_summary` is generated only from same-run source ATU JSON artifacts and records them in `source_reports`.
34. Person-summary accounts, milestones, opportunities, HoK activities, and Monthly ACR are deduplicated using the contract-defined identifiers before aggregation.
35. Every person-summary customer, initiative, milestone, dependency, collaboration item, and next action preserves its originating ATU.
36. A person summary is not more final than any source ATU report.
37. The person-summary Primary view uses the consolidated inventory table with the additional `ATU` column and contains no repeated KPI summaries.
38. The person summary does not contain 1:1 Talking Points or Personal Reflection sections.

## Ownership Boundary

The colleague reporting skill writes:

- its own ATU-scoped `{pillar}-{person_slug}.json` and `.html` pairs
- its own consolidated `persons\{person_slug}\{yyyy-mm}\person-summary.json` and `.html` pair

The selected manager's separate rollup skill owns:

- discovery of colleague reports
- approved/draft filtering
- MBR summaries
- ATU summaries
- ATU-level rollups
- cross-person summaries
- audience-specific adapters
