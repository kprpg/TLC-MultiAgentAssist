---
name: yemi-pod-report-skill
description: |
  Generate lightweight ATU-scoped pod summary reports for Yemi's direct colleagues using configured
  source connectors such as Microsoft 365, MSX, the FY26 Territory Alignment model, and optional wiki/KB sources. Produces self-describing
  JSON + HTML report artifacts covering customer updates, MSX pipeline signals, M365 activity, blockers,
  and asks.
  Use when asked to "produce my pod report", "run my pod report", "generate my monthly pod report",
  "create my report for Yemi", "run yemi pod report", "pod report for [month]",
  "generate my [pillar] pod report", or "my monthly pod summary".
  Supports /yemi-pod-report-skill setup | run | check-access | show-config | edit-config modes.
  Do NOT use for general customer summaries, daily briefings, win-wire matching, or inbox digests.
cowork:
  category: automation
  icon: DocumentDataLink
---

# Yemi Pod Report Skill

## Purpose

This skill helps Yemi's direct colleagues generate ATU-scoped pod summary artifacts with minimal manual effort.

The skill retrieves relevant evidence from configured sources, synthesizes the reporting period, and produces clean person/pillar report artifacts that can be reviewed by the colleague and later rolled up by Yemi or another agent.

This is **not** a general knowledgebase or wiki-maintenance workflow. It is a task-specific pod summary workflow.

## When NOT to Use

- Daily customer summaries or pipeline reviews → use daily-briefing or other tools
- Win wire matching or opportunity research → use dedicated win-wire or D365 skills
- Inbox digests or ad-hoc meeting summaries → use daily-briefing or meeting-intel
- Any report that is not an ATU-scoped pod summary for Yemi's pod structure

This skill is purpose-built for the monthly pod reporting cadence. Its output files (`{pillar}-{person}.json/html`) live in their own folder structure and do not overlap with any other productivity skill.

## Core Principles

1. **No colleague-maintained input folder required.** The skill should retrieve evidence from configured systems for the reporting period.
2. **No shared mutable manifest.** Each report JSON is self-describing; multiple colleagues should not write to the same index file.
3. **MSX is pipeline truth.** Use MSX for opportunities, milestones, pipeline, close dates, amounts, stages, and deal-team ownership.
4. **M365 is activity and intent truth.** Use M365 meeting recaps, follow-ups, notes, emails, Teams/chats where available, and files to understand what actually happened, what customers care about, and what actions were created.
5. **Wiki/KB is optional.** Colleagues do not need to maintain a wiki. If a colleague has a configured wiki/KB, the skill can use it as an additional source.
6. **HTML is for humans; JSON is for agents.** The JSON file is the canonical durable artifact. The HTML dashboard renders the JSON for review and consumption.
7. **Raw evidence is not retained by default.** The monthly report folder should remain a clean publish surface, not an evidence archive.
8. **Configuration is local.** Each colleague's setup/config file is for their local agent harness and should not be written to the shared Pod Reports folder.
9. **Shared output only contains report artifacts.** The shared Pod Reports location should contain JSON/HTML report artifacts and shared schema/configuration contracts, not each colleague's private source configuration.
10. **Territory Alignment is account and ATU truth.** Use the FY26 Territory Alignment Power BI model to discover which accounts a colleague owns and which ATU each belongs to, keyed on the colleague's username and pillar. MSX has no ATU field; this model supplies it. Colleagues do not hand-curate an account list. See **Account & ATU Mapping**.

## Skill Modes

The skill has two primary modes and supporting utility modes.

```text
/yemi-pod-report-skill setup
/yemi-pod-report-skill run
/yemi-pod-report-skill check-access
/yemi-pod-report-skill show-config
/yemi-pod-report-skill edit-config
```

### Setup Mode

Setup mode creates or updates the colleague's reporting configuration. It does **not** generate a report.

Setup mode should guide the colleague through:

1. Identity and ownership.
2. Auto-derived profile — pillar, ATUs, and accounts derived from the Territory Alignment model by username, presented to confirm or edit.
3. Report output location.
4. Source defaults.
5. Source access verification.
6. Optional wiki/KB configuration.
7. Privacy and retention preferences.
8. Draft-first review preferences.
9. Shared schema contract version to use.

The setup experience should be conversational and confirm defaults before writing configuration.

Before asking setup questions, the skill must retrieve the shared Pod Reports contract from SharePoint:

```text
https://microsoft.sharepoint.com/teams/yemiSdirects/Shared Documents/General/Pod Reports/_schema/reporting-contract.md
```

`reporting-contract.md` is the single source of truth — Yemi's editable requirements document for what the pod report must collect and present (allowed ATUs, allowed pillars, required metadata, report content shape, and the Validation Rules). Setup and run mode must use the SharePoint version, not a local `_schema` folder; a local copy may only be a temporary cache of the file just downloaded during the current run. Treat it as the active requirements before every setup or run.

SharePoint folder view:

```text
https://microsoft.sharepoint.com/:f:/r/teams/yemiSdirects/Shared%20Documents/Forms/AllItems.aspx?id=%2Fteams%2FyemiSdirects%2FShared%20Documents%2FGeneral%2FPod%20Reports%2F%5Fschema&p=true&share=cgolWQiw8PyBQIw7v7O2iD90EgUC%2DtbEDFLCyAESZ6vZZ16P6Q
```

If the contract cannot be reached, the skill should stop setup/run and ask the user to fix access. Do not silently use a local fallback, because Yemi may have changed the requirements in SharePoint.

If the shared `_schema` folder does not exist, an authorized setup/admin run should create it first:

