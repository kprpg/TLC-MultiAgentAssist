import { seReportSchema, type SeReport } from '../common/contracts/se-reporting.js'

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const money = (value: number | null) => value === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value)
const quantity = (value: number | null) => value === null ? 'Unavailable' : new Intl.NumberFormat('en-US').format(value)
const list = (rows: string[]) => rows.length ? `<ul>${rows.map((row) => `<li>${escape(row)}</li>`).join('')}</ul>` : '<p class="muted">None recorded.</p>'
const chip = (value: string) => `<span class="chip">${escape(value || 'Unknown')}</span>`
const table = (headers: string[], rows: string[][], caption: string, empty: string) => `<div class="table-wrap"><table><caption>${escape(caption)}</caption><thead><tr>${headers.map((heading) => `<th scope="col">${escape(heading)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">${escape(empty)}</td></tr>`}</tbody></table></div>`
type ReportNote = SeReport['account_notes'][number] & {
    partner?: string; engagement_strategy?: string; solution_play?: string; type?: string; pillar?: string; expected_outcome?: string
}
const detail = (label: string, value: string | undefined) => value ? `<p><b>${escape(label)}:</b> ${escape(value)}</p>` : ''
const notes = (title: string, items: readonly ReportNote[], references: (ids: string[]) => string) =>
    `<section><h2>${escape(title)}</h2>${items.length ? items.map((row) => `<article class="note"><h3>${escape(row.title || row.customer)} ${chip(row.atu)}</h3><p>${escape(row.customer)} · ${escape(row.ownership)}</p><p>${escape(row.text)}</p>
    ${detail('Partner', row.partner)}${detail('Engagement strategy', row.engagement_strategy)}${detail('Solution play', row.solution_play)}
    ${detail('Theme', row.type)}${detail('Dependency pillar', row.pillar)}${detail('Expected outcome', row.expected_outcome)}
    ${row.source_refs.length ? `<details><summary>Evidence references</summary>${references(row.source_refs)}</details>` : ''}</article>`).join('') : '<p class="muted">None recorded.</p>'}</section>`

export function seReportRelativePath(report: SeReport, extension: 'json' | 'html'): string {
    const filename = report.companion_files[extension]
    const segments = report.artifact_type === 'person_monthly_summary'
        ? ['persons', report.owner.alias, report.period, filename]
        : [report.atu!, report.period, filename]
    if (segments.some((segment) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment) || segment.includes('..'))) throw new Error('Unsafe report output path.')
    return segments.join('/')
}

