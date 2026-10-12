"""MCAPS Seller Performance Dashboard: own-quota onboarding and explicit refresh."""
import argparse
from datetime import date
from functools import wraps
import json
from pathlib import Path
import sys

from dashboard_config import (
    ConfigError, create_config, diagnostics, fiscal_period, load_state,
    quota_summary, read_quota_csv, reporting_date, utc_now, validate_config,
)
from manager_model import ModelError, build_model
from secure_dashboard import (
    STATE_FILE, ProfileBusyError, private_directory, profile_lock,
    save_private, serve, validate_profile,
)


HERE = Path(__file__).resolve().parent


def profile_transaction(operation):
    @wraps(operation)
    def run(args):
        with profile_lock(args.profile):
            return operation(args)
    return run


def load_quota(csv_path=None, config=None):
    """A supplied export is only an in-memory candidate until reconciliation."""
    if csv_path is not None:
        return read_quota_csv(csv_path)
    profile = config["profile"] if config else "default"
    state = load_state(profile)
    rows = state.get("pendingQuota") or state.get("quota")
    if not rows:
        raise ConfigError("Supply your own MSX Earnings Quota by Accounts CSV with --quota-csv.")
    return rows


@profile_transaction
def setup(args):
    if not args.quota_csv:
        raise ConfigError("--setup requires your own MSX Earnings export via --quota-csv.")
    profile = validate_profile(args.profile)
    exists = (private_directory(profile, create=False) / STATE_FILE).is_file()
    if exists and not args.replace_profile:
        raise ConfigError("Profile already exists. Use --replace-profile explicitly to change setup; "
                          "the dated last successful snapshot will be retained.")
    quota = read_quota_csv(args.quota_csv)
    config = create_config(args)
    state = load_state(profile) if exists else {"schemaVersion": 1}
    state.update(config=config, pendingQuota=quota, pendingQuotaImportedAt=utc_now(),
                 lastRun={"status": "setup-pending-refresh", "generatedAt": utc_now()})
    save_private(STATE_FILE, state, profile)
    print(json.dumps({"status": "setup-pending-refresh", "profile": profile,
                      **quota_summary(quota), "retainedSnapshot": bool(state.get("dashboard")),
                      "message": "Encrypted setup saved. No live sources fetched. Run --refresh explicitly."}))
    return 0


def _failure_message(error):
    if isinstance(error, ConfigError):
        return str(error)
    if isinstance(error, ModelError):
        return "Official earnings/model reconciliation failed; verify export scope, fiscal year and supported plan."
    from manager_sources import SourceError
    if isinstance(error, SourceError):
        return str(error)
    return "A local storage or source-shape error prevented refresh; no new snapshot was committed."


@profile_transaction
def refresh(args):
    from manager_sources import SourceError, fetch_earnings, fetch_pipeline

    state = None
    profile = validate_profile(args.profile)
    try:
        state = load_state(profile)
        config = validate_config(state["config"], require_bundle=True)
        today = reporting_date(args.as_of, config["timezone"])
        fy, quarter = fiscal_period(today)
        quota = read_quota_csv(args.quota_csv) if args.quota_csv else (
            state.get("pendingQuota") or state.get("quota"))
        if not quota:
            raise ConfigError("Supply your own MSX Earnings Quota by Accounts CSV with --quota-csv.")
        if {row["fiscalYear"] for row in quota} != {fy}:
            raise ConfigError("Quota fiscal year does not match --as-of; supply the matching official export.")
        earnings = fetch_earnings(fy, quarter, config=config)
        tpids = sorted({row["tpid"] for row in quota})
        pipeline = fetch_pipeline(tpids, config=config)
        model = build_model(quota, earnings, pipeline, today)
        status = {
            "status": "updated" if pipeline["status"] == "complete" else "updated-with-pipeline-warning",
            "generatedAt": model["generatedAt"], "profile": profile,
            "pipelineStatus": pipeline["status"], "accounts": len(model["accounts"]),
            "opportunities": len(model["opportunities"]), "milestones": len(model["milestones"]),
        }
        imported_at = (utc_now() if args.quota_csv else
                       state.get("pendingQuotaImportedAt") or state.get("quotaImportedAt"))
        updated = dict(state, quota=quota, quotaImportedAt=imported_at,
                       quotaConfirmedAt=model["generatedAt"], pendingQuota=None, pendingQuotaImportedAt=None,
                       dashboard=model, sources={"earnings": earnings, "pipeline": pipeline},
                       snapshotConfig=config, lastRun=status)
        # One encrypted atomic replacement commits the reconciled quota and snapshot together.
        save_private(STATE_FILE, updated, profile)
    except (SourceError, ModelError, OSError, ValueError, KeyError, TypeError) as error:
        message = _failure_message(error)
        if state is not None:
            failed = dict(state, lastRun={"status": "failed", "generatedAt": utc_now(), "message": message})
            try:
                save_private(STATE_FILE, failed, profile)
            except (OSError, ValueError):
                print("The failure status could not be saved to encrypted storage; "
                      "check local storage access before relying on the viewer's status.", file=sys.stderr)
        print("Refresh failed; the last confirmed quota and dashboard were retained: " + message, file=sys.stderr)
        return 1
    print(json.dumps(status))
    return 0


