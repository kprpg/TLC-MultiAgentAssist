/**
 * Canonical seed data for the local test-data store (sanitized; no real customer data).
 * Covers accounts incl. Zava + Adventure Works, opportunities across MCEM stages 1-5,
 * milestones across every pipeline status + both commitments, and the MCEM
 * decision-team / risk tables (stakeholder / contact / competitor) so meeting-signal
 * extraction and injection can be tested end to end.
 */

/** Verified live Dataverse option-set codes (code ↔ label). */
export const MILESTONE_STATUS: Readonly<Record<number, string>> = {
  861980000: 'On Track',
  861980001: 'At Risk',
  861980002: 'Blocked',
  861980003: 'Completed',
  861980004: 'Cancelled',
  861980005: 'Lost to Competitor',
  861980006: 'Hygiene/Duplicate'
}
export const COMMITMENT: Readonly<Record<number, string>> = { 861980000: 'Uncommitted', 861980003: 'Committed' }
export const BUDGET_STATUS: Readonly<Record<number, string>> = { 1: 'Yes', 0: 'No' }
export const TIMELINE: Readonly<Record<number, string>> = { 0: 'Immediate', 1: 'This Quarter', 2: 'Next Quarter', 3: 'This Year', 4: 'Not known' }
export const PURCHASE_PROCESS: Readonly<Record<number, string>> = { 0: 'Individual', 1: 'Committee', 2: 'Unknown' }
export const NEED: Readonly<Record<number, string>> = { 0: 'Must have', 1: 'Should have', 2: 'Good to have', 3: 'No need' }
export const OPPORTUNITY_RATING: Readonly<Record<number, string>> = { 1: 'Hot', 2: 'Warm', 3: 'Cold' }
export const STAKEHOLDER_ROLE_OPTIONSET: Readonly<Record<number, string>> = {
  861980000: 'Executive Sponsor', 861980001: 'SLT Sponsor', 861980002: 'Technical Sponsor',
  861980003: 'Initiative / Deal Sponsor', 861980004: 'Local Exec Sponsor'
}
export const STAKEHOLDER_ROLE: Readonly<Record<number, string>> = {
  606820000: 'Champion', 606820001: 'Influencer', 606820002: 'Decision Maker', 606820003: 'User', 606820004: 'Ratifier'
}
export const RELATIONSHIP_LEVEL: Readonly<Record<number, string>> = {
  606820000: 'Strong', 606820001: 'Developing', 606820002: 'Weak', 606820003: 'None'
}

type Row = Record<string, string | number | null>

/** The signed-in sample user (owner + comment initials source). */
export const SAMPLE_USER_ID = 'user-girish'

export const seedAccounts: readonly Row[] = [
  { id: 'account-contoso', name: 'Contoso Energy', segment: 'Strategic', tpid: '1000001', visibility: 'visible' },
  { id: 'account-fabrikam', name: 'Fabrikam Retail', segment: 'Enterprise', tpid: '1000002', visibility: 'visible' },
  { id: 'account-northwind', name: 'Northwind Health', segment: 'Enterprise', tpid: '1000003', visibility: 'visible' },
  { id: 'account-zava', name: 'Zava Inc.', segment: 'Strategic', tpid: '1000004', visibility: 'visible' },
  { id: 'account-adventureworks', name: 'Adventure Works Cycles', segment: 'Enterprise', tpid: '1000005', visibility: 'visible' }
]

export const seedSystemUsers: readonly Row[] = [
  { id: SAMPLE_USER_ID, fullname: 'Girish Pillai', initials: 'GP', email: 'girish.pillai@example.com', alias: 'gpillai' },
  { id: 'user-avery', fullname: 'Avery Johnson', initials: 'AJ', email: 'avery.johnson@example.com', alias: 'averyj' },
  { id: 'user-jordan', fullname: 'Jordan Lee', initials: 'JL', email: 'jordan.lee@example.com', alias: 'jordanl' },
  { id: 'user-morgan', fullname: 'Morgan Diaz', initials: 'MD', email: 'morgan.diaz@example.com', alias: 'morgand' }
]