```text
Pod Reports\_schema\
```

Then upload or verify this file:

```text
Pod Reports\_schema\reporting-contract.md
```

The colleague skill should not create or modify the shared contract during normal report generation. Shared contract creation/update is a setup/admin action.

Example setup prompt:

```text
I will set up your pod reporting profile.

By default, I will use Microsoft 365 calendar, meeting recap emails, Teams/chat where available, OneDrive files, and MSX if this agent has access.

I will not use a wiki or knowledgebase unless you add one.

I will generate draft JSON and HTML reports for review before they are used in a rollup.
```

### Run Mode

Run mode generates one colleague-owned report package for a reporting period.

Run mode should:

1. Read `reporting-config.yaml`.
2. Check the shared Pod Reports schema contract.
3. Confirm or infer the reporting period.
4. Validate configured source access.
5. Retrieve evidence from enabled sources.
6. Map each customer/account signal to the configured ATU assignment.
7. Generate one report package per ATU slice.
8. Synthesize report facts into self-describing JSON that conforms to the active schema.
9. Render a human-readable HTML dashboard.
10. Mark outputs as `draft` unless explicitly approved.
11. Avoid writing shared manifests or raw evidence archives.

Example command:

```text
/yemi-pod-report-skill run --period 2026-06
```

### Check-Access Mode

Check-access mode verifies available source connectors in the current harness.

It should check, where possible:

| Source | Access check |
|---|---|
| M365 auth | Current M365 sign-in status |
| Calendar | List a small event range |
| Email | Search or list recent emails |
| Files | Search OneDrive files |
| Teams | List recent chats or verify Teams access |
| MSX | Run a lightweight MSX query |
| Territory Alignment | Query the model for the colleague's username in their pillar column |
| Wiki/KB | Verify configured path exists and is readable |

If a configured source is unavailable, the skill should report the issue clearly and not silently pretend the source was used.

## Setup Questions

Setup mode should ask only what is necessary.

### 1. Identity

Confirm detected profile details where available.

```text
I found this profile:
Name: <detected name>
Alias: <detected alias>

Is this correct?
```

### 2. Pillar, ATU, and Accounts (auto-derived)

The skill does **not** ask the colleague to pick their pillar or ATUs. It resolves their username and derives all three — pillar, ATU(s), and accounts — from the FY26 Territory Alignment model (see **Account & ATU Mapping**), then presents the full profile for confirm/edit.

Auto-derivation flow:

1. Resolve the colleague's username = the local-part of their M365 email (`mcp__me_profile__GetMyDetails`).
2. **Detect pillar** — scan the four pillar STU columns for the username; the column it appears in is the pillar:
   - `SE IC - Cloud & AI Apps` → apps
   - `SE IC - Cloud & AI Data` → data
   - `SE IC - Cloud & AI Infra` → infra
   - `SE IC - Cloud & AI Developer` → github
3. **Derive territories and accounts** — for the matched pillar column, take every `FY26 Sales Territory` where the username appears, then pull the `Accounts` in those territories with their `Segment`, `FY26 ATU`, and `ATU Director`.
4. **Derive ATUs** — the distinct normalized `FY26 ATU` values across those accounts are the colleague's ATU(s).
5. **Present the full profile for confirm/edit** — pillar, ATU(s), and the account list grouped by ATU with segments. The colleague can correct anything before it is saved.
6. Save the confirmed profile to the local config (`owner.pillar`, `owner.atus`, `atu_assignments`).

Allowed pillars: `data`, `infra`, `apps`, `github`. Allowed ATUs: `atu8`, `atu9`, `atu10`, `atu17`.

Pillar-detection query (one call):

```dax
EVALUATE
VAR u = "<username>"
VAR Base =
    SELECTCOLUMNS('STU',
        "Territory", 'STU'[FY26 Sales Territory],
        "apps",   'STU'[SE IC - Cloud & AI Apps],
        "data",   'STU'[SE IC - Cloud & AI Data],
        "infra",  'STU'[SE IC - Cloud & AI Infra],
        "github", 'STU'[SE IC - Cloud & AI Developer]
    )
VAR Mine = FILTER(Base, [apps] = u || [data] = u || [infra] = u || [github] = u)
RETURN
SELECTCOLUMNS(Mine,
    "Territory", [Territory],
    "Pillar", SWITCH(TRUE(), [apps]=u, "apps", [data]=u, "data", [infra]=u, "infra", [github]=u, "github")
)
ORDER BY [Territory]
```

Build the `Base` table once from the full `STU` table, then filter on the renamed columns — projecting STU columns directly inside `SELECTCOLUMNS(FILTER('STU', …))` raises a row-context error in this model.

Example confirmation prompt:

```text
I looked you up in the FY26 Territory Alignment model by your username (jonhernandez):

Pillar: apps   (you're in the "SE IC - Cloud & AI Apps" column)
ATU:    atu17  (USA.EC.HLS.17)

Accounts (15) — Segment: Upper Majors Commercial:
  - OSF Healthcare System
  - BJC Health Care
  - Fairview Health Services
  - ... (15 total)

Confirm, or edit anything — pillar, ATU, or the account list — before I save.
```

Edge cases:

- **Multiple pillar columns** — if the username appears in more than one pillar column, present all detected pillars and ask which to report under (or generate one profile per pillar).
- **Multiple ATUs** — the `FY26 ATU` column partitions accounts across ATUs automatically; surface any account whose ATU is outside the allowed set for confirmation.
- **Not found** — if the username is in none of the four pillar columns (role not represented, or no Territory Alignment access), fall back to asking the colleague for pillar + ATU and deriving accounts from MSX. Do not invent pillar or ATU names.

