# 02 — UI Layout Analysis & Optimizations

> Capture only. Part of [Code / Refactoring / Optimization / Tests](Code-Refactoring-Optimization-Tests.md).
> Scope: the four UI layers — Desktop (Electron renderer-revamp), VS Code extension webview, Web
> (serves the desktop build), and Teams (absent / stub).

## 1. Current layout inventory

### Desktop renderer-revamp (`apps/desktop/renderer-revamp/`)

- **Shell:** a three-blade workspace — Accounts (left), a center tabbed view
  (Portfolio / Workflows / Discover), and an Actions blade (right), under a 44px command bar.
  Blades are user-resizable (drag handles) with widths persisted under `tlc.blade-widths.v1`
  (`src/App.tsx:73-80`, `BladeResizeHandle` at `:138`).
- **Stack:** React **19.2** + Fluent UI v9 (`@fluentui/react-components`), Vite, plain CSS.
- **Size:** `src/App.tsx` is **1,599 lines**; the `App` component itself spans roughly `:187-1569`
  with **79** `useState` hooks and only three extracted helpers (`BladeHeader`, `BladeResizeHandle`,
  `WorkflowResult`). `src/styles.css` is **2,272 lines** (single file, Fluent-style CSS variables such
  as `--cp-bg`, `--cp-accent`).
- **Responsive:** a mobile breakpoint around `max-width: 900px` collapses the blades to a bottom tab
  bar. Desktop Electron smoke runs clamp the window below the 1220px CSS breakpoint on CI (per repo
  memory), so viewport-dependent assertions must derive expected values via `matchMedia`.

### VS Code extension webview (`apps/vscode-extension/src/webview/`)

- **Shell:** an app header, a plays rail, a plays-results area, and a conditional guidance drawer
  (`app.tsx`). It leans on native VS Code theming (`var(--vscode-*)`) with custom fallbacks.
- **Size:** `app.tsx` is **1,334 lines** with **59** `useState`, but the surface is more modular —
  ~24 supporting files including extracted components (`app-header.tsx`, `next-best-actions.tsx`,
  `play-role-owners.tsx`, `record-tooltip.tsx`, `comments-button.tsx`,
  `portfolio-layout-controls.tsx`) and logic modules (`plays-grouping.ts` 198 lines, `sorting.ts`,
  `mcem-stages.ts`, `guidance-*`). `styles.css` is **1,620 lines**.
- **State:** uses `useCallback`/`useMemo` in places, so it over-renders less than the desktop App.

### Web (`apps/web/`)

- **No bespoke web UI.** `apps/web/src/server.ts` serves the compiled desktop revamp build
  (`apps/desktop/dist/revamp`, overridable via `TLC_WEB_STATIC_ROOT`) with security headers from
  `hosting.ts`, and exposes `/api/*` via `app.ts`. So the web layout **is** the desktop renderer
  layout; any desktop layout change ships to web automatically, for better (reuse) and worse (no
  web-tailored UX, no offline affordances).

### Teams

