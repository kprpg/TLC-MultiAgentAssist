"""Offline onboarding and validation for each user's own dashboard profile."""
from __future__ import annotations

import csv
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import math
from pathlib import Path
import re
import shutil
import uuid
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from secure_dashboard import STATE_FILE, load_private, private_directory, validate_profile


HEADERS = ("Account Name", "Metric Name", "Credit Month", "Unit", "Total Quota",
           "Account Type", "Fiscal Year", "Bucket Name", "TPID")
MONTHS = ("January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December")
ACCOUNT_GRAIN = "EndCustomerTopParentName"
MAX_ACCOUNTS = 200


class ConfigError(ValueError):
    """A validation message that never includes private input values."""


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _invalid(row, column, reason="invalid value"):
    raise ConfigError(f"Quota CSV row {row}, column {column}: {reason}.")


def read_quota_csv(path):
    """Read the original MSX export; do not fill absent months or persist inputs."""
    try:
        file = Path(path)
        if file.stat().st_size > 8 * 1024 * 1024:
            raise ConfigError("Quota CSV exceeds the 8 MiB safety limit.")
        with file.open(encoding="utf-8-sig", newline="") as stream:
            first = stream.readline()
            offset = 1 if first.strip().casefold() == "sep=," else 0
            if not offset:
                stream.seek(0)
            reader = csv.reader(stream, strict=True)
            header = next(reader, None)
            if header is None:
                raise ConfigError("Quota CSV is empty.")
            header = [item.strip() for item in header]
            if len(header) != len(set(header)):
                raise ConfigError("Quota CSV has duplicate column headers.")
            missing = [item for item in HEADERS if item not in header]
            if missing:
                raise ConfigError("Quota CSV is missing required columns: " + ", ".join(missing) + ".")
            result, seen, accounts, buckets, years = [], set(), {}, {}, set()
            totals = {"total", "totals", "subtotal", "sub total", "grand total", "report total"}
            for values in reader:
                row_number = reader.line_num + offset
                if not values:
                    continue
                if len(values) != len(header):
                    raise ConfigError(f"Quota CSV row {row_number}: incorrect column count.")
                row = dict(zip(header, (item.strip() for item in values)))
                for column in HEADERS:
                    if not row[column]:
                        _invalid(row_number, column, "a complete original export row is required")
                for column in ("Account Name", "Metric Name", "Bucket Name"):
                    if row[column].casefold() in totals:
                        _invalid(row_number, column, "total/footer rows are not supported")
                if row["Unit"].upper() != "USD":
                    _invalid(row_number, "Unit", "v1 requires USD monetary quotas, not seats or percentages")
                if row["Account Type"] != ACCOUNT_GRAIN:
                    _invalid(row_number, "Account Type", "v1 requires EndCustomerTopParentName")
                if not re.fullmatch(r"[0-9]{1,20}", row["TPID"]):
                    _invalid(row_number, "TPID", "a numeric account identifier is required")
                tpid = str(int(row["TPID"]))
                if tpid == "0":
                    _invalid(row_number, "TPID", "a positive numeric account identifier is required")
                year_match = re.fullmatch(r"(?:FY)?([0-9]{4}|[0-9]{2})", row["Fiscal Year"], re.I)
                if not year_match:
                    _invalid(row_number, "Fiscal Year")
                fy = int(year_match[1])
                fy += 2000 if fy < 100 else 0
                if not 2000 <= fy <= 2200:
                    _invalid(row_number, "Fiscal Year")
                years.add(fy)
                if len(years) != 1:
                    _invalid(row_number, "Fiscal Year", "only one fiscal year is supported")
                month_match = re.fullmatch(r"([A-Za-z]+), ([0-9]{4})", row["Credit Month"])
                month_index = (next((n for n, name in enumerate(MONTHS, 1)
                                    if month_match and name.casefold() == month_match[1].casefold()), None))
                if month_index is None:
                    _invalid(row_number, "Credit Month", "expected English Month, YYYY")
                calendar_year = int(month_match[2])
                if calendar_year + (month_index >= 7) != fy:
                    _invalid(row_number, "Credit Month", "month is outside the row's fiscal year")
                month = f"{MONTHS[month_index - 1]}, {calendar_year}"
                amount = row["Total Quota"]
                if not re.fullmatch(r"[+-]?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?", amount):
                    _invalid(row_number, "Total Quota", "expected a finite monetary amount")
                try:
                    value = float(Decimal(amount.replace(",", "")))
                except (InvalidOperation, ValueError, OverflowError):
                    _invalid(row_number, "Total Quota", "expected a finite monetary amount")
                if not math.isfinite(value):
                    _invalid(row_number, "Total Quota", "expected a finite monetary amount")
                if value < 0:
                    _invalid(row_number, "Total Quota", "v1 requires a nonnegative monetary quota")
                metric, bucket = row["Metric Name"], row["Bucket Name"]
                if metric in buckets and buckets[metric] != bucket:
                    _invalid(row_number, "Bucket Name", "one metric cannot belong to multiple buckets")
                buckets[metric] = bucket
                if tpid in accounts and accounts[tpid] != row["Account Name"]:
                    _invalid(row_number, "Account Name", "one TPID cannot have inconsistent account names")
                accounts[tpid] = row["Account Name"]
                if len(accounts) > MAX_ACCOUNTS:
                    _invalid(row_number, "TPID", "v1 supports at most 200 accounts")
                key = (tpid, metric, month)
                if key in seen:
                    _invalid(row_number, "TPID/Metric Name/Credit Month", "duplicate account-metric-month row")
                seen.add(key)
                result.append({"tpid": tpid, "account": row["Account Name"],
                               "metric": metric, "bucket": bucket, "month": month,
                               "quota": value, "unit": "USD", "fiscalYear": fy})
                if len(result) > 100_000:
                    raise ConfigError("Quota CSV exceeds the row safety limit.")
    except (OSError, UnicodeError, csv.Error, TypeError):
        raise ConfigError("Quota CSV cannot be read as a complete UTF-8 MSX export.") from None
    if not result:
        raise ConfigError("Quota CSV contains no account quota rows.")
    return result


