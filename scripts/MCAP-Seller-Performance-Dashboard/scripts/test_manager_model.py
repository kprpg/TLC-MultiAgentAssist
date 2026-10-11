"""Synthetic model and in-memory renderer regressions; no private source data."""
import calendar
from copy import deepcopy
from datetime import date
import json
from pathlib import Path
import re
import shutil
import subprocess
import unittest
from unittest.mock import patch

from manager_model import ModelError, build_model, candidate_metrics, illustrative_credit, timing
from secure_dashboard import protect, render


TODAY = date(2042, 9, 21)
PLAN = (
    ("Platform Growth", "Databases", .2, 60),
    ("Cloud Outcomes", "ACR - Core", .3, 60),
    ("Contract Revenue", "Novel Billed Revenue", .5, 0),
)


def fixture(plan=PLAN, year=2042, first_month=7, last_month=9):
    quota, account_rows, details, grain, attainment = [], [], [], [], []
    months = [date(year, month, 1).strftime("%B, %Y") for month in range(first_month, last_month + 1)]
    actuals = [80, 90] + [20] * (len(months) - 2)
    actuals = actuals[:len(months)]
    for bucket, metric, weight, baseline in plan:
        actual, target, recurring = sum(actuals), 100 * len(months), baseline * len(months)
        details.append({
            "pcgName": bucket, "pcgWeight": weight, "pcgAttainment": 8.33,
            "calculationCurrency": "USD", "attainmentUnit": "USD",
            "totalActuals": actual, "totalQuota": target, "pcgQuotaRecurring": recurring,
            "calculatedTotalActuals": actual - recurring, "calculatedTotalQuota": target - recurring,
            "pccDetails": [{
                "pccName": metric, "pccAttainment": 8.33, "measuringUnit": "USD",
                "totalPccActuals": actual, "totalPccQuota": target, "pccQuotaRecurring": recurring,
                "calculatedTotalActuals": actual - recurring, "calculatedTotalQuota": target - recurring,
            }],
        })
        for month, actual in zip(months, actuals):
            quota.append({"tpid": "1", "account": "Synthetic account one", "metric": metric,
                          "bucket": bucket, "month": month, "quota": 100,
                          "unit": "USD", "fiscalYear": year + 1})
            grain.append({"fiscalMonthName": month, "pccGrainResults": [{
                "pccName": metric, "totalActuals": actual, "totalQuota": 100,
                "unit": "USD",
                "calculatedTotalActuals": actual - baseline, "calculatedTotalQuota": 100 - baseline,
            }]})
        account_rows.append({
            "id": "1", "metric": metric, "dimension": "EndCustomerTopParentName",
            "unit": "USD",
            "months": list(months), "totalActuals": sum(actuals),
        })
    attainment = [{"month": month, "lastRefreshDateTime": f"{year}-09-17T12:00:00Z"} for month in months]
    earnings = {
        "generatedAt": f"{year}-09-21T14:00:00Z", "sections": {
            "performance": {
                "fiscalYearId": year + 1,
                "calculationStartDateTime": f"{year}-{first_month:02d}-01T00:00:00Z",
                "calculationEndDateTime": f"{year}-{last_month:02d}-{calendar.monthrange(year, last_month)[1]}T23:59:00Z",
                "totalWeightedAttainment": 17.1250007, "pcgDetails": details,
            },
            "summary": {
                "counts": {"accountSummary": len(account_rows)}, "accountSummary": account_rows,
                "attainmentSummary": attainment,
            },
            "pcg": {"pcgGrainResults": grain},
        },
    }
    pipeline = {
        "status": "complete", "asOf": f"{year}-09-21T14:00:00Z", "errors": [],
        "accountStatus": {"1": "complete"}, "opportunities": [], "milestones": [],
    }
    return quota, earnings, pipeline


def milestone(identifier, **changes):
    row = {
        "id": identifier, "tpid": "1", "name": "Synthetic production", "workload": "Azure SQL",
        "category": "Production", "status": "In progress", "active": True,
        "currency": "USD", "monthly": 900, "date": "2042-09-30",
        "commitment": "Committed", "owner": "Synthetic owner",
    }
    row.update(changes)
    return row


def opportunity(identifier, **changes):
    row = {"id": identifier, "tpid": "1", "name": "Synthetic opportunity",
           "state": "Open", "currency": "USD", "estimatedValue": 9000000,
           "closeDate": "2042-09-30"}
    row.update(changes)
    return row


