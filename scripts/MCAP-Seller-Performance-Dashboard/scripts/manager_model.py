"""Official earnings and pipeline inspection model; no proxy attainment."""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
import calendar
import math
import re


class ModelError(ValueError):
    pass


SCENARIO_METRICS = frozenset({
    "ACR - Core", "Databases", "Fabric + XCR - Power BI Consumed Revenue",
})
HINT_METRICS = SCENARIO_METRICS | {
    "SAP Tenant Consumption", "MBS Co-Sell + Partner Sourced Revenue", "Unified ES For Azure",
}
PRODUCTION_CANDIDATE = "Production candidate - credit unverified"


def number(value, field):
    if isinstance(value, bool) or value is None:
        raise ModelError(f"Missing numeric field: {field}")
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ModelError(f"Invalid numeric field: {field}") from exc
    if not math.isfinite(result):
        raise ModelError(f"Non-finite numeric field: {field}")
    return result


def month_date(label):
    try:
        return datetime.strptime(label, "%B, %Y").date()
    except (ValueError, TypeError) as exc:
        raise ModelError("Unexpected earnings month format") from exc


def month_end(value):
    return value.replace(day=calendar.monthrange(value.year, value.month)[1])


def month_overlaps(value, start, end):
    return month_end(value) >= start and value <= end


def timing(value, today, end):
    if not value:
        return "undated"
    try:
        parsed = date.fromisoformat(value[:10])
    except (TypeError, ValueError) as exc:
        raise ModelError("Invalid pipeline date") from exc
    if parsed < today:
        return "overdue"
    return "in-quarter" if parsed <= end else "future"


def candidate_metrics(milestone, available_metrics=None):
    """Optional tentative hints, restricted to the supplied plan when available."""
    text = (milestone.get("workload") or "").lower()
    basis = "Optional workload hint; eligibility still requires owner validation"
    if not text:
        text = milestone.get("name", "").lower()
        basis = "Optional milestone-name hint; workload mapping requires owner validation"
    metrics = []
    if re.search(r"\b(sql|postgres|postgresql|mysql|cosmos|database|mariadb)\b", text):
        metrics.extend(["Databases", "ACR - Core"])
    elif re.search(r"\b(fabric|power\s*bi)\b", text):
        metrics.extend(["Fabric + XCR - Power BI Consumed Revenue", "ACR - Core"])
    elif re.search(r"\b(azure|synapse|databricks|foundry|sentinel|avd|aks|av\s?36|gpu)\b", text):
        metrics.append("ACR - Core")
    if re.search(r"\b(sap)\b", text):
        metrics.append("SAP Tenant Consumption")
    if re.search(r"\b(marketplace|co.sell|cosell)\b", text):
        metrics.append("MBS Co-Sell + Partner Sourced Revenue")
    if re.search(r"\b(unified)\b", text):
        metrics.append("Unified ES For Azure")
    if available_metrics is not None:
        metrics = [metric for metric in metrics if metric in available_metrics]
    return list(dict.fromkeys(metrics)), basis


def _monetary_units(row, label):
    """Nullable metadata is unknown; payout units do not establish the quota basis."""
    primary_fields = ("calculationCurrency", "attainmentUnit", "measuringUnit", "unit")
    observed = {
        field: str(row[field]).strip().upper()
        for field in (*primary_fields, "earningsUnit")
        if row.get(field) is not None and str(row[field]).strip()
    }
    for field, value in observed.items():
        if value != "USD":
            raise ModelError(f"{label}: unsupported {field} {row[field]!r}; "
                             "v1 requires explicit USD monetary units, not inferred currencies or counts")
    return any(field in observed for field in primary_fields)


def _sum(rows, field):
    return sum(number(r.get(field), field) for r in rows)


def commitment_state(value):
    text = (value or "").strip().lower()
    if text == "committed":
        return "committed"
    if text in {"uncommitted", "not committed", "non-committed", "non committed"}:
        return "uncommitted"
    return "unknown"