def quota_summary(rows):
    return {"rows": len(rows), "accounts": len({r["tpid"] for r in rows}),
            "metrics": len({r["metric"] for r in rows}),
            "fiscalYear": rows[0]["fiscalYear"], "currency": "USD"}


def validate_tenant(value):
    try:
        if not isinstance(value, str) or not re.fullmatch(
                r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", value):
            raise ValueError
        identifier = uuid.UUID(value)
        if not identifier.int:
            raise ValueError
        return str(identifier)
    except (ValueError, TypeError, AttributeError):
        raise ConfigError("Supply --tenant-id with your organization's tenant GUID.") from None


def validate_msx_url(value):
    try:
        if not isinstance(value, str) or value != value.strip():
            raise ValueError
        parsed = urlsplit(value)
        valid = (parsed.scheme == "https" and parsed.hostname is not None
                 and re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.crm[0-9]*\.dynamics\.com",
                                  parsed.hostname)
                 and parsed.port in (None, 443) and not parsed.username and not parsed.password
                 and parsed.path in ("", "/") and not parsed.query and not parsed.fragment
                 and "?" not in value and "#" not in value and "\\" not in value)
        if not valid:
            raise ValueError
        return "https://" + parsed.hostname
    except (ValueError, TypeError):
        raise ConfigError("Supply --msx-url as your HTTPS commercial Dynamics organization origin; "
                          "credentials, paths, query strings, and fragments are not allowed.") from None


def validate_timezone(value):
    if value == "local":
        return value
    try:
        if not isinstance(value, str) or not value:
            raise ValueError
        ZoneInfo(value)
        return value
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        raise ConfigError("The requested IANA timezone is unavailable; use local or provision system timezone data.") from None