// Opportunities across MCEM stages 1-5 with a spread of populated vs. deliberately empty fields.
export const seedOpportunities: readonly Row[] = [
  // Contoso
  { id: 'opp-grid-modernization', account_id: 'account-contoso', name: 'Grid operations modernization', owner_id: 'user-avery', recorded_stage: 3, estimated_value: 4_200_000, currency: 'USD', estimated_close_date: '2026-10-30', description: 'GP 9/1/2026 Kickoff held; technical validation underway.', est_completion_date: '2027-02-01', consumption_recurring: 48_000, solution_area: 'Cloud and AI Platforms', technical_capability: 'Analytics', budget_amount: 4_000_000, budget_status: 1, purchase_timeframe: 1, timeline: 1, purchase_process: 1, decision_maker: 1, need: 0, customer_need: 'Modernize grid operations telemetry.', customer_pain_points: 'Legacy SCADA cannot scale.', current_situation: 'On-prem historian at capacity.', proposed_solution: 'Azure data platform + analytics.', final_decision_date: '2026-10-15', identify_competitors: 1, identify_customer_contacts: 1, close_probability: 70, opportunity_rating: 1, qualification_comments: 'Strong exec sponsorship.', primary_competitor_id: 'competitor-aws', other_competitor: null, forecast_category: 100000003 },
  { id: 'opp-cloud-security-readiness', account_id: 'account-contoso', name: 'Cloud security readiness', owner_id: null, recorded_stage: 1, estimated_value: 900_000, currency: 'USD', estimated_close_date: '2027-02-26', description: null, est_completion_date: null, consumption_recurring: null, solution_area: 'Security', technical_capability: 'Threat Protection', budget_amount: null, budget_status: null, purchase_timeframe: null, timeline: null, purchase_process: null, decision_maker: null, need: null, customer_need: null, customer_pain_points: null, current_situation: null, proposed_solution: null, final_decision_date: null, identify_competitors: null, identify_customer_contacts: null, close_probability: 20, opportunity_rating: 3, qualification_comments: null, primary_competitor_id: null, other_competitor: null, forecast_category: 100000001 },
  { id: 'opp-data-estate-consolidation', account_id: 'account-contoso', name: 'Data estate consolidation', owner_id: 'user-jordan', recorded_stage: 2, estimated_value: 2_650_000, currency: 'USD', estimated_close_date: '2027-01-29', description: 'JL 8/20/2026 Discovery in progress.', est_completion_date: null, consumption_recurring: 22_000, solution_area: 'Cloud and AI Platforms', technical_capability: 'Analytics', budget_amount: 2_000_000, budget_status: 0, purchase_timeframe: 3, timeline: 3, purchase_process: 2, decision_maker: 0, need: 1, customer_need: 'Consolidate 6 data warehouses.', customer_pain_points: null, current_situation: null, proposed_solution: null, final_decision_date: null, identify_competitors: 0, identify_customer_contacts: 1, close_probability: 45, opportunity_rating: 2, qualification_comments: null, primary_competitor_id: null, other_competitor: 'Snowflake', forecast_category: 100000002 },
  // Fabrikam
  { id: 'opp-ai-service', account_id: 'account-fabrikam', name: 'AI-assisted customer service', owner_id: 'user-morgan', recorded_stage: 2, estimated_value: 1_750_000, currency: 'USD', estimated_close_date: '2026-12-18', description: null, est_completion_date: null, consumption_recurring: 18_000, solution_area: 'Cloud and AI Platforms', technical_capability: 'Azure AI and ML', budget_amount: 1_500_000, budget_status: 1, purchase_timeframe: 2, timeline: 2, purchase_process: 1, decision_maker: 1, need: 0, customer_need: 'Deflect 40% of tier-1 tickets.', customer_pain_points: 'High support cost.', current_situation: null, proposed_solution: 'Azure OpenAI + Copilot Studio.', final_decision_date: null, identify_competitors: 1, identify_customer_contacts: 0, close_probability: 55, opportunity_rating: 1, qualification_comments: null, primary_competitor_id: 'competitor-google', other_competitor: null, forecast_category: 100000002 },
  { id: 'opp-unified-commerce', account_id: 'account-fabrikam', name: 'Unified commerce platform', owner_id: 'user-morgan', recorded_stage: 4, estimated_value: 3_800_000, currency: 'USD', estimated_close_date: '2026-12-11', description: 'MD 7/30/2026 Contract in legal review.', est_completion_date: '2027-03-15', consumption_recurring: 61_000, solution_area: 'Digital and App Innovation', technical_capability: 'Cloud Native Apps', budget_amount: 3_800_000, budget_status: 1, purchase_timeframe: 0, timeline: 0, purchase_process: 1, decision_maker: 1, need: 0, customer_need: 'Single commerce backbone.', customer_pain_points: 'Fragmented storefronts.', current_situation: 'Three disparate platforms.', proposed_solution: 'AKS + Cosmos DB commerce platform.', final_decision_date: '2026-12-01', identify_competitors: 1, identify_customer_contacts: 1, close_probability: 85, opportunity_rating: 1, qualification_comments: 'Economic buyer engaged.', primary_competitor_id: null, other_competitor: null, forecast_category: 100000003 },
  { id: 'opp-store-modernization', account_id: 'account-fabrikam', name: 'Connected store modernization', owner_id: null, recorded_stage: 1, estimated_value: 1_200_000, currency: 'USD', estimated_close_date: '2027-03-19', description: null, est_completion_date: null, consumption_recurring: null, solution_area: 'Digital and App Innovation', technical_capability: 'IoT', budget_amount: null, budget_status: null, purchase_timeframe: null, timeline: null, purchase_process: null, decision_maker: null, need: 2, customer_need: null, customer_pain_points: null, current_situation: null, proposed_solution: null, final_decision_date: null, identify_competitors: null, identify_customer_contacts: null, close_probability: 15, opportunity_rating: 3, qualification_comments: null, primary_competitor_id: null, other_competitor: null, forecast_category: 100000001 },
  // Northwind — Stage 5 realize/manage
  { id: 'opp-clinical-data-platform', account_id: 'account-northwind', name: 'Clinical data platform modernization', owner_id: 'user-jordan', recorded_stage: 5, estimated_value: 2_100_000, currency: 'USD', estimated_close_date: '2026-09-20', description: 'JL 9/20/2026 Won; onboarding to value realization.', est_completion_date: '2026-11-30', consumption_recurring: 35_000, solution_area: 'Cloud and AI Platforms', technical_capability: 'Analytics', budget_amount: 2_100_000, budget_status: 1, purchase_timeframe: 0, timeline: 0, purchase_process: 1, decision_maker: 1, need: 0, customer_need: 'Unify clinical analytics.', customer_pain_points: null, current_situation: null, proposed_solution: 'Microsoft Fabric analytics.', final_decision_date: '2026-09-10', identify_competitors: 1, identify_customer_contacts: 1, close_probability: 100, opportunity_rating: 1, qualification_comments: null, primary_competitor_id: null, other_competitor: null, forecast_category: 100000005 },
  // Zava Inc.
  { id: 'opp-zava-ai-platform', account_id: 'account-zava', name: 'Zava AI platform foundation', owner_id: 'user-avery', recorded_stage: 2, estimated_value: 2_900_000, currency: 'USD', estimated_close_date: '2027-04-02', description: null, est_completion_date: null, consumption_recurring: 27_000, solution_area: 'Cloud and AI Platforms', technical_capability: 'Azure AI and ML', budget_amount: 2_500_000, budget_status: 0, purchase_timeframe: 3, timeline: 3, purchase_process: 2, decision_maker: 0, need: 1, customer_need: 'Stand up an enterprise AI platform.', customer_pain_points: 'No governed AI foundation.', current_situation: null, proposed_solution: null, final_decision_date: null, identify_competitors: 0, identify_customer_contacts: 0, close_probability: 40, opportunity_rating: 2, qualification_comments: null, primary_competitor_id: null, other_competitor: null, forecast_category: 100000002 },
  { id: 'opp-zava-migration', account_id: 'account-zava', name: 'Zava datacenter exit', owner_id: null, recorded_stage: 1, estimated_value: 1_600_000, currency: 'USD', estimated_close_date: '2027-05-28', description: null, est_completion_date: null, consumption_recurring: null, solution_area: 'Infrastructure', technical_capability: 'Migration', budget_amount: null, budget_status: null, purchase_timeframe: null, timeline: null, purchase_process: null, decision_maker: null, need: null, customer_need: null, customer_pain_points: null, current_situation: null, proposed_solution: null, final_decision_date: null, identify_competitors: null, identify_customer_contacts: null, close_probability: 10, opportunity_rating: 3, qualification_comments: null, primary_competitor_id: null, other_competitor: null, forecast_category: 100000001 },
  // Adventure Works
  { id: 'opp-aw-commerce', account_id: 'account-adventureworks', name: 'Adventure Works commerce replatform', owner_id: 'user-morgan', recorded_stage: 3, estimated_value: 3_100_000, currency: 'USD', estimated_close_date: '2027-01-08', description: 'MD 8/15/2026 POC approved.', est_completion_date: '2027-05-01', consumption_recurring: 40_000, solution_area: 'Digital and App Innovation', technical_capability: 'Cloud Native Apps', budget_amount: 3_000_000, budget_status: 1, purchase_timeframe: 1, timeline: 1, purchase_process: 1, decision_maker: 1, need: 0, customer_need: 'Replatform e-commerce.', customer_pain_points: 'Peak-season outages.', current_situation: 'Monolith on VMs.', proposed_solution: 'AKS microservices.', final_decision_date: '2026-12-20', identify_competitors: 1, identify_customer_contacts: 1, close_probability: 65, opportunity_rating: 1, qualification_comments: null, primary_competitor_id: 'competitor-aws', other_competitor: null, forecast_category: 100000003 },
  // Showcase: milestone-team-only (NOT on the Deal Team, but a milestone membership keeps it in the Portfolio).
  { id: 'opp-ms-only-showcase', account_id: 'account-contoso', name: 'Milestone-only workstream (no Deal Team)', owner_id: 'user-avery', recorded_stage: 2, estimated_value: 1_350_000, currency: 'USD', estimated_close_date: '2027-03-30', description: null, est_completion_date: null, consumption_recurring: 12_000, solution_area: 'Cloud and AI Platforms', technical_capability: 'Analytics', budget_amount: null, budget_status: null, purchase_timeframe: null, timeline: null, purchase_process: null, decision_maker: null, need: null, customer_need: null, customer_pain_points: null, current_situation: null, proposed_solution: null, final_decision_date: null, identify_competitors: null, identify_customer_contacts: null, close_probability: 40, opportunity_rating: 2, qualification_comments: null, primary_competitor_id: null, other_competitor: null, forecast_category: 100000002 },
  // Showcase: greenfield discovery candidate. Present in the opportunity table (so it can enter the Portfolio on milestone join) and in the discovery catalog, but with NO Deal Team and NO milestone membership — the user expands it in Discovery and joins its milestone team.
  { id: 'disc-contoso-greenfield', account_id: 'account-contoso', name: 'Greenfield AI expansion (join a milestone in Discovery)', owner_id: null, recorded_stage: 2, estimated_value: 2_050_000, currency: 'USD', estimated_close_date: '2027-04-18', description: null, est_completion_date: null, consumption_recurring: null, solution_area: 'Cloud and AI Platforms', technical_capability: 'Azure AI and ML', budget_amount: null, budget_status: null, purchase_timeframe: null, timeline: null, purchase_process: null, decision_maker: null, need: null, customer_need: null, customer_pain_points: null, current_situation: null, proposed_solution: null, final_decision_date: null, identify_competitors: null, identify_customer_contacts: null, close_probability: 30, opportunity_rating: 2, qualification_comments: null, primary_competitor_id: null, other_competitor: null, forecast_category: 100000002 }
]

