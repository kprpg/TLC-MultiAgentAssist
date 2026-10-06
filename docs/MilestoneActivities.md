# Plan: Add Activities to Milestones

Status: **Implemented (Task create + list).** Users can view a milestone's Activities and create a
**Task** regarding the milestone from every surface. This document is retained as the design record;
the sections below describe the research and the as-built shape.

## As-built summary

- **Contracts** ([contracts/index.ts](../packages/common/contracts/index.ts)): `milestoneActivitySchema`,
  `createMilestoneActivityRequestSchema`, `taskCategorySchema` (24 bundled labels),
  `milestoneActivityPrioritySchema`.
- **Connector seam** ([connectors/common/index.ts](../packages/connectors/common/index.ts)):
  `listMilestoneActivities(opportunityId, milestoneId)` and
  `createMilestoneActivity(opportunityId, milestoneId, request)`.
- **Live** ([msx/live.ts](../packages/connectors/msx/live.ts)): create = `POST /tasks` with
  `regardingobjectid_msp_engagementmilestone@odata.bind` + `ownerid@odata.bind` (current user),
  `prioritycode`, `scheduledend` (Due), `actualdurationminutes` (Duration), and the Task Category
  option-set field when configured (`TLC_MSX_TASK_CATEGORY_FIELD` + `TLC_MSX_TASK_CATEGORY_CODES`
  JSON). List = `GET /tasks?$filter=_regardingobjectid_value eq <milestoneId>`.
- **Sample parity**: fixture connector (in-memory), SQLite `milestone_activity` table (seeded), and
  the in-browser + VS Code sample stores.
- **Transports**: Web `GET|POST /api/opportunities/{opp}/milestones/{ms}/activities`; Desktop IPC
  `tlc:list-milestone-activities` / `tlc:create-milestone-activity`; VS Code bridge
  `listMilestoneActivities` / `createMilestoneActivity`.
- **UI**: shared renderer shows an **Activities** item in the milestone Actions menu that opens a
  dialog with the activity list + a Quick-Create Task form; the VS Code webview shows an inline
  Activities panel per milestone with the same form.
- **Tests**: contract, connector (live mocked-fetch + SQLite), VS Code bridge, and a desktop e2e.

---


---

## 1. What the screenshots show (observed behavior)

On an **Engagement Milestone** form (`arc enabled SQL clone`, parented to an Opportunity + Account):

- Form tabs: **Summary · Timeline · Milestone Team · Deal Assistance · Delivery Programs ·
  Sales Programs · Related**. `Related ▾ → Activities` opens an **Activities** associated view.
- Activities view toolbar: **New Activity ▾** (Key Events, Appointment, Email, **Task**, Phone Call),
  **Add Existing Activity**, Show Chart, Refresh, Run Report, Excel Templates, Export, Show As.
- The list columns are **Subject · Activity Type · Activity Status · Priority · Due Date ·
  Created By · Regarding** — i.e. the standard Dataverse **activity** columns.
- **Quick Create: Task** panel fields: **Owner** (defaults to the signed-in user), **Subject**\*,
  **Task Category** (option set), **Description**, **Related Link**, **Due**, **Regarding**
  (pre-filled to the milestone — `arc enabled SQL clone`), **Duration** (e.g. 30 minutes),
  **Priority** (Normal). Save / Save & Close.

Observed **Task Category** option values (verbatim, for the bundled option set):
Architecture Design Session · Assessment · Blocker Escalation · Briefing · Call Back Requested ·
Consumption Plan · Cross Segment · Cross Workload · Customer Engagement · Demo ·
External (Co-creation of Value) · Internal · L300+ Demo · Negotiate Pricing · New Partner Request ·
PoC/Pilot · Post Sales · Rapid Prototyping · RFP/RFI · Solution Whiteboarding · Tech Support ·
Technical Close/Win Plan · Technical Workshop · Workshop.

---

## 2. Dataverse model and relationships (research)

**There is no separate "milestone activity" table.** Activities use Dataverse's standard polymorphic
activity model, and the milestone is linked through the activity's **`regardingobjectid`** lookup:

