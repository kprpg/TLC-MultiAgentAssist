---
name: mcaps-seller-performance-dashboard
description: Build a private manager-ready dashboard of official MSX Earnings attainment, quota gaps, and account-scoped pipeline. Requires the user's own Quota by Accounts export from MSX Earnings.
version: 1.0.0
---

# MCAPS Seller Performance Dashboard

## Purpose and triggers

Use when a Microsoft seller asks for an attainment dashboard, quota-gap analysis,
pipeline coverage, a manager performance briefing, or a recurring performance
dashboard. This is an implementation package, not just a prompt.

Explain where the seller stands using **official MSX Earnings**, identify metric
and account dollar gaps, show the pipeline available to address them, and make
missing pipeline or missing evidence explicit. Never substitute gross Azure
consumption pacing for compensation attainment.

## Mandatory prerequisite: the user's own quota report

Before creating a dashboard, require the user to provide **their own Quota by
Accounts report downloaded from MSX Earnings**, exported as a local CSV for the
appropriate fiscal year.

Do not reuse another seller's export, sample data, a remembered account roster,
or an old dashboard's numbers. The package contains no quota or customer data.
Ask for the downloaded CSV's absolute path if it has not been supplied. If the
user supplies only a cloud sharing URL, ask for the downloaded export; do not
work around cloud document rights by parsing a synced or protected copy.

Expected export columns:

`Account Name`, `Metric Name`, `Credit Month`, `Unit`, `Total Quota`,
`Account Type`, `Fiscal Year`, `Bucket Name`, `TPID`.

The importer accepts a UTF-8 BOM and Excel's optional `sep=,` preamble. It
validates rows, dates, amounts, fiscal year, account grain, duplicate keys and
units before use. A malformed or incompatible export is a blocker, not a reason
to fill missing values with zero.

## Supported scope and dependencies

Version 1 supports **USD monetary, account-quota plans** whose MINT responses
provide official performance, account summaries and monthly PCG calculations.
Account grain must be `EndCustomerTopParentName`; the bounded pipeline adapter
supports up to 200 TPIDs. Buckets, weights, metrics, account count and fiscal
period are discovered from the user's data, not fixed to a particular seller.

Seat-count, percentage, non-USD and unsupported compensation schemas must fail
with an explicit explanation. Do not imply that every MCAPS plan has identical
crediting rules. Unrecognized workload-to-metric mappings remain a review task.
Negative calculated bucket targets are unsupported. Zero targets and partial-month
official periods are supported without inventing percentages or prorating source
dollars. Truncated MINT summaries are rejected even if the TPID count is below
the pipeline adapter's limit.

Required environment:

- Windows, with Python 3.11 or newer, Node.js compatible with the installed MSX
  MCP plugin, Azure CLI, and Microsoft Edge.
- An installed, trusted MSX MCP runtime with `get_earnings` support. This package
  does not redistribute that runtime or its dependencies.
- The seller's own authorized corporate MSX/MINT access and network connectivity.
- A host that can run the bundled Python scripts and, optionally, schedule them.

No third-party Python packages are required for the default local-timezone
configuration. An explicitly chosen IANA timezone requires timezone data available
to Python; otherwise select the machine's local timezone deliberately.

## First-run onboarding

1. Resolve this installed skill's root directory. Use paths relative to that root;
   never assume the submitter's home folder, synchronization provider or drive.
2. Ask for the user's downloaded quota CSV if missing. Confirm the report's fiscal
   year and that it belongs to the signed-in seller.
3. Check available MSX authentication before live reads. If sign-in is needed,
   tell the user a browser will open and request their authorized corporate
   account. Do not switch tenants, sign out, or change account defaults silently.
4. Resolve the trusted installed MSX MCP bundle, corporate tenant ID and MSX
   Dataverse organization URL from the user's approved environment. The setup
   helper can discover an unambiguous installed bundle. Supply the tenant and
   organization URL explicitly; supply the bundle path if discovery is ambiguous.
   Never guess tenant IDs or send tokens to an arbitrary URL.