const UNCOMMITTED = 861980000
const COMMITTED = 861980003

// Milestones covering every status, both commitments, and met vs. gap next-step.
export const seedMilestones: readonly Row[] = [
  // opp-grid (varied)
  { id: 'ms-grid-outcome', opportunity_id: 'opp-grid-modernization', name: 'Customer outcome validation', status: 861980003, milestone_date: '2026-07-15', owner_id: 'user-avery', commitment: COMMITTED, monthly_use: 4000, risk_details: null, forecast_comments: 'GP 7/15/2026 Outcome baseline agreed.', conversation: null, customer_budget_approved: 606820000 },
  { id: 'ms-grid-technical', opportunity_id: 'opp-grid-modernization', name: 'Technical validation workshop', status: 861980000, milestone_date: '2026-09-20', owner_id: 'user-avery', commitment: COMMITTED, monthly_use: 4000, risk_details: null, forecast_comments: null, conversation: null, customer_budget_approved: 606820000 },
  { id: 'ms-grid-security', opportunity_id: 'opp-grid-modernization', name: 'Security and compliance review', status: 861980001, milestone_date: '2026-10-05', owner_id: null, commitment: UNCOMMITTED, monthly_use: null, risk_details: 'Awaiting customer security team availability.', forecast_comments: null, conversation: null, customer_budget_approved: 606820001 },
  // opp-cloud-security (gaps: no owner/date)
  { id: 'ms-sec-discovery', opportunity_id: 'opp-cloud-security-readiness', name: 'Security posture discovery', status: 861980000, milestone_date: null, owner_id: null, commitment: UNCOMMITTED, monthly_use: null, risk_details: null, forecast_comments: null, conversation: null, customer_budget_approved: null },
  // opp-data-estate (blocked + hygiene)
  { id: 'ms-data-signoff', opportunity_id: 'opp-data-estate-consolidation', name: 'Business case sign-off', status: 861980002, milestone_date: '2026-09-30', owner_id: 'user-jordan', commitment: UNCOMMITTED, monthly_use: null, risk_details: 'Blocked on budget approval.', forecast_comments: null, conversation: null, customer_budget_approved: 606820001 },
  { id: 'ms-data-dupe', opportunity_id: 'opp-data-estate-consolidation', name: 'Duplicate milestone', status: 861980006, milestone_date: '2026-08-01', owner_id: 'user-jordan', commitment: UNCOMMITTED, monthly_use: null, risk_details: null, forecast_comments: null, conversation: null, customer_budget_approved: null },
  // opp-ai-service (completed + at risk)
  { id: 'ms-ai-poc', opportunity_id: 'opp-ai-service', name: 'POC readiness', status: 861980003, milestone_date: '2026-08-10', owner_id: 'user-morgan', commitment: COMMITTED, monthly_use: 1500, risk_details: null, forecast_comments: null, conversation: null, customer_budget_approved: 606820000 },
  { id: 'ms-ai-deploy', opportunity_id: 'opp-ai-service', name: 'Deployment readiness gate', status: 861980001, milestone_date: '2026-11-20', owner_id: 'user-morgan', commitment: UNCOMMITTED, monthly_use: 1500, risk_details: 'Integration dependencies unconfirmed.', forecast_comments: null, conversation: null, customer_budget_approved: 606820001 },
  // opp-unified-commerce (completed)
  { id: 'ms-uc-design', opportunity_id: 'opp-unified-commerce', name: 'Solution design complete', status: 861980003, milestone_date: '2026-09-01', owner_id: 'user-morgan', commitment: COMMITTED, monthly_use: 5000, risk_details: null, forecast_comments: 'MD 9/1/2026 Design signed off.', conversation: null, customer_budget_approved: 606820000 },
  { id: 'ms-uc-golive', opportunity_id: 'opp-unified-commerce', name: 'Go-live readiness', status: 861980000, milestone_date: '2027-02-28', owner_id: 'user-morgan', commitment: COMMITTED, monthly_use: 5000, risk_details: null, forecast_comments: null, conversation: null, customer_budget_approved: 606820000 },
  // opp-store-modernization (cancelled)
  { id: 'ms-store-scope', opportunity_id: 'opp-store-modernization', name: 'Scoping workshop', status: 861980004, milestone_date: '2026-08-05', owner_id: null, commitment: UNCOMMITTED, monthly_use: null, risk_details: 'Customer paused initiative.', forecast_comments: null, conversation: null, customer_budget_approved: 606820001 },
  // opp-clinical-data (completed value)
  { id: 'ms-clin-value', opportunity_id: 'opp-clinical-data-platform', name: 'Value realization baseline', status: 861980003, milestone_date: '2026-09-15', owner_id: 'user-jordan', commitment: COMMITTED, monthly_use: 2900, risk_details: null, forecast_comments: null, conversation: null, customer_budget_approved: 606820000 },
  // opp-zava-ai-platform (lost-to-competitor example + on track)
  { id: 'ms-zava-foundation', opportunity_id: 'opp-zava-ai-platform', name: 'AI foundation design', status: 861980000, milestone_date: '2027-01-15', owner_id: 'user-avery', commitment: UNCOMMITTED, monthly_use: 2200, risk_details: null, forecast_comments: null, conversation: null, customer_budget_approved: 606820001 },
  { id: 'ms-zava-pilot', opportunity_id: 'opp-zava-ai-platform', name: 'Competitive pilot', status: 861980005, milestone_date: '2026-11-01', owner_id: 'user-avery', commitment: UNCOMMITTED, monthly_use: null, risk_details: 'Lost pilot to competitor; recovering.', forecast_comments: null, conversation: null, customer_budget_approved: 606820001 },
  // opp-zava-migration (no milestones date gap)
  { id: 'ms-zava-assess', opportunity_id: 'opp-zava-migration', name: 'Migration assessment', status: 861980000, milestone_date: null, owner_id: null, commitment: UNCOMMITTED, monthly_use: null, risk_details: null, forecast_comments: null, conversation: null, customer_budget_approved: null },
  // opp-aw-commerce (at risk + on track)
  { id: 'ms-aw-poc', opportunity_id: 'opp-aw-commerce', name: 'POC sign-off', status: 861980003, milestone_date: '2026-08-15', owner_id: 'user-morgan', commitment: COMMITTED, monthly_use: 3300, risk_details: null, forecast_comments: null, conversation: null, customer_budget_approved: 606820000 },
  { id: 'ms-aw-scale', opportunity_id: 'opp-aw-commerce', name: 'Scale readiness', status: 861980000, milestone_date: '2026-12-15', owner_id: 'user-morgan', commitment: COMMITTED, monthly_use: 3300, risk_details: null, forecast_comments: null, conversation: null, customer_budget_approved: 606820000 },
  // Showcase: milestone-team-only opportunity — the user is on this milestone team (seedMilestoneTeam) but not the Deal Team.
  { id: 'ms-only-review', opportunity_id: 'opp-ms-only-showcase', name: 'Executive alignment review', status: 861980000, milestone_date: '2027-01-20', owner_id: 'user-avery', commitment: COMMITTED, monthly_use: 1200, risk_details: null, forecast_comments: null, conversation: null, customer_budget_approved: 606820000 },
  // Showcase: greenfield discovery milestone — no membership, so the user can join it from Discovery.
  { id: 'ms-greenfield-outcome', opportunity_id: 'disc-contoso-greenfield', name: 'Customer outcome validation', status: 861980000, milestone_date: '2027-02-10', owner_id: null, commitment: UNCOMMITTED, monthly_use: null, risk_details: null, forecast_comments: null, conversation: null, customer_budget_approved: null }
]

