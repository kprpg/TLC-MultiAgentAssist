# SE Reporting Dashboard

Open **Dashboards > SE Reporting Dashboard**. Seller Dashboard remains a separate
tab; switching between the dashboards preserves the Seller Dashboard working view.
An identity/data-mode session reset clears the previously displayed private reports
and unsaved reporter input before loading the new session.

## Sample walkthrough

Sample mode uses fictitious people and accounts without sign-in, network access or
SharePoint writes. Select an ATU report or the consolidated person summary, expand
**See more**, filter customer-update status, and download the canonical JSON or
self-contained HTML. Reporter asks start empty. Sample publication is explicitly
labelled as a simulation and writes nothing.

## Live prerequisites

This feature implements the monthly v2.0 contract described by
[`reporting-skill`](../../scripts/SE-manager-dashboard/reporting-skill/README.md).
The current contract takes precedence over the historical query examples and
previous skill versions. The protected PBIX is reference material, not a runtime
dependency or a source of bundled customer data.

- A manager-specific, reachable HTTPS SharePoint `reporting-contract.md` and report
  output folder. The live contract must contain a real manager selector, display
  name, allowed ATUs/pillars, and the supported v2 monthly-report sections.
- The configured Power BI semantic model, the reporter's own delegated
  `Dataset.Read.All`/Build access, and the tenant's Execute Queries REST API setting.
  The adapter uses `AccountAssignmentsWithCustomerIds`, `Accounts`, `systemuser`,
  `opportunity`, `PodMilestones`, and `task` as specified by the source skill.
- Separately consented Microsoft Graph source permissions: `User.Read`,
  `Calendars.Read`, `Mail.Read`, `Chat.Read`, and file read access for enabled
  sources. SharePoint publication additionally needs delegated file-write access
  to the configured destination. All calls remain subject to actual source access.
- An approved Microsoft Foundry project/credential using the existing TLC Foundry
  configuration, plus `TLC_SE_REPORTING_MODEL=<deployed-model-name>`. The narrative
  model does not calculate KPIs, call tools, write records, or author manager asks.

Desktop uses its configured user credential. VS Code requests separate reporting
resource sessions and verifies they match the TLC account. Local Web supports
`TLC_WEB_MODE=azure-cli` with a matching current user. Hosted Easy Auth Web does
**not** reuse a server/managed identity for private reporting: its reporting reads
remain unavailable until a caller-bound reporting token provider is configured.

Teams reporting sources are opt-in with `TLC_SE_REPORTING_ENABLED=1`. Hosted Teams
uses caller-bound OBO tokens. Native Teams uses only silent grants for the already
verified account; HTTP requests never launch sign-in. Configure/admin-consent the
reporting resource permissions through the approved native application first.
CLI Teams can generate/download with separately granted reporting reads, but has
no reporting file-write grant. Teams publication additionally goes through the
existing reviewed-action path and requires `TLC.Teams.Publisher`; a CLI connection
does not acquire that role.

## Set up and generate

1. Enter a profile ID/label, live contract URL, shared output root, semantic-model
   ID, and enabled sources. Optional workload mapping is an explicit JSON object,
   for example `{"Infrastructure":"infra"}`; it is not a manual account list.
2. Select **Inspect live contract and access**. Confirm the resolved manager,
   signed-in reporter, detected workloads, and Primary/Secondary scope.
3. Select **Confirm scope and save profile**. Configuration is private to that
   signed-in reporter, outside the repository and shared report folders. The
   default directory is `%USERPROFILE%\.tlc\se-reporting\profiles`;
   `TLC_SE_REPORTING_PROFILE_DIR` can select a host-owned private directory.
   Never store credentials there or point it at a shared report-output folder.
4. Select a completed reporting month and detected pillar. **Check source access**
   probes every configured source independently.
5. Select **Generate draft package**. Contract retrieval and authoritative
   assignments are repeated. Missing manager, assignment or MSX access blocks
   generation. Other missing enabled sources require explicit per-source approval
   to continue, or can be disabled in the profile.

Only eligible Primary/Backup assignments for the selected manager, reporter,
workload and ATU contribute. Backup appears as **Secondary**; Primary takes
precedence. Deal-team membership, milestone access or account-name fragments do
not expand assignment scope. Exact current eligible account names may resolve
M365 context; calendar titles or name mentions alone do not count as engagement.

