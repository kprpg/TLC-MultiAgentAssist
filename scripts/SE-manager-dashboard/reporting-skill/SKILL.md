---
name: manager-pod-report-skill
description: |
  Generate lightweight manager-scoped pod summary reports using the active manager profile's
  contract and configured source connectors such as Microsoft 365, the MSX semantic model, and optional wiki/KB sources. Produces self-describing
  JSON + HTML report artifacts covering customer updates, MSX pipeline signals, M365 activity, blockers,
  and asks.
  Use when asked to "produce my pod report", "run my pod report", "generate my monthly pod report",
  "generate my report for [manager]", "pod report for [month]",
  "generate my [pillar] pod report", or "my monthly pod summary".
  Supports /manager-pod-report-skill setup | run | check-access | show-config | edit-config modes.
  Do NOT use for general customer summaries, daily briefings, win-wire matching, or inbox digests.
cowork:
  category: automation
  icon: DocumentDataLink
---

# Manager Pod Report Skill

**Version:** 2.0

## Purpose

This skill helps people reporting to any configured manager generate manager-scoped pod summary artifacts with minimal manual effort.

The skill retrieves relevant evidence from sources configured for the active manager profile, applies that profile's current reporting contract and account-assignment rules, and produces clean person/pillar report artifacts that can be reviewed by the reporter and later rolled up by the manager or another agent.

This is **not** a general knowledgebase or wiki-maintenance workflow. It is a manager-scoped pod summary workflow. The supplied `reporting-contract.md` is an example of the contract format. A live contract must select its manager, permitted scope, business schema, and output rules; the configured semantic model supplies the authoritative manager-to-colleague and account-assignment data.

## When NOT to Use

- Daily customer summaries or pipeline reviews → use daily-briefing or other tools
- Win wire matching or opportunity research → use dedicated win-wire or D365 skills
- Inbox digests or ad-hoc meeting summaries → use daily-briefing or meeting-intel
- Any report that is not a manager-scoped pod summary defined by the active manager profile and its contract

This skill is purpose-built for a configured monthly pod-reporting cadence. Its output files (`{pillar}-{person}.json/html`) live under the active manager profile's output root and do not overlap with any other productivity skill.

## Core Principles

1. **No reporter-maintained input folder required.** The skill should retrieve evidence from configured systems for the reporting period.
2. **No shared mutable manifest.** Each report JSON is self-describing; multiple reporters should not write to the same index file.
3. **Configured operational data is pipeline truth.** When MSX is enabled for the selected profile, use it for opportunities, milestones, pipeline, close dates, amounts, stages, and deal-team ownership.
4. **M365 is activity and intent truth.** Use M365 meeting recaps, follow-ups, notes, emails, Teams/chats where available, and files to understand what actually happened, what customers care about, and what actions were created.
5. **Wiki/KB is optional.** Reporters do not need to maintain a wiki. If a reporter has a configured wiki/KB, the skill can use it as an additional source.
6. **HTML is for humans; JSON is for agents.** The JSON file is the canonical durable artifact. The HTML dashboard renders the JSON for review and consumption.
7. **Raw evidence is not retained by default.** The monthly report folder should remain a clean publish surface, not an evidence archive.
8. **Configuration is local.** Each reporter's setup/config file is for their local agent harness and should not be written to the manager's shared report folder.
9. **Shared output only contains report artifacts.** The manager's shared output location should contain report artifacts and shared contracts, not each reporter's private source configuration.
10. **The active profile defines scope truth.** Use its configured assignment source and account-resolution mapping as authoritative for eligible accounts, workloads/pillars, assignment types, and organizational scope. Resolve accounts by stable identifiers where available; do not infer assignment from names or opportunity-title text. See **Manager Profile and Contract**.

## Skill Modes

The skill has two primary modes and supporting utility modes.

```text
/manager-pod-report-skill setup
/manager-pod-report-skill run
/manager-pod-report-skill run --test-contract <uploaded-or-local-path>
/manager-pod-report-skill check-access
/manager-pod-report-skill show-config
/manager-pod-report-skill edit-config
```

When upgrading an existing manager-specific installation, migrate its skill command and local config to the generic names. A compatibility entry point must resolve a live contract explicitly; it must never cause another manager's run to inherit the wrong contract, manager, sources, or output destination.

## Manager Profile and Contract

Each reporting group is a separate profile. Setup and run must select a profile explicitly or use the sole configured profile; if multiple profiles exist and the intended contract is unclear, ask before proceeding. The live contract selects the manager by `manager_system_user_id` or `manager_alias`; do not take manager identity from a stale local profile value.

Each profile must provide:

- Reporting-group identifier.
- The live contract URL and shared output root for that manager.
- The contract-selected manager identity, using `manager_system_user_id` when available or `manager_alias` otherwise.
- The contract's current version, allowed scope/pillars, report sections, metadata, and validation rules (read from the live contract at setup and before every run).
- The source connectors and, when MSX is used, its semantic-model identifier plus the table/column mapping or profile-specific adapter for resolving reporter identity, account assignments, account IDs, workloads, and organizational scope.
- The manager's rollup handoff destination/owner when applicable.