- `activitypointer` is the base activity table; concrete types are `task`, `appointment`, `email`,
  `phonecall`, plus custom activity types (the screenshot's "Key Events" is a custom activity).
- `regardingobjectid` is a **polymorphic lookup** that associates an activity to its parent record.
  A table must be **activity-enabled** to be a regarding target; `msp_engagementmilestone` **is**
  activity-enabled (the form exposes the Activities tab and "Regarding" is set to the milestone).
- The attached Task's **Regarding** = the milestone → the task row has
  `_regardingobjectid_value = <milestoneId>` with the regarding type = `msp_engagementmilestone`.

### 2.1 Create a Task regarding a milestone (Web API)

Confirmed binding syntax (`regardingobjectid_<entitylogicalname>@odata.bind` →
`/<entitysetname>(<GUID>)`):

```http
POST /api/data/v9.2/tasks
Content-Type: application/json

{
  "subject": "Architecture design session",
  "description": "…",
  "regardingobjectid_msp_engagementmilestone@odata.bind": "/msp_engagementmilestones(<milestoneId>)",
  "ownerid@odata.bind": "/systemusers(<userId>)",
  "scheduledend": "2027-02-03",                 // "Due"
  "actualdurationminutes": 30,                    // "Duration"
  "prioritycode": 1,                              // Low 0 / Normal 1 / High 2
  "<taskCategoryField>": <optionCode>             // "Task Category" (custom option set — confirm name)
}
```

### 2.2 Read activities regarding a milestone

```http
GET /api/data/v9.2/activitypointers
  ?$select=activityid,subject,activitytypecode,statecode,prioritycode,scheduledend,createdon
  &$expand=...formattedvalues via Prefer header
  &$filter=_regardingobjectid_value eq <milestoneId>
  &$orderby=scheduledend desc
```

Tasks-only read uses `/tasks?$filter=_regardingobjectid_value eq <milestoneId>`.

### 2.3 Unknowns to confirm with a live `describe` (Dataverse MCP was unauthenticated during research)

| Unknown | How to confirm | Fallback |
|---|---|---|
| **Task Category** logical field name (e.g. `msp_tasktype` / `msp_taskcategory`) and option codes | `describe tables/task`; match labels in §1 | Treat as configurable env (`TLC_MSX_TASK_CATEGORY_FIELD` + code map), like `riskDetailsField`/`stageCodes` |
| **Related Link** field logical name | `describe tables/task` | Optional; omit if unmapped |
| Whether "Key Events" is a custom activity type we must support | `describe` + solution review | MVP = **Task only** |
| Exact regarding navigation property casing | metadata `ManyToOneRelationships` (same technique as deal-team bindings) | Discover at runtime, cache (reuse `resolveDealTeamBindings` pattern) |

---

## 3. What already exists in this codebase (reuse)

- A sample **`activity`** table already models `activitypointer`/appointment shaped data with
  `opportunity_id` = `regardingobjectid` → opportunity, plus `activity_type`, `scheduled_start/end`,
  `status`, owner, etc. — see [schema.ts](../packages/connectors/local-store/schema.ts).
- `LocalStoreMsxConnector.listActivities(opportunityId)` + the `ActivityView` interface already read
  activities — see [local-store/index.ts](../packages/connectors/local-store/index.ts).
- The **live** connector does **not** read or write activities yet (no activity code in
  [msx/live.ts](../packages/connectors/msx/live.ts)); it must gain both for this feature.
- Governed-write precedent: `updateMilestone`, `updateOpportunityStage` (audit note), and the
  deal-team `post`/metadata-binding helpers give the exact live-write + navigation-binding pattern to
  follow.

---

## 4. Requirements

- **REQ-A1** A user can view the activities associated with a milestone (list: subject, type,
  status, priority, due, created-by).
- **REQ-A2** A user can create a **Task** regarding a milestone via a Quick-Create form (Owner
  defaults to the signed-in user; Subject required; Task Category, Description, Due, Priority,
  Duration, Related Link optional).
- **REQ-A3** The created task is linked to the milestone through `regardingobjectid` and appears in
  the milestone's activity list (and in MSX's native Activities tab).
- **REQ-A4** Works in **sample mode** (bundled fixtures, no network) and **live mode**.
- **REQ-A5** Consistent across **VS Code webview, Desktop, Web**.
- **REQ-A6** The write is **explicit and reviewed** (confirm step), **audited** (Dataverse
  created-by/created-on), and performed under the **delegated user** scope; the milestone must be in
  the user's reachable scope.
- **REQ-A7** (Stretch) Support additional activity types (Appointment, Phone Call, Email) and
  "Add Existing Activity". MVP is **Task create + list**.

---

## 5. Proposed design

### 5.1 Contracts (packages/common/contracts) — contracts-first