The five KPI tiles distinguish reporting-month activity, current milestone
snapshots, full fiscal-year inventory and FYTD events. Commitments require
`Committed On`; HoK requires completed owned tasks in the seven allowed categories
with `actualend`. Task ownership is independent of milestone access-team membership:
the task's account is resolved through the milestone/opportunity path and still
must pass current assignment eligibility. Task retrieval is bounded to the fiscal
and reporting-period activity windows, not the reporter's entire task history.
Missing date columns or amounts are not invented. Current status
is labelled with its actual snapshot date, not presented as historical month-end
state. Person summaries are recomputed/deduplicated from the same run's ATU
artifacts, never by rereading evidence.

## Review, output and privacy

- Read every ATU report and the person summary. In **Reporter review and manager
  asks**, enter your own asks separately for each ATU, or explicitly confirm none.
  Text is retained verbatim. Approval is a separate opt-in checkbox.
- Downloads are explicit local JSON/HTML exports. The HTML is script-free, with
  exactly five KPI tiles, the primary sections in contract order, and one native
  **See more** disclosure for secondary content. Export/print exposes all content.
- Publication requires a destination-file preview and a separate confirmation.
  Every existing draft, approved or final artifact needs overwrite consent, and
  SharePoint ETags prevent blind replacement after the preview. HTML is written
  before its canonical JSON. Multi-file SharePoint writes are not transactional;
  a partial failure is reported explicitly and requires inspection before retry.
- Only the reporter's own `{atu}/{yyyy-mm}/{pillar}-{person}.json/html` pairs and
  `persons/{person}/{yyyy-mm}/person-summary.json/html` are published. Contracts,
  manifests, rollups and other reporters' artifacts are not modified.
- An explicitly selected local test contract creates test drafts only. They cannot
  be approved or published; download them to an isolated local test directory.
- Raw source evidence is held only during generation, not retained in profiles,
  reports, browser storage or telemetry. Durable output contains summaries and
  references. Reports/runs remain in memory for the current signed-in session
  (one-hour idle lifetime); private profile configuration survives restarts.

## Supported source limits

Reads are bounded and fail explicitly rather than silently reporting truncated
data. Semantic-model results must be below 5,000 rows per query. M365 reads have
per-source/page budgets and the narrative input has a 600 KB complete-input
budget. Complete matching recap text is used, not email previews; a single
normalized evidence text above 100,000 characters fails that source explicitly
instead of silently truncating its conclusions. Current file/wiki content support is explicitly selected UTF-8 Markdown
or text; a matching Office/PDF file that needs document-text extraction marks that
source unavailable rather than treating a filename as evidence. These cases can
use explicit degraded-mode approval; no missing evidence is labelled as used.

No MSX/Dataverse record, source contract or other colleague's report is changed by
generation or review.

## Milestone and task source (Dataverse or Power BI)

By default milestones and tasks come from the Power BI semantic model. Set `TLC_SE_SOURCE` on the Desktop, VS Code or Teams host to change this (it requires the host's delegated MSX access):

- `powerbi` (default): current behavior.
- `dataverse`: read the reporter's milestone-team milestones and owned tasks directly from MSX Dataverse.
- `auto`: read both; use Dataverse only when its milestone and task id sets match Power BI (at least 99%), otherwise use Power BI and record the parity result. If Dataverse cannot be read, Power BI is used.

Account assignment (Primary/Backup, ATU, workload) comes from the semantic model **permanently**; no Dataverse equivalent exists and Dataverse is never used to widen scope. The Dynamics manager hierarchy is maintained for the target teams, so **Check source access** also confirms (counts and yes/no only) whether the reporter is a direct report of the contract manager; a mismatch is shown as a warning and does not change scope.

Hosted Web (Easy Auth or local Azure CLI) now gives the Dataverse provider the signed-in caller's own delegated MSX token (never a server identity), and Teams uses the caller's MSX access already. Assignments still need the Power BI grant, so hosted Web still cannot generate a full report until a caller-bound Power BI/Graph token provider exists. The report's MSX source line records which provider was used and the parity counts (no identifiers). `TLC_MSX_RISK_DETAILS_FIELD` enables the blocker text from Dataverse.

## Microsoft 365 evidence

Mail, Teams chats (including meeting chats) and meeting calendar entries are read by a dedicated read-only Graph connector (`packages/connectors/graph/se-evidence.ts`) with your delegated Mail/Chat/Calendar read grants. Calendar entries are context only and never count as engagement on their own. Records are matched to assigned accounts by whole account name, private HR/compensation/legal text is dropped, only HTTPS references are kept, and a source that exceeds its budget fails rather than reporting truncated data. Teams channel messages and meeting transcripts are not read because they need additional admin-consented permissions.
