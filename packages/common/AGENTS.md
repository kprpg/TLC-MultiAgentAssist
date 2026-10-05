# AGENTS.md — Contracts & common (schema authority)

`packages/common` is the **single source of truth** for cross-boundary types. Inherits the root AGENTS.md.

## Rules
- Every type crossing a process/network/UI boundary is a **zod schema** here (`contracts/`), with an
  exported inferred type (`z.infer`). Prefer `.strict()` objects; version wire contracts with a literal
  `contractVersion`.
- Changing a contract = update **schema + inferred type + a test in `tests/contract`**. If the wire shape
  changes, **bump `contractVersion`** and update every producer/consumer.
- Keep this package **platform-neutral**: no Node-only APIs, no imports from `apps/*` or connectors.
- `configuration/` holds validated config loaders (entity map, foundry env, MCP servers/policy) — keep
  their zod validation strict; config is also untrusted until parsed.