export const seedContacts: readonly Row[] = [
  { id: 'contact-grid-cfo', full_name: 'Priya Nair', job_title: 'CFO', email: 'priya.nair@contoso.example', account_id: 'account-contoso' },
  { id: 'contact-grid-cto', full_name: 'Daniel Reyes', job_title: 'CTO', email: 'daniel.reyes@contoso.example', account_id: 'account-contoso' },
  { id: 'contact-uc-vp', full_name: 'Sofia Martinez', job_title: 'VP Digital', email: 'sofia.martinez@fabrikam.example', account_id: 'account-fabrikam' },
  { id: 'contact-aw-vp', full_name: 'Liam OBrien', job_title: 'VP Engineering', email: 'liam.obrien@adventureworks.example', account_id: 'account-adventureworks' }
]

export const seedCompetitors: readonly Row[] = [
  { id: 'competitor-aws', name: 'AWS' },
  { id: 'competitor-google', name: 'Google Cloud' },
  { id: 'competitor-snowflake', name: 'Snowflake' }
]

export const seedStakeholders: readonly Row[] = [
  { id: 'stk-grid-cfo', opportunity_id: 'opp-grid-modernization', name: 'Priya Nair', contact_id: 'contact-grid-cfo', job_role: 'CFO', role_optionset: 861980000, stakeholder_role: 606820002, relationship_level: 606820000, linkedin_url: null },
  { id: 'stk-grid-cto', opportunity_id: 'opp-grid-modernization', name: 'Daniel Reyes', contact_id: 'contact-grid-cto', job_role: 'CTO', role_optionset: 861980002, stakeholder_role: 606820000, relationship_level: 606820001, linkedin_url: null },
  { id: 'stk-uc-vp', opportunity_id: 'opp-unified-commerce', name: 'Sofia Martinez', contact_id: 'contact-uc-vp', job_role: 'VP Digital', role_optionset: 861980003, stakeholder_role: 606820000, relationship_level: 606820000, linkedin_url: null },
  { id: 'stk-aw-vp', opportunity_id: 'opp-aw-commerce', name: 'Liam OBrien', contact_id: 'contact-aw-vp', job_role: 'VP Engineering', role_optionset: 861980002, stakeholder_role: 606820001, relationship_level: 606820001, linkedin_url: null }
]

