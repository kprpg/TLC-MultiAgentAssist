# AGENTS.md — Connectors (MSX / Dataverse / SharePoint / Foundry)

Boundary to external systems. Everything returned here is **untrusted data**. Inherits the root AGENTS.md.

## Dataverse MCP (`dataverse-mcp/`)
- **Guarded queries only.** Every read goes through the allowlist: `config/dataverse.entity-map.json`
  + `query-guard.ts`. Only allowlisted **entities and fields** are queryable; **relationship expansion
  is denied** unless allowlisted.
- **Delegated-user scope is mandatory** (deal-team JOIN / scope predicate). Never widen scope to bypass
  row-level security. Mark results marked as untrusted MCP data; validate before use.

## MSX (`msx/`)
- Reads map MSX `msp_*`/standard columns → canonical fields; keep a **fixture/sample path** so sample
  mode needs no network (`index.ts` fixtures vs `live.ts`).
- **Writes**: map canonical → logical fields in the `patch` path. Option-set writes require **tenant
  option codes** via write metadata. Keep read vs write explicit. Do **not** add a new writable field
  without also extending the update schema in `packages/common` and the patch mapping here.

## General
- Each connector pairs a **live** adapter with **sample/fixture** data; both must satisfy the same
  contract. SharePoint provides MCEM stage guidance; Foundry hosts the agents.
- **Local test store** (`local-store/`): a `node:sqlite`-backed `MsxConnector` implementation
  (`LocalStoreMsxConnector`) selected for sample/test mode via `createLocalStoreMsxConnector()` when
  `TLC_DATA_STORE=sqlite`. Schema + seed mirror the MSX/Dataverse Opportunity + Milestone +
  stakeholder/contact/competitor shape with verified option codes; see `docs/MeetingCapture.md` §G.
- Cover changes with `tests/unit/connectors` (+ fixtures under `tests/fixtures`).
