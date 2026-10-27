# Sample data with real Foundry AI

This runbook describes **sample business data with real AI**. Live business-source
permissions, agent choices, model behavior and deployment defaults are unchanged.
The shared VS Code Foundry session-renewal behavior applies to both Live and
Sample + Foundry; see [authentication findings](../auth/Foundry-MSX-Authentication-Findings.md#successive-guidance-requests-and-renewal).

Web, Desktop, VS Code and Teams can use SQLite sample business records while invoking the
existing real Foundry agents/models. No MSX, Dataverse, Graph, Power BI or live
knowledge/deck-library connection is enabled by this combination.

## Modes and features

| Sample configuration | Business data | AI |
| --- | --- | --- |
| Default, or `TLC_AI_MODE=foundry` | SQLite sample store | Real Foundry, with clearly labeled offline fallback |
| `TLC_AI_MODE=sample` | SQLite or existing fixture store | Explicit offline implementations; no AI sign-in/network |

The setting is independent of `TLC_DATA_MODE` / `TLC_WEB_MODE` / `TLC_TEAMS_MODE`. It does not turn
sample business records into live records. Fixture-only/static browser previews
remain offline; select SQLite for hybrid inference.

Real inference includes:

- MCEM Coach, Account Pulse, Pursuit Executive, Risk/Solution Play, their
  follow-up prompts, and Guidance invoked from Plays.
- Meeting-signal extraction over the selected sample transcript and SQLite snapshot.
- Sample reporting narrative generation.
- Working-session topic deduction and template drafting.

MCEM stage rules, metrics, evidence validation, workflow execution and review gates
remain deterministic. Sample reporting/workflow/knowledge fixtures stay synthetic;
reviewed sample writes affect SQLite only. Sample working sessions do not search
live Learn, GitHub, M365 or Seismic sources, and never deploy generated templates.

## Credentials and configuration

Only the host calls Foundry. No token or service key is passed to browser JavaScript.

- **Azure Web:** the slot's managed identity; visitors remain anonymous.
- **Local Web:** the configured Foundry tenant through Azure CLI, without MSX/Graph sign-in.
- **Desktop:** its existing Foundry credential and per-user Foundry configuration.
- **VS Code:** its existing Microsoft/Foundry sign-in and configured Foundry project.
- **Teams:** its existing runtime-profile workload identity: tenant-pinned Azure
  CLI locally, managed identity in the Azure profile. This is separate from the
  business-source user's identity. AI configuration/credentials are acquired
  lazily, not while browsing the sample portfolio. Hosted usage admission and
  budget storage remain required.

Foundry credentials are acquired for inference, not ordinary sample browsing.
The project and four agent references use the existing validated Foundry environment
loader. Keep real local environment files out of packages and commits.

The existing deployment/model selectors still choose deployments:
`TLC_MEETING_MODEL`, `TLC_WORKING_SESSION_MODEL`, `TLC_SE_REPORTING_MODEL`.
When a sample feature explicitly requests Foundry but its deployment is disabled or
unavailable, it reports offline fallback instead of silently claiming a real answer.
Existing live-mode handling of these settings is unchanged.

## Run locally

```powershell
# Web: SQLite defaults for real sample AI.
npm run web:start

# Desktop: only business data changes to sample.
$env:TLC_DATA_MODE = 'sample'
npm run desktop:start

# Teams: the same shared sample inference, Foundry by default.
npm run teams:start

# Completely offline sample AI (also suitable for fixture-only previews).
$env:TLC_AI_MODE = 'sample'
npm run web:start:sqlite
```

Remove or change `TLC_AI_MODE` when switching back to real sample inference.
In VS Code, use:

```json
{
  "tlc.mode": "sample",
  "tlc.dataStore": "sqlite",
  "tlc.aiMode": "foundry"
}
```

`tlc.aiMode=sample` is the explicit offline option. `TLC_AI_MODE` takes precedence
over the setting; configuration changes rebuild the sample provider, not live data.

In VS Code, the first AI request can ask you to approve Microsoft sign-in for
**TLC Assist** and select an account with access to the configured Foundry tenant.
Sample browsing does not request this sign-in. Interactive sign-in, including renewed
consent, completes before the model's request/first-token timeout starts. If you decline or close sign-in,
Guidance labels the fallback as `authentication`; run Guidance again to retry.
Each submitted prompt allows up to three automatic interactive sign-in attempts
shared across credential callbacks. Healthy sessions renew silently for the
previously selected Foundry account. Cancellation or terminal tenant/access
errors stop recovery rather than reopening the picker indefinitely.
Failed initialization is not cached for the rest of the session.

Teams displays **Sample data / Foundry AI** or **Sample data / Offline AI** in
the header and labels fallback on the response. `TLC_AI_MODE=sample` keeps Teams
AI fully offline too. This does not enable Live source connections, local-owner
pairing, or reviewed writes to MSX. Sample and Live services remain separate when
switching data modes.

## Azure sample slot

Build once after upgrading; an old ZIP does not contain the new inference wiring:

```powershell
npm run web:deploy:sample
# Explicit offline deployment instead:
npm run web:deploy:sample -- -AiMode sample
```

In the default hybrid path, the wrapper stores validated non-secret Foundry routing
metadata in `TLC_FOUNDRY_ENV_BASE64` and sets `TLC_AI_MODE=foundry` on the sample slot.
It does not acquire a developer token for the hosted process or alter production.
`-PackageOnly` still does not contact Azure or require Foundry configuration.

The current `tlc/sample` identity exists but must have the required Foundry permissions.
Agent-only access can use **Foundry Agent Consumer** at project/agent scope. The
additional direct model calls also need model inference permission. For the existing
account, **Foundry User** is a supported built-in option; an Azure administrator should
review its broader permissions or supply a narrower approved custom role.

> **The role belongs to the app, not the visitor.** Your Azure login authorizes
> publishing; the `tlc/sample` slot's managed identity authorizes server-side Foundry
> calls. Deployment and SQLite browsing can succeed without that grant, while AI
> requests return a labeled offline fallback. Visitors still need no sign-in.

In the Azure portal, open Foundry resource **multiagentAcctTeam** in **rgAgents**:
**Access control (IAM) > Add role assignment > Foundry User > Managed identity**,
then select the identity belonging to **tlc/sample**, not production. This grants
Foundry access only; it does not grant MSX/Graph access or change visitor authentication.

An administrator can deliberately grant that role on the exact existing Foundry
account (not the subscription). This is a separate Azure change:

```powershell
$subscription = 'cbaf34df-7bb5-4fcf-bd7d-686a5f43ad31'
$principal = az webapp identity show --subscription $subscription `
  --resource-group myDemoRg --name tlc --slot sample --query principalId --output tsv
if ($LASTEXITCODE -ne 0 -or -not $principal) { throw 'Could not resolve the sample-slot identity.' }
$scope = "/subscriptions/$subscription/resourceGroups/rgAgents/providers/Microsoft.CognitiveServices/accounts/multiagentAcctTeam"
az role assignment create --assignee-object-id $principal `
  --assignee-principal-type ServicePrincipal `
  --role 53ca6127-db72-4b80-b1b0-d745d6d5456d --scope $scope
```

Confirm the identity/project tenant, role propagation and each configured deployment.
Do not disable production Authentication or grant MSX/Graph access to make sample AI
work. Production and slot identities do not swap; a later production promotion needs
its own identity verification.

## Usage limits (hosted sample only)

All sample agent/model requests share one slot-wide policy:

- **25** concurrent outbound calls.
- **20** actual provider attempts per fixed UTC-minute window.
- **500** attempts per UTC day.

Daily/minute admissions persist in `HOME\data\tlc-ai\<slot>\usage.sqlite`, separate
from the in-memory sample data and outside the mounted deployment ZIP. Sample edits
can reset while AI usage counts survive restarts. `TLC_AI_BUDGET_PATH` can select a
different durable, slot-specific writable path; never use the read-only package root
or an in-memory ledger.

Requests are reserved atomically before sending. Failed/uncertain requests are not
refunded; retries count too. Concurrency remains reserved through streamed response
consumption. Missing/corrupt usage storage denies real inference and reports fallback.
No new limits are imposed on live mode or unrelated local installations.

The hybrid client disables hidden SDK retries and remote tools, bounds output tokens,
and restricts requests to the configured project's inference endpoints. Existing
live-client behavior is preserved. These are call-volume limits, **not a dollar cap**.
Use Foundry usage monitoring/billing alerts as well.

## Visible results and failure handling

The header shows **Sample data / Foundry AI** or **Sample data / Offline AI**.
Each hybrid result carries independently versioned inference provenance identifying
the provider that actually produced it.

Unavailable credentials/configuration, quota, timeout, invalid model output or
provider errors produce a labeled **Offline/sample fallback** where an offline
implementation exists. In-progress local Guidance drafts are not final model output.
Cancellation, invalid input/evidence and policy denial are not rewritten as success.

Prompts, entered sample fields and pasted transcripts can be sent to Foundry.
Do not enter real customer data, secrets or credentials in a public demo.
Telemetry records operation/outcome/usage metadata only, not prompt or source content.

## Verification

Ordinary tests, release smoke and automated sample UI tests explicitly select offline
AI. A successful data-only `/api/health`, package smoke, or `-Action Verify` does
**not** prove real Foundry access; the wrapper says so.

The automated hybrid browser journey runs the actual built host and SDK against an
isolated test transport, covering all named agents and structured features without
Azure access or charges:

```powershell
npm run web:build
node node_modules\@playwright\test\cli.js test --config playwright.revamp.config.ts web-release.spec.ts --reporter=line
```

For a real rollout, explicitly test each feature and inspect its returned `inference`
metadata: `provider=foundry`, `state=complete`, and business `mode=sample`. A labeled
fallback is correct degradation, not successful live inference. Check that no live
business-source call or write was made before admitting public traffic.

The opt-in HTTP smoke makes eight paid inference calls against the supplied sample
host (plus any explicitly supported compatibility retry), consumes that slot's
quotas, and fails if any result is offline fallback. Run it only after approving the
charges and verifying the target:

```powershell
$env:TLC_RUN_LIVE_SMOKE = '1'
$env:TLC_SAMPLE_LIVE_URL = 'https://<sample-slot-hostname>'
try { npm test -- tests/connectors/sample-inference.live.test.ts --maxWorkers=1 }
finally {
  Remove-Item Env:TLC_RUN_LIVE_SMOKE -ErrorAction SilentlyContinue
  Remove-Item Env:TLC_SAMPLE_LIVE_URL -ErrorAction SilentlyContinue
}
```