### 3. Report Location

Final report output must go to the shared Pod Reports SharePoint location, under the ATU selected during setup or generated for the current ATU slice.

Shared root:

```text
https://microsoft.sharepoint.com/teams/yemiSdirects/Shared%20Documents/General/Pod%20Reports
```

The colleague should not choose an arbitrary output root unless they are doing a local test run.

Recommended pattern:

```text
Pod Reports\{atu}\{yyyy-mm}\{pillar}-{person_slug}.json
Pod Reports\{atu}\{yyyy-mm}\{pillar}-{person_slug}.html
```

Example:

```text
Pod Reports\atu17\2026-06\apps-jonathan-hernandez.json
Pod Reports\atu17\2026-06\apps-jonathan-hernandez.html
```

For multi-ATU contributors, generate one report pair per ATU:

```text
Pod Reports\atu17\2026-06\apps-kwame-lastname.json
Pod Reports\atu17\2026-06\apps-kwame-lastname.html
Pod Reports\atu10\2026-06\apps-kwame-lastname.json
Pod Reports\atu10\2026-06\apps-kwame-lastname.html
```

The implementation may use a synced local path, a SharePoint/OneDrive URL, or Microsoft Graph upload depending on the harness. The logical output root remains the shared Pod Reports folder.

### 4. Source Defaults

Default sources should be:

```yaml
sources:
  m365_calendar:
    enabled: true
    use_as: "activity_index"

  m365_email:
    enabled: true
    use_as: "meeting_recaps_followups_action_items"

  m365_teams:
    enabled: true
    use_as: "chat_and_thread_context"

  m365_files:
    enabled: true
    use_as: "supporting_documents_decks_notes_attachments"

  msx:
    enabled: true
    use_as: "opportunities_milestones_pipeline_deal_team"

  wiki:
    enabled: false
    path: null
    use_as: "optional_private_knowledgebase"
```

The setup prompt should ask:

```text
These are the default sources I will use each month:
- M365 calendar
- M365 email recaps and follow-ups
- M365 Teams/chat where available
- M365 files and attachments
- MSX opportunities and milestones

I will not use a wiki or KB unless you add one.

Would you like to add, remove, or change any source?
```

### 5. Optional Wiki/KB

If the colleague wants to add a wiki/KB, ask for the path or location.

```yaml
sources:
  wiki:
    enabled: true
    path: "C:\\Users\\<user>\\my-wiki"
    use_as: "optional_private_knowledgebase"
```

If not configured, the skill should not use a wiki.

### 6. Draft Approval

Default should be draft-first.

```yaml
approval:
  default_status: "draft"
  require_review_before_rollup: true
```

The skill should ask:

```text
Do you want generated reports to stay in draft until you approve them?
```

Recommended answer: yes.

## Local Configuration File

Setup mode should create or update:

```text
reporting-config.yaml
```

This file is **local to the colleague's agent harness**. It should not be stored in the shared Pod Reports folder because it may contain local paths, source preferences, access verification status, or private wiki/KB paths.

Recommended local locations:

```text
~/.copilot/yemi-pod-report-skill/reporting-config.yaml
```

or:

```text
%USERPROFILE%\.copilot\yemi-pod-report-skill\reporting-config.yaml
```

Example config:

```yaml
schema_version: "1.0"
skill: "yemi-pod-report-skill"

owner:
  name: "Jonathan Hernandez"
  alias: "jonathan-hernandez"
  pillar: "apps"
  atus:
    - atu17

reporting:
  default_period: "previous_month"
  draft_first: true
  require_review_before_rollup: true
  output_formats:
    - json
    - html

workspace:
  shared_output_root_url: "https://microsoft.sharepoint.com/teams/yemiSdirects/Shared%20Documents/General/Pod%20Reports"
  selected_atus:
    - atu17
  folder_pattern: "{atu}\\{yyyy-mm}"
  file_pattern: "{pillar}-{person_slug}"
  local_test_output_root: null

allowed_values:
  pillars:
    - data
    - infra
    - apps
    - github
  atus:
    - atu8
    - atu9
    - atu10
    - atu17

atu_assignments:
  # Auto-derived from the Territory Alignment model (see Account & ATU Mapping):
  # customers is populated at setup from the colleague's username + pillar column.
  - atu: atu17
    customers: []
    output_enabled: true

schema_contract:
  source: "shared_pod_reports_root"
  folder_url: "https://microsoft.sharepoint.com/:f:/r/teams/yemiSdirects/Shared%20Documents/Forms/AllItems.aspx?id=%2Fteams%2FyemiSdirects%2FShared%20Documents%2FGeneral%2FPod%20Reports%2F%5Fschema&p=true&share=cgolWQiw8PyBQIw7v7O2iD90EgUC%2DtbEDFLCyAESZ6vZZ16P6Q"
  contract_url: "https://microsoft.sharepoint.com/teams/yemiSdirects/Shared Documents/General/Pod Reports/_schema/reporting-contract.md"
  version: "1.2"
  require_shared_check: true
  fallback_allowed: false

sources:
  m365_calendar:
    enabled: true
    access_verified: false
    use_as: "activity_index"

  m365_email:
    enabled: true
    access_verified: false
    use_as: "meeting_recaps_followups_action_items"
    search_strategy:
      include_terms:
        - "meeting notes"
        - "recap"
        - "follow-up"
        - "action items"
        - "customer names"
        - "pillar keywords"

  m365_teams:
    enabled: true
    access_verified: false
    use_as: "chat_and_thread_context"

  m365_files:
    enabled: true
    access_verified: false
    use_as: "supporting_documents_decks_notes_attachments"

  msx:
    enabled: true
    access_verified: false
    use_as: "opportunities_milestones_pipeline_deal_team"
    artifact_id: "bbc0cbd3-9840-4736-bf4a-f3df87fb2b5f"
    access_method: "power_bi_semantic_model"

  territory_alignment:
    enabled: true
    access_verified: false
    use_as: "account_discovery_and_atu_mapping"
    artifact_id: "39c7f8e7-cb79-4bcb-8c0b-db60e8398631"
    access_method: "power_bi_semantic_model"
    match_on: "username"   # M365 email local-part, matched against the pillar's STU column
    pillar_columns:
      apps: "SE IC - Cloud & AI Apps"
      data: "SE IC - Cloud & AI Data"
      infra: "SE IC - Cloud & AI Infra"
      github: "SE IC - Cloud & AI Developer"
    atu_code_map:
      atu8: "USA.EC.HLS.08"
      atu9: "USA.EC.HLS.09"
      atu10: "USA.EC.HLS.10"
      atu17: "USA.EC.HLS.17"

  wiki:
    enabled: false
    access_verified: false
    path: null
    use_as: "optional_private_knowledgebase"

privacy:
  retain_raw_evidence: false
  retain_intermediate_evidence: false
  exclude_hr_comp_legal: true
  summarize_private_messages: true
  store_only_report_artifacts: true

approval:
  default_status: "draft"
  allowed_statuses:
    - draft
    - approved
    - final
```