The contract owns manager selection, business content, and schema; the profile supplies where to retrieve that contract, where to write reports, and which connector reaches the shared semantic model. Resolve the reporting population from the contract-selected manager and the model at run time. The local `reporting-contract.md` supplied with this skill is an example and is not a substitute for a manager's live contract. Contract retrieval failure blocks setup/run; never silently fall back to a local or another manager's contract.

Keep each profile's configuration local to the reporter's agent harness. Do not write private profile configuration or connector credentials to shared report folders.

### Setup Mode

Setup mode creates or updates the colleague's reporting configuration. It does **not** generate a report.

Setup mode should guide the colleague through:

1. Select the reporting profile, resolve the contract-selected manager in the semantic model, and confirm reporter identity.
2. Auto-derived reporting scope — pillar/workload, assignment types, accounts, and organizational units derived through the profile's configured assignment source, presented for confirmation.
3. Report output location.
4. Source defaults.
5. Source access verification.
6. Optional wiki/KB configuration.
7. Privacy and retention preferences.
8. Draft-first review preferences.
9. Live contract version to use for this manager profile.

The setup experience should be conversational and confirm defaults before writing configuration.

Before asking setup questions, the skill must retrieve the live report contract from the selected profile's configured location. The URL below is one example only:

```text
https://microsoft.sharepoint.com/teams/yemiSdirects/Shared Documents/General/Pod Reports/_schema/reporting-contract.md
```

`reporting-contract.md` is the single source of truth for the selected manager profile's requirements (allowed scope and pillars, required metadata, report content shape, and validation rules). Setup and run mode must use the live version configured for that profile, not a bundled example or another manager's contract. A local copy may only be a temporary cache of the file just downloaded during the current run. Treat it as the active requirements before every setup or run.

SharePoint folder view:

```text
https://microsoft.sharepoint.com/:f:/r/teams/yemiSdirects/Shared%20Documents/Forms/AllItems.aspx?id=%2Fteams%2FyemiSdirects%2FShared%20Documents%2FGeneral%2FPod%20Reports%2F%5Fschema&p=true&share=cgolWQiw8PyBQIw7v7O2iD90EgUC%2DtbEDFLCyAESZ6vZZ16P6Q
```

If the selected profile's contract cannot be reached, stop setup/run and ask the user to fix access. Do not silently use a local fallback, because the manager may have changed the requirements. An explicit `run --test-contract <path>` is an isolated test override, not a fallback or substitute for the live contract.

If the selected manager's shared schema folder does not exist, an authorized setup/admin run may create it at that manager's configured location:

```text
<manager-report-root>\_schema\
```

Then upload or verify this file:

```text
<manager-report-root>\_schema\reporting-contract.md
```

The reporting skill should not create or modify a shared contract during normal report generation. Shared contract creation/update is a setup/admin action.

Example setup prompt:

```text
I will set up your pod reporting profile.

By default, I will use the sources configured for your manager's profile (typically Microsoft 365 calendar, meeting recap emails, Teams/chat, OneDrive files, and MSX if this agent has access).

I will not use a wiki or knowledgebase unless you add one.

I will generate draft JSON and HTML reports for review before they are used in a rollup.
```

### Run Mode

Run mode generates one reporter-owned report package for a reporting period and selected manager profile. Normal runs require the live shared contract. An explicit `--test-contract` override may use an uploaded or local contract for isolated testing.

Run mode should:

1. Retrieve and check the selected manager profile's live report contract.
2. Read `reporting-config.yaml`.
3. Confirm or infer the reporting period.
4. Validate configured source access.
5. Retrieve evidence from enabled sources.
6. Resolve each customer/account signal through the selected profile's configured stable account identifiers and assignment source.
7. Determine every required reporting-scope slice containing qualifying reporter activity or other contract-defined qualifying data, and generate packages exactly as the live contract requires.
8. Synthesize report facts into self-describing JSON that conforms to the active schema. Any reporter-owned section defined by the contract must be left empty until supplied directly by the reporter (see **Reporter-Owned Sections**).
9. Render a human-readable HTML dashboard.
10. Once the draft package is complete, ask for direct reporter input for each reporter-owned section required by the contract, and populate those sections from the reporter's reply only — never synthesize them.
11. Mark outputs as `draft` unless explicitly approved.
12. Apply the profile's account eligibility and assignment rules consistently. Any secondary/collaboration handling must follow the active contract.
13. Use the unmapped-account workflow only when the account or organizational scope cannot be resolved through the configured source.
14. Avoid writing shared manifests or raw evidence archives.

Example commands:

```text
/manager-pod-report-skill run --manager <manager-profile-id> --period 2026-06
/manager-pod-report-skill run --period 2026-06
/manager-pod-report-skill run --manager <manager-profile-id> --period 2026-06 --test-contract "<uploaded-or-local-path>"
```

`--manager` is required when more than one manager profile is configured and there is no unambiguous active profile.

### Local Test Contract Override

Use `--test-contract` only when the user explicitly asks to test an uploaded or local contract without changing the shared SharePoint copy.

Test-contract behavior:

1. Resolve the supplied path or current-turn attachment explicitly. Never search for or select a local contract implicitly.
2. Read and validate the entire test contract before querying evidence. It must have a supported schema version, a real manager selector, and no unresolved placeholders in required fields.
3. Continue using the selected manager profile for connector configuration, semantic-model access, and reporter identity.
4. Resolve the contract-selected manager and colleague through the same semantic-model checks as a normal run. A test override changes requirements, not authorization or assignment eligibility.
5. Do not read, modify, upload, or replace the shared SharePoint contract.
6. Force test output to a local or session-scoped directory supplied with `--test-output`, or to a generated session test directory when omitted. Never write test artifacts to the manager's shared output root.
7. Mark every artifact with `"test_mode": true` and record the local test contract path, schema version, and content hash in `schema_contract`.
8. Keep status `draft`. Test artifacts are ineligible for rollup and must not be approved or promoted to `final`.
9. Display a clear completion message stating that the shared contract and shared report folders were unchanged.

Example:

```text
/manager-pod-report-skill run --manager <manager-profile-id> --period 2026-06 --test-contract "C:\path\to\reporting-contract.md" --test-output "C:\path\to\pod-report-test"
```

When the contract is attached to the current request rather than saved at a stable path, the harness may stage it in session storage and use that resolved file as `--test-contract`. Record the staged path in metadata and delete it at session cleanup when it is temporary.

### Reporter-Owned Sections

Any section the live contract marks as reporter-owned is authored by the reporter, not the agent. The agent must never generate, infer, or pre-fill it from evidence (blockers, risks, milestones, pipeline, or anything else).

Once the draft package is complete — and before the report is finalized — prompt the reporter for each such section, for example:

> Before I finalize, is there anything you'd like to add to the reporter-owned section(s) in your manager's report? I will use only what you provide. Reply with your text, or say "none".

Then:

- Insert the reporter's input **verbatim**, mapped only to the structure the active contract defines for each section — never reworded, ranked, or expanded with invented content.
- If the reporter says "none" (or provides nothing), leave the section empty, or use the contract-defined empty placeholder if one exists.
- Run this step on every `run`, after the draft is generated and before the report is finalized.

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
| Assignment source | Query the selected manager profile's configured mapping for the reporter's current assignments |
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

### 2. Reporting Scope and Accounts (auto-derived)

The skill does **not** ask the reporter to hand-curate an account list or select a fixed set of report scopes. Resolve the reporter's identity and derive their workload/pillar, current account assignments, and organizational scope from the assignment source configured in the selected manager profile (see **Account Assignment & Scope Mapping**).

Auto-derivation flow:

1. Read `manager_system_user_id` or `manager_alias` from the live contract.
2. Resolve exactly one manager in `AccountAssignmentsWithCustomerIds`, preferring `ManagerSystemUserId` over `ManagerAlias`.
3. Resolve the reporter's `systemuserid` from their signed-in M365 email.
4. Query current assignment rows where `ManagerSystemUserId` identifies the resolved manager and `AssignedSystemUserId` identifies the reporter.
5. Map `Workload` to the reporting pillar using the live contract's allowed values.
6. Group eligible accounts by `AssignmentType` and contract-defined organizational scope (`ATU` for the supplied contract).
7. Present the resolved manager, workload, scope, and account-assignment summary for confirmation.
8. Save source preferences locally. Treat the live contract and semantic model as runtime truth rather than persisting manager membership or a hand-maintained customer list.

Read allowed pillars and scope values from the selected profile's live `reporting-contract.md`; do not hardcode a manager's allowed set in the skill.

Example confirmation prompt:

```text
I found your current account assignments for <manager>:

Pillar: apps
Primary accounts: 15 across <scope values>
Secondary accounts: 21 across <scope values>

These assignments will be refreshed from the configured source each time the report runs.
```

Edge cases:

- **Multiple workloads** — present the detected workloads and ask which pillar to report under, or generate one profile per pillar when the contract permits it.
- **Manager missing or ambiguous** — stop. Ask for the live contract to be corrected; never select a similarly named manager.
- **No current assignment rows under the selected manager** — treat the reporter as outside that manager's current reporting population unless the active contract explicitly defines another path.
- **Unresolved account or scope** — record the mapping gap and use the unmapped-account workflow. Do not guess from opportunity-name text.

### 3. Report Location

Normal final report output must go to the shared output location configured in the selected manager profile. Generate report artifacts for every scope slice required by the live contract. Test-contract runs must instead use their isolated local/session test output.

Configured output root:

```text
<manager_profile.workspace.shared_output_root_url>
```

The colleague should not choose an arbitrary output root unless they are doing a local test run.

The contract/profile determines folder and filename patterns. A typical pattern is:

```text
{shared_output_root}\{scope}\{yyyy-mm}\{pillar}-{person_slug}.json
{shared_output_root}\{scope}\{yyyy-mm}\{pillar}-{person_slug}.html
```

Example:

```text
{shared_output_root}\{scope_value}\2026-06\{pillar}-{person_slug}.json
{shared_output_root}\{scope_value}\2026-06\{pillar}-{person_slug}.html
```

If activity spans multiple scopes, generate the artifact set required by the live contract for each qualifying scope:

```text
{shared_output_root}\{scope_a}\2026-06\{pillar}-{person_slug}.json
{shared_output_root}\{scope_a}\2026-06\{pillar}-{person_slug}.html
{shared_output_root}\{scope_b}\2026-06\{pillar}-{person_slug}.json
{shared_output_root}\{scope_b}\2026-06\{pillar}-{person_slug}.html
```

The implementation may use a synced local path, a SharePoint/OneDrive URL, or Microsoft Graph upload depending on the harness. The logical output root remains the location configured for that manager.

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
    use_as: "opportunities_milestones_pipeline_deal_team_account_assignments_atu_mapping"

  wiki:
    enabled: false
    path: null
    use_as: "optional_private_knowledgebase"
```

The setup prompt should ask:

```text
These are the available sources configured for <manager>'s profile:
- M365 calendar
- M365 email recaps and follow-ups
- M365 Teams/chat where available
- M365 files and attachments
- MSX opportunities and milestones, if configured and authorized

I will not use a wiki or KB unless you add one.

Would you like to change which sources are enabled for this manager?
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

## Local Configuration File and Manager Profiles

Setup mode should create or update:

```text
reporting-config.yaml
```

This file is **local to the reporter's agent harness**. It should not be stored in a shared report folder because it may contain local paths, manager-specific locations, source preferences, access verification status, or private wiki/KB paths.

Recommended local locations:

```text
~/.copilot/manager-pod-report-skill/reporting-config.yaml
```

or:

```text
%USERPROFILE%\.copilot\manager-pod-report-skill\reporting-config.yaml
```

Example config:

```yaml
schema_version: "1.0"
skill: "manager-pod-report-skill"

owner:
  name: "<reporter name>"
  alias: "<reporter-alias>"
  email: "<reporter-email>"

active_manager_profile: "<manager-profile-id>"

manager_profiles:
  "<manager-profile-id>":
    workspace:
      shared_output_root_url: "<manager-specific shared report root>"
      folder_pattern: "{scope}\\{yyyy-mm}"
      file_pattern: "{pillar}-{person_slug}"
    schema_contract:
      contract_url: "<manager-specific live reporting-contract.md URL>"
      version: null
      require_shared_check: true
      fallback_allowed: false
    assignment_source:
      type: "power_bi_semantic_model"
      resource_id: "6df78dc8-768b-4fb7-b213-3ab6bfeb7c2f"
      assignment_table: "AccountAssignmentsWithCustomerIds"
      account_table: "Accounts"
      reporter_id_column: "AssignedSystemUserId"
      manager_id_column: "ManagerSystemUserId"
      manager_alias_column: "ManagerAlias"
      account_id_column: "DataverseAccountId"
      workload_column: "Workload"
      assignment_type_column: "AssignmentType"
      scope_column: "ATU"
    rollup:
      owner: "<manager or rollup skill>"
      destination_url: "<optional manager-specific rollup location>"
    sources:
      m365_calendar:
        enabled: true
      m365_email:
        enabled: true
      m365_teams:
        enabled: true
      m365_files:
        enabled: true
      msx:
        enabled: true

# Manager-profile source settings override shared connector defaults.
# Never reuse one manager's source settings, model ID, or account mapping for another manager.

reporting:
  default_period: "previous_month"
  draft_first: true
  require_review_before_rollup: true
  output_formats:
    - json
    - html

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
    use_as: "opportunities_milestones_pipeline_deal_team_and_configured_assignment_mapping"
    resource_id: "<manager-profile-specific-model-or-source-id>"
    access_method: "<configured connector>"

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

Account assignments and activity-bearing scope slices are refreshed from the selected profile's configured assignment source at run time rather than stored as a hand-maintained local mapping:

```yaml
assignment_profile:
  source: "active_manager_profile.assignment_source"
  refresh_each_run: true
  match_on: "active_manager_profile.assignment_source.identity_mapping"
```

Use the active profile's live assignment source to classify account eligibility and assignment context. If an account or scope cannot be resolved, use the unmapped-account workflow; do not ask the reporter to maintain a parallel account list.

## Access Verification Behavior

Setup mode and run mode should both verify access.

The first access check should be the selected manager profile's shared report contract:

| Asset | Required behavior |
|---|---|
| Manager profile's configured contract location | Must be reachable before setup/run continues |
| Live `reporting-contract.md` for the selected manager | Read from the configured shared location; single source of truth for report requirements and validation rules |

If the selected manager's contract cannot be reached, stop and ask the user to repair access. Do not use a local `_schema` folder, bundled example, or another manager's contract as a fallback.

The only exception is an explicit `run --test-contract <path>` invocation. In that mode, validate and use exactly the supplied test contract, do not treat it as the live contract, and do not write to shared output locations. A normal `setup`, `run`, or `check-access` without `--test-contract` must still require the live shared contract.

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

## Report Output Contract

The manager-specific monthly output folder is a clean publish surface, not an evidence archive.

Use a manifestless reporter-output layout unless the active contract says otherwise. This skill only writes person/pillar report files. It does not write rollups.

```text
<manager-report-root>\
  <scope>\
    2026-06\
      <pillar>-<reporter>.json
      <pillar>-<reporter>.html
