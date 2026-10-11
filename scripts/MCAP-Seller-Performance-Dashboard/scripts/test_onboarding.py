"""Synthetic, offline onboarding tests; all files stay under this scripts directory."""
import argparse
import contextlib
import copy
import csv
from datetime import date
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfoNotFoundError

import dashboard_config as config
import manager_runner as runner
import manager_sources as sources
import secure_dashboard as secure


HERE = Path(__file__).resolve().parent
TENANT = "11111111-1111-4111-8111-111111111111"


def csv_row(**changes):
    row = {"Account Name": "Synthetic Customer", "Metric Name": "Synthetic Revenue",
           "Credit Month": "September, 2026", "Unit": "USD", "Total Quota": "100",
           "Account Type": "EndCustomerTopParentName", "Fiscal Year": "FY27",
           "Bucket Name": "Synthetic Bucket", "TPID": "1"}
    row.update(changes)
    return row


@unittest.skipUnless(os.name == "nt", "Windows profile transaction locks")
class ProfileLockTests(unittest.TestCase):
    def test_competing_process_cannot_mutate_locked_profile(self):
        code = (
            "from secure_dashboard import profile_lock, ProfileBusyError\n"
            "try:\n"
            "    with profile_lock('locking'):\n"
            "        pass\n"
            "except ProfileBusyError:\n"
            "    raise SystemExit(7)\n"
        )
        with tempfile.TemporaryDirectory(prefix=".lock-tests-", dir=HERE) as directory, \
                patch.dict(os.environ, {"MCAPS_DASHBOARD_STATE_DIR": str(Path(directory) / "state")}):
            def attempt():
                return subprocess.run([sys.executable, "-B", "-c", code], cwd=HERE,
                                      capture_output=True, timeout=20, check=False).returncode
            with secure.profile_lock("locking"):
                self.assertEqual(attempt(), 7)
            self.assertEqual(attempt(), 0)

    def test_runner_mutations_fail_before_loading_locked_state(self):
        with tempfile.TemporaryDirectory(prefix=".lock-tests-", dir=HERE) as directory, \
                patch.dict(os.environ, {"MCAPS_DASHBOARD_STATE_DIR": str(Path(directory) / "state")}):
            args = argparse.Namespace(profile="locking")
            with secure.profile_lock("locking"), \
                    patch.object(runner, "load_state", side_effect=AssertionError("No stale state read")):
                for operation in (runner.setup, runner.refresh, runner.rebuild):
                    with self.subTest(operation=operation.__name__), self.assertRaises(secure.ProfileBusyError):
                        operation(args)


class IsolatedTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix=".onboarding-tests-", dir=HERE)
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.enterContext(patch.dict(os.environ, {
            "MCAPS_DASHBOARD_STATE_DIR": str(self.root / "state"),
            "LOCALAPPDATA": str(self.root / "local"),
        }))
        self.enterContext(patch.object(sources.subprocess, "run", side_effect=AssertionError("No live subprocess")))
        self.enterContext(patch.object(sources.subprocess, "Popen", side_effect=AssertionError("No live MCP")))
        self.enterContext(patch.object(sources.urllib.request, "build_opener", side_effect=AssertionError("No live network")))
        self.enterContext(patch.object(secure.webbrowser, "open", side_effect=AssertionError("No browser")))
        self.bundle = self.root / "msx-mcp.mjs"
        self.bundle.write_text("// Synthetic non-executable test fixture.\n", encoding="utf-8")

    def write_csv(self, rows=None, *, bom=False, sep=False, headers=config.HEADERS):
        path = self.root / "quota.csv"
        with path.open("w", encoding="utf-8-sig" if bom else "utf-8", newline="") as stream:
            if sep:
                stream.write("sep=,\r\n")
            writer = csv.DictWriter(stream, fieldnames=headers)
            writer.writeheader()
            writer.writerows([csv_row()] if rows is None else rows)
        return path

    def args(self, **changes):
        values = dict(profile="default", quota_csv=str(self.write_csv()), replace_profile=False,
                      msx_bundle=str(self.bundle), tenant_id=TENANT,
                      msx_url="https://synthetic-org.crm4.dynamics.com", timezone=None, as_of="2026-09-21")
        values.update(changes)
        return argparse.Namespace(**values)

    def configuration(self, **changes):
        return config.create_config(self.args(**changes))

    def capture(self, function, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = function(*args)
        return code, out.getvalue(), err.getvalue()


class QuotaTests(IsolatedTests):
    def test_bom_separator_zero_missing_months_and_canonical_fields(self):
        rows = config.read_quota_csv(self.write_csv([
            csv_row(**{"TPID": "0001", "Unit": "usd", "Total Quota": "0"}),
            csv_row(**{"TPID": "1", "Credit Month": "July, 2026", "Total Quota": "1,234.50"}),
        ], bom=True, sep=True))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0], {"tpid": "1", "account": "Synthetic Customer", "metric": "Synthetic Revenue",
                                  "bucket": "Synthetic Bucket", "month": "September, 2026", "quota": 0,
                                  "unit": "USD", "fiscalYear": 2027})
        self.assertEqual(rows[1]["quota"], 1234.5)
        self.assertFalse((self.root / "state").exists())

    def test_required_headers(self):
        for missing in config.HEADERS:
            with self.subTest(missing=missing):
                row = csv_row()
                row.pop(missing)
                with self.assertRaisesRegex(config.ConfigError, "required columns"):
                    config.read_quota_csv(self.write_csv([row], headers=tuple(row)))

    def test_incomplete_and_unsupported_rows_are_redacted(self):
        invalid = [
            ("Unit", "Seats"), ("Unit", "EUR"), ("Unit", "%"), ("Unit", "$"),
            ("Account Type", "OtherGrain"), ("TPID", "secret-private-value"),
            ("TPID", "1 OR 1=1"), ("TPID", "1.0"), ("TPID", "0"),
            ("Credit Month", "Sep, 2026"), ("Credit Month", "Septembre, 2026"),
            ("Credit Month", "September, 2027"), ("Credit Month", "2026-09"),
            ("Fiscal Year", "secret-private-value"), ("Fiscal Year", "1999"),
            ("Total Quota", "NaN"), ("Total Quota", "Infinity"), ("Total Quota", "1e100"),
            ("Total Quota", "-1"),
            ("Total Quota", "1,23"), ("Total Quota", "9" * 400),
            ("Account Name", "Grand Total"), ("Metric Name", "Total"), ("Bucket Name", "Subtotal"),
        ] + [(column, "") for column in config.HEADERS]
        for column, value in invalid:
            with self.subTest(column=column, value=value[:30]):
                with self.assertRaises(config.ConfigError) as caught:
                    config.read_quota_csv(self.write_csv([csv_row(**{column: value})]))
                self.assertIn("row 2", str(caught.exception))
                self.assertNotIn("secret-private-value", str(caught.exception))

    def test_duplicate_fiscal_year_bucket_and_account_consistency(self):
        for second in (
                csv_row(), csv_row(**{"TPID": "0001"}),
                csv_row(**{"Credit Month": "September, 2027", "Fiscal Year": "FY28"}),
                csv_row(**{"Credit Month": "August, 2026", "Bucket Name": "Different Bucket"}),
                csv_row(**{"Credit Month": "August, 2026", "Account Name": "Different Customer"})):
            with self.subTest(second=second):
                with self.assertRaises(config.ConfigError):
                    config.read_quota_csv(self.write_csv([csv_row(), second]))

    def test_footer_header_duplicates_and_extra_columns(self):
        path = self.write_csv()
        original = path.read_text(encoding="utf-8")
        for suffix in ("Grand Total,100\n", ",".join(config.HEADERS) + "\n", "secret-footer\n"):
            path.write_text(original + suffix, encoding="utf-8")
            with self.assertRaises(config.ConfigError) as caught:
                config.read_quota_csv(path)
            self.assertNotIn("secret-footer", str(caught.exception))
        path.write_text("TPID,TPID\n1,2\n", encoding="utf-8")
        with self.assertRaisesRegex(config.ConfigError, "duplicate column"):
            config.read_quota_csv(path)

    def test_empty_and_invalid_encoding(self):
        path = self.write_csv([])
        with self.assertRaisesRegex(config.ConfigError, "no account"):
            config.read_quota_csv(path)
        path.write_bytes(b"\xff")
        with self.assertRaisesRegex(config.ConfigError, "UTF-8"):
            config.read_quota_csv(path)

    def test_account_bound(self):
        path = self.write_csv([csv_row(**{"TPID": str(n)}) for n in range(1, 202)])
        with self.assertRaisesRegex(config.ConfigError, "at most 200"):
            config.read_quota_csv(path)

    def test_offline_validation_outputs_only_counts(self):
        with patch.object(runner, "load_state", side_effect=AssertionError("No profile read")):
            code, out, err = self.capture(runner.main, ["--validate-quota", str(self.write_csv())])
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(json.loads(out), {"rows": 1, "accounts": 1, "metrics": 1,
                                          "fiscalYear": 2027, "currency": "USD"})


