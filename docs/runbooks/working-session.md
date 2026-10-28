# Working session pack

For the opportunity and milestone you are working, **Working session** prepares three things in one
folder: PowerPoint decks that already exist, a Microsoft Learn document set, and draft Bicep/ARM templates.
It is read-only toward MSX and never deploys anything.

On all four surfaces, open the same working-session flow using the **target icon**, with the tooltip
**Generate Prep/ Delivery Artifacts**. The 24px icon sits in a 32px button and replaces the previous
Working session text or file-share icon; topic suggestion, preparation and output actions are unchanged.

| Surface | Where the control is | Result |
|---|---|---|
| VS Code | Next to **Run MCEM Coach** | Folder under `Documents\TLC`, **Open folder** |
| Desktop | Opportunities header, next to **Meeting capture** | Folder under `Documents\TLC`, **Open folder** |
| Web | Same as Desktop | `.zip` download (kept for a few minutes) |
| Teams | Milestones heading, next to **Meeting capture** | `.zip` download |

## What you get

`Documents\TLC\<Opportunity> - <Milestone>\` (the name is made Windows-safe; long names get a short hash):

- `decks\` - copied decks, a `links.md` for decks that could only be linked, or a `DRAFT-...-outline.pptx`
  built from the Learn pages when no existing deck was found (clearly labelled as a draft).
- `learn\` - one Markdown file per Learn page with its source URL, plus `index.md`; `Learn-Reading-Set.docx`
  combines them.
- `iac\` - `main.bicep`, `main.json` (compiled ARM, when the Bicep CLI or `az bicep` is installed),
  `main.parameters.example.json` and a README. Templates are drafts to review; TLC never deploys them.
- `README.md` and `manifest.json` - every file, its source, and what could not be gathered and why.

Re-running never overwrites a file that differs; it writes `name (2).ext` instead.

## How the topic is chosen

The topic comes from the opportunity and milestone titles first, then their comments. You see it, with the
evidence, and can edit the topic, services, search phrases and template description before anything runs.
Live hosts use a Foundry model by default and fall back to a built-in rule catalog if it is unavailable;
set `TLC_WORKING_SESSION_MODEL=off` to stay fully rule-based, or to a deployment name to choose the model.
Opportunity and milestone text is treated as untrusted input and every model answer is schema-checked.

## Where decks come from

| Source | Works today | Notes |
|---|---|---|
| Local synced folders | Desktop and VS Code | `TLC_DECK_LIBRARY_PATHS` (semicolon separated), plus OneDrive and Downloads. Not searched from hosted Web or Teams. |
| Public GitHub | Everywhere | Allowlist in `TLC_DECK_GITHUB_REPOS` (default `AzureDataCommunity/Resources`, a community repository). Check the repository's licence before reusing a deck. Optional `TLC_GITHUB_TOKEN` raises the rate limit. |
| Seismic | Needs Graph consent and `TLC_SEISMIC_GRAPH_CONNECTION_ID` | Returns links, not files. |
| Microsoft 365 files | Needs Graph `Files.Read.All` consent | Reported as "needs consent" until that exists. |

Sources that are unavailable are listed under **Needs attention** and in the manifest; the others still run.

## Configuration

| Variable | Purpose |
|---|---|
| `TLC_DECK_LIBRARY_PATHS` | Extra local deck folders (Desktop and VS Code), semicolon separated |
| `TLC_DECK_GITHUB_REPOS` | Public repositories to search for decks, comma separated |
| `TLC_GITHUB_TOKEN` | Optional, raises the GitHub rate limit |
| `TLC_WORKING_SESSION_MODEL` | Foundry deployment for topic and template drafting; `off` keeps it rule-based |
| `TLC_DOCUMENTS_FOLDER` | Desktop only: use this folder instead of the system Documents folder (redirected profiles, tests) |

## Limits

- A copied deck is limited to 60 MB. Hosted zips are limited to 40 MB total (larger decks become links).
- Not interactive while running: there is no progress stream or cancel yet; the panel shows a working state.
- Bicep to ARM compilation needs the Bicep CLI or Azure CLI; without it the Bicep is still delivered.
- Sample mode retains bundled sources but uses real Foundry topic/template inference
  by default; `TLC_AI_MODE=sample` is fully offline. Fallbacks are labeled in the UI
  and result manifest. [Sample Foundry AI](sample-foundry-ai.md) does not change live behavior.

## Session-only result retention

You can switch opportunities or views while topic deduction or preparation continues.
Reopening the **target icon** for the original opportunity restores its pending state or
latest result, including the original milestone and confirmed preparation settings.
Closing and reopening an unchanged panel preserves its current edits. Restoring a result
does not run another search, inference call or preparation.

Desktop, Web, VS Code and the shared Teams launcher use the same presentation-state owner.
It retains up to 20 completed operation results, shared with Meeting Capture where available,
using least-recently-used eviction; active operations are never evicted. Failures are retained
for their originating scope rather than appearing in another opportunity. Existing admission
limits, per-call timeouts and write approvals are unchanged.

This is not durable background-job storage. Refresh, app restart, webview recreation and
private-session/data-mode/access resets clear the cache. Eviction removes only UI state,
not output files. Hosted output availability is unchanged: at most two archives per user,
each expiring after 15 minutes. A retained result can therefore refer to an expired or
displaced download; the UI reports that failure explicitly and **Prepare again** remains a
user action. No automatic regeneration, cancellation or retry is added.

## Security

Only `learn.microsoft.com` pages and allowlisted GitHub repositories are fetched, over HTTPS, with size and
time limits. Files are written only under the generated folder (no path traversal, no link escape). Folder
opening is restricted to directories under `Documents\TLC`. Hosted downloads are per user and expire.
Prompts, customer names and tokens are not logged.
