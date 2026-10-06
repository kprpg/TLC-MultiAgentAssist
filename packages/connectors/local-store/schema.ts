/**
 * SQLite DDL for the local test-data store. This mirrors the MSX / Dataverse
 * Opportunity + Engagement Milestone shape (and the MCEM decision-team / risk
 * tables) closely enough to exercise meeting-signal extraction and injection.
 *
 * Single source of truth for the schema; see docs/MeetingCapture.md §G9.
 * Verified option-set codes come from a live Dataverse `describe`.
 */
export const LOCAL_STORE_SCHEMA = /* sql */ `
PRAGMA foreign_keys = ON;

CREATE TABLE account (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  segment     TEXT,
  tpid        TEXT,
  visibility  TEXT NOT NULL DEFAULT 'visible'
);

CREATE TABLE systemuser (
  id        TEXT PRIMARY KEY,
  fullname  TEXT NOT NULL,
  initials  TEXT NOT NULL,
  email     TEXT,
  alias     TEXT
);

CREATE TABLE opportunity (
  id                       TEXT PRIMARY KEY,
  account_id               TEXT NOT NULL REFERENCES account(id),
  name                     TEXT NOT NULL,
  owner_id                 TEXT REFERENCES systemuser(id),
  recorded_stage           INTEGER NOT NULL,
  estimated_value          REAL NOT NULL DEFAULT 0,
  currency                 TEXT NOT NULL DEFAULT 'USD',
  estimated_close_date     TEXT NOT NULL,
  description              TEXT,
  -- Tier A (existing MSX columns)
  est_completion_date      TEXT,
  consumption_recurring    REAL,
  solution_area            TEXT,
  technical_capability     TEXT,
  -- Tier B (standard D365 — verified live)
  budget_amount            REAL,
  budget_status            INTEGER,     -- budgetstatus: Yes 1 / No 0
  purchase_timeframe       INTEGER,     -- purchasetimeframe: Q1 0..Next FY 4
  timeline                 INTEGER,     -- timeline: Immediate 0..Not known 4
  purchase_process         INTEGER,     -- purchaseprocess: Individual 0 / Committee 1 / Unknown 2
  decision_maker           INTEGER,     -- bit
  need                     INTEGER,     -- Must have 0..No need 3
  customer_need            TEXT,
  customer_pain_points     TEXT,
  current_situation        TEXT,
  proposed_solution        TEXT,
  final_decision_date      TEXT,
  identify_competitors     INTEGER,     -- bit
  identify_customer_contacts INTEGER,   -- bit
  close_probability        INTEGER,
  opportunity_rating       INTEGER,     -- Hot 1 / Warm 2 / Cold 3
  qualification_comments   TEXT,
  primary_competitor_id    TEXT REFERENCES competitor(id),
  other_competitor         TEXT,
  forecast_category        INTEGER
);

CREATE TABLE engagement_milestone (
  id                TEXT PRIMARY KEY,
  opportunity_id    TEXT NOT NULL REFERENCES opportunity(id),
  name              TEXT NOT NULL,
  status            INTEGER NOT NULL,   -- On Track 861980000..Hygiene/Duplicate 861980006
  milestone_date    TEXT,
  owner_id          TEXT REFERENCES systemuser(id),
  commitment        INTEGER,            -- Uncommitted 861980000 / Committed 861980003
  monthly_use       REAL,
  risk_details      TEXT,
  forecast_comments TEXT,
  conversation      TEXT,
  customer_budget_approved INTEGER      -- Yes 606820000 / No 606820001
);

CREATE TABLE contact (
  id         TEXT PRIMARY KEY,
  full_name  TEXT NOT NULL,
  job_title  TEXT,
  email      TEXT,
  account_id TEXT REFERENCES account(id)
);

CREATE TABLE competitor (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL
);

CREATE TABLE stakeholder (
  id                 TEXT PRIMARY KEY,
  opportunity_id     TEXT REFERENCES opportunity(id),
  name               TEXT NOT NULL,
  contact_id         TEXT REFERENCES contact(id),
  job_role           TEXT,
  role_optionset     INTEGER,  -- Executive Sponsor 861980000..Local Exec Sponsor 861980004
  stakeholder_role   INTEGER,  -- Champion 606820000..Ratifier 606820004
  relationship_level INTEGER,  -- Strong 606820000..None 606820003
  linkedin_url       TEXT
);

CREATE TABLE opportunity_dealteam (
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  systemuser_id  TEXT NOT NULL REFERENCES systemuser(id),
  PRIMARY KEY (opportunity_id, systemuser_id)
);

CREATE TABLE milestone_team_member (        -- app-owned milestone-team membership (independent of deal team)
  milestone_id   TEXT NOT NULL REFERENCES engagement_milestone(id),
  systemuser_id  TEXT NOT NULL REFERENCES systemuser(id),
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  PRIMARY KEY (milestone_id, systemuser_id)
);

CREATE TABLE milestone_activity (           -- Activity (Task) regarding a milestone (MSX: task.regardingobjectid)
  id               TEXT PRIMARY KEY,
  milestone_id     TEXT NOT NULL REFERENCES engagement_milestone(id),
  opportunity_id   TEXT NOT NULL REFERENCES opportunity(id),
  subject          TEXT NOT NULL,
  activity_type    TEXT NOT NULL DEFAULT 'task',
  status           TEXT NOT NULL DEFAULT 'Open',   -- Open / Completed / Canceled
  priority         TEXT,                           -- Low / Normal / High
  task_category    TEXT,
  due              TEXT,
  duration_minutes INTEGER,
  description      TEXT,
  owner_id         TEXT REFERENCES systemuser(id),
  created_by       TEXT REFERENCES systemuser(id),
  created_on       TEXT
);

CREATE TABLE discoverable_opportunity (     -- SE-domain discovery catalog ("Add me" candidates)
  id                   TEXT PRIMARY KEY,
  account_id           TEXT NOT NULL REFERENCES account(id),
  name                 TEXT NOT NULL,
  recorded_stage       INTEGER NOT NULL,
  value                REAL NOT NULL DEFAULT 0,
  currency             TEXT NOT NULL DEFAULT 'USD',
  close_date           TEXT NOT NULL,
  domain               TEXT NOT NULL,       -- infra|data|ai-apps|security|modern-work|biz-apps|devices|services
  solution_area        TEXT,
  technical_capability TEXT
);

CREATE TABLE activity (                       -- MSX: activitypointer / appointment (the meeting itself)
  id                     TEXT PRIMARY KEY,     -- MSX: activityid
  opportunity_id         TEXT REFERENCES opportunity(id),   -- MSX: regardingobjectid (opportunity)
  subject                TEXT NOT NULL,        -- MSX: subject
  owner_id               TEXT REFERENCES systemuser(id),    -- MSX: ownerid
  activity_type          TEXT,                 -- MSX: activitytypecode ('appointment','phonecall','task')
  scheduled_start        TEXT,                 -- MSX: scheduledstart (ISO)
  scheduled_end          TEXT,                 -- MSX: scheduledend  (ISO; the "due date" WF-007/WF-010 read)
  status                 INTEGER,              -- MSX: statecode (Open 0, Completed 1, Canceled 2, Scheduled 3)
  is_online_meeting      INTEGER,              -- MSX: isonlinemeeting (bit)
  online_meeting_join_url TEXT,                -- MSX: onlinemeetingjoinurl
  location               TEXT,                 -- MSX: location
  description            TEXT                  -- MSX: description
);

CREATE TABLE option_value (
  option_set TEXT NOT NULL,
  code       INTEGER NOT NULL,
  label      TEXT NOT NULL,
  PRIMARY KEY (option_set, code)
);

-- Test aids (not in MSX) ---------------------------------------------------
CREATE TABLE comment_entry (
  id         TEXT PRIMARY KEY,
  entity     TEXT NOT NULL,
  record_id  TEXT NOT NULL,
  author_id  TEXT REFERENCES systemuser(id),
  initials   TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE transcript (
  id             TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  activity_id    TEXT REFERENCES activity(id),   -- links the transcript to the meeting record
  meeting_type   TEXT NOT NULL,
  title          TEXT,
  source         TEXT,
  occurred_at    TEXT NOT NULL
);

CREATE TABLE transcript_segment (
  id            TEXT PRIMARY KEY,
  transcript_id TEXT NOT NULL REFERENCES transcript(id),
  start_ms      INTEGER,
  end_ms        INTEGER,
  speaker       TEXT,
  speaker_role  TEXT,
  text          TEXT NOT NULL
);

CREATE INDEX idx_opportunity_account ON opportunity(account_id);
CREATE INDEX idx_milestone_opportunity ON engagement_milestone(opportunity_id);
CREATE INDEX idx_stakeholder_opportunity ON stakeholder(opportunity_id);
CREATE INDEX idx_dealteam_user ON opportunity_dealteam(systemuser_id);
CREATE INDEX idx_milestoneteam_user ON milestone_team_member(systemuser_id);
CREATE INDEX idx_milestone_activity_milestone ON milestone_activity(milestone_id);
CREATE INDEX idx_activity_opportunity ON activity(opportunity_id);
CREATE INDEX idx_transcript_opportunity ON transcript(opportunity_id);
`