/**
 * The sample user is on the Deal Team for every seeded opportunity EXCEPT the showcase opportunities:
 * `opp-ms-only-showcase` (milestone-team-only → portfolio union without Deal Team) and
 * `disc-contoso-greenfield` (a Discovery candidate the user joins via a milestone, not the Deal Team).
 */
export const DEAL_TEAM_EXCLUDED_OPPORTUNITY_IDS: ReadonlySet<string> = new Set([
  'opp-ms-only-showcase',
  'disc-contoso-greenfield'
])

export const seedDealTeam: readonly Row[] = seedOpportunities
  .filter((opportunity) => !DEAL_TEAM_EXCLUDED_OPPORTUNITY_IDS.has(String(opportunity['id'])))
  .map((opportunity) => ({
    opportunity_id: String(opportunity['id']),
    systemuser_id: SAMPLE_USER_ID
  }))

/**
 * The sample user is on the milestone team for a representative subset of milestones, so both
 * the join ("+") and leave ("-") states are visible in the SQLite sample store. Independent of
 * Deal Team membership. `ms-only-review` belongs to an opportunity the user is NOT on the Deal Team
 * for, so that opportunity appears in the Portfolio solely through milestone-team membership.
 */
export const seedMilestoneTeam: readonly Row[] = (['ms-grid-outcome', 'ms-grid-technical', 'ms-ai-poc', 'ms-uc-design', 'ms-only-review'] as const)
  .map((milestoneId) => {
    const milestone = seedMilestones.find((candidate) => candidate['id'] === milestoneId)!
    return { milestone_id: milestoneId, systemuser_id: SAMPLE_USER_ID, opportunity_id: String(milestone['opportunity_id']) }
  })