class ConfigurationTests(IsolatedTests):
    def test_profile_names_and_isolation_without_global_carry(self):
        a = secure.private_directory("alpha", create=False)
        b = secure.private_directory({"profile": "beta"}, create=False)
        self.assertEqual(a.parent, b.parent)
        self.assertNotEqual(a, b)
        self.assertEqual(secure.private_directory(create=False).name, "default")
        for name in ("..", "../outside", "UPPER", "con", "lpt1", "", "a" * 49):
            with self.assertRaises(ValueError):
                secure.private_directory(name, create=False)
        with patch.dict(os.environ):
            os.environ.pop("MCAPS_DASHBOARD_STATE_DIR")
            default = secure.private_directory(create=False)
        self.assertEqual(default, self.root / "local" / "MicrosoftScout" /
                         "MCAPSSellerPerformanceDashboard" / "default")
        self.assertNotIn("QuotaAttainment", default.parts)

    def test_unsafe_state_overrides_and_filenames(self):
        for path in ("relative", str(self.root / ".." / "escape"),
                     str(self.root / "QuotaAttainment"), str(Path(self.root.anchor)), ""):
            with patch.dict(os.environ, {"MCAPS_DASHBOARD_STATE_DIR": path}):
                with self.assertRaises(ValueError):
                    secure.private_directory(create=False)
        for name in ("..\\quota.dpapi", "plain.json", "\\absolute.dpapi"):
            with self.assertRaises(ValueError):
                secure.load_private(name)

    def test_url_validation(self):
        self.assertEqual(config.validate_msx_url("https://synthetic-org.crm12.dynamics.com/"),
                         "https://synthetic-org.crm12.dynamics.com")
        for value in (None, "http://org.crm.dynamics.com", "https://example.com",
                      "https://org.crm.dynamics.com.evil.example", "https://user:pass" "@org.crm.dynamics.com",
                      "https://org.crm.dynamics.com/a", "https://org.crm.dynamics.com/?x=1",
                      "https://org.crm.dynamics.com/#a", "https://org.crm.dynamics.com?",
                      "https://org.crm.dynamics.com:444", "https://org.crm.dynamics.com\\evil"):
            with self.subTest(value=value), self.assertRaises(config.ConfigError):
                config.validate_msx_url(value)

    def test_explicit_configuration_and_bundle_validation(self):
        configured = self.configuration()
        self.assertEqual(configured["tenantId"], TENANT)
        self.assertEqual(configured["timezone"], "local")
        self.assertEqual(configured["msxBundle"], str(self.bundle))
        for changes in ({"tenant_id": None}, {"msx_url": None}, {"msx_bundle": "msx-mcp.mjs"},
                        {"msx_bundle": str(self.root / "missing.mjs")}, {"tenant_id": "not-a-guid"}):
            with self.subTest(changes=changes), self.assertRaises(config.ConfigError):
                self.configuration(**changes)

    def test_discovery_only_known_plugin_paths_and_ambiguity(self):
        with patch.object(config.Path, "home", return_value=self.root):
            with self.assertRaisesRegex(config.ConfigError, "no unique"):
                config.discover_bundle()
            one = self.root / ".copilot" / "installed-plugins" / "one" / "msx-mcp" / "bundle" / "msx-mcp.mjs"
            one.parent.mkdir(parents=True)
            one.write_text("// Synthetic.", encoding="utf-8")
            self.assertEqual(config.discover_bundle(), str(one))
            two = self.root / ".copilot" / "installed-plugins" / "two" / "msx-mcp" / "bundle" / "msx-mcp.mjs"
            two.parent.mkdir(parents=True)
            two.write_text("// Synthetic.", encoding="utf-8")
            with self.assertRaisesRegex(config.ConfigError, "no unique"):
                config.discover_bundle()

    def test_timezone_and_dynamic_fiscal_period(self):
        local_now = Mock()
        local_now.astimezone.return_value.date.return_value = date(2031, 7, 1)
        with patch.object(config, "datetime") as clock:
            clock.now.return_value = local_now
            self.assertEqual(config.reporting_date(), date(2031, 7, 1))
            clock.now.assert_called_once_with()
            local_now.astimezone.assert_called_once_with()
        self.assertEqual(config.fiscal_period(date(2031, 7, 1)), (2032, 1))
        self.assertEqual(config.fiscal_period(date(2032, 6, 30)), (2032, 4))
        self.assertEqual(config.reporting_date("2032-02-29"), date(2032, 2, 29))
        with self.assertRaises(config.ConfigError):
            config.reporting_date("2031-02-29")
        with patch.object(config, "ZoneInfo", side_effect=ZoneInfoNotFoundError):
            with self.assertRaisesRegex(config.ConfigError, "unavailable"):
                config.reporting_date(None, "Unavailable/Zone")

    def test_diagnose_no_auth_profile_or_network_reads(self):
        with patch.object(config, "load_private", side_effect=AssertionError("No private read")):
            code, out, err = self.capture(runner.main, ["--diagnose", "--profile", "sample"])
        self.assertEqual((code, err), (0, ""))
        result = json.loads(out)
        self.assertEqual(result["profile"], "sample")
        self.assertFalse(result["profilePresent"])
        self.assertEqual(set(result["dependencies"]), {"node", "az"})

    def test_missing_setup_never_reads_fallback(self):
        with self.assertRaisesRegex(config.ConfigError, "own MSX"):
            runner.load_quota()
        self.assertFalse((self.root / "state").exists())
        code, _, err = self.capture(runner.main, ["--setup"])
        self.assertEqual(code, 1)
        self.assertIn("--quota-csv", err)

    def test_missing_snapshot_does_not_launch_viewer(self):
        with patch.object(runner, "serve", side_effect=AssertionError("No viewer")):
            code, _, err = self.capture(runner.main, ["--open"])
        self.assertEqual(code, 1)
        self.assertIn("not configured", err)