5. Confirm the reporting timezone and a profile name. Default `local` means the
   automation machine's timezone, not the author's timezone. A profile is a
   local configuration boundary, not a way to impersonate another seller.
6. Explain storage before setup: configuration, imported quota, source snapshots
   and rendered-dashboard data are encrypted for the current Windows user.
   They live under
   `%LOCALAPPDATA%\MicrosoftScout\MCAPSSellerPerformanceDashboard\<profile>`.
   No private data belongs in the installed skill folder.
7. Validate and set up using the bundled entry point. Substitute confirmed values
   into the commands below; never execute literal angle-bracket placeholders.

```powershell
python "<SKILL_ROOT>\scripts\build_dashboard.py" --diagnose
python "<SKILL_ROOT>\scripts\build_dashboard.py" --validate-quota "<OWN_QUOTA_CSV>"
python "<SKILL_ROOT>\scripts\build_dashboard.py" --setup --profile "<PROFILE>" --quota-csv "<OWN_QUOTA_CSV>" --tenant-id "<CORPORATE_TENANT_GUID>" --msx-url "<APPROVED_MSX_ORG_URL>" --msx-bundle "<TRUSTED_MSX_MCP_BUNDLE>" --timezone local
```

Use the script's `--help` for the final supported options. Setup is local
configuration, not permission to publish or share. Explicit replacement approval
is required before replacing an existing profile configuration.

## Build and open

Tell the user that first-time MINT access may open a dedicated Edge capture
profile for corporate sign-in. The helper reuses the installed MSX MCP
authentication pathway; never extract, print, paste or persist raw credentials.

```powershell
python "<SKILL_ROOT>\scripts\build_dashboard.py" --refresh --profile "<PROFILE>"
python "<SKILL_ROOT>\scripts\build_dashboard.py" --profile "<PROFILE>" --open
```

Refresh is always explicit: invoking the entry point without an action displays
usage and does not fetch live data. For a reproducible reporting date, add
`--as-of YYYY-MM-DD` to `--refresh`. For a
newly downloaded quota report, add `--quota-csv "<NEW_OWN_QUOTA_CSV>"` to `--refresh`; a failed
reconciliation must not replace the last successful dashboard or accepted quota.

The viewer is loopback-only, uses a per-launch capability URL and disables
caching. It renders the encrypted snapshot in memory. A viewer URL is not a
portable manager-sharing link. Refresh separately on each authorized machine;
do not copy encrypted snapshots between machines or users. Use screen sharing
for a manager discussion, subject to company policy. Do not create an unprotected
HTML attachment or bypass sensitivity protections.

## Accounting rules: non-negotiable

- **Headline:** use MINT's reported `totalWeightedAttainment` and reported bucket
  weights/attainment. Do not reconstruct official payout from raw revenue ratios.
- **Adjusted basis:** preserve official recurring baselines and calculated
  actual/quota fields, including negative calculated actuals.
- **Posted gap:** calculated quota minus calculated actual, floored at zero,
  where the supported source schema supplies those fields. This includes normal
  consumption still to post; it is not all net-new pipeline required.
- **Closed-month comparison:** a separately labeled calculation, not an official
  historical payout headline or a quarter-end forecast.
- **Account gaps:** the user's official account quota minus credited account
  actuals. Do not allocate portfolio recurring baselines or weighted attainment
  to accounts when the source does not provide them.
- **Aggregation:** net signed actuals/quota before clamping a selected gap.
  Do not sum individually clamped account gaps as a portfolio shortfall.
  Keep potentially overlapping buckets and metric credit separate.
- **Reporting window:** use the selected official partition and its actual YTD
  start/end dates. Never assume the latest available partition is the current
  quarter. The adapter handles the end-date normalization boundary and rejects
  out-of-period aggregate months or truncated results.
