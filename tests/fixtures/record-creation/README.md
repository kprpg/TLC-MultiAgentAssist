# Record Creation Test Inputs

Sanitized, deterministic inputs for the Opportunity and Engagement Milestone creation design:

- [single-opportunity-multiple-milestones](./single-opportunity-multiple-milestones/)
- [multiple-opportunities-multiple-milestones](./multiple-opportunities-multiple-milestones/)

These are input fixtures only. They do not write to MSX and contain no real customer data.

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
| Owner | `user-morgan` | Morgan Lee |
| Workload | `workload-cloud-scale-analytics` | Cloud Scale Analytics |
| Workload | `workload-azure-ai-ml` | Azure AI and ML |
| Workload | `workload-commerce` | Commerce |
| Workload | `workload-cloud-security` | Cloud Security |
| Workload | `workload-well-architected` | Well Architected |

Future SQLite seeds should use these IDs or update the fixtures and seed together.

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