@profile_transaction
def rebuild(args):
    state = load_state(args.profile)
    if not state.get("dashboard") or not state.get("sources") or not state.get("quota"):
        raise ConfigError("No successful snapshot to rebuild; run --refresh first.")
    old = state["dashboard"]
    model = build_model(state["quota"], state["sources"]["earnings"], state["sources"]["pipeline"],
                        date.fromisoformat(old["period"]["today"]))
    model["generatedAt"] = old["generatedAt"]
    model["warnings"].append("View rebuilt from recorded encrypted sources; snapshot date and source timestamps are unchanged.")
    save_private(STATE_FILE, dict(state, dashboard=model), args.profile)
    print("Private dashboard rebuilt; no live sources fetched.")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--setup", action="store_true", help="Save encrypted configuration and your required quota CSV; no live fetch")
    actions.add_argument("--refresh", action="store_true", help="Explicitly refresh MINT and scoped Dataverse; a sign-in browser may open")
    actions.add_argument("--validate-quota", metavar="PATH", help="Offline original-export validation; counts only, no setup needed")
    actions.add_argument("--diagnose", action="store_true", help="Offline dependency availability and profile presence; no authentication")
    actions.add_argument("--open", action="store_true", help="Open the private loopback snapshot viewer")
    actions.add_argument("--serve", action="store_true", help="Serve the private snapshot without opening the browser")
    actions.add_argument("--rebuild", action="store_true", help="Rebuild the last successful snapshot without a live fetch")
    parser.add_argument("--profile", default="default", help="Isolated Windows-user profile slug (default: default)")
    parser.add_argument("--quota-csv", help="Your own MSX Earnings Quota by Accounts export; required for setup")
    parser.add_argument("--replace-profile", action="store_true", help="Explicitly replace setup while preserving the dated last-good snapshot")
    parser.add_argument("--msx-bundle", help="Absolute installed msx-mcp.mjs path (setup only); otherwise bounded plugin discovery")
    parser.add_argument("--tenant-id", help="Your organization's tenant GUID (required for setup)")
    parser.add_argument("--msx-url", help="Your commercial Dynamics HTTPS organization origin (required for setup)")
    parser.add_argument("--timezone", help="local (default) or an available IANA timezone (setup only)")
    parser.add_argument("--as-of", help="YYYY-MM-DD reporting date (refresh only); default is the profile's local date")
    args = parser.parse_args(argv)
    if not args.setup and any((args.replace_profile, args.msx_bundle, args.tenant_id, args.msx_url, args.timezone)):
        parser.error("configuration arguments and --replace-profile are supported only with --setup")
    if args.quota_csv and not (args.setup or args.refresh):
        parser.error("--quota-csv is supported only with --setup or --refresh")
    if args.as_of and not args.refresh:
        parser.error("--as-of is supported only with --refresh")
    try:
        validate_profile(args.profile)
        if args.validate_quota:
            print(json.dumps(quota_summary(read_quota_csv(args.validate_quota))))
            return 0
        if args.diagnose:
            print(json.dumps(diagnostics(args.profile)))
            return 0
        if args.setup:
            return setup(args)
        if args.open or args.serve:
            state = load_state(args.profile)
            if not state.get("dashboard"):
                raise ConfigError("No successful dashboard snapshot for this profile; run --refresh first.")
            serve(HERE / "manager_dashboard.html", open_browser=args.open, profile=args.profile)
            return 0
        if args.rebuild:
            return rebuild(args)
        return refresh(args)
    except (ConfigError, OSError, ValueError, KeyError, TypeError) as error:
        message = str(error) if isinstance(error, (ConfigError, ProfileBusyError)) else "Profile operation failed validation or Windows encrypted-storage access."
        print(message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