- **Absent.** No tab/bot/message-extension, no manifest. See
  [MOD-6](01-modularization.md#mod-6--enforced-teams-stub-surface-boundary--p2) for the stub boundary.

## 2. Headline layout problems

1. **Two mega-components** (`App.tsx` 1,599 / `app.tsx` 1,334) mix layout, state, data access, event
   handling, and dialogs in one file each — hard to reason about, test, and optimize.
2. **Two monolithic stylesheets** (2,272 / 1,620 lines) with parallel-but-divergent tokens; shared
   layout patterns (blades, cards, tables, drawers) are re-expressed per surface.
3. **State sprawl** (79 / 59 `useState`) with prop-drilling through a single component → broad
   re-renders on nearly any interaction, especially on the desktop side (few memo boundaries).
4. **Responsive behavior is ad hoc** — a couple of `max-width` breakpoints, no documented grid or
   shared breakpoint tokens; web inherits desktop breakpoints that were designed for a desktop window.
5. **Accessibility is partial** — `aria-*` attributes exist but are not systematic; there is no
   automated a11y check (see [TEST-7](04-testing-strategy.md#test-7--accessibility-tests-axe--p1)).

---

## UI-1 — Decompose the App mega-components · P0

**Problem / evidence.** `apps/desktop/renderer-revamp/src/App.tsx` is a single ~1,380-line component
with 79 `useState`; `apps/vscode-extension/src/webview/app.tsx` is 1,334 lines with 59 `useState`.

**Proposed change.** Break each shell into feature components with clear inputs/outputs, keeping the
existing visual result:

- Desktop: `CommandBar`, `AccountsBlade`, `CenterTabs` (`PortfolioTab`, `WorkflowsTab`,
  `DiscoverTab`), `ActionsBlade`, and dialog components (email compose, stage move, account search).
- VS Code: continue the existing extraction pattern — pull `PlaysRail`, `PlaysResults`,
  `GuidanceDrawer`, and queue-group rendering out of `app.tsx`.
- Co-locate each feature's local state with its component; lift only genuinely shared state (UI-3).
- Reuse shared presentation helpers from `packages/ui-logic` (MOD-4) rather than per-file copies.

**Acceptance criteria.**
- Neither `App.tsx` nor `app.tsx` exceeds a few hundred lines; each feature lives in its own file.
- No visual or behavioral change; existing unit tests and revamp Playwright specs pass.
- `useState` count per top-level component drops substantially as state moves into features.

**Blast radius.** Medium (large files, but mechanical). Pin behavior with the existing revamp e2e
(`tests/e2e/revamp/*`) and webview unit tests before/after.

---

## UI-2 — Split stylesheets and adopt shared design tokens · P1

**Problem / evidence.** `renderer-revamp/src/styles.css` (2,272) and
`vscode-extension/src/webview/styles.css` (1,620) are monolithic and define parallel token sets
(`--cp-*` vs `--vscode-*` fallbacks). Shared components (cards, tables, blades, drawers, chips) are
styled twice.

**Proposed change.** Extract a shared token layer (colors, spacing, radii, typography, breakpoints)
and shared component styles into a common stylesheet (pairs with `packages/ui-logic`/`ui-contracts`),
then split each surface's CSS by feature (command bar, blades, tabs, dialogs). Keep VS Code's native
theme mapping as a thin adapter over the shared tokens.

**Acceptance criteria.**
- A single source of truth for tokens and shared component styles; per-surface CSS only holds
  surface-specific overrides.
- No visual regression against the web visual snapshots
  (`tests/e2e/revamp/web.spec.ts-snapshots/*`); update snapshots intentionally if tokens change.

**Blast radius.** Medium. CSS changes are visible; gate with the existing snapshot specs and expand
them (UI-4 / TEST-5).

---

## UI-3 — Scoped UI state to stop prop-drilling and over-render · P1

**Problem / evidence.** The desktop `App` holds ~79 `useState` and drills props through the whole
tree; most interactions re-render large subtrees because there are almost no memo boundaries. The
webview is better (uses `useCallback`/`useMemo`) but still centralizes state in one component.

**Proposed change.** Introduce scoped state boundaries — React context providers (or a small store)
per domain (selection, portfolio data, workflow runs, dialogs) — so features subscribe only to what
they need. Pair with `React.memo` on the extracted feature components from UI-1. No new heavy state
library is required; prefer the lightest approach that removes the drilling.

**Acceptance criteria.**
- Feature components read state from scoped providers/selectors, not a monolithic prop chain.
- Interacting with one blade does not re-render unrelated blades (verify via render profiling).
- Behavior unchanged; tests green.

**Blast radius.** Medium. Depends on UI-1; validate with interaction tests (TEST-5).

---

## UI-4 — Formalize responsive breakpoints and the layout grid · P2

**Problem / evidence.** Breakpoints are scattered `max-width` media queries (desktop ~900px; the
webview adds several). Web inherits desktop breakpoints. Repo memory notes desktop smoke runs clamp
below the 1220px breakpoint, so tests must compute expected values via `matchMedia` rather than
hard-code desktop widths — a sign breakpoints are implicit.

**Proposed change.** Define a documented breakpoint scale as shared tokens (UI-2) and a documented
grid for the blade/plays layouts. Make the web surface explicitly choose its breakpoints rather than
inheriting desktop-window assumptions. Document the matrix (surface × breakpoint × layout) in this
file when implemented.

**Acceptance criteria.**
- Breakpoints come from shared tokens; the responsive matrix is documented.
- Web and desktop can set different breakpoints without divergent CSS forks.

**Blast radius.** Low-medium. Mostly CSS + docs; guard with snapshot specs.

---

## UI-5 — Accessibility pass · P1

**Problem / evidence.** `aria-*` and `role` usage exists but is not systematic across the two shells,
and there is no automated a11y gate. Resizable blades, tab lists, drawers, and tables are the
high-risk areas for keyboard and screen-reader users.

**Proposed change.** Audit and fix focus order, roles/labels, keyboard operability (blade resize,
tab navigation, dialog focus trap/restore), and color contrast against the shared tokens. Pair with
the automated axe checks in [TEST-7](04-testing-strategy.md#test-7--accessibility-tests-axe--p1).

**Acceptance criteria.**
- Interactive elements are reachable and operable by keyboard; dialogs trap and restore focus.
- axe scans report no serious/critical violations on the main desktop and web views.

**Blast radius.** Low-medium. Additive attributes + focus handling; low risk of regressions.

---

## UI-6 — Virtualize long lists and tables · P2

**Problem / evidence.** Portfolio opportunities, the plays queue (`plays-grouping.ts` builds grouped
queues), milestones, and discovery results render full lists. Large live portfolios will mount many
nodes at once, compounding the over-render issue in UI-3.

**Proposed change.** Virtualize the longest lists/tables (windowing) so only visible rows mount.
Apply after UI-1/UI-3 so the list components are isolated and memoized first. Measure with the
benchmark from [PERF-5](03-performance.md#perf-5--reduce-ui-bundle-and-render-cost--p2).

**Acceptance criteria.**
- Large portfolios/queues render in constant DOM size regardless of row count.
- Scroll remains smooth; no functional regression in selection/sort/filter.

**Blast radius.** Medium. Isolated to list components once UI-1 lands.

---

## Notes for implementers

- The web surface renders the desktop build; **every desktop layout change is also a web change.**
  Validate both the desktop revamp specs and the web visual snapshots.
- Keep presentation logic (markdown, prompts, sorting) in `packages/ui-logic` (MOD-4), not inside
  components, so both shells and any future Teams surface share it.
- Fluent UI v9 is already a dependency; prefer its primitives for new components to keep accessibility
  and theming consistent rather than hand-rolling controls.