For a colleague who supports multiple ATUs, the local config should store validated customer assignments:

```yaml
owner:
  name: "Kwame Lastname"
  alias: "kwame-lastname"
  pillar: "apps"
  atus:
    - atu17
    - atu10

workspace:
  selected_atus:
    - atu17
    - atu10
  folder_pattern: "{atu}\\{yyyy-mm}"
  file_pattern: "{pillar}-{person_slug}"

atu_assignments:
  - atu: atu17
    customers:
      - "OSF HealthCare"
      - "BJC"
      - "Fairview"
    output_enabled: true

  - atu: atu10
    customers:
      - "Customer A"
      - "Customer B"
    output_enabled: true
```

The skill should use this mapping to partition retrieved evidence. If a customer appears in the evidence but is not mapped to any selected ATU, the run should pause and ask the colleague to assign or exclude the customer.

## Access Verification Behavior

Setup mode and run mode should both verify access.

The first access check should be the shared Pod Reports schema contract:

| Asset | Required behavior |
|---|---|
| SharePoint `_schema/` folder | Must be reachable before setup/run continues |
| SharePoint `_schema/reporting-contract.md` | Read from SharePoint; single source of truth for requirements and Validation Rules |

If the SharePoint contract cannot be reached, the skill should warn the user and stop or ask for access repair. It should not use a local `_schema` folder as a fallback.

Each configured source should produce one of these states:

```yaml
access_verified: true
```

or:

```yaml
access_verified: false
access_issue: "MSX MCP unavailable in this agent harness"
```

If a source is enabled but unavailable, the skill should ask what to do.

Example:

```text
MSX is enabled in your config, but this agent does not currently have MSX access.

Choose one:
1. Continue with M365-only reporting
2. Disable MSX in this config
3. Stop setup so you can install or authorize MSX access
```

If a run proceeds without a requested source, the report JSON must record that clearly.

```json
{
  "sources_requested": ["m365", "msx"],
  "sources_used": ["m365"],
  "sources_unavailable": [
    {
      "source": "msx",
      "reason": "MSX MCP unavailable"
    }
  ]
}
```

## Report Folder Contract

The monthly folder is a clean publish surface, not an evidence archive.

Use a manifestless colleague-output layout. This colleague skill only writes person/pillar report files. It does not write rollups.

```text
Pod Reports\
  atu17\
    2026-06\
      apps-jonathan-hernandez.json
      apps-jonathan-hernandez.html
      github-tim-ferro.json
      github-tim-ferro.html
      data-azieb.json
      data-azieb.html
      infra-brian.json
      infra-brian.html
```

Rules:

1. Each colleague writes only their own `{pillar}-{person_slug}.json` and `.html` files.
2. No shared mutable `manifest.json` is required.
3. This colleague skill does not create rollups, MBR files, ATU aggregate files, or shared indexes.
4. Yemi's separate rollup skill is responsible for reading approved colleague JSON files and creating rollups/adapters.

## File Naming

Person/pillar report files use:

```text
{pillar}-{person_slug}.json
{pillar}-{person_slug}.html
```

Examples:

```text
apps-jonathan-hernandez.json
apps-jonathan-hernandez.html
data-azieb.json
data-azieb.html
infra-brian.json
infra-brian.html
github-tim-ferro.json
github-tim-ferro.html
```

## Self-Describing JSON Contract

Each report JSON must be self-describing so that no shared manifest is needed.

The required metadata structure is defined by the shared contract at the root of the Pod Reports folder so Yemi can evolve the reporting requirements over time without changing every colleague's local config.

Recommended shared location:

```text
Pod Reports\_schema\reporting-contract.md
```

The colleague skill should read this shared contract from SharePoint during setup and run mode. If the contract is unavailable, stop and ask the user to restore access rather than using a local fallback.

Metadata envelope:

```json
{
  "schema_version": "1.2",
  "artifact_type": "person_pillar_report",
  "report_id": "atu17-2026-06-apps-jonathan-hernandez",
  "atu": "atu17",
  "atu_scope": {
    "type": "single_atu",
    "included_atus": ["atu17"],
    "current_atu": "atu17",
    "included_customers": [],
    "excluded_customers": [],
    "cross_atu_owner": false
  },
  "period": "2026-06",
  "report_period": {
    "label": "2026-06",
    "start": "2026-06-01",
    "end": "2026-06-30",
    "status": "full_month"
  },
  "pillar": "apps",
  "owner": {
    "name": "Jonathan Hernandez",
    "alias": "jonathan-hernandez"
  },
  "status": "draft",
  "review": {
    "status": "draft",
    "approved_by": null,
    "approved_at": null
  },
  "source_profile": "m365_msx_no_wiki",
  "sources_requested": ["m365_calendar", "m365_email", "m365_files", "m365_teams", "msx"],
  "sources_used": ["m365_calendar", "m365_email_full_bodies", "m365_files", "msx"],
  "sources_unavailable": [],
  "source_coverage": {},
  "schema_contract": {
    "source": "shared_pod_reports_root",
    "version": "1.2",
    "path": "_schema/reporting-contract.md",
    "fallback_used": false
  },
  "companion_files": {
    "html": "apps-jonathan-hernandez.html"
  },
  "generation": {
    "generated_at": "",
    "generator": "yemi-pod-report-skill",
    "retained_intermediate_evidence": false
  }
}
```

This is the metadata envelope the skill owns — the fields that make the file self-describing. The report's business sections (Executive Summary, Scorecard, Priority Initiatives, Customer Updates, Account Notes, Partners, Technical Win/Loss/Learning Themes, Cross-Pillar Dependencies, Asks for Yemi, Next Month Priorities, and Dashboard Sections) live alongside this envelope in the same JSON object, but their structure and every field inside them are defined by the shared contract (`reporting-contract.md`). Read the live contract at run time and build those sections to match its current Required Report Sections — do not hardcode the section list or field names here, since the contract is versioned and Yemi evolves it, and anything restated in this file will drift out of sync.

## HTML Dashboard Requirements