export function renderSeReportHtml(raw: SeReport, options: { customerStatus?: string; dark?: boolean; includeFilters?: boolean } = {}): string {
    const report = seReportSchema.parse(raw)
    const references = (ids: string[]) => `<ul>${ids.map((id) => {
        const reference = report.source_references.find((row) => row.id === id)
        return `<li>${reference ? `<a href="${escape(reference.url)}" target="_blank" rel="noopener noreferrer">${escape(reference.source)}</a>` : escape(id)}</li>`
    }).join('')}</ul>`
    const kpi = report.dashboard.kpis
    const fiscal = `FY${report.fiscal_year.year % 100}`
    const tile = (label: string, value: string, secondary: string) => `<article class="kpi"><span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(secondary)}</small></article>`
    const summary = report.artifact_type === 'person_monthly_summary'
    const tiles = [
        tile('Accounts engaged', quantity(kpi.accounts_engaged), 'This period'),
        tile('Active milestones', quantity(kpi.active_milestones.current), `${fiscal} total: ${quantity(kpi.active_milestones.fiscal_year)}`),
        tile('Monthly ACR represented', money(kpi.milestone_pipeline_influenced.current), `${fiscal} milestone ACR: ${money(kpi.milestone_pipeline_influenced.fiscal_year)}`),
        tile('Milestones committed', quantity(kpi.committed_milestones.period), `${fiscal} YTD: ${quantity(kpi.committed_milestones.fytd)}`),
        tile('HoK activities', quantity(kpi.hok_activities.period), `${fiscal} YTD: ${quantity(kpi.hok_activities.fytd)}`)
    ].join('')
    const inventory = table(
        [...(summary ? ['ATU'] : []), 'Account', 'Milestone', 'Category', 'Status', 'Commitment', 'Monthly ACR'],
        report.milestone_inventory.map((row) => [
            ...(summary ? [escape(row.atu)] : []), escape(row.customer), escape(row.name), escape(row.category),
            chip(row.status), chip(row.commitment), escape(money(row.monthlyAcr))
        ]), `Current milestone status as of ${kpi.active_milestones.as_of_date}`, `No eligible ${fiscal} milestone pipeline.`)
    const initiatives = report.priority_initiatives.map((row) => `<article class="note"><h3>${escape(row.customer)} ${chip(row.atu)}</h3><p>${escape(row.sales_territory_name)} · ${escape(row.ownership)}</p><p><b>${escape(row.big_bet_opportunity)}</b></p><p>${escape(row.customer_need_business_outcome)}</p><p>${escape(row.plan)}</p><p>${escape(row.obstacles_help_needed)}</p>
        <p>FY26 annual ACR: ${escape(money(row.fy26_acr_year))} · Confidence: ${escape(row.confidence_level)}</p>
        ${row.known_amounts.length ? `<p>Known Monthly ACR: ${row.known_amounts.map((value) => escape(money(value))).join(', ')}</p>` : ''}
        ${list(row.next_steps)}${row.source_refs.length ? `<details><summary>Evidence references</summary>${references(row.source_refs)}</details>` : ''}</article>`).join('')
    const customerCards = report.customer_updates.map((row) => `<article class="customer status-${escape(row.status)}"${options.customerStatus && options.customerStatus !== row.status ? ' hidden' : ''}>
        <header><h3>${escape(row.customer)}</h3>${chip(row.ownership)} ${chip(row.atu)} <span class="status">${escape(row.status.replaceAll('_', ' '))}</span></header>
        <p>${escape(row.summary)}</p><p><b>Impact:</b> ${escape(row.impact)}</p>
        <div class="signals"><div><h4>MSX</h4>${row.msx.length ? row.msx.map((signal) => `<p><b>${escape(signal.label)}:</b> ${escape(signal.text)}</p>`).join('') : '<p class="muted">No pipeline signal recorded.</p>'}</div>
        <div><h4>M365</h4>${row.m365.length ? row.m365.map((signal) => `<p><b>${escape(signal.label)}:</b> ${escape(signal.text)}</p>`).join('') : '<p class="muted">No activity summary recorded.</p>'}</div></div>
        <details><summary>Next actions and evidence</summary>${list(row.next_actions)}<p>Confidence: ${escape(row.confidence)}</p>${references(row.source_refs)}</details></article>`).join('')
    const collaboration = table(['ATU', 'Account', 'Milestone', 'Support Provided', 'HoK Count'],
        report.cross_collaboration.items.map((row) => [escape(row.atu), escape(row.account), escape(row.milestone), escape(row.support_description), quantity(row.hok_count)]),
        'Cross Collaboration', 'No Cross Collaboration activity this period.')
    const asks = report.asks_for_manager.length ? report.asks_for_manager.map((row) => `<article class="note"><p class="verbatim">${escape(row.ask)}</p>${detail('Why it matters', row.why_it_matters)}${detail('Customer', row.customer)}${detail('Urgency', row.urgency)}${row.source_refs.length ? references(row.source_refs) : ''}</article>`).join('') : '<p class="muted">No asks provided by the reporter.</p>'
    const filters = options.includeFilters === false ? '' : `<fieldset class="report-status-filter"><legend>Customer update status</legend>${report.dashboard.customer_update_filters.map((value) => `<label><input type="radio" name="customer-status" value="${escape(value)}"${value === 'All' ? ' checked' : ''}>${escape(value.replaceAll('_', ' '))}</label>`).join('')}</fieldset>`
    return `<!doctype html><html lang="en"${options.dark ? ' class="dark"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(report.executive_summary.headline)}</title><style>
    :root{color-scheme:light;--bg:#f4f6f9;--surface:#fff;--fg:#202b3c;--muted:#596579;--line:#d6dce5;--accent:#165ac0}
    :root.dark{color-scheme:dark;--bg:#151c28;--surface:#202b3b;--fg:#edf2fa;--muted:#bcc7d8;--line:#42516a;--accent:#93c5fd}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 "Segoe UI",Arial,sans-serif}main{max-width:1480px;margin:auto;padding:24px}h1{font-size:28px;margin:4px 0}h2{font-size:20px;margin:0 0 14px}h3{font-size:16px;margin:0 0 6px}h4,p{margin:6px 0}section{margin:20px 0;padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:12px}.muted,small{color:var(--muted)}.banner{padding:10px;border:1px solid var(--line);border-radius:8px}.kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;padding:0;border:0;background:none}.kpi{padding:18px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}.kpi span,.kpi strong,.kpi small{display:block}.kpi strong{font-size:30px;line-height:1.4}.chip,.status{display:inline-block;border:1px solid var(--line);border-radius:20px;padding:2px 9px;font-size:12px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}caption{text-align:left;color:var(--muted);padding:0 0 12px}th,td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--muted)}th:last-child,td:last-child{text-align:right;white-space:nowrap}.customer,.note{padding:14px 0;border-bottom:1px solid var(--line)}.customer{border-left:4px solid var(--line);padding:16px;margin:12px 0}.customer header{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.customer h3{margin-right:auto}.status-running_hot{border-left-color:#db3750}.status-with_blocker{border-left-color:#ce7a13}.status-advisory{border-left-color:#218653}.status-watchlist{border-left-color:#7b8798}.signals{display:grid;grid-template-columns:1fr 1fr;gap:20px}.signals h4{color:var(--accent)}details{margin-top:12px}summary{cursor:pointer;padding:10px 0;font-weight:600}summary:focus-visible{outline:2px solid var(--accent)}.secondary-view{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:0 20px}.secondary-view>summary{padding:16px 0}.secondary-view section{border:0;border-top:1px solid var(--line);border-radius:0;padding:18px 0}.verbatim{white-space:pre-wrap}.customer[hidden]{display:none}
    @media(max-width:900px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.signals{grid-template-columns:1fr}}
    @media(max-width:480px){main{padding:12px}.kpis{grid-template-columns:1fr}section{padding:14px}.kpi strong{font-size:27px}}
    .report-status-filter{display:flex;flex-wrap:wrap;gap:12px;border:1px solid var(--line);margin:12px 0}.report-status-filter label{cursor:pointer}
    body{overflow-wrap:anywhere}
    .customer-updates:has(input[value="running_hot"]:checked) .customer:not(.status-running_hot),.customer-updates:has(input[value="with_blocker"]:checked) .customer:not(.status-with_blocker),.customer-updates:has(input[value="advisory"]:checked) .customer:not(.status-advisory),.customer-updates:has(input[value="watchlist"]:checked) .customer:not(.status-watchlist){display:none}
    @media print{body{background:#fff;color:#000}main{padding:0;max-width:none}details::details-content{content-visibility:visible!important;display:contents!important;height:auto!important}details:not([open])>*,details>*,.customer[hidden],.customer-updates .customer{display:block!important}details>summary,.report-status-filter{display:none!important}.secondary-view{border:0}.kpis{grid-template-columns:repeat(5,1fr)}.table-wrap{overflow:visible}.kpi{break-inside:avoid}section{break-inside:auto}.customer{break-inside:avoid}}
    </style></head><body><main><header><p class="muted">${escape(report.owner.name)} · ${escape(report.period)} · ${escape(report.atu_scope.included_atus.join(', '))}</p><h1>SE Reporting Dashboard</h1><p>${chip(report.status)} ${escape(report.included_pillars.join(', '))} · ${escape(report.manager.name)}</p></header>
    ${report.data_mode === 'sample' ? '<p class="banner">SYNTHETIC SAMPLE — no live customer data or SharePoint writes.</p>' : ''}
    ${report.schema_contract.test_mode ? '<p class="banner">TEST DRAFT — not eligible for approval or rollup.</p>' : ''}
    ${report.sources_unavailable.length ? '<p class="banner">Some activity evidence is unavailable. This draft may not reflect all work this period.</p>' : ''}
    <section class="kpis" aria-label="Reporting KPIs">${tiles}</section><p class="muted">Current milestone status as of ${escape(kpi.active_milestones.as_of_date)}. Monthly ACR is a monthly rate, not recognized revenue.</p>
    <section><h2>Executive Summary</h2><h3>${escape(report.executive_summary.headline)}</h3><p>${escape(report.executive_summary.overall_status)}</p>${list(report.executive_summary.running_hot)}${list(report.executive_summary.needs_attention)}<h3>Next month focus</h3>${list(report.executive_summary.next_month_focus)}</section>
    <section><h2>Priority Initiatives</h2>${initiatives || '<p class="muted">No source-backed priority initiatives recorded.</p>'}</section>
    <section class="milestone-inventory"><h2>${fiscal} Milestone Inventory</h2>${inventory}</section>
    <section><h2>Asks for ${escape(report.manager.name)}</h2>${asks}</section>
    <details class="secondary-view"><summary>See more</summary>
    <section class="customer-updates"><h2>Customer Updates</h2>${filters}${customerCards || '<p class="muted">No qualifying customer updates this period.</p>'}</section>
    ${notes('Account Notes', report.account_notes, references)}${notes('Partners', report.partners, references)}${notes('Technical Win / Loss / Learning Themes', report.technical_themes, references)}
    ${notes('Cross-Pillar Dependencies', report.cross_pillar_dependencies, references)}
    <section><h2>Cross Collaboration</h2>${collaboration}</section>
    ${notes('Next Month Priorities', report.next_month_priorities, references)}${notes('Leadership decisions', report.leadership_decisions, references)}
    ${notes('Scrum rollup bullets', report.scrum_rollup_bullets, references)}${notes('Follow-up required', report.follow_up_required, references)}
    </details></main></body></html>`
}
