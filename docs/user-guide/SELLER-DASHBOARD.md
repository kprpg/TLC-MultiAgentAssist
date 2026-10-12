# Seller Dashboard

Seller Dashboard is a separate, read-only pane on Desktop, Web, and the VS Code
webview. It does not change Portfolio, Plays, Discovery, Deal Team membership,
milestones, or CRM records.

## Open and explore

- **Desktop/Web:** select the **Seller Dashboard** chart icon in the left
  navigation rail. On mobile, use **Open Seller Dashboard** in the command bar.
- **VS Code:** select the fourth **Seller Dashboard** tab.
- **Sample mode:** one clearly labelled fictitious report runs offline on all
  three surfaces. No real seller’s reference report is included.

The report has four sections:

| Section | What to inspect |
| --- | --- |
| **Pipeline & Hygiene** | Qualified/early open nominal inventory, committed/uncommitted USD monthly production candidates, overdue and blocked exposure, concentration, milestone evidence, stale/recent queues, and MACC/SQL opportunity views. |
| **ACR & Insights** | Fixed official metric reconciliation, recurring baselines, signed actuals, separately netted account/bucket gaps, owner review actions, and an optional illustrative production-ramp scenario. |
| **Consumption & Growth** | Validated consumption, daily rates, separately labelled projected landing, pillars, service movers, new services/subscriptions, and Arc/SQL review evidence. |
| **U2C Progress** | A dated starting uncommitted cohort, conversion amounts/counts, retained-in-quarter and shifted-out conversion. Current commitment state is not historical conversion evidence. |

Account, fiscal-quarter, bucket, metric, pipeline-state and search filters control
the working view. **Official headline and bucket attainment do not change.**
Quarter filters date inventory; they never rewrite the official MINT reporting
period or prorate supplied quota/actuals. Tables sort from their column headers
and paginate without dropping records from totals. Arrow keys/Home/End navigate
the report-section tabs.

**Stale 45+ days** uses each active uncommitted milestone's own update timestamp,
the same evidence shown in **Days since update**, not its parent opportunity's age.
**Recently committed** uses the milestone's commitment-change timestamp. Missing
timestamps are reported for the relevant milestones and do not establish staleness
or recent commitment.

“Unknown,” “partial,” and “unavailable” are not zero. Source warnings and
**Sources, freshness & methodology** explain scope, timestamps and accounting.
Every quota account must include the complete official metric set with source-supplied
quota rows. Missing actuals remain `null`/unknown; genuine zeros must be explicit.
An omitted metric or empty account-metric list rejects the snapshot rather than
silently dropping amounts from account gaps or supplying invented zeros.

Monthly usage and nominal opportunity values are never treated as verified
reporting-period credit. The scenario starts off and is explicitly hypothetical.
Its candidate credit uses only milestones in the filtered working view, including
record-level search and pipeline-state filters. Selecting committed milestones
excludes uncommitted scenario credit; official attainment and posted gaps remain fixed.

## Local live prerequisites

The supplied collector supports **Windows**, Python 3.11+, a trusted separately
installed MSX MCP runtime, corporate MINT/MSX access, and compatible **USD monetary
account-quota plans** with `EndCustomerTopParentName` grain and at most 200 TPIDs.
Not all MCAPS plans have identical crediting rules.

1. Download **your own Quota by Accounts CSV** from MSX Earnings for the fiscal year.
2. Follow the trusted collector’s `SKILL.md`: validate the original CSV, explicitly
   confirm tenant, Dynamics organization, runtime, reporting timezone and profile.
3. Run one explicit successful manual refresh. The collector atomically stores
   accepted quota and source/model snapshots using Windows-user DPAPI encryption.
4. Configure the local host environment before starting TLC:

```powershell
$env:TLC_SELLER_DASHBOARD_SKILL_ROOT = 'C:\trusted\MCAPS-Seller-Performance-Dashboard'
$env:TLC_SELLER_DASHBOARD_PROFILE = '<your-confirmed-profile>'
$env:TLC_SELLER_DASHBOARD_OWNER_EMAIL = '<your-own-signed-in-email>'
# Optional, when Python is not on PATH:
$env:TLC_SELLER_DASHBOARD_PYTHON = 'C:\Python312\python.exe'
```

Replace the example path/placeholders with your confirmed installation and
identity; do not execute literal placeholders or guess organization details.
The owner must match the current authenticated seller before any private read.
The UI cannot choose an arbitrary profile, executable, tenant or path.

- **Reload dashboard** reads the existing protected snapshot; it does not collect
  new MINT/Dataverse source data.
- **Refresh live sources** requires explicit confirmation that the profile is
  yours and authorizes a read-only refresh. Corporate sign-in may open in Edge.
- A failed refresh keeps the collector’s last successful snapshot and visibly
  labels it stale. A reload/validation failure does not make retained data fresh.
- An identity/access denial clears the private displayed snapshot.

The Windows profile adapter is supported only on **Desktop and local Windows
VS Code**. It is disabled on **all Web modes**, including `TLC_WEB_MODE=azure-cli`
and hosted Easy Auth. Loopback and the server's Azure CLI identity do not
authenticate an HTTP caller, so another local process/user must never receive
the host user's decrypted financial snapshot. Setting profile environment
variables does not enable this Web path.

Web private earnings require a future per-session capability or caller-authenticated
provider bound to the seller identity. Web sample mode remains available and
never reads an encrypted profile.

## Supplemental data and privacy

The supplied Python collector does **not** collect Fabric SL4/service/subscription
data, U2C baseline/history, or update/commitment-change timestamps. Without actual
source evidence those live views/fields remain unavailable, not fabricated.

The optional `sellerDashboardSupplement` field in the same encrypted state accepts
only the versioned, validated consumption/U2C contract. It must be supplied by an
approved source integration; this pane does not export, edit or manufacture it.
See the [contract](../../packages/common/contracts/seller-dashboard.ts) and
[implementation analysis](../Seller-Dashboard-Implementation.md).

Private sources stay in Windows-user-encrypted storage, outside this repository.
The pane adds no browser persistence, financial telemetry, downloads, email,
sharing, uploads, automation, or CRM writes. Proof screenshots use synthetic
sample data only. Live access must be validated under the seller’s own identity;
synthetic tests do not establish it.