The report's content shape — required sections, customer-card fields, dashboard filters, status conventions, MSX/M365 separation, and the "business-facing, no generation diagnostics" rule — is owned by the shared contract (`reporting-contract.md`), read from SharePoint before every run. Build the dashboard to match whatever the live contract specifies. Do not restate its section or field lists here, so this skill can never drift from Yemi's current requirements. (The contract's Customer Updates and Dashboard Sections are where the card layout, filters, and status accents live.)

Skill-side rendering mechanics (not owned by the contract):

1. HTML dashboards must be self-contained single files.
2. Render the same facts as the JSON — never re-derive, add, or omit content in the HTML.
3. If generated in Clawpilot, use the Clawpilot theme variables required by the web artifacts builder skill.

## Account & ATU Mapping (Territory Alignment Model)

Account discovery and ATU assignment are derived automatically from the **FY26 Territory Alignment v2** Power BI semantic model — the authoritative source for which accounts a colleague owns and which ATU each account belongs to. MSX has no ATU field; this model does. Colleagues do **not** hand-curate an account list.

```text
Artifact ID: 39c7f8e7-cb79-4bcb-8c0b-db60e8398631
Workspace:   HLS Territory
Tools:       mcp__pbi_fabricaihub__ExecuteQuery / mcp__pbi_fabricaihub__GetSemanticModelSchema
```

> **Power BI tool names are harness-specific.** The `mcp__pbi_fabricaihub__…` prefix is the Cowork registration (verified in Cowork). Another harness (e.g. Clawpilot) may expose the same Power BI tools — `ExecuteQuery`, `GetSemanticModelSchema`, `DiscoverArtifacts`, `GetReportMetadata`, `ResolveReportIdFromUrl` — under a different MCP prefix. Do not assume a single hardcoded prefix: if a literal call returns tool-not-found, resolve the tool by its bare name via `ToolSearch` and use whatever prefix the current harness registers.

Tables used:

- `Accounts` — `MSSales Account Name`, `Segment`, `FY26 ATU`, `FY26 ATU Group`, `FY26 Sales Territory`, `ATU Director`, `ATU GM`.
- `STU` — one row per `FY26 Sales Territory`, with one column per role holding the assignee's **username/alias** (e.g. `jonhernandez`). Pillar → column map below.
- `Accounts` and `STU` are related on `FY26 Sales Territory`.

**Access:** every pod colleague has access to this model. Row-level security scopes the published *report* view by account, but the model-query path used here can return the full pod, so the skill scopes explicitly by username + pillar column (below) rather than relying on RLS.

### Pillar → STU role column

| Skill pillar | STU column |
|---|---|
| apps | `SE IC - Cloud & AI Apps` |
| data | `SE IC - Cloud & AI Data` |
| infra | `SE IC - Cloud & AI Infra` |
| github | `SE IC - Cloud & AI Developer` |

### ATU code normalization

The skill uses short ATU codes; the model uses full codes. They map 1:1:

| Skill code | Territory model `FY26 ATU` |
|---|---|
| atu8 | USA.EC.HLS.08 |
| atu9 | USA.EC.HLS.09 |
| atu10 | USA.EC.HLS.10 |
| atu17 | USA.EC.HLS.17 |

All four sit in the `USA.EC.HLS.MJR.PayorProvider` ATU group (Yemi's pod patch). If Yemi's allowed ATUs change, update this table and `allowed_values.atus` in the config together.

### Derivation

1. Resolve the colleague's username = the local-part of their M365 email (`mcp__me_profile__GetMyDetails` → `jonhernandez@microsoft.com` → `jonhernandez`).
2. Pick the STU column for the colleague's pillar from the table above.
3. Run the query below (apps column shown — swap in the colleague's pillar column):

```dax
EVALUATE
CALCULATETABLE(
    SELECTCOLUMNS('Accounts',
        "Account",      'Accounts'[MSSales Account Name],
        "Segment",      'Accounts'[Segment],
        "ATU",          'Accounts'[FY26 ATU],
        "Territory",    'Accounts'[FY26 Sales Territory],
        "ATU Director", 'Accounts'[ATU Director]
    ),
    FILTER('STU', 'STU'[SE IC - Cloud & AI Apps] = "<username>")
)
ORDER BY [Territory], [Account]
```

Each returned account already carries its `FY26 ATU`, so the account-to-ATU mapping is read directly: single-ATU colleagues get one ATU; multi-ATU colleagues are partitioned automatically by the `FY26 ATU` column. Normalize each `FY26 ATU` to the skill code via the table above.

Notes:

- **Match on the username, not the display name** — the STU columns store the alias (`jonhernandez`), not "Jonathan Hernandez".
- **Use the `CALCULATETABLE(…, FILTER('STU', …))` shape.** Projecting STU columns directly inside `SELECTCOLUMNS(FILTER('STU', …))` raises a row-context error in this model; filtering STU and letting the `FY26 Sales Territory` relationship propagate to `Accounts` is the reliable pattern.
- **Fallback:** if the username is not found in the pillar column (role not represented, or no Territory Alignment access), record account discovery as degraded, fall back to MSX-derived names via `PodMilestones` → `opportunity` (`RELATED(opportunity[name])`, which embeds the customer), and confirm the ATU split with the colleague.
- This model supplies **account scope and ATU only.** MSX remains pipeline truth (opportunities, milestones, amounts); M365 remains activity/intent truth.

## Evidence Retrieval Strategy

The run mode should use a staged retrieval strategy.

### 1. MSX Retrieval

Use MSX for:

- Opportunities
- Milestones
- Deal-team ownership
- Pipeline movement
- Stages
- Forecast comments
- Close dates
- Dollar amounts
- Risks and blockers
- Next actions

MSX should not be the only source unless M365 is unavailable.

#### MSX via Power BI Semantic Model

MSX data for this pod is accessed via the **MSX Pod Report Power BI semantic model**:

```
Artifact ID: bbc0cbd3-9840-4736-bf4a-f3df87fb2b5f
Tools: mcp__pbi_fabricaihub__ExecuteQuery / mcp__pbi_fabricaihub__GetSemanticModelSchema  (harness-specific prefix — see the Power BI tool-name note under Account & ATU Mapping; resolve via ToolSearch if not found)
```

The model is pre-filtered to Yemi's 16-person pod. It contains these tables: `opportunity`, `opportunityproduct`, `msp_dealteam`, `PodMilestones`, `task`, `systemuser`, `product`.

- **`PodMilestones`** is the milestone table and the primary milestone source — one row per **pod member × milestone**, scoped to the milestones the pod is actually staffed on via MSX milestone **access teams** (not via opportunity deal-team membership). This is the "milestones we're on, not just opportunities we're on" grain. It is related to `systemuser` on `[Pod Member ID]` and to `opportunity` on `[Opportunity ID]`. `[Status]`, `[Category]`, and `[Solution Area]` are already decoded to readable text, and `[Monthly ACR]` carries the milestone's monthly usage/ACR value.
- **`task`** holds the pod's technical activities (Demos, ADS, PoCs, Blocker Escalations, etc.); its **category** field (`msp_taskcategoryname`) is the key classifier — see Step 3.
- There is **no `msp_engagementmilestone` table in the model** — that was a Power Query staging source and is not loaded. Always query milestones through `PodMilestones`.

**Step 0 — Auto-resolve the colleague's systemuserid:**

Never hardcode systemuserids. Resolve dynamically at runtime using the colleague's M365 email (available from session context — `mcp__me_profile__GetMyDetails` returns it):

```dax
EVALUATE
FILTER(
    SELECTCOLUMNS(systemuser, "ID", [systemuserid], "Email", [internalemailaddress]),
    [Email] = "<signed-in-user-email>"
)
```

If the query returns no rows, the colleague is not in the model's `systemuser` table — record MSX as `sources_unavailable` and continue with M365-only retrieval.

**Step 1 — Query the colleague's opportunities:**

```dax
EVALUATE
VAR MyOpps =
    SELECTCOLUMNS(
        FILTER(msp_dealteam, UPPER([msp_dealteamuserid]) = "<SYSTEMUSERID-UPPERCASE>"),
        "OppId", [msp_parentopportunityid]
    )
RETURN
SELECTCOLUMNS(
    FILTER(opportunity, CONTAINS(MyOpps, [OppId], [opportunityid])),
    "Opportunity", [name],
    "Step", [stepname],
    "Est. Value", [estimatedvalue],
    "Est. Close", [estimatedclosedate],
    "Actual Close", [actualclosedate],
    "Status", [statecode],
    "Customer", [customerid]
)
ORDER BY [Est. Value] DESC
```

`statecode`: 0 = Open, 1 = Won, 2 = Lost.

**Step 2 — Query the colleague's milestones (via `PodMilestones`):**

`PodMilestones` is already scoped to the pod's milestone access teams, so filter it to the colleague by `[Pod Member ID]` — equivalently, filter the related `systemuser` by email. Resolve the human-readable account/opportunity name through the opportunity relationship with `RELATED(opportunity[name])`; the customer is embedded in that name (e.g. "OSF - Fax Processing Use Case"). There is no account-name column on the milestone itself.

```dax
EVALUATE
CALCULATETABLE(
    SELECTCOLUMNS(
        PodMilestones,
        "Milestone", [Milestone],
        "Status", [Status],
        "Category", [Category],
        "Solution Area", [Solution Area],
        "Monthly ACR", [Monthly ACR],
        "Milestone Date", [Milestone Date],
        "Opportunity", RELATED(opportunity[name])
    ),
    FILTER(ALL(systemuser), systemuser[internalemailaddress] = "<signed-in-user-email>"),
    PodMilestones[Status] <> "Completed" && PodMilestones[Status] <> "Cancelled"
)
ORDER BY [Monthly ACR] DESC
```

Drop the two `[Status]` filters to include Completed/Cancelled history. Full `PodMilestones` columns: `Pod Member ID`, `Milestone ID`, `Milestone`, `Milestone Date`, `Status`, `Category`, `Solution Area`, `BACV`, `Monthly ACR`, `Risk / Blocker Details`, `Opportunity ID`, `Owner ID`, `Milestone Key`.

**Step 3 — Query the colleague's technical activities (via `task`, especially the category):**

The `task` table classifies each activity by `msp_taskcategoryname` — the single most useful field for understanding *what kind* of technical engagement happened, and the one to lead with for the activity-mix and blockers sections. Filter to the colleague by owner (the `systemuser` → `task[ownerid]` relationship). Categories present in the pod: **Demo, Architecture Design Session, PoC/Pilot, Workshop, Technical Close/Win Plan, Blocker Escalation, Consumption Plan, Customer Engagement, Briefing, Tech Support, RFP/RFI, Negotiate Pricing** (some rows are uncategorized). Surface open **Blocker Escalation** tasks explicitly in the report's risks/asks.

```dax
EVALUATE
CALCULATETABLE(
    SELECTCOLUMNS(
        task,
        "Subject", [subject],
        "Category", [msp_taskcategoryname],
        "Regarding", [regardingobjectidname],
        "Due", [scheduledend],
        "Status", [statecode]
    ),
    FILTER(ALL(systemuser), systemuser[internalemailaddress] = "<signed-in-user-email>")
)
ORDER BY [Due] DESC
```

`statecode`: 0 = Open, 1 = Completed, 2 = Canceled. Roll up counts by `Category` for an activity-mix view.

**Notes:**
- **GUID casing:** `msp_dealteamuserid` stores GUIDs in uppercase. Always apply `UPPER()` when comparing against a resolved systemuserid to avoid case mismatch.
- **Model scope:** The model is pre-filtered to the pod, so a colleague outside the pod returns empty results — this is expected, not an error.
- **Names / accounts:** `PodMilestones` has no account-name column. Resolve the human-readable name through the opportunity relationship — `RELATED(opportunity[name])` from a `PodMilestones` row, or join `PodMilestones[Opportunity ID]` → `opportunity[opportunityid]`. The customer is embedded in the opportunity name (e.g. "OSF - …", "BJC - …", "Fairview - …"). `opportunity[customerid]` is a GUID with no account-name table, so `opportunity[name]` is the human anchor.

### 2. Calendar Retrieval

Use calendar as an activity index.

Calendar tells the skill where to look next, but calendar titles should not be treated as final evidence of meeting outcomes.

### 3. Email Retrieval

Search email for:

- Meeting notes
- Recaps
- Follow-ups
- Action items
- Customer names
- Pillar terms
- Opportunity names
- Account team names

After identifying high-signal results, fetch full email bodies and attachment metadata.

Do not stop at email previews.

### 4. Teams/Chat Retrieval

When available, search Teams/chats for:

- Meeting follow-ups
- Customer discussions
- Action item threads
- Decisions
- Blockers
- Links to docs or recordings

If Teams access is unavailable, record this in the JSON metadata.

### 5. File and Attachment Retrieval

Search OneDrive and attachments for:

- Decks
- Meeting notes
- Briefings
- Follow-up docs
- Customer-facing collateral
- Monthly report examples

Inspect attachment metadata by default. Read/download attachment content only when needed and permitted.

### 6. Optional Wiki/KB Retrieval

If configured, use wiki/KB to add:

- Relationship context
- Prior history
- Customer strategy
- Open action continuity
- Known hypotheses
- Stakeholder context

Do not require a wiki/KB for colleagues.

## Source Weighting

Use the following source roles:

| Source | Role |
|---|---|
| MSX | Pipeline truth |
| Territory Alignment | Account scope and ATU truth |
| M365 calendar | Activity index |
| M365 email recaps | What happened and what actions were created |
| M365 Teams/chats | Discussion context and decisions |
| M365 files/attachments | Supporting documents and collateral |
| Wiki/KB | Optional memory and strategy context |

When sources conflict, prefer:

1. Explicit customer or account-team recap for what happened.
2. MSX for opportunity/milestone/pipeline facts.
3. Calendar for meeting existence only.
4. Wiki/KB for context unless contradicted by fresher source data.

## Privacy and Retention Rules

Default privacy behavior:

```yaml
privacy:
  retain_raw_evidence: false
  retain_intermediate_evidence: false
  exclude_hr_comp_legal: true
  summarize_private_messages: true
  store_only_report_artifacts: true
```

Rules:

1. Do not retain raw email bodies by default.
2. Do not retain raw Teams messages by default.
3. Do not retain raw calendar dumps by default.
4. Do not retain raw MSX payloads by default.
5. Do not include HR, compensation, or legal content.
6. Do not expose private meeting details unless needed for the report and appropriate for the audience.
7. Store durable summaries, source references, and confidence indicators only.
8. The monthly folder should contain report artifacts, not evidence archives.

## Approval Workflow

Default status is `draft`.

Each report should contain:

```json
{
  "review": {
    "status": "draft",
    "approved_by": null,
    "approved_at": null
  }
}
```

Supported statuses:

```text
draft
approved
final
```

Yemi's separate rollup skill can decide whether to include only approved reports, include drafts with labels, or exclude stale/invalid files. This colleague skill only writes the review status into the colleague-owned JSON.

## Rollup Handoff Boundary

This colleague skill does not implement rollup discovery.

It only guarantees that each generated JSON file is self-describing and written to the correct shared Pod Reports folder. Yemi's separate rollup skill is responsible for discovering colleague reports, filtering by status/schema/ATU/period, and creating MBR, ATU, or other audience-specific outputs.

Write boundaries:

| Actor | Reads | Writes |
|---|---|---|
| Colleague reporting skill | Own configured sources | Own `{pillar}-{person}.json/html` |
| Yemi rollup skill | Colleague person/pillar JSON files | Rollup and audience-specific artifacts |

No shared colleague-level manifest is required.

## Error Handling

The skill should not silently degrade.

If a source fails:

1. Record the source as unavailable.
2. Explain the impact in the draft response.
3. Continue only if the user approves or if the config allows degraded mode.
4. Do not claim the source was used.

Example source failure metadata:

```json
{
  "sources_unavailable": [
    {
      "source": "msx",
      "reason": "MSX MCP unavailable in current harness",
      "impact": "Opportunity amounts, milestones, and deal-team ownership may be missing."
    }
  ]
}
```

## Cowork and Clawpilot Compatibility

The skill should be portable across Cowork and Clawpilot.

Setup mode must not assume all harnesses have the same capabilities.

Expected differences:

| Capability | Clawpilot | Cowork |
|---|---|---|
| Local file access | Likely available | May be limited |
| M365 tools | Available if authorized | Depends on harness |
| MSX access | Environment-specific | Environment-specific |
| Teams transcript access | May require WorkIQ or Graph support | Depends on harness |
| Local wiki path | Possible | May not be available |

Setup mode should probe actual access and write the config accordingly.

## Example Setup Completion Message

```text
Setup complete.

Reports will be generated to:
Pod Reports\atu17\{YYYY-MM}\{pillar}-{person}.json
Pod Reports\atu17\{YYYY-MM}\{pillar}-{person}.html

Enabled sources:
- M365 calendar
- M365 email recaps and follow-ups
- M365 files and attachments
- MSX

Disabled sources:
- Wiki / KB

Sources needing attention:
- Teams chat access not verified

Default behavior:
- Draft-first reports
- No raw evidence retention
- No shared manifest
- Local config only; shared folder receives report artifacts only
```

## Example Run Completion Message

```text
Generated draft report:
Pod Reports\atu17\2026-06\apps-jonathan-hernandez.json
Pod Reports\atu17\2026-06\apps-jonathan-hernandez.html

Status: draft
Sources used: M365 calendar, M365 email full bodies, M365 files, MSX
Sources unavailable: Teams chat
Raw evidence retained: no
Contract: Pod Reports\_schema\reporting-contract.md v1.2
```

## Pilot Lessons Incorporated

The June pilot produced three important design lessons:

1. A no-wiki run should not become MSX-only. MSX is necessary but insufficient.
2. Calendar titles and email previews are not enough. The skill must fetch full high-signal email/recap bodies.
3. Human-facing dashboards should not include diagnostic commentary about the reporting process. Source and generation metadata belongs in JSON, not the visible dashboard.

## Guardrails

1. **Never fabricate facts.** Do not invent customer names, opportunity amounts, meeting dates, action items, or MSX signals. If a source returns no data, leave a clearly-marked placeholder (e.g., `[No MSX data available for this customer]`) rather than filling in plausible-sounding content.

2. **Draft-first by default.** All generated reports must carry `"status": "draft"` unless the user explicitly approves them. Never auto-promote to `approved` or `final`.

3. **Confirm the reporting period before running.** If the period is ambiguous, ask. Default to the previous calendar month.

4. **Do not include HR, compensation, or legal content.** If sources contain this content, exclude it from the report without comment.

5. **Do not overwrite an existing approved report** without confirming with the user first.

6. **One report pair per ATU slice.** Each run produces `{pillar}-{person}.json` and `{pillar}-{person}.html` per ATU. Do not write to shared rollup files or other colleagues' report files.

7. **Colleagues have different service access.** Do not assume MSX, Teams transcripts, or wiki/KB are available. Degrade gracefully, record what was and wasn't available in the JSON metadata, and explain the gap to the user.

8. **Raw evidence is not retained.** Do not persist raw email bodies, Teams messages, calendar dumps, or MSX payloads to disk. Synthesize and summarize only.

9. **Resolve the SharePoint contract first.** If the shared contract cannot be reached, stop and ask the user to repair access — do not silently use a local fallback.

## Summary

This skill should make pod reporting easy for Yemi's direct colleagues by combining setup-time configuration with run-time evidence retrieval.

The durable contract is simple:

```text
{pillar}-{person}.json
{pillar}-{person}.html
```

The JSON is self-describing. The HTML is human-readable. There is no shared mutable manifest. Raw evidence is not retained by default. Colleagues can use M365 and MSX without curating a wiki, while wiki-backed users can optionally add their own knowledgebase as another source.