@unittest.skipUnless(os.name == "nt", "Real Windows-user DPAPI storage tests")
class RunnerTests(IsolatedTests):
    def seed(self):
        arguments = self.args()
        self.assertEqual(self.capture(runner.setup, arguments)[0], 0)
        state = config.load_state()
        state.update(quota=state["pendingQuota"], pendingQuota=None,
                     dashboard={"generatedAt": "2026-09-01T12:00:00Z", "period": {"today": "2026-09-01"},
                                "warnings": [], "accounts": [{"tpid": "1"}], "opportunities": [], "milestones": []},
                     sources={"earnings": {"synthetic": True}, "pipeline": {"status": "complete"}},
                     lastRun={"status": "updated"})
        secure.save_private(secure.STATE_FILE, state)
        return state

    def fresh_model(self, *args):
        return {"generatedAt": "2026-09-21T12:00:00Z", "period": {"today": "2026-09-21"},
                "accounts": [{"tpid": "1"}], "opportunities": [], "milestones": [], "warnings": []}

    def test_setup_encrypted_no_fetch_and_requires_replace(self):
        args = self.args()
        self.assertEqual(self.capture(runner.setup, args)[0], 0)
        target = secure.private_directory() / secure.STATE_FILE
        content = target.read_bytes()
        self.assertNotIn(b"Synthetic Customer", content)
        self.assertNotIn(TENANT.encode(), content)
        state = config.load_state()
        self.assertEqual(state["config"]["profile"], "default")
        self.assertNotIn("dashboard", state)
        with self.assertRaisesRegex(config.ConfigError, "--replace-profile"):
            runner.setup(args)
        self.assertEqual(target.read_bytes(), content)
        code, _, err = self.capture(runner.main, ["--open"])
        self.assertEqual(code, 1)
        self.assertIn("No successful dashboard", err)
        with self.assertRaisesRegex(ValueError, "No successful dashboard"):
            secure.serve(HERE / "manager_dashboard.html")

    def test_bad_replacement_preserves_profile_and_snapshot(self):
        original = self.seed()
        for bad in ({"quota_csv": str(self.root / "missing.csv")},
                    {"msx_url": "https://foreign.example"}, {"tenant_id": "wrong"}):
            with self.assertRaises(config.ConfigError):
                runner.setup(self.args(replace_profile=True, **bad))
            self.assertEqual(config.load_state(), original)

    def test_valid_replacement_keeps_old_snapshot_until_refresh(self):
        original = self.seed()
        args = self.args(replace_profile=True)
        self.write_csv([csv_row(**{"Total Quota": "200"})])
        self.assertEqual(self.capture(runner.setup, args)[0], 0)
        state = config.load_state()
        self.assertEqual(state["dashboard"], original["dashboard"])
        self.assertEqual(state["quota"], original["quota"])
        self.assertEqual(state["pendingQuota"][0]["quota"], 200)
        self.assertEqual(state["lastRun"]["status"], "setup-pending-refresh")

    def test_failed_refresh_does_not_replace_quota_sources_or_snapshot(self):
        for failure in (sources.SourceError("Synthetic source unavailable"),
                        runner.ModelError("secret-private-value")):
            with self.subTest(failure=type(failure).__name__):
                original = self.seed()
                args = self.args()
                self.write_csv([csv_row(**{"Total Quota": "999"})])
                with patch.object(sources, "fetch_earnings") as earnings, \
                        patch.object(sources, "fetch_pipeline", return_value={"status": "complete"}), \
                        patch.object(runner, "build_model") as model:
                    if isinstance(failure, sources.SourceError):
                        earnings.side_effect = failure
                    else:
                        model.side_effect = failure
                    code, out, err = self.capture(runner.refresh, args)
                self.assertEqual((code, out), (1, ""))
                self.assertNotIn("secret-private-value", err)
                state = config.load_state()
                for key in ("quota", "dashboard", "sources"):
                    self.assertEqual(state[key], original[key])
                self.assertIsNone(state["pendingQuota"])
                self.assertEqual(state["lastRun"]["status"], "failed")
                # Start the next failure case from the same last-good snapshot.
                (secure.private_directory() / secure.STATE_FILE).unlink()

    def test_unavailable_pipeline_is_warning_not_earnings_failure(self):
        self.seed()
        args = self.args()
        self.write_csv([csv_row(**{"Total Quota": "200"})])
        pipeline = {"status": "unavailable", "accountStatus": {"1": "unavailable"},
                    "opportunities": [], "milestones": [], "errors": ["Synthetic unavailable"]}
        with patch.object(sources, "fetch_earnings", return_value={"status": "complete"}) as earnings, \
                patch.object(sources, "fetch_pipeline", return_value=pipeline) as fetch_pipeline, \
                patch.object(runner, "build_model", side_effect=self.fresh_model) as build:
            code, out, err = self.capture(runner.refresh, args)
        self.assertEqual((code, err), (0, ""))
        state = config.load_state()
        self.assertEqual(json.loads(out)["status"], "updated-with-pipeline-warning")
        self.assertEqual(state["quota"][0]["quota"], 200)
        self.assertEqual(state["sources"]["pipeline"], pipeline)
        self.assertEqual(build.call_args.args[2]["accountStatus"]["1"], "unavailable")
        self.assertEqual(earnings.call_args.kwargs["config"]["tenantId"], TENANT)
        self.assertEqual(fetch_pipeline.call_args.kwargs["config"]["profile"], "default")

    def test_atomic_commit_failure_keeps_last_good_data(self):
        original = self.seed()
        args = self.args()
        self.write_csv([csv_row(**{"Total Quota": "999"})])
        with patch.object(sources, "fetch_earnings", return_value={}), \
                patch.object(sources, "fetch_pipeline", return_value={"status": "complete"}), \
                patch.object(runner, "build_model", side_effect=self.fresh_model), \
                patch.object(secure.os, "replace", side_effect=OSError("synthetic write failure")):
            self.assertEqual(self.capture(runner.refresh, args)[0], 1)
        self.assertEqual(config.load_state(), original)
        self.assertEqual(list(secure.private_directory().glob(".pending-*")), [])

    def test_profile_storage_has_no_cross_profile_carry(self):
        self.seed()
        secure.save_private("test.dpapi", {"synthetic": "alpha"}, "alpha")
        secure.save_private("test.dpapi", {"synthetic": "beta"}, "beta")
        self.assertEqual(secure.load_private("test.dpapi", "alpha")["synthetic"], "alpha")
        self.assertEqual(secure.load_private("test.dpapi", "beta")["synthetic"], "beta")
        with self.assertRaises(FileNotFoundError):
            secure.load_private("test.dpapi")

    def test_fiscal_year_mismatch_and_missing_file_never_fetch(self):
        original = self.seed()
        with patch.object(sources, "fetch_earnings", side_effect=AssertionError("No live fetch")):
            self.assertEqual(self.capture(runner.refresh, self.args(as_of="2027-07-01"))[0], 1)
            self.assertEqual(self.capture(runner.refresh, self.args(quota_csv=str(self.root / "missing.csv")))[0], 1)
        self.assertEqual(config.load_state()["quota"], original["quota"])

    def test_viewer_keeps_loopback_capability_and_no_store_csp(self):
        state = self.seed()
        state["lastRun"] = {"status": "setup-pending-refresh"}
        secure.save_private(secure.STATE_FILE, state)
        template = self.root / "synthetic-view.html"
        template.write_text("<html>__DASHBOARD_DATA__</html>", encoding="utf-8")
        responses = []

        def fake_server(address, handler_type):
            self.assertEqual(address, ("127.0.0.1", 0))
            server = Mock(server_port=54321)

            def invoke():
                for host, path, origin, expected in (
                        ("foreign.example", "/synthetic-capability", None, 403),
                        ("127.0.0.1:54321", "/wrong", None, 404),
                        ("127.0.0.1:54321", "/synthetic-capability", "https://foreign.example", 403),
                        ("127.0.0.1:54321", "/synthetic-capability", None, 200)):
                    handler = handler_type.__new__(handler_type)
                    handler.server = server
                    handler.headers = {"Host": host}
                    if origin:
                        handler.headers["Origin"] = origin
                    handler.path = path
                    handler.send_error, handler.send_response = Mock(), Mock()
                    handler.send_header, handler.end_headers = Mock(), Mock()
                    handler.wfile = io.BytesIO()
                    handler.do_GET()
                    if expected == 200:
                        handler.send_response.assert_called_once_with(200)
                        headers = dict(call.args for call in handler.send_header.call_args_list)
                        self.assertEqual(headers["Cache-Control"], "no-store, max-age=0")
                        self.assertIn("connect-src 'none'", headers["Content-Security-Policy"])
                        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
                        self.assertIn(b"dated last successful snapshot", handler.wfile.getvalue())
                        responses.append(headers)
                    else:
                        handler.send_error.assert_called_once_with(expected)
            server.serve_forever.side_effect = invoke
            return server

        with patch.object(secure, "ThreadingHTTPServer", side_effect=fake_server), \
                patch.object(secure.threading, "Thread"), \
                patch.object(secure.secrets, "token_urlsafe", return_value="synthetic-capability"):
            self.capture(lambda: secure.serve(template, open_browser=False))
        self.assertEqual(len(responses), 1)