```

Rules:

1. Each reporter writes only their own `{pillar}-{person_slug}.json` and `.html` files.
2. No shared mutable `manifest.json` is required.
3. This skill does not create rollups, aggregate files, or shared indexes.
4. The selected manager's separate rollup process is responsible for reading report JSON files and creating rollups/adapters.

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

The required metadata structure is defined by the selected manager's live shared contract so that manager can evolve reporting requirements without changing every reporter's local config.

An example shared contract location is:

```text
Pod Reports\_schema\reporting-contract.md
```

The skill must read the selected manager's configured contract from its shared location during setup and normal run mode. If that contract is unavailable, stop and ask the user to restore access rather than using a local fallback. An explicit test-contract run reads only its supplied test contract and remains isolated from shared outputs.

Metadata envelope:

```json
{
  "schema_version": "<active_contract_version>",
  "artifact_type": "person_pillar_report",
  "report_id": "<scope>-<period>-<pillar>-<person_slug>",
  "manager_profile": "<manager-profile-id>",
  "scope": "<contract-defined-scope>",
  "scope_metadata": {
    "<contract-required-key>": "<contract-required-value>"
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
    "name": "<reporter name>",
    "alias": "<reporter alias>"
  },
  "manager": {
    "name": "<resolved manager name>",
    "alias": "<resolved manager alias>",
    "system_user_id": "<resolved manager systemuserid>"
  },
  "status": "draft",
  "review": {
    "status": "draft",
    "approved_by": null,
    "approved_at": null
  },
  "source_profile": "<configured-source-profile>",
  "sources_requested": ["m365_calendar", "m365_email", "m365_files", "m365_teams", "msx"],
  "sources_used": ["m365_calendar", "m365_email_full_bodies", "m365_files", "msx"],
  "sources_unavailable": [],
  "source_coverage": {},
  "schema_contract": {
    "source": "manager_profile.shared_contract",
    "version": "<active_contract_version>",
    "path": "<profile-defined-contract-path>",
    "fallback_used": false,
    "test_mode": false,
    "content_hash": "<contract-content-hash>"
  },
  "companion_files": {
    "html": "<pillar>-<person_slug>.html"
  },
  "generation": {
    "generated_at": "",
    "generator": "manager-pod-report-skill",
    "retained_intermediate_evidence": false
  }
}
```

This is the metadata envelope the skill owns — the fields that make the file self-describing. The report's business sections live alongside this envelope in the same JSON object, but their structure and every field inside them are defined by the selected manager's live contract (`reporting-contract.md`). Read that contract at run time and build sections to match its current requirements — do not hardcode its section list or field names here. Any reporter-owned section is populated only from the reporter's own input, gathered after the draft is complete (see **Reporter-Owned Sections**), and is never synthesized from evidence; only its structure comes from the contract.

The envelope is illustrative: replace placeholders and include the exact metadata keys and structures required by the active contract. Do not emit placeholder values.

## HTML Dashboard Requirements

The report's content shape — required sections, customer-card fields, dashboard filters, status conventions, source separation, and business-facing presentation — is owned by the selected manager's live contract, read from its configured location before every run. Build the dashboard to match that contract. Do not restate its section or field lists here.

Skill-side rendering mechanics (not owned by the contract):

1. HTML dashboards must be self-contained single files.
2. Render the same facts as the JSON — never re-derive, add, or omit content in the HTML.
3. If generated in Clawpilot, use the Clawpilot theme variables required by the web artifacts builder skill.

## Account Assignment & Scope Mapping

The selected manager profile configures the authoritative assignment source, reporter-identity mapping, account-identity mapping, workload/pillar mapping, assignment types, and organizational-scope fields. The source may be an MSX semantic model or another approved system. Do not assume a particular model ID, table name, manager, or set of scope values.

At setup and at the start of every run:

1. Read the selected manager from the live contract. Require `manager_system_user_id` or `manager_alias`.
2. Resolve the selected manager against `AccountAssignmentsWithCustomerIds`. Prefer an exact, case-insensitive `ManagerSystemUserId` match; use an exact, case-insensitive `ManagerAlias` match only when the contract does not supply the ID. Require the matching rows to resolve to exactly one manager ID.
3. Resolve the reporter in `systemuser` from their signed-in M365 email. Never hardcode user IDs.
4. Query `AccountAssignmentsWithCustomerIds` for rows matching both the resolved `ManagerSystemUserId` and reporter `AssignedSystemUserId`, then filter to the selected workload/pillar.
5. Match accounts through `DataverseAccountId`; do not infer assignments from account-name text embedded in opportunity names.
6. Apply eligibility, primary/secondary precedence, and collaboration classification exactly as the live contract defines.
7. Derive each report's organizational scope from `ATU` on the authoritative assignment row. Use only scope values allowed by the live contract.
8. Generate report slices and include or exclude signals exactly as the live contract specifies.

Do not persist a second hand-maintained manager membership or account list in local configuration. If the reporter has no current eligible assignment rows under the contract-selected manager, apply the live contract's population rule; do not infer manager membership or eligibility from historical opportunity, milestone, or activity records alone. If a manager, account, or scope cannot be resolved, stop or record the mapping gap as required by the contract; never guess.

The shared model uses `AccountAssignmentsWithCustomerIds` as the authoritative manager-to-colleague assignment table and resolves Dataverse account IDs through `Accounts`. Its relevant assignment columns are `Manager`, `ManagerAlias`, `ManagerSystemUserId`, `AssignedAlias`, `AssignedSystemUserId`, `Workload`, `AssignmentType`, `ATU`, and `DataverseAccountId`.

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

#### Shared manager-scoped MSX adapter

The following model and mapping apply to every manager selected by a live contract that uses this shared source. Manager scope always comes from the contract plus `AccountAssignmentsWithCustomerIds`; changing contracts must not change the model mapping or bypass manager filtering.

Access MSX through this Power BI semantic model:

```
Artifact ID: 6df78dc8-768b-4fb7-b213-3ab6bfeb7c2f
Tools: mcp__pbi_fabricaihub__ExecuteQuery / mcp__pbi_fabricaihub__GetSemanticModelSchema  (harness-specific prefix; resolve the registered tool names when needed)
```

The model contains reporting tables such as `opportunity`, `opportunityproduct`, `msp_dealteam`, `PodMilestones`, `task`, `systemuser`, `product`, `Accounts`, and `AccountAssignmentsWithCustomerIds`.

- **`PodMilestones`** is the milestone table and the primary milestone source — one row per **pod member × milestone**, scoped to the milestones the pod is actually staffed on via MSX milestone **access teams** (not via opportunity deal-team membership). This is the "milestones we're on, not just opportunities we're on" grain. Filter `[Pod Member ID]` directly using the resolved reporter `systemuserid`; do not rely on `systemuser` filter propagation. `[Status]`, `[Category]`, and `[Solution Area]` are already decoded to readable text; `[Monthly ACR]` carries the milestone's monthly usage/ACR value; and `[Commitment Recommendation]` is the milestone's committed-consumption flag — either `Committed` or `Uncommitted` — which is the **authoritative source for the `u2c_conversion_wins` scorecard metric** (see the U2C note under Step 2). Do not infer U2C from `[Category]` or `[Status]`.
- **`task`** holds the pod's technical activities (Demos, ADS, PoCs, Blocker Escalations, etc.); its **category** field (`msp_taskcategoryname`) is the key classifier — see Step 3.
- There is **no `msp_engagementmilestone` table in the model** — that was a Power Query staging source and is not loaded. Always query milestones through `PodMilestones`.

**Step 0 — Resolve and validate the contract-selected manager:**

Prefer `manager_system_user_id`; use `manager_alias` only when the ID is absent. Substitute an empty string for a selector the contract does not provide:

```dax
EVALUATE
VAR ManagerId = LOWER(TRIM("<MANAGER_SYSTEM_USER_ID>"))
VAR ManagerAlias = LOWER(TRIM("<MANAGER_ALIAS>"))
RETURN
DISTINCT(
    SELECTCOLUMNS(
        FILTER(
            AccountAssignmentsWithCustomerIds,
            (ManagerId <> ""
                && LOWER(TRIM(AccountAssignmentsWithCustomerIds[ManagerSystemUserId])) = ManagerId)
            || (ManagerId = ""
                && ManagerAlias <> ""
                && LOWER(TRIM(AccountAssignmentsWithCustomerIds[ManagerAlias])) = ManagerAlias)
        ),
        "Manager", AccountAssignmentsWithCustomerIds[Manager],
        "ManagerAlias", AccountAssignmentsWithCustomerIds[ManagerAlias],
        "ManagerSystemUserId", AccountAssignmentsWithCustomerIds[ManagerSystemUserId]
    )
)
```

Require at least one result row and exactly one distinct nonblank `ManagerSystemUserId`. If the selector is missing, unmatched, or ambiguous, stop and ask for the live contract to be corrected.

**Step 0a — Auto-resolve the colleague's systemuserid:**

Never hardcode systemuserids. Resolve dynamically at runtime using the colleague's M365 email (available from session context — `mcp__me_profile__GetMyDetails` returns it):

```dax
EVALUATE
FILTER(
    SELECTCOLUMNS(systemuser, "ID", [systemuserid], "Email", [internalemailaddress]),
    [Email] = "<signed-in-user-email>"
)
```

If the query returns no rows, the colleague cannot be validated against authoritative assignments. Stop the run unless the live contract explicitly permits a non-MSX population path; do not produce an M365-only report that bypasses the assignment gate.

**Step 0b — Validate the colleague under the selected manager and retrieve assignments:**

```dax
EVALUATE
SELECTCOLUMNS(
    FILTER(
        AccountAssignmentsWithCustomerIds,
        LOWER(TRIM(AccountAssignmentsWithCustomerIds[ManagerSystemUserId]))
            = LOWER(TRIM("<RESOLVED_MANAGER_SYSTEM_USER_ID>"))
        && LOWER(TRIM(AccountAssignmentsWithCustomerIds[AssignedSystemUserId]))
            = LOWER(TRIM("<REPORTER_SYSTEM_USER_ID>"))
        && AccountAssignmentsWithCustomerIds[AssignmentType] IN {"Primary", "Backup"}
    ),
    "Manager", AccountAssignmentsWithCustomerIds[Manager],
    "ManagerAlias", AccountAssignmentsWithCustomerIds[ManagerAlias],
    "ManagerSystemUserId", AccountAssignmentsWithCustomerIds[ManagerSystemUserId],
    "AssignedAlias", AccountAssignmentsWithCustomerIds[AssignedAlias],
    "AssignedSystemUserId", AccountAssignmentsWithCustomerIds[AssignedSystemUserId],
    "Workload", AccountAssignmentsWithCustomerIds[Workload],
    "AssignmentType", AccountAssignmentsWithCustomerIds[AssignmentType],
    "ATU", AccountAssignmentsWithCustomerIds[ATU],
    "DataverseAccountId", AccountAssignmentsWithCustomerIds[DataverseAccountId],
    "Account", AccountAssignmentsWithCustomerIds[AccountName],
    "DataverseAccountName", AccountAssignmentsWithCustomerIds[DataverseAccountName]
)
ORDER BY [Workload], [ATU], [Account]
```

Apply the live contract's workload/pillar mapping after retrieval. If this query returns no eligible rows, the colleague is not in the selected manager's current reporting population. Stop rather than retrieving another manager's rows or inferring membership.

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

`PodMilestones` is already scoped to milestone access teams. Filter it to the colleague directly with `PodMilestones[Pod Member ID] = <resolved systemuserid>`. Do **not** filter `systemuser` and assume that filter reaches `PodMilestones`.

```dax
EVALUATE
SELECTCOLUMNS(
    FILTER(
        PodMilestones,
        LOWER(PodMilestones[Pod Member ID]) = LOWER("<SYSTEMUSERID>")
            && PodMilestones[Status] <> "Completed"
            && PodMilestones[Status] <> "Cancelled"
    ),
    "Milestone", PodMilestones[Milestone],
    "Status", PodMilestones[Status],
    "Category", PodMilestones[Category],
    "Solution Area", PodMilestones[Solution Area],
    "Monthly ACR", PodMilestones[Monthly ACR],
    "Commitment Recommendation", PodMilestones[Commitment Recommendation],
    "Milestone Date", PodMilestones[Milestone Date],
    "Opportunity ID", PodMilestones[Opportunity ID],
    "Opportunity", RELATED(opportunity[name]),
    "Customer ID", RELATED(opportunity[customerid]),
    "Account", RELATED(Accounts[AccountName])
)
ORDER BY [Monthly ACR] DESC
```

Drop the two `[Status]` filters to include Completed/Cancelled history. Full `PodMilestones` columns: `Pod Member ID`, `Milestone ID`, `Milestone`, `Milestone Date`, `Status`, `Category`, `Solution Area`, `BACV`, `Monthly ACR`, `Commitment Recommendation`, `Risk / Blocker Details`, `Opportunity ID`, `Owner ID`, `Milestone Key`.

Milestone access-team presence is inventory, not proof that work occurred during the reporting period. Use reporting-period HoK tasks and M365 evidence, following the live contract, to determine whether an account has qualifying activity and therefore receives an ATU report slice. Do not use `Milestone Date` alone as the activity date.

**U2C conversion wins (`u2c_conversion_wins`) — source from `[Commitment Recommendation]`.** The scorecard's U2C metric means *usage-to-consumption: milestones that moved from **uncommitted** to **committed**.* The model exposes this directly as the `[Commitment Recommendation]` column (values: `Committed` / `Uncommitted`). Compute U2C as the colleague's milestones flagged **`Committed`**, excluding `Cancelled` (and `Hygiene/Duplicate`) status rows. Report the **count** (headline) and total **Monthly ACR** of those committed milestones; where useful, list the distinct accounts. Notes:

- **Do not** derive U2C from `[Category]` (POC/Pilot vs Production) or from `[Status] = "Completed"` — those describe milestone *type* and *lifecycle*, not commitment. A `Completed` POC/Pilot can be `Committed`, and a `Production` milestone can still be `Uncommitted`; only `[Commitment Recommendation]` is authoritative.
- Count by **milestone** by default. If the reporter prefers to count by opportunity, dedupe on `[Opportunity ID]` (two committed milestones on the same opp = one conversion) and say which convention was used.
- The model has no commitment-*date* column, so U2C reflects current committed state rather than a commit that provably occurred within the reporting month; treat it consistently with how `owned_pipeline` is counted and note the caveat if the reporter asks for strict in-month attribution.

U2C-only query (committed milestones for the colleague):

```dax
EVALUATE
SELECTCOLUMNS(
    FILTER(
        PodMilestones,
        LOWER(PodMilestones[Pod Member ID]) = LOWER("<SYSTEMUSERID>")
            && PodMilestones[Commitment Recommendation] = "Committed"
            && PodMilestones[Status] <> "Cancelled"
            && PodMilestones[Status] <> "Hygiene/Duplicate"
    ),
    "Milestone", PodMilestones[Milestone],
    "Commitment Recommendation", PodMilestones[Commitment Recommendation],
    "Status", PodMilestones[Status],
    "Category", PodMilestones[Category],
    "Monthly ACR", PodMilestones[Monthly ACR],
    "Opportunity", RELATED(opportunity[name])
)
ORDER BY [Monthly ACR] DESC
```

**Step 3 — Query the colleague's technical activities (via `task`, especially the category):**

The `task` table classifies activities by `msp_taskcategoryname`; the field is useful for activity-mix and blockers sections. Filter to the reporter by the configured owner relationship and apply the selected-manager assignment gate before including the account. Surface open blocker tasks only in the contract-defined risks section. Do **not** use them to populate any reporter-owned section.

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
    FILTER(ALL(systemuser), systemuser[internalemailaddress] = "<signed-in-user-email>"),
    task[scheduledend] >= <REPORT_PERIOD_START>,
    task[scheduledend] < <REPORT_PERIOD_END_EXCLUSIVE>
)
ORDER BY [Due] DESC
```