```ts
// Read model
export const milestoneActivitySchema = z.object({
  id: z.string().min(1),
  milestoneId: z.string().min(1),
  opportunityId: z.string().min(1),
  subject: z.string().min(1),
  activityType: z.enum(['task','appointment','phonecall','email','keyevent']).default('task'),
  status: z.string().min(1),                 // Open / Completed / Canceled / Scheduled
  owner: z.string().min(1).optional(),
  taskCategory: z.string().min(1).optional(),
  priority: z.enum(['Low','Normal','High']).optional(),
  due: z.string().date().optional(),
  durationMinutes: z.number().int().positive().optional(),
  description: z.string().optional(),
  relatedLink: z.string().url().optional(),
  createdBy: z.string().min(1).optional(),
  createdOn: z.string().datetime().optional()
})

// Bundled Task Category option set (labels from §1; codes confirmed via describe or env-mapped)
export const taskCategorySchema = z.enum([/* 24 labels from §1 */])

// Create request (write) — strict; subject required; owner defaults to current user server-side
export const createMilestoneActivityRequestSchema = z.object({
  opportunityId: z.string().min(1),
  milestoneId: z.string().min(1),
  activityType: z.literal('task').default('task'),  // MVP
  subject: z.string().trim().min(1).max(200),
  taskCategory: taskCategorySchema.optional(),
  description: z.string().max(30_000).optional(),
  due: z.string().date().optional(),
  priority: z.enum(['Low','Normal','High']).default('Normal'),
  durationMinutes: z.number().int().positive().max(100_000).optional(),
  relatedLink: z.string().url().max(2000).optional()
}).strict()
```

- Follow the Deal Team precedent: these schemas **do not** carry the global `contractVersion` (so no
  bump); add contract tests.
- Keep `milestoneSchema` unchanged; optionally add `activityCount?: number` later for a badge
  (additive, optional).

### 5.2 Connector seam (packages/connectors/common `MsxConnector`)

```ts
listMilestoneActivities(opportunityId: string, milestoneId: string): Promise<MilestoneActivity[]>
createMilestoneActivity(request: CreateMilestoneActivityRequest): Promise<MilestoneActivity>
```

- **Live** ([msx/live.ts](../packages/connectors/msx/live.ts)):
  - `createMilestoneActivity`: validate GUIDs; verify the milestone belongs to the opportunity
    (reuse `getMilestoneRows`, as `joinMilestoneTeam` does); resolve current user (`WhoAmI`); resolve
    the regarding navigation property from metadata (reuse the `resolveDealTeamBindings` caching
    pattern); `POST /tasks` with the `@odata.bind` body in §2.1; read back and return.
  - `listMilestoneActivities`: `GET /tasks?$filter=_regardingobjectid_value eq <milestoneId>` (+
    formatted values); map to the read model.
  - New write metadata (env-configured, like `riskDetailsField`/`stageCodes`):
    `TLC_MSX_TASK_CATEGORY_FIELD`, a Task-Category code map, and optional `TLC_MSX_TASK_RELATEDLINK_FIELD`.
  - Access rule: the milestone's opportunity must be in the user's reachable scope (portfolio **or**
    discoverable account scope) — same philosophy as milestone-team join.
- **Fixture + Local-store**: add a milestone-regarding activity store.
  - Local store: add nullable `milestone_id TEXT REFERENCES engagement_milestone(id)` to the existing
    `activity` table (plus `task_category`, `priority`, `duration_minutes`, `related_link`,
    `created_by`, `created_on`), and index `(milestone_id)`. `createMilestoneActivity` inserts a row;
    `listMilestoneActivities` selects by `milestone_id`.
  - Fixture/in-browser sample: in-memory activity list keyed by milestone id; seed a couple so the
    list is non-empty in sample mode.

### 5.3 Orchestrator

Thin pass-through with validation (mirrors `join/leaveMilestoneTeam`), parsing the request through
`createMilestoneActivityRequestSchema` before delegating to the connector.

### 5.4 Transport (three surfaces)

| Surface | Add |
|---|---|
| Web ([app.ts](../apps/web/src/app.ts)) | `GET` + `POST /api/opportunities/{opp}/milestones/{ms}/activities` |
| Desktop ([electron main](../apps/desktop/electron/main/index.ts) + [preload](../apps/desktop/electron/preload/index.ts)) | IPC `tlc:list-milestone-activities`, `tlc:create-milestone-activity` (schema-parse every arg; `assertTrustedSender`) |
| VS Code ([message-contracts.ts](../apps/vscode-extension/src/message-contracts.ts) → [host-router.ts](../apps/vscode-extension/src/host-router.ts) → [data-provider.ts](../apps/vscode-extension/src/data-provider.ts) → [live-provider-core.ts](../apps/vscode-extension/src/live-provider-core.ts)) | `listMilestoneActivities`, `createMilestoneActivity` bridge methods |

Wire both the shared [data-client.ts](../apps/desktop/renderer-revamp/src/data-client.ts) (web
fetch + desktop bridge + in-browser sample) and the VS Code
[webview/data-client.ts](../apps/vscode-extension/src/webview/app.tsx) + view-types.

### 5.5 UI (three surfaces)

Attach to each milestone row (next to the existing `+/−` team toggle and the edit menu):

- An **Activities** affordance: a small count/disclosure (`Activities (n)`) that expands an inline
  panel **or** opens a drawer/dialog showing the milestone's activity list and a **＋ New task**
  button.
