# Milestone Team Membership (+ / − toggle)

Status: **Shipped.** Design + architecture record for the capability that lets a signed-in user
add or remove **themselves** on an individual milestone's team, independently of the opportunity
Deal Team. The control is a compact **+ / −** toggle beside each milestone name on every surface
(VS Code webview, Desktop, Web).

> Companion feature: the opportunity **Deal Team** join/leave capability (Discovery "Add me / Remove
> me") already existed. This document covers the milestone-team capability built on top of it and the
> portfolio changes required to keep the two memberships independent.

---

## 1. Requirement and the key product decision

Original ask: *"Add a capability to add oneself to a Milestone. A simple + | − toggle beside the
milestones under each opportunity."*

The decisive clarification from the product owner:

> Opportunity and Milestone are **separate from each other** for membership. A person can be on the
> Opportunity Deal Team but not a member of a milestone, and **vice versa**. We need two independent
> capabilities: (1) add/remove from the Opportunity Deal Team, (2) add/remove from a Milestone team.

This makes membership a **many-to-many** relationship per user per milestone, and it is **not** the
same as the milestone's single `Owner`. The toggle never changes the milestone `Owner`.

### Membership state matrix

| Opportunity Deal Team | Milestone team (≥1 milestone) | Result |
|---|---|---|
| No  | No  | Opportunity is reachable only through Discovery |
| Yes | No  | Opportunity is in Portfolio; every milestone shows `+` |
| No  | Yes | Parent opportunity **stays in Portfolio** because of milestone membership |
| Yes | Yes | Opportunity appears once; both membership states are tracked independently |

Row 3 is the architecturally significant case: leaving the Deal Team must **not** strand an
opportunity (and its milestones) that the user still belongs to via a milestone team.

---

## 2. Feasibility findings (why it is built this way)

- **Milestone membership is a Dataverse Access Team.** The "Milestone Team" tab on the milestone form
  is the standard Dataverse **access team** (tooltip: _"Add user — Add a user to access this record"_).
  Membership is **not** a custom milestone↔systemuser many-to-many table; it is managed through the
  generic `team` / `teammembership` / `teamtemplate` tables and the `AddUserToRecordTeam` /
  `RemoveUserFromRecordTeam` actions. An earlier `describe` of `msp_engagementmilestone` missed this
  because auto-created access teams do not surface as a relationship on the entity.
- **Opportunity Deal Team already works end-to-end** via the real `msp_dealteams` intersect entity
  (`joinDealTeam` / `leaveDealTeam`). That pattern is reused for shape, not for storage.
- **No shared custom table was provisioned.** Creating a `tlc_milestoneteammember` Dataverse table in
  the shared org is a governance-gated action. To ship with full **sample + live parity** and real
  e2e testing *now*, milestone-team membership is persisted in an **app-owned store** keyed by the
  Dataverse `WhoAmI` user id. The store is an interface, so a future Dataverse-backed implementation
  can drop in without touching callers (see §9).

---

## 3. Domain model and persistence

> **Update (live MSX write — Dataverse Access Team):** Live milestone-team membership is the standard
> Dataverse **access team** behind the "Milestone Team" subgrid on the milestone form — not a custom
> intersect entity and **not an app-owned store**. Joining calls the `AddUserToRecordTeam` action and
> leaving calls `RemoveUserFromRecordTeam` (both bound to `systemuser`, taking the milestone `Record`
> and the access-team `TeamTemplate`). The "Milestone Team" **team template** is discovered at runtime
> by name, so **no per-tenant configuration is required**. `onMilestoneTeam` and the portfolio union
> are read from the `teams` / `teammembership` tables (access teams with `teamtype = 1` whose members
> include the signed-in user). The `MilestoneMembershipStore` below is retained only for sample/offline
> use and is not wired into `LiveMsxConnector`.
>
> Optional overrides (normally unnecessary): `TLC_MSX_MILESTONE_TEAM_TEMPLATE_NAME` (defaults to
> `Milestone Team`) and `TLC_MSX_MILESTONE_TEAM_TEMPLATE_ID` (an explicit team-template GUID that skips
> name discovery — set only if the environment has multiple templates sharing that name). When the
> access team is genuinely not set up, join/leave throw a short, actionable error instead of silently
> succeeding.

### 3.1 Membership store (sample/offline only)

`MilestoneMembershipStore` in
[milestone-membership.ts](../packages/connectors/common/milestone-membership.ts) is the authority for
milestone-team membership and the milestone-team half of the portfolio union.

```ts
interface MilestoneMembership { milestoneId: string; opportunityId: string } // opportunityId denormalized
interface MilestoneMembershipStore {
  list(userKey: string): Promise<MilestoneMembership[]>
  add(userKey: string, membership: MilestoneMembership): Promise<{ added: boolean }>   // idempotent
  remove(userKey: string, milestoneId: string): Promise<{ removed: boolean }>          // idempotent
}
```

- `userKey` is the Dataverse `WhoAmI` UserId (live) or the sample user id.
- `opportunityId` is denormalized alongside `milestoneId` so portfolio assembly can union
  milestone-team opportunities without a per-milestone lookup.
- Membership is unique per `(user, milestone)`.

Implementations:

| Impl | Used by | Durability |
|---|---|---|
| `MemoryMilestoneMembershipStore` | unit tests, default fallback | process only |
| `JsonFileMilestoneMembershipStore` | Desktop, Web, VS Code live | serialized mutation queue + atomic rename, survives restarts |
| SQLite `milestone_team_member` table | `TLC_DATA_STORE=sqlite` sample store | file/db |
| In-memory `Set` | in-browser sample + fixture connector | session only |

The JSON store mirrors `JsonFilePortfolioPreferenceStore` exactly (queue + atomic write).

### 3.2 Per-surface store paths

- Desktop: `userData/milestone-memberships.json`
- Web: `TLC_MILESTONE_MEMBERSHIP_PATH` or `.tlc/milestone-memberships.json`
- VS Code live: sibling of the portfolio-preferences file (`milestone-memberships.json`)

---

## 4. Contracts (packages/common/contracts)

Follows the Deal Team precedent — **membership results do not carry the global `contractVersion`**
(the `dealTeam*` result schemas don't either), so the global constant was intentionally **not**
bumped. See [contracts/index.ts](../packages/common/contracts/index.ts).

```ts
// Additive field on the milestone read model (optional; connectors set it per user at read time):
milestoneSchema.onMilestoneTeam: z.boolean().optional()

// Strict mutation results:
milestoneTeamJoinResultSchema  = { opportunityId, milestoneId, onMilestoneTeam: true,  alreadyMember }
milestoneTeamLeaveResultSchema = { opportunityId, milestoneId, onMilestoneTeam: false, alreadyAbsent }
```

`onMilestoneTeam` is **optional** (not required) specifically to avoid touching every milestone
construction site and to match how other per-record flags (`owner`, `commitment`) are modeled; each
connector always sets a definite boolean in its `listMilestones`, and the UI reads
`milestone.onMilestoneTeam === true`.

`MsxConnector` (the shared seam in
[connectors/common/index.ts](../packages/connectors/common/index.ts)) gains:

```ts
joinMilestoneTeam(opportunityId, milestoneId): Promise<MilestoneTeamJoinResult>
leaveMilestoneTeam(opportunityId, milestoneId): Promise<MilestoneTeamLeaveResult>
```

The caller never supplies a user id; the connector resolves the current identity.

---

## 5. Portfolio union (the independence guarantee)

`loadPortfolio` in the live connector ([msx/live.ts](../packages/connectors/msx/live.ts)) now unions
the opportunity ids from two sources before loading opportunities/accounts:

```text
opportunityIds = unique(
  dealTeamRows[].parentOpportunityId        // active msp_dealteams for the user
  ∪ milestoneMemberships[].opportunityId    // app-owned milestone memberships
)
```

The fixture and SQLite connectors apply the same union
(`portfolioOpportunityIds()` / a `UNION` query). Consequences enforced everywhere:

- Joining a milestone pulls the parent opportunity into Portfolio even with no Deal Team row.
- Leaving the Deal Team keeps the opportunity while any milestone membership remains.
- The opportunity leaves Portfolio only after **both** the Deal Team and all its milestone teams are
  left.
- `listMilestones` access is granted if the user is on the Deal Team **or** any milestone team for
  that opportunity (and the account is visible).

---

## 6. Mutation behavior

### Join (`+`)
1. Resolve current user (`WhoAmI` live / sample user).
2. Validate ids (GUIDs in live).
3. Read the opportunity's milestone rows and verify the milestone belongs to it.
4. `membershipStore.add` (idempotent → `alreadyMember`).
5. Invalidate portfolio + milestone caches.
6. Return confirmed `{ onMilestoneTeam: true, alreadyMember }`.

### Leave (`−`)
1. Resolve current user.
2. `membershipStore.remove` only that user's membership (idempotent → `alreadyAbsent`).
3. Invalidate caches.
4. Return `{ onMilestoneTeam: false, alreadyAbsent }`.

**Timed-out writes** against a real backend must be reconciled by the unique `(user, milestone)` key
before any retry (do not blindly retry); surface "outcome unknown — refresh to reconcile" if it can't
be reconciled. The app-owned JSON/SQLite store is local and atomic, so this risk applies to a future
Dataverse implementation.

---

## 7. Surface wiring (three-surface parity)

```
UI toggle (+/-)
  ├─ Desktop/Web shared renderer  apps/desktop/renderer-revamp/src/App.tsx + data-client.ts
  │    Web transport:  POST|DELETE /api/opportunities/{opp}/milestones/{ms}/team/me  (apps/web/src/app.ts)
  │    Desktop transport: IPC tlc:join-milestone-team / tlc:leave-milestone-team     (electron main + preload)
  └─ VS Code webview              apps/vscode-extension/src/webview/app.tsx + webview/data-client.ts
       Bridge: joinMilestoneTeam / leaveMilestoneTeam  (message-contracts.ts → host-router.ts → data-provider.ts)
              │
              ▼
   ThinSliceOrchestrator.join/leaveMilestoneTeam  (packages/orchestrator/index.ts)
              │
              ▼
   MsxConnector impls: LiveMsxConnector | FixtureMsxConnector | LocalStoreMsxConnector
              │                     │                    │
         JsonFile store        in-memory Set       milestone_team_member table
```

UI behavior (identical copy across surfaces):
- `+` adds you (no confirmation). `−` removes you with a short confirmation, because it can drop the
  parent opportunity from Portfolio.
- Only the affected row is disabled while the call is in flight; state changes only after the server
  confirms.
- Labels: `Add me to the team for <milestone>` / `Remove me from the team for <milestone>`;
  `aria-pressed` reflects membership; `Owner` is still shown separately and is never changed.

---

## 8. Validation

- Contracts: [milestone-team-contract.test.ts](../tests/contract/milestone-team-contract.test.ts).
- Store: [milestone-membership-store.test.ts](../tests/unit/connectors/milestone-membership-store.test.ts).
- Connectors (live + fixture + union + idempotency + guards):
  [msx-discover-deal-team.test.ts](../tests/connectors/msx-discover-deal-team.test.ts),
  [local-store.test.ts](../tests/unit/connectors/local-store.test.ts),
  [msx-live.test.ts](../tests/connectors/msx-live.test.ts).
- VS Code bridge router + message contracts:
  [vscode-extension-bridge.contract.test.ts](../tests/contract/vscode-extension-bridge.contract.test.ts),
  [message-contracts.test.ts](../tests/unit/vscode-extension/message-contracts.test.ts).
- e2e toggle (desktop IPC path):
  [desktop-milestones.spec.ts](../tests/e2e/revamp/desktop-milestones.spec.ts).
- SQLite sample store showcase (portfolio union + mixed `+/-` states + Discovery expansion) seeded in
  [seed.ts](../packages/connectors/local-store/seed.ts) and exercised end-to-end via
  [desktop-sqlite-showcase.spec.ts](../tests/e2e/revamp/desktop-sqlite-showcase.spec.ts)
  (run the app this way with `npm run desktop:start:sqlite`).
- Gates run green: `npm run typecheck` · `npm run lint` · `npm test` (489) · `ext:build` ·
  `desktop:build` · `web:build` · full `tests/e2e/revamp` suite.

---

## 9. Future hardening / open items

1. **Live uses the Dataverse Access Team (shipped).** Live join/leave call `AddUserToRecordTeam` /
   `RemoveUserFromRecordTeam` against the auto-created "Milestone Team" access team (team template
   discovered at runtime by name), and `onMilestoneTeam` / the portfolio union read from `teams` /
   `teammembership`. No custom `tlc_milestoneteammember` intersect entity is needed. The
   `MilestoneMembershipStore` remains only for sample/offline mode. **Phase-0 gate:** confirm the
   delegated (non-admin) user can add and remove *themselves* on a milestone access team in the target
   tenant (requires the access-team append/append-to privilege).
2. **Discovery milestone expansion** (greenfield path): **Shipped.** In Discovery, each opportunity
   row can be expanded to list its milestones (via `listDiscoverableMilestones`, which bypasses the
   portfolio gate within the user's account scope) and join a milestone team for an opportunity the
   user has never been on the Deal Team for. Joining promotes the opportunity into the portfolio
   union without Deal Team membership. Covered on all three surfaces + e2e.
3. **Provenance label.** A milestone-only account currently shows `deal-team` provenance (enum has no
   `milestone` value); cosmetic only.
4. **Audit.** The app-owned store has no audit trail; the Dataverse implementation gains
   created-by/created-on for free.