class ModelTests(unittest.TestCase):
    def test_official_not_gross_attainment_three_buckets(self):
        model = build_model(*fixture(), TODAY)
        self.assertEqual(model["official"]["weightedAttainment"], 17.1250007)
        self.assertAlmostEqual(model["official"]["closedMonthAttainment"], 73.75)
        self.assertEqual(model["official"]["metrics"][0]["gap"], 110)
        self.assertEqual([b["weight"] for b in model["official"]["buckets"]], [.2, .3, .5])
        self.assertTrue(model["accounts"][0]["pipeline"]["noPipeline"])
        self.assertEqual(model["plan"]["fiscalYear"], 2043)
        self.assertTrue(model["plan"]["sourceUnitsVerified"])
        self.assertNotIn("FY27", model["sources"]["quota"]["name"])

    def test_single_unfamiliar_billed_bucket_supported_without_fake_scenario(self):
        result = build_model(*fixture((("Billed Outcomes", "Future Contract Dollars", 1, 0),)), TODAY)
        self.assertEqual(len(result["official"]["buckets"]), 1)
        self.assertEqual(result["official"]["metrics"][0]["recurring"], 0)
        self.assertEqual(result["coverage"][0]["state"], "Metric mapping requires review")
        self.assertIsNone(result["coverage"][0]["scenarioCommittedCredit"])
        self.assertIsNone(result["coverage"][0]["scenarioRemainingGap"])
        self.assertFalse(result["plan"]["metricMapping"][0]["hintSupported"])
        self.assertEqual(result["actions"][0]["issue"], "Metric mapping requires review")

    def test_two_bucket_monetary_plan_uses_its_own_weights(self):
        plan = (("First Outcome", "Databases", .45, 60),
                ("Second Outcome", "ACR - Core", .55, 60))
        result = build_model(*fixture(plan), TODAY)
        self.assertEqual([b["weight"] for b in result["official"]["buckets"]], [.45, .55])
        self.assertAlmostEqual(result["official"]["closedMonthAttainment"], 62.5)
        self.assertEqual(result["official"]["weightedAttainment"], 17.1250007)

    def test_zero_calculated_quota_preserves_official_score_and_signed_gap(self):
        result = build_model(*fixture((("Zero adjusted target", "New Monetary Metric", 1, 100),)), TODAY)
        self.assertEqual(result["official"]["weightedAttainment"], 17.1250007)
        self.assertEqual(result["official"]["buckets"][0]["calcQuota"], 0)
        self.assertEqual(result["official"]["buckets"][0]["calcActual"], -110)
        self.assertEqual(result["official"]["buckets"][0]["gap"], 110)
        self.assertIsNone(result["official"]["closedMonthAttainment"])
        self.assertIsNone(result["official"]["metrics"][0]["closedAttainment"])

    def test_genuine_zero_quota_rows_are_known_zero_not_missing(self):
        q, e, p = fixture((("Zero target", "New Monetary Metric", 1, 0),))
        for row in q:
            row["quota"] = 0
        bucket = e["sections"]["performance"]["pcgDetails"][0]
        for row, fields in (
            (bucket, ("totalQuota", "totalActuals", "calculatedTotalQuota", "calculatedTotalActuals")),
            (bucket["pccDetails"][0], ("totalPccQuota", "totalPccActuals", "calculatedTotalQuota", "calculatedTotalActuals")),
        ):
            for field in fields:
                row[field] = 0
        for group in e["sections"]["pcg"]["pcgGrainResults"]:
            for row in group["pccGrainResults"]:
                for field in ("totalQuota", "totalActuals", "calculatedTotalQuota", "calculatedTotalActuals"):
                    row[field] = 0
        e["sections"]["summary"]["accountSummary"][0]["totalActuals"] = 0
        model = build_model(q, e, p, TODAY)
        self.assertEqual(model["accounts"][0]["metrics"][0]["quota"], 0)
        self.assertEqual(model["accounts"][0]["metrics"][0]["actual"], 0)
        self.assertEqual(model["coverage"][0]["state"], "No posted gap")
        self.assertEqual(model["actions"], [])
        self.assertIsNone(model["official"]["closedMonthAttainment"])

    def test_zero_weight_zero_calculated_quota_does_not_infer_comparison(self):
        plan = (("First Outcome", "Databases", .7, 60),
                ("Second Outcome", "ACR - Core", .3, 60),
                ("Inactive Component", "New Monetary Metric", 0, 100))
        model = build_model(*fixture(plan), TODAY)
        self.assertEqual(model["official"]["buckets"][-1]["weight"], 0)
        self.assertIsNone(model["official"]["closedMonthAttainment"])
        self.assertEqual(model["official"]["weightedAttainment"], 17.1250007)

    def test_source_units_and_quota_units_fail_closed(self):
        for location, field, value in (
            ("bucket", "calculationCurrency", "EUR"), ("bucket", "attainmentUnit", "Seats"),
            ("bucket", "attainmentUnit", "%"), ("metric", "measuringUnit", "Percent"),
            ("bucket", "attainmentUnit", "Revenue"), ("bucket", "earningsUnit", "EUR"),
            ("metric", "earningsUnit", "Seats"),
            ("metric", "measuringUnit", "EUR"), ("quota", "unit", "GBP"),
            ("quota", "unit", None), ("quota", "fiscalYear", "2043"),
            ("quota", "fiscalYear", 2044),
        ):
            with self.subTest(location=location, field=field, value=value):
                q, e, p = fixture()
                bucket = e["sections"]["performance"]["pcgDetails"][0]
                row = q[0] if location == "quota" else bucket if location == "bucket" else bucket["pccDetails"][0]
                row[field] = value
                with self.assertRaises(ModelError):
                    build_model(q, e, p, TODAY)

    def test_optional_monthly_and_summary_unit_metadata_requires_explicit_usd(self):
        for level in ("monthly", "summary"):
            for unit in ("EUR", "Seats", "Revenue", "%", "$"):
                q, e, p = fixture()
                row = (e["sections"]["pcg"]["pcgGrainResults"][0]["pccGrainResults"][0]
                       if level == "monthly" else e["sections"]["summary"]["accountSummary"][0])
                row["unit"] = unit
                with self.subTest(level=level, unit=unit), self.assertRaises(ModelError):
                    build_model(q, e, p, TODAY)

    def test_anonymous_mint_shape_nullable_payout_unit_does_not_override_usd_basis(self):
        for payout in (None, "", "   "):
            q, e, p = fixture()
            for bucket in e["sections"]["performance"]["pcgDetails"]:
                bucket.update(attainmentUnit="USD", calculationCurrency="USD", earningsUnit=payout)
                for metric in bucket["pccDetails"]:
                    metric["measuringUnit"] = "USD"
            model = build_model(q, e, p, TODAY)
            with self.subTest(payout=payout):
                self.assertTrue(model["plan"]["sourceUnitsVerified"])
                self.assertEqual(model["official"]["weightedAttainment"], 17.1250007)

    def test_nullable_optional_primary_metadata_remains_unverified_not_contradictory(self):
        for value in (None, "", "   "):
            q, e, p = fixture()
            e["sections"]["summary"]["accountSummary"][0]["unit"] = value
            model = build_model(q, e, p, TODAY)
            with self.subTest(value=value):
                self.assertFalse(model["plan"]["sourceUnitsVerified"])
                self.assertEqual(model["plan"]["unit"], "USD")

    def test_absent_optional_source_unit_metadata_still_requires_normalized_usd_quota(self):
        q, e, p = fixture()
        for bucket in e["sections"]["performance"]["pcgDetails"]:
            del bucket["attainmentUnit"]
            del bucket["calculationCurrency"]
            for metric in bucket["pccDetails"]:
                del metric["measuringUnit"]
        for group in e["sections"]["pcg"]["pcgGrainResults"]:
            for row in group["pccGrainResults"]:
                del row["unit"]
        for row in e["sections"]["summary"]["accountSummary"]:
            del row["unit"]
        model = build_model(q, e, p, TODAY)
        self.assertEqual(model["plan"]["unit"], "USD")
        self.assertFalse(model["plan"]["sourceUnitsVerified"])
        self.assertTrue(any("source units remain unverified" in warning for warning in model["warnings"]))
        del q[0]["unit"]
        with self.assertRaises(ModelError):
            build_model(q, e, p, TODAY)

    def test_missing_important_official_fields_fail_as_model_errors(self):
        for field in ("calculationStartDateTime", "calculationEndDateTime", "fiscalYearId",
                      "totalWeightedAttainment"):
            q, e, p = fixture()
            del e["sections"]["performance"][field]
            with self.subTest(field=field), self.assertRaises(ModelError):
                build_model(q, e, p, TODAY)
        for field in ("totalActuals", "calculatedTotalActuals", "pcgQuotaRecurring", "pcgWeight"):
            q, e, p = fixture()
            del e["sections"]["performance"]["pcgDetails"][0][field]
            with self.subTest(field=field), self.assertRaises(ModelError):
                build_model(q, e, p, TODAY)

    def test_mapping_conflicts_and_duplicate_buckets_fail(self):
        for mode in ("quota", "official", "duplicate"):
            q, e, p = fixture()
            if mode == "quota":
                q[0]["bucket"] = "Conflicting bucket"
            elif mode == "official":
                e["sections"]["performance"]["pcgDetails"][0]["pcgName"] = "Wrong bucket"
            else:
                e["sections"]["performance"]["pcgDetails"].append(
                    deepcopy(e["sections"]["performance"]["pcgDetails"][0]))
            with self.subTest(mode=mode), self.assertRaises(ModelError):
                build_model(q, e, p, TODAY)

    def test_full_csv_mapping_validation_includes_months_outside_reporting_period(self):
        for changes in ({"bucket": "Conflicting bucket"}, {"metric": "Unexpected future metric"},
                        {"fiscalYear": 2044}):
            q, e, p = fixture()
            q.append(dict(q[0], month="October, 2042", **changes))
            with self.subTest(changes=changes), self.assertRaises(ModelError):
                build_model(q, e, p, TODAY)

    def test_missing_access_is_not_no_pipeline(self):
        q, e, p = fixture()
        p.update(status="unavailable", accountStatus={"1": "unavailable"})
        result = build_model(q, e, p, TODAY)
        self.assertFalse(result["accounts"][0]["pipeline"]["noPipeline"])
        self.assertFalse(result["accounts"][0]["pipeline"]["noInQuarterPipeline"])
        self.assertEqual(result["coverage"][0]["state"], "Unavailable")

    def test_global_unavailable_overrides_inconsistent_account_completeness(self):
        q, e, p = fixture()
        p["status"] = "unavailable"
        result = build_model(q, e, p, TODAY)
        self.assertFalse(result["accounts"][0]["pipeline"]["noPipeline"])
        self.assertFalse(result["accounts"][0]["pipeline"]["noInQuarterPipeline"])

    def test_unknown_status_is_partial_not_zero_pipeline(self):
        q, e, p = fixture()
        p["milestones"] = [milestone("a", status=None, active=None)]
        result = build_model(q, e, p, TODAY)
        self.assertEqual(result["sources"]["pipeline"]["status"], "partial")
        self.assertEqual(result["accounts"][0]["pipeline"]["status"], "partial")
        self.assertFalse(result["accounts"][0]["pipeline"]["noInQuarterPipeline"])
        self.assertEqual(result["coverage"][0]["candidateCount"], 0)
        self.assertIn("quality", result["coverage"][0]["state"])

    def test_missing_account_actual_is_not_zero(self):
        for mode in ("row", "null", "month"):
            q, e, p = fixture()
            summary = e["sections"]["summary"]
            if mode == "row":
                summary["accountSummary"].pop()
                summary["counts"]["accountSummary"] -= 1
            elif mode == "null":
                summary["accountSummary"][-1]["totalActuals"] = None
            else:
                summary["accountSummary"][-1]["months"].pop()
            result = build_model(q, e, p, TODAY)
            row = next(r for r in result["accounts"][0]["metrics"] if r["metric"] == "Novel Billed Revenue")
            with self.subTest(mode=mode):
                self.assertIsNone(row["actual"])
                self.assertIsNone(row["gap"])

    def test_monthly_not_period_credit_and_commitment_not_substring(self):
        q, e, p = fixture()
        p["milestones"] = [milestone("a"), milestone("b", commitment="Uncommitted")]
        p["opportunities"] = [opportunity("c")]
        result = build_model(q, e, p, TODAY)
        self.assertEqual(result["coverage"][0]["committedMonthly"], 900)
        self.assertEqual(result["coverage"][0]["uncommittedMonthly"], 900)
        self.assertIsNone(result["coverage"][0]["verifiedPeriodCredit"])
        self.assertEqual(result["official"]["metrics"][0]["gap"], 110)
        self.assertEqual(result["coverage"][0]["scenarioCommittedCredit"], 30)
        self.assertEqual(result["coverage"][0]["scenarioRemainingGap"], 50)
        self.assertFalse(result["accounts"][0]["pipeline"]["noPipeline"])
        self.assertEqual(result["accounts"][0]["pipeline"]["inQuarterValue"], 9000000)

    def test_terminal_future_nonproduction_overdue_and_currency_excluded(self):
        q, e, p = fixture()
        p["milestones"] = [
            milestone("a", status="Completed"), milestone("b", date="2042-10-01"),
            milestone("c", category="Proof of Concept"), milestone("d", currency="EUR"),
            milestone("e", date="2042-09-20"), milestone("f", date=None),
            milestone("g", monthly=0), milestone("h", active=False),
        ]
        result = build_model(q, e, p, TODAY)
        self.assertEqual(result["coverage"][0]["candidateCount"], 0)
        self.assertTrue(result["accounts"][0]["pipeline"]["noInQuarterPipeline"])

    def test_unknown_commitment_not_silently_uncommitted(self):
        q, e, p = fixture()
        p["milestones"] = [milestone("a", commitment="")]
        result = build_model(q, e, p, TODAY)
        self.assertEqual(result["coverage"][0]["candidateCount"], 1)
        self.assertEqual(result["coverage"][0]["uncommittedMonthly"], 0)
        self.assertEqual(result["coverage"][0]["scenarioUncommittedCredit"], 0)

    def test_unmapped_candidates_require_review_even_for_supported_metrics(self):
        q, e, p = fixture()
        p["milestones"] = [milestone("a", workload="Unfamiliar production workload")]
        result = build_model(q, e, p, TODAY)
        self.assertEqual(result["plan"]["unmappedProductionCandidates"], 1)
        self.assertEqual(result["coverage"][0]["state"], "Metric mapping requires review")
        self.assertFalse(result["accounts"][0]["pipeline"]["noInQuarterPipeline"])
        self.assertIsNone(result["milestones"][0]["scenarioCredit"])

    def test_open_usd_inventory_and_won_supporting_parents_remain_separate(self):
        q, e, p = fixture()
        p["opportunities"] = [opportunity("open"), opportunity("won", state="Won"),
                              opportunity("eur", currency="EUR")]
        p["milestones"] = [milestone("a", opportunityId="won")]
        result = build_model(q, e, p, TODAY)
        self.assertEqual(result["accounts"][0]["pipeline"]["openCount"], 2)
        self.assertEqual(result["accounts"][0]["pipeline"]["inQuarterValue"], 9000000)
        self.assertEqual(result["coverage"][0]["candidateCount"], 1)

    def test_lost_parent_never_supplies_candidate_consumption(self):
        q, e, p = fixture()
        p["opportunities"] = [opportunity("lost", state="Lost")]
        p["milestones"] = [milestone("a", opportunityId="lost")]
        result = build_model(q, e, p, TODAY)
        self.assertEqual(result["coverage"][0]["candidateCount"], 0)
        self.assertFalse(result["milestones"][0]["active"])

    def test_duplicate_records_fail(self):
        for mode in ("milestone", "opportunity", "quota", "actual", "monthly"):
            q, e, p = fixture()
            if mode == "milestone":
                p["milestones"] = [milestone("a"), milestone("a")]
            elif mode == "opportunity":
                p["opportunities"] = [opportunity("a"), opportunity("a")]
            elif mode == "quota":
                q.append(dict(q[0]))
            elif mode == "actual":
                e["sections"]["summary"]["accountSummary"].append(deepcopy(e["sections"]["summary"]["accountSummary"][0]))
                e["sections"]["summary"]["counts"]["accountSummary"] += 1
            else:
                e["sections"]["pcg"]["pcgGrainResults"].append(deepcopy(e["sections"]["pcg"]["pcgGrainResults"][0]))
            with self.subTest(mode=mode), self.assertRaises(ModelError):
                build_model(q, e, p, TODAY)

    def test_missing_boundary_month_fails_even_when_reconciled_zero(self):
        q, e, p = fixture()
        e["sections"]["pcg"]["pcgGrainResults"] = [
            g for g in e["sections"]["pcg"]["pcgGrainResults"] if g["fiscalMonthName"] != "September, 2042"
        ]
        with self.assertRaises(ModelError):
            build_model(q, e, p, TODAY)

    def test_truncated_account_data_fails(self):
        q, e, p = fixture()
        e["sections"]["summary"]["counts"]["accountSummary"] = 99
        with self.assertRaises(ModelError):
            build_model(q, e, p, TODAY)

    def test_cross_period_aggregate_fails(self):
        q, e, p = fixture()
        e["sections"]["summary"]["accountSummary"][0]["months"].append("October, 2042")
        with self.assertRaises(ModelError):
            build_model(q, e, p, TODAY)

    def test_signed_calculated_actual_and_baseline_are_preserved(self):
        model = build_model(*fixture(last_month=12), TODAY)
        self.assertLess(model["official"]["metrics"][0]["calcActual"], 0)
        self.assertEqual(model["official"]["metrics"][0]["recurring"], 360)
        self.assertEqual(model["official"]["metrics"][0]["calcActual"], -110)
        self.assertNotIn("recurring", model["accounts"][0]["metrics"][0])

    def test_ytd_reporting_period_not_forced_to_current_quarter(self):
        q, e, p = fixture(last_month=12)
        p["milestones"] = [milestone("a", date="2042-12-31"), milestone("b", date="2043-01-01")]
        model = build_model(q, e, p, date(2042, 12, 21))
        self.assertEqual(model["period"]["start"], "2042-07-01")
        self.assertEqual(model["period"]["end"], "2042-12-31")
        self.assertEqual(model["coverage"][0]["candidateCount"], 1)
        self.assertEqual(model["official"]["closedThrough"], "November, 2042")
        self.assertEqual(model["accounts"][0]["metrics"][0]["quota"], 600)

    def test_midmonth_participation_includes_source_prorated_boundary_month(self):
        q, e, p = fixture()
        perf = e["sections"]["performance"]
        perf["calculationStartDateTime"] = "2042-07-15T00:00:00Z"
        for row in q:
            if row["month"] == "July, 2042":
                row["quota"] /= 2
        for group in e["sections"]["pcg"]["pcgGrainResults"]:
            if group["fiscalMonthName"] == "July, 2042":
                for row in group["pccGrainResults"]:
                    for field in ("totalActuals", "totalQuota", "calculatedTotalActuals", "calculatedTotalQuota"):
                        row[field] /= 2
        for bucket in perf["pcgDetails"]:
            metric = bucket["pccDetails"][0]
            baseline_reduction = metric["pccQuotaRecurring"] / 6
            metric["totalPccActuals"] -= 40
            metric["totalPccQuota"] -= 50
            metric["pccQuotaRecurring"] -= baseline_reduction
            metric["calculatedTotalActuals"] -= 40 - baseline_reduction
            metric["calculatedTotalQuota"] -= 50 - baseline_reduction
            for bucket_key, metric_key in (("totalActuals", "totalPccActuals"),
                                           ("totalQuota", "totalPccQuota"),
                                           ("pcgQuotaRecurring", "pccQuotaRecurring"),
                                           ("calculatedTotalActuals", "calculatedTotalActuals"),
                                           ("calculatedTotalQuota", "calculatedTotalQuota")):
                bucket[bucket_key] = metric[metric_key]
        for row in e["sections"]["summary"]["accountSummary"]:
            row["totalActuals"] -= 40
        model = build_model(q, e, p, TODAY)
        self.assertEqual(model["period"]["start"], "2042-07-15")
        self.assertEqual(model["accounts"][0]["metrics"][0]["quota"], 250)
        self.assertEqual(model["accounts"][0]["metrics"][0]["actual"], 150)
        self.assertEqual(model["official"]["metrics"][0]["calcActual"], 0)
        self.assertEqual(model["official"]["metrics"][0]["recurring"], 150)
        self.assertEqual(model["official"]["weightedAttainment"], 17.1250007)
        e["sections"]["summary"]["accountSummary"][0]["months"].append("June, 2042")
        with self.assertRaises(ModelError):
            build_model(q, e, p, TODAY)

    def test_midmonth_end_retains_official_month_amounts_and_exact_candidate_cutoff(self):
        q, e, p = fixture()
        e["sections"]["performance"]["calculationEndDateTime"] = "2042-09-15T23:59:00Z"
        p["milestones"] = [milestone("boundary", date="2042-09-15"),
                           milestone("outside", date="2042-09-16")]
        model = build_model(q, e, p, date(2042, 9, 14))
        self.assertEqual(model["accounts"][0]["metrics"][0]["quota"], 300)
        self.assertEqual(model["coverage"][0]["candidateCount"], 1)
        self.assertEqual(model["period"]["end"], "2042-09-15")

    def test_monthly_metric_mapping_is_optional_and_plan_limited(self):
        values, basis = candidate_metrics(milestone("a"), {"Databases"})
        self.assertEqual(values, ["Databases"])
        self.assertIn("validation", basis)
        self.assertIn("Optional", basis)
        self.assertEqual(candidate_metrics(milestone("a"), {"Novel Billed Revenue"})[0], [])
        self.assertNotIn("Databases", candidate_metrics(milestone("b", workload="Databricks"))[0])

    def test_date_boundaries(self):
        self.assertEqual(timing("2042-09-30T00:00:00Z", TODAY, date(2042, 9, 30)), "in-quarter")
        self.assertEqual(timing("2042-09-21", TODAY, date(2042, 9, 30)), "in-quarter")
        self.assertEqual(timing("2042-09-20", TODAY, date(2042, 9, 30)), "overdue")
        self.assertEqual(timing(None, TODAY, date(2042, 9, 30)), "undated")

    def test_scenario_calendar_proration(self):
        self.assertEqual(illustrative_credit(900, date(2042, 9, 30), date(2042, 9, 30)), 30)
        self.assertEqual(illustrative_credit(900, date(2042, 9, 1), date(2042, 9, 30)), 900)
        self.assertEqual(illustrative_credit(900, date(2042, 9, 1), date(2042, 10, 31)), 1800)
        self.assertEqual(illustrative_credit(900, date(2042, 10, 1), date(2042, 9, 30)), 0)

    def test_nonfinite_amounts_fail(self):
        for value in (float("nan"), float("inf"), True, "not numeric"):
            q, e, p = fixture()
            p["milestones"] = [milestone("a", monthly=value)]
            with self.subTest(value=value), self.assertRaises(ModelError):
                build_model(q, e, p, TODAY)

    def test_private_snapshot_round_trip(self):
        payload = b'{"synthetic": 42}'
        encrypted = protect(payload)
        self.assertNotIn(payload, encrypted)
        self.assertEqual(protect(encrypted, decrypt=True), payload)

    def test_untrusted_data_cannot_end_json_script(self):
        template = '<script type="application/json">__DASHBOARD_DATA__</script>'
        with patch("pathlib.Path.read_text", return_value=template):
            content = render("unused.html", {"name": "</script><script>bad()</script>"}).decode()
        self.assertEqual(content.count("</script>"), 1)
        self.assertIn("\\u003c", content)

    def test_invalid_template_fails_closed(self):
        with patch("pathlib.Path.read_text", return_value="No data placeholder"):
            with self.assertRaises(ValueError):
                render("unused.html", {})