/** A couple of Activities (Tasks) regarding milestones, so the Activities list is non-empty in the SQLite store. */
export const seedMilestoneActivities: readonly Row[] = [
  { id: 'act-grid-outcome-1', milestone_id: 'ms-grid-outcome', opportunity_id: 'opp-grid-modernization', subject: 'Architecture design session', activity_type: 'task', status: 'Open', priority: 'Normal', task_category: 'Architecture Design Session', due: '2026-07-10', duration_minutes: 60, description: 'Whiteboard the target data platform.', owner_id: SAMPLE_USER_ID, created_by: SAMPLE_USER_ID, created_on: '2026-06-20T17:00:00.000Z' },
  { id: 'act-grid-technical-1', milestone_id: 'ms-grid-technical', opportunity_id: 'opp-grid-modernization', subject: 'Technical validation workshop prep', activity_type: 'task', status: 'Completed', priority: 'High', task_category: 'Technical Workshop', due: '2026-09-15', duration_minutes: 30, description: null, owner_id: SAMPLE_USER_ID, created_by: SAMPLE_USER_ID, created_on: '2026-09-01T17:00:00.000Z' }
]

export const seedOptionValues: readonly Row[] = [
  ...Object.entries(MILESTONE_STATUS).map(([code, label]) => ({ option_set: 'msp_milestonestatus', code: Number(code), label })),
  ...Object.entries(COMMITMENT).map(([code, label]) => ({ option_set: 'msp_commitmentrecommendation', code: Number(code), label })),
  ...Object.entries(BUDGET_STATUS).map(([code, label]) => ({ option_set: 'budgetstatus', code: Number(code), label })),
  ...Object.entries(TIMELINE).map(([code, label]) => ({ option_set: 'timeline', code: Number(code), label })),
  ...Object.entries(PURCHASE_PROCESS).map(([code, label]) => ({ option_set: 'purchaseprocess', code: Number(code), label })),
  ...Object.entries(NEED).map(([code, label]) => ({ option_set: 'need', code: Number(code), label })),
  ...Object.entries(OPPORTUNITY_RATING).map(([code, label]) => ({ option_set: 'opportunityratingcode', code: Number(code), label })),
  ...Object.entries(STAKEHOLDER_ROLE_OPTIONSET).map(([code, label]) => ({ option_set: 'msp_roleoptionset', code: Number(code), label })),
  ...Object.entries(STAKEHOLDER_ROLE).map(([code, label]) => ({ option_set: 'msp_stakeholderrole', code: Number(code), label })),
  ...Object.entries(RELATIONSHIP_LEVEL).map(([code, label]) => ({ option_set: 'msp_relationshiplevel', code: Number(code), label }))
]