`statecode`: 0 = Open, 1 = Completed, 2 = Canceled. Roll up counts by `Category` for an activity-mix view.

**Notes:**
- **GUID casing:** `msp_dealteamuserid` stores GUIDs in uppercase. Always apply `UPPER()` when comparing against a resolved systemuserid to avoid case mismatch.
- **Current reporting population:** A colleague with no current rows in `AccountAssignmentsWithCustomerIds` for the contract-selected `ManagerSystemUserId` is outside that manager's current reporting population, even if historical milestone presence remains in `PodMilestones`.
- **Names / accounts:** Resolve `PodMilestones[Opportunity ID]` → `opportunity[customerid]` → `Accounts[DataverseAccountId]` → eligible `AccountAssignmentsWithCustomerIds[DataverseAccountId]` rows for the resolved manager and reporter. Use the Dataverse ID path for account and ATU classification; do not parse opportunity-name text.

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

Do not require a wiki/KB for reporters.

## Source Weighting

Use the following source roles when those connectors are configured:

| Source | Role |
|---|---|
| Configured assignment/pipeline source (for example MSX) | Pipeline, milestone, activity, account-assignment, and organizational-scope truth |
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

The selected manager's rollup process can decide whether to include only approved reports, include drafts with labels, or exclude stale/invalid files. This skill only writes the review status into the reporter-owned JSON.