# A deliberately small DOM runs the real inline renderer without a browser,
# network, storage, installed packages or synthetic snapshot files.
DOM_RUNNER = r"""
const vm = require("node:vm");
const input = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this._text = ""; this.value = "";
    this.checked = false; this.hidden = false; this.style = {}; this.attrs = {}; this.events = {}; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(""); }
  set innerHTML(v) { throw Error("Unsafe HTML sink"); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this._text = ""; this.children = nodes; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(k, fn) { this.events[k] = fn; }
  get options() { return this.children; }
  get selectedIndex() { return Math.max(0, this.children.findIndex(n => n.value === this.value)); }
  focus() {}
  querySelector(selector) { return walk(this).find(n => selector[0] === "." ?
    String(n.className || "").split(" ").includes(selector.slice(1)) : n.tagName === selector) || null; }
}
function walk(node) { return node.children.flatMap(child => [child, ...walk(child)]); }
const ids = new Map();
for (const match of input.html.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
  const node = new Element(match[1]); node.id = match[2];
  if (node.tagName === "select") { const option = new Element("option"); option.textContent = "All"; node.append(option); }
  ids.set(node.id, node);
}
ids.get("dashboard-data").textContent = JSON.stringify(input.model);
const document = { getElementById: id => { if (!ids.has(id)) throw Error("Missing ID " + id); return ids.get(id); },
  createElement: tag => new Element(tag), createTextNode: text => { const n = new Element("#text"); n.textContent = text; return n; },
  documentElement: new Element("html") };
const context = vm.createContext({ document, Node: Element, URLSearchParams,
  window: { location: { search: "" }, matchMedia: () => ({matches: false}) } });
for (const match of input.html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!match[1].includes("application/json")) vm.runInContext(match[2], context, {timeout: 3000});
}
for (const action of input.actions || []) {
  const node = ids.get(action.id);
  if ("value" in action) node.value = action.value;
  if ("checked" in action) node.checked = action.checked;
  const target = action.selector ? node.querySelector(action.selector) : node;
  target.events[action.event || "change"]();
}
const tables = {};
for (const id of ["coverage-table", "account-table", "metric-table", "milestone-table", "opportunity-table"]) {
  const body = walk(ids.get(id)).find(n => n.tagName === "tbody");
  tables[id] = body ? body.children.map(row => row.children.map(cell => cell.textContent)) : [];
}
console.log(JSON.stringify({ text: Object.fromEntries([...ids].map(([id, n]) => [id, n.textContent])),
  tables, bucketCount: ids.get("official-buckets").children.length, scenarioChecked: ids.get("scenario-toggle").checked,
  dashboardHidden: ids.get("dashboard").hidden, errorHidden: ids.get("data-error").hidden }));
"""