/** SE-domain discovery catalog across all 8 domains ("Add me" candidates, not yet on the deal team). */
export const seedDiscoverable: readonly Row[] = [
  { id: 'disc-contoso-infra', account_id: 'account-contoso', name: 'Hybrid networking modernization', recorded_stage: 2, value: 1_850_000, currency: 'USD', close_date: '2027-03-01', domain: 'infra', solution_area: 'Cloud and AI Platforms', technical_capability: 'Advanced Networking' },
  { id: 'disc-contoso-data', account_id: 'account-contoso', name: 'Lakehouse analytics foundation', recorded_stage: 1, value: 1_250_000, currency: 'USD', close_date: '2027-04-10', domain: 'data', solution_area: 'Cloud and AI Platforms', technical_capability: 'Analytics' },
  { id: 'disc-fabrikam-aiapps', account_id: 'account-fabrikam', name: 'Cloud-native apps modernization', recorded_stage: 2, value: 2_300_000, currency: 'USD', close_date: '2027-02-20', domain: 'ai-apps', solution_area: 'Digital and App Innovation', technical_capability: 'Cloud Native Apps with AKS' },
  { id: 'disc-fabrikam-modernwork', account_id: 'account-fabrikam', name: 'Teams calling rollout', recorded_stage: 1, value: 540_000, currency: 'USD', close_date: '2027-05-05', domain: 'modern-work', solution_area: 'Modern Work', technical_capability: 'Calling' },
  { id: 'disc-zava-security', account_id: 'account-zava', name: 'Zero trust threat protection', recorded_stage: 2, value: 1_400_000, currency: 'USD', close_date: '2027-03-18', domain: 'security', solution_area: 'Security', technical_capability: 'Threat Protection' },
  { id: 'disc-zava-devices', account_id: 'account-zava', name: 'Surface fleet deployment', recorded_stage: 1, value: 480_000, currency: 'USD', close_date: '2027-06-01', domain: 'devices', solution_area: 'Windows and Devices', technical_capability: 'Surface & Partner Devices' },
  { id: 'disc-aw-bizapps', account_id: 'account-adventureworks', name: 'D365 customer service', recorded_stage: 2, value: 1_650_000, currency: 'USD', close_date: '2027-02-28', domain: 'biz-apps', solution_area: 'Business Applications', technical_capability: 'Customer Service' },
  { id: 'disc-aw-services', account_id: 'account-adventureworks', name: 'Cloud advisory services', recorded_stage: 1, value: 320_000, currency: 'USD', close_date: '2027-04-22', domain: 'services', solution_area: 'Microsoft Services', technical_capability: 'Advisory Services' },
  { id: 'disc-northwind-data', account_id: 'account-northwind', name: 'Clinical analytics with Fabric', recorded_stage: 2, value: 2_100_000, currency: 'USD', close_date: '2027-05-20', domain: 'data', solution_area: 'Cloud and AI Platforms', technical_capability: 'Analytics' },
  { id: 'disc-northwind-infra', account_id: 'account-northwind', name: 'Datacenter exit to Azure', recorded_stage: 1, value: 1_900_000, currency: 'USD', close_date: '2027-06-15', domain: 'infra', solution_area: 'Infrastructure', technical_capability: 'Migration' },
  // Showcase: greenfield candidate whose milestones can be expanded and joined in Discovery (its opportunity row exists so it can enter the Portfolio on milestone join).
  { id: 'disc-contoso-greenfield', account_id: 'account-contoso', name: 'Greenfield AI expansion (join a milestone in Discovery)', recorded_stage: 2, value: 2_050_000, currency: 'USD', close_date: '2027-04-18', domain: 'ai-apps', solution_area: 'Cloud and AI Platforms', technical_capability: 'Azure AI and ML' }
]

/** activitypointer / appointment statecode (verified live). */
export const ACTIVITY_STATUS: Readonly<Record<number, string>> = { 0: 'Open', 1: 'Completed', 2: 'Canceled', 3: 'Scheduled' }

