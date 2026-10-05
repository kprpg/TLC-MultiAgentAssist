# AGENTS.md — Foundry agents

Each agent is a **Foundry prompt agent** with a fixed artifact layout: `foundry-agent.json`
(model + instructions), `prompts/`, `policies/grounding.md`, `golden-scenarios.json`, `README.md`, and
optionally `src/` for deterministic evaluation (e.g. `mcem-coach/src`). Inherits the root AGENTS.md.

## Rules
- **Read-only and grounded.** Analyze **only** the structured context the orchestrator supplies. Never
  invent customer facts, MCEM rules, citations, or source access; never call another agent.
- **Cite evidence** and state explicitly when results are partial, stale, unauthorized, or sample-based.
- Keep the **shared default model** consistent across agents (currently `gpt-5.4-1`); if behavior
  changes, update `golden-scenarios.json` and the grounding policy together.
- Treat `prompts/instructions.md` + `policies/grounding.md` as the contract for the agent's output
  structure; keep responses concise and human-review-ready.