@unittest.skipUnless(shutil.which("node"), "Node is optional for in-memory renderer regression tests")
class RendererTests(unittest.TestCase):
    def render_model(self, model, actions=()):
        result = subprocess.run(
            ["node", "-e", DOM_RUNNER], input=json.dumps({
                "html": Path(__file__).with_name("manager_dashboard.html").read_text(encoding="utf-8"),
                "model": model, "actions": actions,
            }), text=True, encoding="utf-8", capture_output=True, check=True, timeout=20)
        return json.loads(result.stdout)

    def test_three_and_single_bucket_render_and_official_score_is_filter_invariant(self):
        model = build_model(*fixture(), TODAY)
        initial = self.render_model(model)
        selected = self.render_model(model, [{"id": "bucket-filter", "value": "Contract Revenue"}])
        self.assertEqual(initial["bucketCount"], 3)
        self.assertEqual(initial["text"]["weighted-attainment"], "17.1250007%")
        self.assertEqual(initial["text"]["weighted-attainment"], selected["text"]["weighted-attainment"])
        self.assertFalse(initial["scenarioChecked"])
        self.assertIn("Metric mapping requires review", selected["text"]["coverage-table"])
        single = build_model(*fixture((("Only Bucket", "New Monetary Metric", 1, 0),)), TODAY)
        self.assertEqual(self.render_model(single)["bucketCount"], 1)

    def test_candidate_counts_timing_and_production_match_model(self):
        q, e, p = fixture()
        p["milestones"] = [
            milestone("today", date="2042-09-21"), milestone("end"),
            milestone("overdue", date="2042-09-20"), milestone("future", date="2042-10-01"),
            milestone("poc", category="Proof of Concept"), milestone("eur", currency="EUR"),
            milestone("zero", monthly=0), milestone("terminal", status="Completed"),
            milestone("undated", date=None),
        ]
        model = build_model(q, e, p, TODAY)
        rendered = self.render_model(model)
        for expected, row in zip(model["coverage"], rendered["tables"]["coverage-table"]):
            self.assertEqual(int(row[2]), expected["candidateCount"])
        self.assertEqual(model["coverage"][0]["candidateCount"], 2)
        self.assertIn("2 available production candidates", rendered["text"]["manager-pipeline-summary"])

    def test_unmapped_production_review_survives_metric_filter(self):
        q, e, p = fixture()
        p["milestones"] = [milestone("a", workload="Unfamiliar production workload")]
        rendered = self.render_model(build_model(q, e, p, TODAY),
                                     [{"id": "metric-filter", "value": "Databases"}])
        self.assertIn("Metric mapping requires review", rendered["text"]["coverage-table"])

    def test_non_acr_scenario_stays_unsupported(self):
        model = build_model(*fixture(), TODAY)
        rendered = self.render_model(model, [{"id": "scenario-toggle", "checked": True}])
        unknown_row = next(row for row in rendered["tables"]["coverage-table"] if row[0].startswith("Novel"))
        self.assertEqual(unknown_row[6:9], ["Unsupported"] * 3)
        self.assertIsNone(model["coverage"][-1]["scenarioRemainingGap"])

    def test_zero_denominator_ratios_are_unknown_while_official_score_is_unchanged(self):
        model = build_model(*fixture((("Zero adjusted target", "New Monetary Metric", 1, 100),)), TODAY)
        rendered = self.render_model(model)
        self.assertEqual(rendered["text"]["weighted-attainment"], "17.1250007%")
        self.assertEqual(rendered["text"]["closed-attainment"], "Unknown")
        metric_row = rendered["tables"]["metric-table"][0]
        self.assertEqual(metric_row[6], "$0")
        self.assertEqual(metric_row[7], "Unknown")
        self.assertNotIn("Infinity", rendered["text"]["metric-table"])

    def test_partial_source_preserves_null_scenario_under_filters(self):
        q, e, p = fixture()
        p.update(status="partial", accountStatus={"1": "partial"})
        p["milestones"] = [milestone("a")]
        model = build_model(q, e, p, TODAY)
        model["coverage"][0]["scenarioCommittedCredit"] = None
        rendered = self.render_model(model, [
            {"id": "account-filter", "value": "1"},
            {"id": "metric-filter", "value": "Databases"},
            {"id": "scenario-toggle", "checked": True},
        ])
        self.assertEqual(rendered["tables"]["coverage-table"][0][6], "Unknown")
        self.assertEqual(rendered["tables"]["coverage-table"][0][8], "Unknown")
        self.assertIsNone(model["coverage"][0]["scenarioRemainingGap"])

    def test_currency_guard_covers_all_monthly_inventory(self):
        q, e, p = fixture()
        p["milestones"] = [milestone("usd", monthly=25), milestone("eur", currency="EUR", monthly=9000000),
                           milestone("unknown", currency=None, monthly=8000000)]
        p["opportunities"] = [opportunity("eur", currency="EUR", monthlyRunRate=7000000)]
        rendered = self.render_model(build_model(q, e, p, TODAY))
        self.assertIn("Committed USD monthly inventory$25/mo", rendered["text"]["inventory-cards"])
        self.assertNotIn("$9,000,000", rendered["text"]["milestone-table"])
        self.assertNotIn("$8,000,000", rendered["text"]["milestone-table"])
        self.assertNotIn("$7,000,000", rendered["text"]["opportunity-table"])

    def test_negative_actual_and_net_gap_after_account_aggregation(self):
        q, e, p = fixture((("Only Bucket", "Databases", 1, 60),))
        for row in q:
            row["quota"] = 50
        q.extend([dict(row, tpid="2", account="Synthetic account two") for row in q.copy()])
        summary = e["sections"]["summary"]
        summary["accountSummary"][0]["totalActuals"] = 200
        summary["accountSummary"].append(dict(summary["accountSummary"][0], id="2", totalActuals=-10))
        summary["counts"]["accountSummary"] = 2
        p["accountStatus"]["2"] = "complete"
        model = build_model(q, e, p, TODAY)
        rendered = self.render_model(model)
        self.assertEqual(rendered["tables"]["coverage-table"][0][1], "$110")
        self.assertIn("-$10", rendered["text"]["account-table"])
        selected = self.render_model(model, [{"id": "account-filter", "value": "1"}])
        self.assertEqual(selected["tables"]["coverage-table"][0][1], "$0")
        self.assertIn("No posted gap", selected["text"]["coverage-table"])
        self.assertNotIn("Create", selected["tables"]["coverage-table"][0][-1])
        self.assertIn("No additional gap-closing pipeline", selected["text"]["account-table"])

    def test_open_usd_only_and_won_parents_separate(self):
        q, e, p = fixture()
        p["opportunities"] = [opportunity("open", estimatedValue=10),
                              opportunity("won", state="Won", estimatedValue=9000000),
                              opportunity("eur", currency="EUR", estimatedValue=8000000)]
        rendered = self.render_model(build_model(q, e, p, TODAY))
        self.assertIn("1 Won parents", rendered["text"]["inventory-cards"])
        self.assertIn("Open opportunity nominal USD$10", rendered["text"]["inventory-cards"])

    def test_source_quality_badge_not_just_access_failure(self):
        q, e, p = fixture()
        p["milestones"] = [milestone("unknown", status=None)]
        rendered = self.render_model(build_model(q, e, p, TODAY))
        self.assertIn("Source quality", rendered["text"]["pipeline-status"])
        self.assertNotIn("No remaining-period pipeline", rendered["text"]["account-table"])

    def test_xss_remains_text_and_template_is_generic(self):
        q, e, p = fixture()
        payload = '</script><img src=x onerror="bad()">'
        for row in q:
            row["account"] = payload
        rendered = self.render_model(build_model(q, e, p, TODAY))
        self.assertIn(payload, rendered["text"]["account-table"])
        html = Path(__file__).with_name("manager_dashboard.html").read_text(encoding="utf-8")
        self.assertEqual(html.count("__DASHBOARD_DATA__"), 1)
        self.assertIn("<h1>MCAPS Seller Performance Dashboard</h1>", html)
        self.assertIn("<title>MCAPS Seller Performance Dashboard</title>", html)
        self.assertNotRegex(html, r"Data Services|Total ACR|Both buckets|FY27|localStorage|sessionStorage|fetch\(")
        self.assertNotRegex(html, r'<(?:script|link)\b[^>]*(?:src|href)="https?')

    def test_load_more_uses_full_counts_and_no_export_or_print_buttons(self):
        q, e, p = fixture()
        p["milestones"] = [milestone(str(i)) for i in range(105)]
        model = build_model(q, e, p, TODAY)
        initial = self.render_model(model)
        expanded = self.render_model(model, [{"id": "milestone-table", "selector": "button", "event": "click"}])
        self.assertEqual(len(initial["tables"]["milestone-table"]), 100)
        self.assertEqual(len(expanded["tables"]["milestone-table"]), 105)
        self.assertEqual(int(initial["tables"]["coverage-table"][0][2]), 105)
        html = Path(__file__).with_name("manager_dashboard.html").read_text(encoding="utf-8")
        self.assertFalse(any(re.search("print|export", button, re.I)
                             for button in re.findall(r"<button\b[^>]*>.*?</button>", html)))

    def test_non_usd_snapshot_fails_renderer_guard(self):
        model = build_model(*fixture(), TODAY)
        model["plan"]["unit"] = "Seats"
        result = self.render_model(model)
        self.assertIn("requires a validated USD", result["text"]["data-error"])


if __name__ == "__main__":
    unittest.main()