- **Reconciliation:** validate quota and account/metric totals against official
  source data. Missing, mismatched or unsupported fields must be visible or block
  the build; they must not produce success-shaped placeholders.

## Pipeline rules

Use all accessible account records for the TPIDs in the user's quota report,
not just their deal-team membership. Follow pagination and preserve bounded
queries, global record deduplication, parent-account attribution, source dates,
owners, statuses and record identifiers.

Show open opportunities and relevant active consumption milestones, including
those on won opportunities. Do not count a won deal's nominal value as open
pipeline. Keep overdue, remaining-quarter, future and undated records separate.
Remaining-quarter means the as-of date through quarter end, inclusive.

Distinguish:

- **No recorded pipeline:** complete successful retrieval with no qualifying
  recorded inventory in the stated accessible scope.
- **No remaining-quarter candidate:** no eligible dated candidate in that window;
  this is not proof that all business opportunity is absent.
- **Mapping requires review:** unrecognized metric or unmapped workload evidence
  prevents asserting metric-specific coverage.
- **Partial/unavailable:** access, retrieval, classification or attribution is
  incomplete. Never label this zero pipeline.

Missing milestone statuses remain visible and are excluded from eligible
candidate coverage. Surface the associated cleanup action.

Opportunity nominal values, monthly ACR run-rates, and quarterly earnings credit
have different units. **Never subtract deal value or monthly run-rate directly
from a quarterly gap.** Workload/name-based mappings are tentative hints, not
verified credit rules. Confirmed incremental period credit stays unknown without
evidence.

The optional ramp scenario is off by default. It assumes eligible USD monthly
consumption is entirely new, incremental, correctly mapped, and starts at a flat
run-rate on the production date, prorated by calendar days. It is illustrative,
not a forecast or guaranteed earnings. Non-compatible metrics and unknown
commitment remain unsupported/unknown; official cards never change.

## Dashboard output

The private dashboard includes:

- Official portfolio attainment and a distinct closed-month comparison.
- Dynamic bucket/metric reconciliation, recurring baselines and posted gaps.
- Account gaps, source-quality warnings and prioritized review actions.
- Pipeline timing, commitment, owner and workload detail, with explicit absence
  or unverified-coverage callouts.
- Account, bucket, metric and pipeline-state filters; source freshness and
  methodology; an optional clearly separated scenario.

After a run, verify the dashboard renders and report the actual result. If a
source fails, preserve the last successful snapshot and label it stale. A
successful file write alone does not establish current or correct data.

## Optional recurring automation

Use `automation-template.txt` only after one successful manual refresh.

Ask the user for the schedule, timezone, profile and whether to enable it.
Preview the exact automation configuration and wait for approval before
creating or changing an automation. Use the host's automation API, not edits to
its internal settings files. Do not inherit another seller's schedule or
automation identifier.

Unattended runs must not initiate an unexpected sign-in loop, switch accounts,
rewrite the helper code, fabricate missing data or report an old snapshot as
fresh. Report an authentication requirement and preserve the last good result.
Do not auto-send financial summaries to Teams, email or a manager.

## Privacy and outbound actions

This skill reads the seller's authorized data; it does not create or update MSX
records. Private earnings/account/pipeline content must never enter the package,
submission packet, source code, public repository, telemetry, or plaintext logs.
No browser storage, downloads or data export controls are provided.

Before any later sharing, submission, message or upload, show the recipient,
destination and exact content/files; warn when private data is involved and wait
for explicit confirmation. Installing or running this skill is not sharing
approval. Authentication remains under the user's own identity.

## Maintenance and validation

Run the bundled synthetic tests from `scripts`:

```powershell
python -m unittest discover -s "<SKILL_ROOT>\scripts" -p "test_*.py"
```

Tests use fictitious data and isolated temporary state. Never substitute live
exports into distributable fixtures. Changes to source schemas, compensation
rules, currency support or metric mapping require renewed reconciliation before
expanding the documented scope.