def reporting_date(as_of=None, timezone_name="local"):
    validate_timezone(timezone_name)
    if as_of is not None:
        try:
            if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", as_of):
                raise ValueError
            return date.fromisoformat(as_of)
        except (ValueError, TypeError):
            raise ConfigError("--as-of must be a valid YYYY-MM-DD date.") from None
    if timezone_name == "local":
        return datetime.now().astimezone().date()
    return datetime.now(ZoneInfo(timezone_name)).date()


def fiscal_period(today):
    return today.year + (today.month >= 7), ((today.month - 7) % 12) // 3 + 1


def validate_bundle(value):
    try:
        path = Path(value)
        if (not path.is_absolute() or ".." in path.parts
                or path.name != "msx-mcp.mjs" or not path.is_file()):
            raise ValueError
        return str(path.resolve())
    except (OSError, TypeError, ValueError):
        raise ConfigError("--msx-bundle must be an absolute path to an installed msx-mcp.mjs file.") from None


def discover_bundle():
    """Only inspect bounded, known plugin layouts; never scan the user's home."""
    root = Path.home() / ".copilot" / "installed-plugins"
    candidates = set()
    for pattern in (r"msx-mcp\bundle\msx-mcp.mjs", r"*\msx-mcp\bundle\msx-mcp.mjs",
                    r"*\msx-mcp\*\bundle\msx-mcp.mjs"):
        for path in root.glob(pattern):
            try:
                candidates.add(validate_bundle(path))
            except ConfigError:
                continue
    if len(candidates) != 1:
        raise ConfigError("MSX MCP discovery found no unique installed bundle; supply --msx-bundle explicitly.")
    return candidates.pop()


def create_config(args):
    return {"schemaVersion": 1, "profile": validate_profile(args.profile),
            "tenantId": validate_tenant(args.tenant_id), "msxUrl": validate_msx_url(args.msx_url),
            "msxBundle": validate_bundle(args.msx_bundle) if args.msx_bundle else discover_bundle(),
            "timezone": validate_timezone(args.timezone or "local"), "currency": "USD",
            "accountGrain": ACCOUNT_GRAIN, "configuredAt": utc_now()}


def validate_config(config, *, require_bundle=False):
    if (not isinstance(config, dict) or config.get("schemaVersion") != 1
            or config.get("currency") != "USD" or config.get("accountGrain") != ACCOUNT_GRAIN):
        raise ConfigError("Unsupported dashboard profile; run --setup with your own quota export.")
    normalized = dict(config, profile=validate_profile(config.get("profile")),
                      tenantId=validate_tenant(config.get("tenantId")),
                      msxUrl=validate_msx_url(config.get("msxUrl")),
                      timezone=validate_timezone(config.get("timezone")))
    if require_bundle:
        normalized["msxBundle"] = validate_bundle(config.get("msxBundle"))
    return normalized


def load_state(profile="default"):
    profile = validate_profile(profile)
    try:
        state = load_private(STATE_FILE, profile)
    except FileNotFoundError:
        raise ConfigError("Profile is not configured. Run --setup --quota-csv with your own MSX Earnings export.") from None
    except (OSError, ValueError):
        raise ConfigError("The encrypted profile cannot be read by this Windows user.") from None
    if not isinstance(state, dict) or state.get("schemaVersion") != 1:
        raise ConfigError("Unsupported encrypted profile schema.")
    config = validate_config(state.get("config"))
    if config["profile"] != profile:
        raise ConfigError("Encrypted profile does not match the selected profile.")
    state["config"] = config
    return state


def load_config(profile="default"):
    return load_state(profile)["config"]


def diagnostics(profile="default"):
    profile = validate_profile(profile)
    return {"profile": profile, "profilePresent": (private_directory(profile, create=False) / STATE_FILE).is_file(),
            "dependencies": {"node": shutil.which("node") is not None,
                             "az": shutil.which("az") is not None},
            "timezoneDefault": "local"}