def illustrative_credit(monthly, start, end):
    """Hypothetical flat incremental run-rate; not earned credit or a forecast."""
    result, current = 0.0, start
    while current <= end:
        boundary = min(month_end(current), end)
        result += monthly * ((boundary - current).days + 1) / calendar.monthrange(current.year, current.month)[1]
        current = boundary + timedelta(days=1)
    return result


def build_model(quota, earnings, pipeline, today):
    try:
        return _build_model(quota, earnings, pipeline, today)
    except ModelError:
        raise
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError) as exc:
        raise ModelError(f"Missing or invalid required source field: {exc}") from exc


def _build_model(quota, earnings, pipeline, today):
    source_unit_checks = []
    perf = earnings.get("sections", {}).get("performance") or {}
    summary = earnings.get("sections", {}).get("summary") or {}
    grain = earnings.get("sections", {}).get("pcg", {}).get("pcgGrainResults") or []
    if not perf.get("pcgDetails") or not summary.get("attainmentSummary") or not grain:
        raise ModelError("Official performance, monthly calculations, and summary are required")
    _monetary_units(perf, "Official plan")
    start = date.fromisoformat(perf["calculationStartDateTime"][:10])
    end = date.fromisoformat(perf["calculationEndDateTime"][:10])
    fy = perf["fiscalYearId"]
    if type(fy) is not int or fy < 1:
        raise ModelError("Official fiscalYearId must be an integer")
    if start > end:
        raise ModelError("Official reporting start must not be after its end")
    if not start <= today <= end + timedelta(days=31):
        raise ModelError("Official reporting period does not contain the requested as-of date")
    if not isinstance(quota, list) or not quota:
        raise ModelError("Each user must provide their own official QuotaByAccounts CSV")
    full_quota_mappings, full_quota_keys = {}, set()
    for row in quota:
        if row.get("unit") != "USD":
            raise ModelError("Quota unit must be USD; v1 supports only USD monetary account-quota plans")
        if type(row.get("fiscalYear")) is not int:
            raise ModelError("Normalized quota fiscalYear must be an integer")
        if row["fiscalYear"] != fy:
            raise ModelError("Account quota fiscal year does not match official MINT reporting")
        metric, bucket = row["metric"], row["bucket"]
        if not metric or not bucket:
            raise ModelError("Quota metric and bucket must be populated")
        if metric in full_quota_mappings and full_quota_mappings[metric] != bucket:
            raise ModelError(f"Conflicting quota metric-to-bucket mapping: {metric}")
        full_quota_mappings[metric] = bucket
        key = str(row["tpid"]), metric, month_date(row["month"])
        if key in full_quota_keys:
            raise ModelError("Duplicate account quota month")
        full_quota_keys.add(key)
        if number(row.get("quota"), "account quota") < 0:
            raise ModelError("Negative account quota is unsupported")
    relevant_quota = [q for q in quota if month_overlaps(month_date(q["month"]), start, end)]
    if not relevant_quota:
        raise ModelError("No official account quota for the reporting period")
    names = {}
    q_by_account = defaultdict(float)
    q_by_metric = defaultdict(float)
    buckets_by_metric = {}
    quota_keys = set()
    quota_months = defaultdict(set)
    for row in relevant_quota:
        tpid, metric = str(row["tpid"]), row["metric"]
        if row["fiscalYear"] != fy:
            raise ModelError("Account quota fiscal year does not match official MINT reporting")
        if not tpid or tpid == "None" or not metric or not row["bucket"] or not row["account"]:
            raise ModelError("Quota account, TPID, metric and bucket must be populated")
        if tpid in names and names[tpid] != row["account"]:
            raise ModelError("Conflicting account names for the same quota TPID")
        if metric in buckets_by_metric and buckets_by_metric[metric] != row["bucket"]:
            raise ModelError(f"Conflicting quota metric-to-bucket mapping: {metric}")
        key = tpid, metric, row["month"]
        if key in quota_keys:
            raise ModelError("Duplicate account quota month")
        quota_keys.add(key)
        quota_months[metric].add(month_date(row["month"]))
        names[tpid] = row["account"]
        value = number(row.get("quota"), "account quota")
        if value < 0:
            raise ModelError("Negative account quota is unsupported")
        q_by_account[(tpid, metric)] += value
        q_by_metric[metric] += value
        buckets_by_metric[metric] = row["bucket"]

    account_rows = summary.get("accountSummary") or []
    reported_count = summary.get("counts", {}).get("accountSummary")
    if reported_count is not None and reported_count != len(account_rows):
        raise ModelError("Earnings account data is truncated")
    actual_by_account = defaultdict(float)
    missing_actuals, actual_months = set(), defaultdict(set)
    for row in account_rows:
        source_unit_checks.append(_monetary_units(row, "Official account actual"))
        if row.get("dimension") != "EndCustomerTopParentName":
            raise ModelError("Unexpected account grain in official earnings")
        if not row.get("months") or any(
            not month_overlaps(month_date(m), start, end) for m in row["months"]
        ):
            raise ModelError("Aggregated account earnings include months outside the period")
        tpid = str(row["id"])
        if tpid not in names:
            raise ModelError("Official earnings account missing from the account quota roster")
        key = tpid, row["metric"]
        if key not in q_by_account:
            raise ModelError("Official account metric missing from that account's quota")
        months = {month_date(m) for m in row["months"]}
        if len(months) != len(row["months"]) or actual_months[key] & months:
            raise ModelError("Duplicate or overlapping account actual periods")
        actual_months[key].update(months)
        if row.get("totalActuals") is None:
            missing_actuals.add(key)
        else:
            actual_by_account[key] += number(row["totalActuals"], "account actual")
    for key in missing_actuals:
        actual_by_account.pop(key, None)

    monthly = defaultdict(list)
    monthly_keys = set()
    for group in grain:
        md = month_date(group["fiscalMonthName"])
        if not month_overlaps(md, start, end):
            continue
        for row in group.get("pccGrainResults", []):
            key = row["pccName"], md
            if key in monthly_keys:
                raise ModelError("Duplicate official metric month")
            monthly_keys.add(key)
            source_unit_checks.append(_monetary_units(row, row["pccName"]))
            monthly[row["pccName"]].append((md, row))
    expected_months, current = set(), start.replace(day=1)
    while current <= end:
        expected_months.add(current)
        current = month_end(current) + timedelta(days=1)
    for key, months in actual_months.items():
        if months != expected_months:
            actual_by_account.pop(key, None)
    if any(months != expected_months for months in quota_months.values()):
        raise ModelError("Official account quota is missing reporting-period months")
    weights = {
        b["pcgName"]: number(b.get("pcgWeight"), "bucket weight")
        for b in perf["pcgDetails"]
    }
    if len(weights) != len(perf["pcgDetails"]) or any(not name for name in weights):
        raise ModelError("Duplicate or missing official bucket names")
    if any(weight < 0 or weight > 1 for weight in weights.values()):
        raise ModelError("Official bucket weights must be proportions between zero and one")
    if abs(sum(weights.values()) - 1) > 0.000001:
        raise ModelError("Official bucket weights do not sum to one")
    metrics, buckets, warnings = [], [], []
    closed_bucket = defaultdict(lambda: {"actual": 0.0, "quota": 0.0})
    closed_dates = set()
    official_metric_names = set()
    for bucket in perf["pcgDetails"]:
        name = bucket["pcgName"]
        source_unit_checks.append(_monetary_units(bucket, name))
        if not bucket.get("pccDetails"):
            raise ModelError(f"Official bucket has no compensation metrics: {name}")
        ca = number(bucket.get("calculatedTotalActuals"), "bucket calculated actual")
        cq = number(bucket.get("calculatedTotalQuota"), "bucket calculated quota")
        if cq < 0:
            raise ModelError("Negative official bucket calculated quota is unsupported")
        buckets.append({
            "name": name, "weight": weights[name], "unit": "USD",
            "attainment": number(bucket.get("pcgAttainment"), "bucket attainment"),
            "actual": number(bucket.get("totalActuals"), "bucket actual"),
            "quota": number(bucket.get("totalQuota"), "bucket quota"),
            "recurring": number(bucket.get("pcgQuotaRecurring"), "bucket recurring quota"),
            "calcActual": ca, "calcQuota": cq, "gap": max(cq - ca, 0),
        })
        for row in bucket.get("pccDetails", []):
            metric = row["pccName"]
            source_unit_checks.append(_monetary_units(row, metric))
            if not metric or metric in official_metric_names:
                raise ModelError("Duplicate official metric or conflicting metric-to-bucket mapping")
            official_metric_names.add(metric)
            if metric not in q_by_metric:
                raise ModelError("Official compensation metric missing from account quota")
            if buckets_by_metric[metric] != name:
                raise ModelError(f"Quota and official metric-to-bucket mapping conflict: {metric}")
            if {md for md, _ in monthly[metric]} != expected_months:
                raise ModelError(f"Official monthly source is missing reporting-period months: {metric}")
            a = number(row.get("totalPccActuals"), "metric actual")
            q = number(row.get("totalPccQuota"), "metric quota")
            month_rows = [r for _, r in monthly[metric]]
            if (not month_rows or abs(_sum(month_rows, "totalActuals") - a) > 1
                    or abs(_sum(month_rows, "totalQuota") - q) > 1):
                raise ModelError(f"Monthly source does not reconcile to official performance: {metric}")
            aca = sum(v for (t, m), v in actual_by_account.items() if m == metric)
            account_q_delta, account_a_delta = q_by_metric[metric] - q, aca - a
            if abs(account_q_delta) > 1:
                raise ModelError(f"Account quota does not reconcile to official earnings: {metric}")
            if abs(account_a_delta) > 1:
                warnings.append(f"{metric}: account actuals differ from the official metric total; "
                                "inspect account attribution before assigning the gap.")
            closed = [r for md, r in monthly[metric] if month_end(md) < today]
            closed_dates.update(md for md, _ in monthly[metric] if month_end(md) < today)
            cca = _sum(closed, "calculatedTotalActuals")
            ccq = _sum(closed, "calculatedTotalQuota")
            closed_bucket[name]["actual"] += cca
            closed_bucket[name]["quota"] += ccq
            calc_a = number(row.get("calculatedTotalActuals"), "metric calculated actual")
            calc_q = number(row.get("calculatedTotalQuota"), "metric calculated quota")
            if (abs(_sum(month_rows, "calculatedTotalActuals") - calc_a) > 1
                    or abs(_sum(month_rows, "calculatedTotalQuota") - calc_q) > 1):
                raise ModelError(f"Monthly calculated values do not reconcile: {metric}")
            metrics.append({
                "name": metric, "bucket": name, "unit": "USD",
                "mappingSupported": metric in HINT_METRICS,
                "scenarioAllowed": metric in SCENARIO_METRICS,
                "attainment": number(row.get("pccAttainment"), "metric attainment"),
                "actual": a, "quota": q,
                "recurring": number(row.get("pccQuotaRecurring"), "metric recurring quota"),
                "calcActual": calc_a, "calcQuota": calc_q,
                "gap": max(calc_q - calc_a, 0),
                "closedGap": max(ccq - cca, 0),
                "closedAttainment": cca / ccq * 100 if ccq > 0 else None,
                "accountActualDifference": account_a_delta,
                "accountQuotaDifference": account_q_delta,
            })
    if set(q_by_metric) != {r["name"] for r in metrics}:
        raise ModelError("The account quota and earnings metric sets differ")
    if full_quota_mappings != {r["name"]: r["bucket"] for r in metrics}:
        raise ModelError("The full quota CSV and official earnings metric-to-bucket mappings differ")
    weighted_closed = None
    if closed_dates and all(closed_bucket[b]["quota"] > 0 for b in weights):
        weighted_closed = sum(
            weights[b] * closed_bucket[b]["actual"] / closed_bucket[b]["quota"] * 100
            for b in weights
        )

    pipeline = dict(pipeline)
    pipeline["accountStatus"] = dict(pipeline.get("accountStatus") or {})
    pipeline["errors"] = list(pipeline.get("errors") or [])
    if pipeline.get("status") not in {"complete", "partial", "unavailable"}:
        pipeline["status"] = "unavailable"
    for tpid in names:
        status = pipeline["accountStatus"].get(tpid)
        if pipeline["status"] == "unavailable" or status not in {"complete", "partial", "unavailable"}:
            pipeline["accountStatus"][tpid] = "unavailable"
    uncertain_accounts = set()
    opportunities, milestones = [], []
    for original in pipeline.get("opportunities", []):
        row = dict(original)
        if str(row["tpid"]) not in names:
            raise ModelError("Pipeline record outside the quota roster")
        row["account"] = names[str(row["tpid"])]
        row["state"] = str(row.get("state") or "").strip().capitalize()
        if row["state"] not in {"Open", "Won", "Lost"}:
            uncertain_accounts.add(str(row["tpid"]))
        row["currency"] = str(row.get("currency") or "").strip().upper()
        for field in ("estimatedValue", "monthlyRunRate"):
            if row.get(field) is not None:
                row[field] = number(row[field], f"opportunity {field}")
        row["timing"] = timing(row.get("closeDate"), today, end)
        row["relevance"] = "Review metric mapping"
        opportunities.append(row)
    for original in pipeline.get("milestones", []):
        row = dict(original)
        if str(row["tpid"]) not in names:
            raise ModelError("Milestone outside the quota roster")
        row["account"] = names[str(row["tpid"])]
        row["currency"] = str(row.get("currency") or "").strip().upper()
        if row.get("monthly") is not None:
            row["monthly"] = number(row["monthly"], "milestone monthly amount")
        row["timing"] = timing(row.get("date"), today, end)
        row["metricCandidates"], row["mappingBasis"] = candidate_metrics(row, official_metric_names)
        status_label = str(row.get("status") or "").strip().lower()
        terminal = any(s in status_label for s in
                       ("completed", "cancel", "hygiene", "duplicate", "lost"))
        if row.get("opportunityId") and any(
                o["id"] == row["opportunityId"] and o["state"] == "Lost" for o in opportunities):
            terminal = True
        row["active"] = False if terminal else row.get("active")
        if not status_label and not terminal:
            row["active"] = None
        if row["active"] is not True and row["active"] is not False:
            row["active"] = None
            uncertain_accounts.add(str(row["tpid"]))
        eligible = (
            row["active"] is True
            and str(row.get("category") or "").strip().lower() == "production"
            and row.get("currency") == "USD"
            and row.get("monthly") is not None and row["monthly"] > 0
        )
        row["classification"] = (
            PRODUCTION_CANDIDATE if eligible
            else "Not an eligible production candidate"
        )
        row["scenarioCredit"] = (
            illustrative_credit(row["monthly"], date.fromisoformat(row["date"][:10]), end)
            if eligible and row["timing"] == "in-quarter"
            and SCENARIO_METRICS.intersection(row["metricCandidates"]) else None
        )
        milestones.append(row)
    if len({r["id"] for r in opportunities}) != len(opportunities):
        raise ModelError("Duplicate opportunity IDs in pipeline")
    if len({r["id"] for r in milestones}) != len(milestones):
        raise ModelError("Duplicate milestone IDs in pipeline")
    for tpid in uncertain_accounts:
        if pipeline["accountStatus"].get(tpid) == "complete":
            pipeline["accountStatus"][tpid] = "partial"
    if uncertain_accounts:
        pipeline["errors"].append("Some returned records have unknown status/activity; "
                                  "source quality requires review, not a zero-pipeline conclusion.")
    if pipeline.get("status") == "complete" and any(
            pipeline["accountStatus"].get(tpid) != "complete" for tpid in names):
        pipeline["status"] = "partial"

    def candidates(tpid=None, metric=None):
        return [
            r for r in milestones
            if r["classification"] == PRODUCTION_CANDIDATE
            and r["timing"] == "in-quarter"
            and (tpid is None or str(r["tpid"]) == tpid)
            and (metric is None or metric in r["metricCandidates"])
        ]

    def mapping_review(metric, tpid=None):
        return metric not in HINT_METRICS or any(
            not r["metricCandidates"] for r in candidates(tpid=tpid)
        )

    def split_monthly(rows):
        return (
            sum(r["monthly"] for r in rows if commitment_state(r.get("commitment")) == "committed"),
            sum(r["monthly"] for r in rows if commitment_state(r.get("commitment")) == "uncommitted"),
        )

    accounts, actions = [], []
    for tpid, name in sorted(names.items(), key=lambda kv: kv[1].lower()):
        account_metrics = []
        for metric in q_by_metric:
            key = tpid, metric
            if key not in q_by_account and key not in actual_by_account:
                continue
            q = q_by_account.get(key, 0)
            a = actual_by_account.get(key)
            account_metrics.append({
                "metric": metric, "bucket": buckets_by_metric[metric],
                "quota": q, "actual": a,
                "variance": a - q if a is not None else None,
                "gap": max(q - a, 0) if a is not None else None,
            })
        status = pipeline.get("accountStatus", {}).get(tpid, "unavailable")
        open_opps = [o for o in opportunities if str(o["tpid"]) == tpid
                     and o.get("state", "").lower() == "open"]
        in_period = [o for o in open_opps if o["timing"] == "in-quarter"]
        all_active = [m for m in milestones if str(m["tpid"]) == tpid and m.get("active")]
        prod = [m for m in all_active if m["classification"] == PRODUCTION_CANDIDATE]
        current = candidates(tpid=tpid)
        committed, uncommitted = split_monthly(current)
        no_pipeline = status == "complete" and not any(
            str(r["tpid"]) == tpid for r in opportunities + milestones
        )
        no_in_period = status == "complete" and not in_period and not current
        if account_metrics and all(m["gap"] == 0 for m in account_metrics):
            action = "No posted account gap; protect existing performance. No additional gap-closing pipeline is required."
            if status != "complete":
                action += " Source quality / completeness still requires review."
        elif status != "complete":
            action = "Resolve MSX source warnings: confirm milestone statuses, account attribution and retrieval completeness before asserting coverage."
        elif no_pipeline:
            action = "No pipeline recorded in accessible MSX records. Create and qualify a gap-closing play."
        elif no_in_period:
            action = "No remaining-period pipeline recorded. Build a new play or confirm a realistic pull-forward."
        elif not current:
            action = "Deals exist but no dated, valued production milestone supports remaining-period consumption."
        else:
            action = "Validate workload credit, incremental consumption, go-live date and ramp with milestone owners."
        if any(m["actual"] is None for m in account_metrics):
            action += " Missing account actuals must be resolved; they are not assumed zero."
        account = {
            "tpid": tpid, "name": name, "metrics": account_metrics,
            "pipeline": {
                "status": status, "openCount": len(open_opps),
                "inQuarterCount": len(in_period),
                "inQuarterValue": sum(
                    o["estimatedValue"] for o in in_period
                    if o.get("currency") == "USD" and o.get("estimatedValue") is not None
                ),
                "productionCount": len(prod), "inQuarterProductionCount": len(current),
                "committedMonthly": committed, "uncommittedMonthly": uncommitted,
                "noPipeline": no_pipeline, "noInQuarterPipeline": no_in_period,
            }, "nextAction": action,
        }
        accounts.append(account)
        for metric in account_metrics:
            if metric["gap"] is not None and metric["gap"] <= 0:
                continue
            rows = candidates(tpid=tpid, metric=metric["metric"])
            issue = (
                "Pipeline source needs review" if status != "complete"
                else "Metric mapping requires review" if mapping_review(metric["metric"], tpid)
                else "No pipeline recorded" if no_pipeline
                else "No remaining-period production candidate" if not rows
                else "Candidate consumption is not verified gap coverage"
            )
            actions.append({
                "account": name, "tpid": tpid, "metric": metric["metric"],
                "priority": "High" if not rows else "Medium",
                "issue": issue, "action": (
                    "Review metric credit rules and unmapped production inventory. Optional hints "
                    "cannot certify zero metric pipeline." if issue == "Metric mapping requires review" else action
                ),
                "owner": ", ".join(sorted({r["owner"] for r in rows if r.get("owner")})) or "Account team",
            })
    coverage = []
    for metric in metrics:
        rows = candidates(metric=metric["name"])
        committed, uncommitted = split_monthly(rows)
        scenario_allowed = metric["scenarioAllowed"]
        sc = sum(r["scenarioCredit"] for r in rows if r["scenarioCredit"] is not None
                 and commitment_state(r.get("commitment")) == "committed")
        su = sum(r["scenarioCredit"] for r in rows if r["scenarioCredit"] is not None
                 and commitment_state(r.get("commitment")) == "uncommitted")
        review_mapping = mapping_review(metric["name"])
        state = (
            "No posted gap" if metric["gap"] == 0
            else "Unavailable" if pipeline.get("status") == "unavailable"
            else "Source quality / completeness requires review" if pipeline.get("status") != "complete"
            else "Metric mapping requires review" if review_mapping
            else "Needs credit validation" if rows else "No remaining-period candidate"
        )
        coverage.append({
            "metric": metric["name"], "bucket": metric["bucket"], "gap": metric["gap"],
            "candidateCount": len(rows), "committedMonthly": committed,
            "uncommittedMonthly": uncommitted, "verifiedPeriodCredit": None, "state": state,
            "mappingSupported": metric["mappingSupported"], "mappingReviewRequired": review_mapping,
            "scenarioAllowed": scenario_allowed,
            "scenarioCommittedCredit": sc if scenario_allowed else None,
            "scenarioUncommittedCredit": su if scenario_allowed else None,
            "scenarioRemainingGap": (
                max(metric["gap"] - sc - su, 0)
                if scenario_allowed and pipeline.get("status") == "complete" else None
            ),
            "nextAction": (
                "No posted gap; protect existing performance." if metric["gap"] == 0
                else "Resolve source completeness before declaring a gap uncovered."
                if pipeline.get("status") != "complete"
                else "Review metric credit rules and unmapped production inventory; "
                "available optional hints cannot certify zero metric pipeline."
                if review_mapping
                else "Validate incremental, in-period credited dollars; monthly run-rate is not period revenue."
                if rows else "No candidates matched the optional hints; verify mapping and credit rules "
                "before asserting the metric has no pipeline."
            ),
        })
    refreshes = [r["lastRefreshDateTime"] for r in summary["attainmentSummary"]
                 if r.get("lastRefreshDateTime")]
    refreshed = min(refreshes) if refreshes else None
    age = (today - date.fromisoformat(refreshed[:10])).days if refreshed else None
    warnings.extend(pipeline.get("errors", []))
    unmapped = sum(1 for r in candidates() if not r["metricCandidates"])
    if unmapped:
        warnings.append(f"{unmapped} remaining-period production candidates have no suggested metric mapping; "
                        "review unmapped inventory before declaring metric pipeline absent.")
    if age is None or age > 2:
        warnings.append("Official earnings are not current through today. Open-month results are incomplete.")
    if not all(source_unit_checks):
        warnings.append("Some optional MINT unit metadata is absent or blank; those source units remain unverified. "
                        "USD denomination relies on the user's validated USD quota and monetary reconciliation, "
                        "not an invented official source unit.")
    warnings.append("Pipeline visibility is limited to the signed-in user's accessible MSX records.")
    warnings.append("No pipeline amount has been certified as incremental in-period earnings credit.")
    return {
        "schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat(),
        "plan": {
            "currency": "USD", "unit": "USD", "fiscalYear": fy,
            "sourceUnitsVerified": bool(source_unit_checks) and all(source_unit_checks),
            "metricMapping": [{
                "metric": metric["name"], "bucket": metric["bucket"],
                "hintSupported": metric["mappingSupported"],
                "state": "Metric mapping requires review" if mapping_review(metric["name"])
                else "Optional tentative hints only",
                "scenarioAllowed": metric["scenarioAllowed"],
            } for metric in metrics],
            "unmappedProductionCandidates": unmapped,
        },
        "period": {
            "label": f"FY{fy} reporting period",
            "start": start.isoformat(), "end": end.isoformat(), "today": today.isoformat(),
        },
        "sources": {
            "earnings": {
                "status": "stale" if age is None or age > 2 else "live",
                "generatedAt": earnings["generatedAt"], "refreshedAt": refreshed,
                "months": sorted({r["month"] for r in summary["attainmentSummary"]}, key=month_date),
                "ageDays": age,
            },
            "pipeline": {
                "status": pipeline.get("status", "unavailable"),
                "asOf": pipeline.get("asOf"), "errors": pipeline.get("errors", []),
            },
            "quota": {
                "name": "User-provided official QuotaByAccounts CSV (validated USD input)",
                "rows": len(quota), "accounts": len(names),
            },
        },
        "warnings": warnings,
        "official": {
            "weightedAttainment": number(perf.get("totalWeightedAttainment"), "official attainment"),
            "closedMonthAttainment": weighted_closed,
            "closedThrough": max(closed_dates).strftime("%B, %Y") if closed_dates else None,
            "buckets": buckets, "metrics": metrics,
        },
        "accounts": accounts, "opportunities": opportunities, "milestones": milestones,
        "coverage": coverage, "actions": actions,
        "methodology": [
            "The headline and bucket/metric attainment are reported directly by MSX Earnings (MINT), not FinHub proxies.",
            "Official recurring baselines and calculated actual/quota fields are preserved, including negative values.",
            "Monthly source rows are included when their calendar month overlaps the official reporting interval. Partial-month quota and actual amounts are taken as supplied by the official sources; the model does not prorate earnings or quota.",
            "The posted gap is calculated quota less calculated actual, floored at zero; it is not a period-end forecast.",
            "The posted balance includes ordinary earnings still to post. It must not be described as entirely net-new pipeline required to close the period.",
            "The closed-month comparison is a baseline-adjusted calculation using completed months and official bucket weights, not a separate MINT performance headline.",
            "Zero official calculated quota is preserved. Undefined calculated ratios and closed-month comparisons remain unknown; source-reported attainment is never manufactured or reweighted.",
            "Account gaps use official account quota less credited account actuals. Account-level weighted attainment is not inferred.",
            "Buckets may overlap; do not combine dollar totals without verified credit rules.",
            "Opportunity values, monthly milestone run-rates and reporting-period earnings credit have different units. They are never netted against each other.",
            "Candidate metric mappings are OPTIONAL tentative hints, restricted to names on this user's plan, not confirmed credit rules. Unfamiliar metrics or unmapped production inventory require mapping review; these hints cannot certify zero pipeline.",
            "Production category, a date from today through official period end inclusive, confirmed active status and a positive USD monthly estimate are required for an in-period candidate.",
            "Committed is an MSX milestone label, not a probability or guaranteed payout. No probability weighting is fabricated.",
            "Unknown milestone commitment is excluded from both committed and uncommitted scenario totals.",
            "The optional illustrative scenario assumes all candidate monthly USD consumption is new, incremental, credited to the suggested metric and starts immediately on the production date at a flat run-rate, prorated by calendar days. It is not a forecast; it excludes posting lag and is not applied to non-ACR compensation metrics.",
            "Remaining-period pipeline dates run from the report's as-of date through the official reporting end, including for YTD reports. Overdue dates are shown separately and require requalification.",
            "Closed-won opportunities can retain active consumption milestones; lost opportunities and terminal milestones do not count as active coverage.",
            "No pipeline means none recorded in successfully retrieved accessible records. Missing access is explicitly unavailable, never zero.",
            "Snapshots are Windows-user encrypted. The viewer renders private data in memory and does not create an unprotected HTML export.",
        ],
    }