class AdapterTests(IsolatedTests):
    def dataverse(self, configuration=None, token_tenant=TENANT):
        settings = configuration or self.configuration()
        response = subprocess.CompletedProcess([], 0, json.dumps({"accessToken": "synthetic-token", "tenant": token_tenant}), "")
        with patch.object(sources.shutil, "which", return_value="synthetic-az"), \
                patch.object(sources.subprocess, "run", return_value=response) as call, \
                patch.object(sources.urllib.request, "build_opener", return_value=Mock()):
            client = sources._Dataverse(settings)
        return client, call

    def test_config_specific_origin_tenant_and_pagination(self):
        one, call = self.dataverse()
        two_config = self.configuration(msx_url="https://second-org.crm9.dynamics.com")
        two, _ = self.dataverse(two_config)
        command = call.call_args.args[0]
        self.assertEqual(command[command.index("--tenant") + 1], TENANT)
        self.assertEqual(command[command.index("--resource") + 1], "https://synthetic-org.crm4.dynamics.com")
        self.assertIn("synthetic-org.crm4", one._url("accounts"))
        self.assertIn("second-org.crm9", two._url("accounts"))
        for path in ("https://foreign.example/api/data/v9.2/accounts", two._url("accounts"),
                     "https://synthetic-org.crm4.dynamics.com/api/data/v9.2/accounts#x"):
            with self.assertRaises(sources.SourceError):
                one._url(path)
        with self.assertRaises(sources.SourceError):
            self.dataverse(token_tenant="22222222-2222-4222-8222-222222222222")

    def test_unconfigured_sources_never_use_personal_defaults(self):
        with self.assertRaises(sources.SourceError):
            sources.fetch_earnings(2027, 1)
        result = sources.fetch_pipeline(["1"])
        self.assertEqual(result["status"], "unavailable")
        self.assertFalse(hasattr(sources, "ORIGIN"))
        self.assertFalse(hasattr(sources, "TENANT"))
        self.assertFalse(hasattr(sources, "BUNDLE"))

    def test_mint_uses_explicit_validated_bundle(self):
        client = sources._MintClient(str(self.bundle))
        self.assertEqual(client.bundle, self.bundle)
        with self.assertRaises(sources.SourceError):
            sources._MintClient(str(self.root / "not-installed.mjs"))

    def test_official_partition_keeps_ytd_and_exclusive_end_guard(self):
        bootstrap = {"context": {"participation": {"fiscalYearId": 2031, "availablePartitions": [
            {"partitionCadence": "Quarterly", "partitions": [
                {"title": "FY31-Q2", "order": 99, "startDate": "2030-07-01", "endDate": "2030-12-31"}]}]}}}
        self.assertEqual(sources._selected_partition(bootstrap, 2031, 2),
                         (99, date(2030, 7, 1), date(2031, 1, 1)))
        self.assertFalse(sources._month_in_period("January, 2031", date(2030, 7, 1), date(2031, 1, 1)))
        bad = copy.deepcopy(bootstrap)
        bad["context"]["participation"]["availablePartitions"][0]["partitions"][0]["endDate"] = "2031-01-01"
        with self.assertRaises(sources.SourceError):
            sources._selected_partition(bad, 2031, 2)

    def test_midmonth_partition_accepts_only_overlapping_calendar_months(self):
        start, end = date(2026, 8, 15), date(2026, 10, 1)
        for label in ("August, 2026", "September, 2026", "2026-08", "2026-09-01",
                      "FY27-August", "Sep FY27"):
            with self.subTest(label=label):
                self.assertTrue(sources._month_in_period(label, start, end))
        for label in ("July, 2026", "October, 2026", "2026-07", "2026-10-01",
                      "FY27-July", "October FY27", "August, 0000", ""):
            with self.subTest(label=label):
                self.assertFalse(sources._month_in_period(label, start, end))
        self.assertFalse(sources._month_in_period("August, 2026", start, start))
        self.assertFalse(sources._month_in_period("August, 2026", end, start))

    def test_earnings_configured_bundle_and_response_end_guard(self):
        settings = self.configuration()
        bootstrap = {"context": {"participation": {"fiscalYearId": 2027, "availablePartitions": [
            {"partitionCadence": "Quarterly", "partitions": [
                {"title": "FY27-Q1", "order": 7, "startDate": "2026-07-01", "endDate": "2026-09-30"}]}]}}}
        summary = {key: [] for key in ("accountSummary", "productSummary", "territorySummary", "attainmentSummary")}
        summary["counts"] = {key: 0 for key in summary}
        data = {"query": {"fiscalYearId": 2027, "fiscalQuarterId": 7,
                          "startDate": "2026-07-01", "endDate": "2026-10-01"},
                "sections": {"summary": summary, "performance": {
                    "fiscalYearId": 2027, "fiscalQuarterId": 7, "pcgDetails": []},
                    "pcg": {"pcgGrainResults": []}}}
        for end, succeeds in (("2026-10-01", True), ("2026-10-02", False)):
            sample = copy.deepcopy(data)
            sample["query"]["endDate"] = end
            with patch.object(sources, "_MintClient") as client:
                client.return_value.__enter__.return_value.earnings.side_effect = [bootstrap, sample]
                if succeeds:
                    result = sources.fetch_earnings(2027, 1, config=settings)
                    self.assertEqual(result["status"], "complete")
                else:
                    with self.assertRaises(sources.SourceError):
                        sources.fetch_earnings(2027, 1, config=settings)
                client.assert_called_once_with(settings["msxBundle"])
                arguments = client.return_value.__enter__.return_value.earnings.call_args.args[0]
                self.assertEqual(arguments["endDate"], "2026-10-01")


if __name__ == "__main__":
    unittest.main()
