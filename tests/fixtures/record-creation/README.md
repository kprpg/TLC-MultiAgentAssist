# Record Creation Test Inputs

Sanitized, deterministic inputs for the Opportunity and Engagement Milestone creation design:

- [single-opportunity-multiple-milestones](./single-opportunity-multiple-milestones/)
- [multiple-opportunities-multiple-milestones](./multiple-opportunities-multiple-milestones/)

These fixtures contain no real customer data and never write to MSX. The contract, SQLite,
orchestrator, CSV, and three-surface tests use them to verify preview and atomic sample creation.

## File layout

Each scenario contains:

| File | Purpose |
|---|---|
| `input.json` | Canonical nested `opportunity-batch` input, including Account context and child Milestones. |
| `opportunities.csv` | Flat Opportunity import rows. |
| `milestones.csv` | Flat Milestone import rows linked through `parentOpportunityKey`. |

The JSON and CSV files in a scenario describe the same records.

## Import conventions

- The Account is selected in TLC and is therefore absent from the CSV rows. Its deterministic test
  context is recorded in `input.json` and in each scenario section below.
- `clientOpportunityKey` and `clientMilestoneKey` are fixture-local idempotency/correlation keys.
  They are not Dataverse record IDs.
- `parentOpportunityKey` must match one `clientOpportunityKey` in the same scenario.
- Dates use ISO `YYYY-MM-DD`.
- Money and usage values are unformatted base-10 numbers.
- Lookup columns use deterministic IDs; companion labels are display assertions and are not trusted
  as identifiers.
- Choice columns use exact labels from the metadata research. Numeric choice codes are carried in
  the canonical JSON.
- The CSV `opportunityIntent` column uses `|` between multiple labels, for example
  `Billed|Consumption`. The separator is deliberately not a comma so standard CSV parsing remains
  unambiguous.
- Empty optional CSV cells normalize to omitted JSON properties.
- Every row is expected to be validated before an all-or-nothing SQLite commit.

## Deterministic reference data

| Kind | ID | Label |
|---|---|---|
| Account | `account-contoso` | Contoso Energy |
| Account | `account-fabrikam` | Fabrikam Retail |
| Price list | `price-list-usd-standard` | USD Standard Price List |
| Currency | `currency-usd` | US Dollar |
| Owner | `user-avery` | Avery Johnson |
| Owner | `user-morgan` | Morgan Diaz |
| Workload | `workload-cloud-scale-analytics` | Cloud Scale Analytics |
| Workload | `workload-azure-ai-ml` | Azure AI and ML |
| Workload | `workload-commerce` | Commerce |
| Workload | `workload-cloud-security` | Cloud Security |
| Workload | `workload-well-architected` | Well Architected |

The SQLite seed uses these IDs. Keep it and the fixtures in sync when changing reference data.

## Trying the paired CSV inputs

In the **New** tab of a SQLite-backed sample Desktop, VS Code extension, or hosted Web session,
select **Multiple Opportunities**, choose the Account named in the scenario, then **Import CSV**. Select the
scenario's `opportunities.csv` and `milestones.csv`, then select **Validate & load CSV**.
This only validates and populates the editable draft; it does not write to SQLite. Select
**Validate & review**, verify the complete batch, and then **Submit to SQLite** to insert it
atomically. The `input.json` file is the equivalent nested contract input used by tests.
For a Milestone-only batch, select an existing parent in **New > Milestone** and import a Milestone
CSV without the `parentOpportunityKey` column. The VS Code sample fixture mode and live mode
export drafts instead of persisting records.

In VS Code, set both `tlc.mode` to `sample` and `tlc.dataStore` to `sqlite`; install the current
VSIX and run **Developer: Reload Window** if the installed extension is older than the source.
Verify **Save target > SQLite sample store** before reviewing. The **Submit to SQLite** button
appears on the review screen, not the CSV import screen.

See the [creation walkthrough](../../../docs/user-guide/USER-GUIDE.md#new-opportunity-and-milestone-creation)
for form entry, CSV steps, expected records, persistence, and troubleshooting on each surface.

## Scenario expectations

### Single Opportunity / multiple Milestones

- Account: `account-contoso`
- Opportunities: 1
- Milestones: 3
- Expected atomic mutations when creator Deal Team membership is included: 5

### Multiple Opportunities / multiple Milestones

- Account: `account-fabrikam`
- Opportunities: 3
- Milestones: 6 (two under each Opportunity)
- Expected atomic mutations when each creator Deal Team membership is included: 12
