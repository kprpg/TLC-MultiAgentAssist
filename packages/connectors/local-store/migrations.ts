export const localStoreSchemaVersion = 1

export const migrateLocalStoreV1 = /* sql */ `
CREATE TABLE IF NOT EXISTS price_level (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transaction_currency (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  iso_code TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workload (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
ALTER TABLE account ADD COLUMN default_price_level_id TEXT REFERENCES price_level(id);
ALTER TABLE account ADD COLUMN default_currency_id TEXT REFERENCES transaction_currency(id);
ALTER TABLE opportunity ADD COLUMN price_level_id TEXT REFERENCES price_level(id);
ALTER TABLE opportunity ADD COLUMN transaction_currency_id TEXT REFERENCES transaction_currency(id);
ALTER TABLE opportunity ADD COLUMN opportunity_intent_codes TEXT;
ALTER TABLE engagement_milestone ADD COLUMN milestone_category INTEGER;
ALTER TABLE engagement_milestone ADD COLUMN workload_id TEXT REFERENCES workload(id);
ALTER TABLE engagement_milestone ADD COLUMN parent_account_id TEXT REFERENCES account(id);
ALTER TABLE engagement_milestone ADD COLUMN transaction_currency_id TEXT REFERENCES transaction_currency(id);
CREATE TABLE creation_batch (
  batch_id TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES account(id),
  created_by TEXT NOT NULL REFERENCES systemuser(id),
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE creation_batch_item (
  batch_id TEXT NOT NULL REFERENCES creation_batch(batch_id),
  client_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  record_id TEXT,
  parent_record_id TEXT,
  PRIMARY KEY (batch_id, kind, client_key)
);
`
