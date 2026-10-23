# Manager Pod Report Skill

**Skill name:** `manager-pod-report-skill`

## What this skill does

The skill generates monthly, manager-scoped pod reports from the sources configured for that manager. It creates:

- A **JSON** file as the canonical, machine-readable report.
- A matching **HTML** dashboard for human review.

Reports are draft-first. A reporter reviews and approves a report before the manager's separate rollup process uses it.

Each manager has an independent local profile containing its live report-contract URL, output root, connector and assignment-source mappings, and rollup handoff details. The skill applies the selected manager's live contract; it does not assume managers share the same team scope, reporting requirements, data model, or SharePoint location.

The `reporting-contract.md` included with this repository is the Yemi profile's contract, supplied as a concrete reference. It is **not** the default contract for other managers. Do not copy its allowed ATUs, pillars, MSX identifiers, URLs, report sections, or manager-specific wording into another profile.

## Install

1. Download `SKILL.md` from the skill's maintained distribution location.
2. Create a `manager-pod-report-skill` folder in your personal skills location and put `SKILL.md` inside it.
   - **Cowork:** `Documents/Cowork/skills/manager-pod-report-skill/SKILL.md`
   - **Other local harnesses:** use the agent's skills directory.
3. Reload the agent session and verify it responds to `/manager-pod-report-skill`.

When upgrading an existing Yemi installation, migrate its command and local config to the generic names. If the host keeps `/yemi-pod-report-skill` as a compatibility entry point, bind it explicitly to the Yemi profile only.

## Configure a manager profile

Run:

```text
/manager-pod-report-skill setup
```

Setup confirms the reporter and manager, reads the manager's live contract, discovers the reporting scope using that profile's configured assignment source, verifies connector access, and creates or updates a local configuration. The manager profile must supply:

- Manager identity and reporting-group identifier.
- Live contract URL and shared report-output root.
- Assignment source and mappings for reporter identity, account IDs, workload/pillar, assignment type, and organizational scope.
- Available source connectors and their resource/model IDs.
- Optional rollup owner and destination.

The local configuration stays in the reporter's agent harness; it must not be uploaded to a shared report folder. The skill checks the live contract before setup and every run. If the contract is unavailable, setup/run stops; a bundled contract or another manager's contract is never used as a fallback.

## Generate a report

```text
/manager-pod-report-skill run --manager <manager-profile-id> --period 2026-06
```

If there is more than one configured manager profile, use `--manager <manager-profile-id>` or select the intended manager before running. The skill applies that profile's live contract, refreshes account assignments from the configured source, validates the period and source access, retrieves evidence, and writes report files to the configured output location. It records unavailable sources and their impact in the JSON.

Other commands:

| Command | What it does |
|---|---|
| `/manager-pod-report-skill setup` | Create or update manager profiles and reporter settings |
| `/manager-pod-report-skill run` | Generate a report package for a period |
| `/manager-pod-report-skill check-access` | Verify contract and configured source access |
| `/manager-pod-report-skill show-config` | Display the current local configuration |
| `/manager-pod-report-skill edit-config` | Change the local configuration |

## Report output and ownership

The manager profile and live contract define the output root, scope-folder pattern, and required artifact set. A typical layout is:

```text
{manager_output_root}\{scope}\{yyyy-mm}\{pillar}-{person_slug}.json
{manager_output_root}\{scope}\{yyyy-mm}\{pillar}-{person_slug}.html
```

The skill writes only the reporter's own artifacts. It does not create shared manifests, rollups, aggregate reports, or raw-evidence archives.

## Access and privacy

The active manager's contract must be reachable before setup or run. Other configured sources (such as Microsoft 365, MSX, Teams, or a wiki/KB) are probed independently. If an enabled source is unavailable, the skill reports the issue and asks whether to continue, disable it, or stop. Degraded runs record missing-source details rather than claiming the source was used.

Raw email bodies, Teams messages, calendar dumps, and source payloads are not retained by default. HR, compensation, and legal content is excluded. Reports remain `draft` unless the reporter explicitly approves them.

## Troubleshooting

| Symptom | What to do |
|---|---|
| Skill doesn't respond | Check the folder name and that `SKILL.md` sits directly inside it; reload the session |
| Setup stops before profile creation | Verify access to the selected manager's configured live contract |
| Assignment scope looks wrong | Correct the authoritative assignment source or profile mapping; do not maintain a separate local account list |
| A source is unavailable | Use `check-access`; authorize it, disable it for this profile, or proceed only with explicit degraded-mode approval |
| No report is produced | Check the live contract's qualification rules and whether any activity or other qualifying data exists in the reporting period |