## Rollup Handoff Boundary

This manager reporting skill does not implement rollup discovery.

For normal runs, it guarantees that each generated JSON file is self-describing and written to the selected manager profile's shared output location. Test-contract runs write only to their isolated test output and are ineligible for rollup. The manager's separate rollup process is responsible for discovering normal reports, filtering by status/schema/scope/period, and creating audience-specific outputs.

Write boundaries:

| Actor | Reads | Writes |
|---|---|---|
| Manager reporting skill | Own configured sources | Own `{pillar}-{person}.json/html` |
| Manager's rollup process | Reporter person/pillar JSON files | Rollup and audience-specific artifacts |

No shared reporter-level manifest is required.

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
{manager_output_root}\{scope}\{YYYY-MM}\{pillar}-{person}.json
{manager_output_root}\{scope}\{YYYY-MM}\{pillar}-{person}.html

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
{manager_output_root}\{scope}\2026-06\{pillar}-{person}.json
{manager_output_root}\{scope}\2026-06\{pillar}-{person}.html

Status: draft
Sources used: M365 calendar, M365 email full bodies, M365 files, MSX
Sources unavailable: Teams chat
Raw evidence retained: no
Contract: {manager_profile.contract_url} v{active_contract_version}
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

6. **Generate only contract-defined scope slices.** Each run produces the report artifacts required by the active contract for each qualifying scope. Do not write to shared rollup files or other reporters' report files.