/** Meetings / activities tied to opportunities (the meeting a transcript comes from). */
export const seedActivities: readonly Row[] = [
  { id: 'act-grid-review', opportunity_id: 'opp-grid-modernization', subject: 'Executive architecture review', owner_id: 'user-avery', activity_type: 'appointment', scheduled_start: '2026-10-12T15:00:00.000Z', scheduled_end: '2026-10-12T16:00:00.000Z', status: 3, is_online_meeting: 1, online_meeting_join_url: 'https://teams.microsoft.com/l/meetup-join/grid-review', location: 'Microsoft Teams', description: 'Review solution architecture and decision timeline.' },
  { id: 'act-grid-followup', opportunity_id: 'opp-grid-modernization', subject: 'Customer follow-up on security review', owner_id: 'user-avery', activity_type: 'phonecall', scheduled_start: '2026-08-01T14:00:00.000Z', scheduled_end: '2026-08-01T14:30:00.000Z', status: 0, is_online_meeting: 0, online_meeting_join_url: null, location: null, description: 'Overdue follow-up on the security and compliance review.' },
  { id: 'act-ai-kickoff', opportunity_id: 'opp-ai-service', subject: 'AI service kickoff', owner_id: 'user-morgan', activity_type: 'appointment', scheduled_start: '2026-08-10T16:00:00.000Z', scheduled_end: '2026-08-10T17:00:00.000Z', status: 1, is_online_meeting: 1, online_meeting_join_url: 'https://teams.microsoft.com/l/meetup-join/ai-kickoff', location: 'Microsoft Teams', description: 'Kickoff and discovery session.' },
  { id: 'act-cs-discovery', opportunity_id: 'opp-cloud-security-readiness', subject: 'Cloud security discovery call', owner_id: 'user-girish', activity_type: 'appointment', scheduled_start: '2026-09-15T15:00:00.000Z', scheduled_end: '2026-09-15T15:45:00.000Z', status: 1, is_online_meeting: 1, online_meeting_join_url: 'https://teams.microsoft.com/l/meetup-join/cs-discovery', location: 'Microsoft Teams', description: 'Qualify budget, timeline, and decision process for the security readiness initiative.' }
]

/** A seeded meeting transcript linked to a meeting activity, with diarized segments (evidence units). */
export const seedTranscripts: readonly Row[] = [
  { id: 'tr-grid-customer', opportunity_id: 'opp-grid-modernization', activity_id: 'act-grid-review', meeting_type: 'customer', title: 'Executive architecture review', source: 'teams', occurred_at: '2026-10-12T15:00:00.000Z' },
  { id: 'tr-cloud-security', opportunity_id: 'opp-cloud-security-readiness', activity_id: 'act-cs-discovery', meeting_type: 'customer', title: 'Cloud security discovery call', source: 'teams', occurred_at: '2026-09-15T15:00:00.000Z' }
]

export const seedTranscriptSegments: readonly Row[] = [
  { id: 'seg-grid-1', transcript_id: 'tr-grid-customer', start_ms: 12000, end_ms: 24000, speaker: 'Priya Nair', speaker_role: 'customer', text: 'Our board approved the budget; we can commit around 4 million this fiscal year.' },
  { id: 'seg-grid-2', transcript_id: 'tr-grid-customer', start_ms: 48000, end_ms: 61000, speaker: 'Daniel Reyes', speaker_role: 'customer', text: 'The decision will go through our architecture committee, and we want to decide this quarter.' },
  { id: 'seg-grid-3', transcript_id: 'tr-grid-customer', start_ms: 83000, end_ms: 95000, speaker: 'Avery Johnson', speaker_role: 'internal', text: 'We are competing against AWS here, so the proof of value needs to land next week.' },
  { id: 'seg-cs-1', transcript_id: 'tr-cloud-security', start_ms: 15000, end_ms: 30000, speaker: 'Priya Nair', speaker_role: 'customer', text: 'We have sign-off to spend about 900 thousand this quarter to get our cloud security posture right.' },
  { id: 'seg-cs-2', transcript_id: 'tr-cloud-security', start_ms: 54000, end_ms: 70000, speaker: 'Daniel Reyes', speaker_role: 'customer', text: 'Our security steering committee makes the final call, and honestly this is a must-have for us this year.' },
  { id: 'seg-cs-3', transcript_id: 'tr-cloud-security', start_ms: 95000, end_ms: 112000, speaker: 'Girish Pillai', speaker_role: 'internal', text: 'Let us schedule a threat-protection proof of value; note that Palo Alto is also in the evaluation.' }
]

export interface LocalStoreSeed {
  accounts: readonly Row[]
  systemUsers: readonly Row[]
  opportunities: readonly Row[]
  milestones: readonly Row[]
  contacts: readonly Row[]
  competitors: readonly Row[]
  stakeholders: readonly Row[]
  dealTeam: readonly Row[]
  milestoneTeam: readonly Row[]
  milestoneActivities: readonly Row[]
  optionValues: readonly Row[]
  discoverable: readonly Row[]
  activities: readonly Row[]
  transcripts: readonly Row[]
  transcriptSegments: readonly Row[]
}

export const defaultSeed: LocalStoreSeed = {
  accounts: seedAccounts,
  systemUsers: seedSystemUsers,
  opportunities: seedOpportunities,
  milestones: seedMilestones,
  contacts: seedContacts,
  competitors: seedCompetitors,
  stakeholders: seedStakeholders,
  dealTeam: seedDealTeam,
  milestoneTeam: seedMilestoneTeam,
  milestoneActivities: seedMilestoneActivities,
  optionValues: seedOptionValues,
  discoverable: seedDiscoverable,
  activities: seedActivities,
  transcripts: seedTranscripts,
  transcriptSegments: seedTranscriptSegments
}