- **Quick-Create Task** form (drawer on Desktop/Web Fluent UI; lightweight form in the VS Code
  webview) with: Subject\*, Task Category (select, bundled option set), Description, Due (date),
  Priority (Low/Normal/High), Duration (minutes), Related Link (url). Owner is implicit (current
  user) and shown read-only; Regarding is implicit (the milestone) and shown read-only.
- **Confirm-before-write**: a clear "Create task" primary action; disable while in flight; show
  success/error via the existing note/error surface; refresh the activity list on success. (This is a
  write, so it is explicit and reviewed by construction — no silent writes.)
- Identical labels/copy across surfaces; full keyboard + `aria-label` support.

### 5.6 Sample + live parity

- Seed sample activities regarding a few milestones (local-store + fixture + in-browser sample) so
  the list renders in sample mode; creating in sample mode appends to the in-memory/SQLite store.
- Bundle the Task Category option set in `packages/common` so sample mode needs no network.

---

## 6. Phased task breakdown

**Phase 0 — Live schema confirmation (spike, blocks live write only).**
Authenticate Dataverse MCP; `describe tables/task`; confirm the Task Category field logical name +
option codes, Related Link field, the `regardingobjectid_msp_engagementmilestone` navigation
property, and that a delegated (non-admin) user can create a task regarding a milestone and read it
back. Exit: a task is created regarding a real milestone and returned by the list query.

**Phase 1 — Contracts + option set.** Add `milestoneActivitySchema`,
`createMilestoneActivityRequestSchema`, `taskCategorySchema`, types; add contract tests. [REQ-A1,A2]

**Phase 2 — Connector seam + sample stores.** Add the two `MsxConnector` methods; implement
fixture + local-store (new `activity` columns/index + seed); unit tests for create/list, idempotency
of reads, and access scoping. [REQ-A1..A4,A6]

**Phase 3 — Live connector.** Implement live `createMilestoneActivity` (metadata-bound `POST /tasks`,
env-mapped Task Category) + `listMilestoneActivities`; add env write-metadata; connector tests with a
mocked fetch (mirroring `msx-discover-deal-team.test.ts`). [REQ-A2,A3,A6]

**Phase 4 — Orchestrator + transports.** Orchestrator methods; Web REST, Desktop IPC, VS Code bridge;
transport-contract/parity tests. [REQ-A5]

**Phase 5 — Shared Desktop/Web UI.** Activities panel + Quick-Create Task drawer in
`renderer-revamp/App.tsx` + data-client; e2e in `tests/e2e/revamp`. [REQ-A2,A5]

**Phase 6 — VS Code webview UI.** Equivalent panel + form; webview data-client/view-types. [REQ-A5]

**Phase 7 — Docs + rollout.** Update `docs/user-guide/USER-GUIDE.md`, `docs/FAQ.md`, and this doc’s
status; gate live write behind config until Phase 0 is satisfied in every environment.

---

## 7. Test plan

- **Contract**: strict parsing; subject required; priority/category enums; no global `contractVersion`.
- **Connector**: create returns a linked activity; list returns it; create verifies milestone∈
  opportunity; invalid GUID rejected (live); owner defaults to current user; sample create persists;
  access blocked when the milestone is out of scope.
- **Transport parity**: web/desktop/vscode produce identical create/list behavior.
- **UI**: form validation (Subject required), busy/disabled state, success refresh, error surface,
  keyboard/aria; list renders seeded sample activities.
- **Gates**: `typecheck` · `lint` · `test` · `ext:build` · `desktop:build` · `web:build` ·
  `tests/e2e/revamp`.

---

## 8. Risks and open questions

| Risk / question | Mitigation |
|---|---|
| Task Category field name/codes unknown | Phase-0 `describe`; env-mapped field + code map; sample uses bundled labels |
| `regardingobjectid` navigation property casing | Resolve from metadata at runtime + cache (reuse deal-team bindings pattern) |
| Milestone may not be activity-enabled in some orgs | Phase-0 confirms; if not, surface a clear "activities unavailable" state (no write) |
| Delegated user lacks task-create privilege | Phase-0 identity/role proof; show permission error, do not silently fail |
| Timed-out create (write) | Reconcile by read-back before any retry; otherwise surface "outcome unknown — refresh"; never blind-retry |
| Scope creep to all activity types / "Add Existing" | MVP = Task create + list; design the type as an enum so Appointment/Phone Call/Email are additive |
| Owner other than current user | MVP fixes Owner = signed-in user (matches the screenshot default); reassignment is out of scope |

---

## 9. Out of scope (MVP)

- "Add Existing Activity", Key Events, Appointments/Phone Calls/Emails (design leaves room via the
  `activityType` enum).
- Editing/completing/deleting existing activities (list is read + create only).
- The full MSX **Timeline** control; we present a focused Activities list.