7. **Managers and reporters have different service access.** Do not assume MSX, Teams transcripts, or wiki/KB are available. Degrade gracefully, record what was and wasn't available in the JSON metadata, and explain the gap to the user.

8. **Raw evidence is not retained.** Do not persist raw email bodies, Teams messages, calendar dumps, or MSX payloads to disk. Synthesize and summarize only.

9. **Resolve the manager's contract first.** Normal runs require the configured live contract and must stop if it cannot be reached. Use a local or uploaded contract only through the explicit `--test-contract` mode, mark all outputs as test drafts, and keep them out of shared folders and rollups.

10. **Reporter-owned sections stay reporter-owned.** Never generate, infer, or pre-fill these sections from evidence. Populate them only from the reporter's direct input, captured after the draft is complete. If the reporter provides none, leave them empty or use the contract's defined empty-state placeholder.

11. **Report generation is non-destructive.** Treat shared contracts, source data, other colleagues' reports, and approved/final reports as read-only. Replacing an existing draft requires the reporter's explicit approval.

## Summary

This skill should make pod reporting easy across managers by combining manager-profile configuration with run-time evidence retrieval.

The durable contract is simple:

```text
{pillar}-{person}.json
{pillar}-{person}.html
```

The JSON is self-describing. The HTML is human-readable. There is no shared mutable manifest. Raw evidence is not retained by default. Colleagues can use M365 and MSX without curating a wiki, while wiki-backed users can optionally add their own knowledgebase as another source.
