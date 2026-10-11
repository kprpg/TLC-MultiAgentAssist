"""Read-only, in-memory MINT and account-scoped Dataverse adapters."""

from __future__ import annotations

import datetime as dt
import errno
import http.client
import json
import math
import os
from pathlib import Path
import queue
import re
import shutil
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from dashboard_config import ConfigError, load_config, validate_bundle, validate_config


FORMATTED = "@OData.Community.Display.V1.FormattedValue"
MAX_RECORDS = 50_000
MAX_BYTES = 64 * 1024 * 1024
TERMINAL_STATUSES = {"completed", "cancelled", "canceled", "lost to competitor", "hygiene/duplicate"}
ACTIVE_STATUSES = {"on track", "at risk", "blocked"}


class SourceError(RuntimeError):
    """A sanitized source failure, safe for a status report."""


def _configuration(config):
    try:
        return validate_config(config if config is not None else load_config())
    except (ConfigError, ValueError, OSError):
        raise SourceError("A valid package profile with --tenant-id and --msx-url is required; run --setup first.") from None


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def _number(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SourceError("Source returned an invalid numeric field.")
    if not math.isfinite(value):
        raise SourceError("Source returned a non-finite numeric field.")
    return value


def _date(value):
    if not value:
        return None
    if not isinstance(value, str):
        raise SourceError("Source returned an invalid date field.")
    try:
        # CRM date-only fields must retain their original UTC calendar date.
        return dt.date.fromisoformat(value[:10]).isoformat()
    except ValueError:
        raise SourceError("Source returned an invalid date field.") from None


def _guid(value) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise SourceError("Source returned an invalid record identifier.") from None


def _label(row, field) -> str:
    value = row.get(field + FORMATTED)
    if value is not None:
        return str(value)
    value = row.get(field)
    return value if isinstance(value, str) and not field.startswith("_") else ""


def _chunks(items, size=15):
    for index in range(0, len(items), size):
        yield items[index:index + size]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SourceError("Dataverse redirect rejected.")


class _Dataverse:
    def __init__(self, config=None):
        config = _configuration(config)
        self.origin = config["msxUrl"]
        self.api = self.origin + "/api/data/v9.2/"
        self.tenant = config["tenantId"]
        az = shutil.which("az")
        if not az:
            raise SourceError("Azure CLI is unavailable.")
        try:
            result = subprocess.run(
                [az, "account", "get-access-token", "--tenant", self.tenant,
                 "--resource", self.origin, "--output", "json"],
                capture_output=True, timeout=90, check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except (OSError, subprocess.TimeoutExpired):
            raise SourceError("Azure CLI token acquisition failed or timed out.") from None
        if result.returncode:
            raise SourceError("Dataverse authentication unavailable; sign in to Azure CLI for the configured tenant yourself.")
        try:
            response = json.loads(result.stdout)
            if str(uuid.UUID(response["tenant"])) != self.tenant:
                raise ValueError
            self._token = response["accessToken"]
            if not isinstance(self._token, str) or not self._token:
                raise ValueError
        except (ValueError, KeyError, TypeError):
            raise SourceError("Azure CLI returned an invalid authentication response.") from None
        self._opener = urllib.request.build_opener(_NoRedirect())
        self._metadata = {}
        self._currency = {}
        self._rows_read = 0

    def _url(self, path, params=None):
        try:
            url = urllib.parse.urljoin(self.api, path)
            parsed = urllib.parse.urlsplit(url)
            valid = (parsed.scheme == "https" and parsed.hostname == urllib.parse.urlsplit(self.origin).hostname
                     and parsed.port in (None, 443) and not parsed.username and not parsed.password
                     and not parsed.fragment and parsed.path.startswith("/api/data/v9.2/"))
        except (ValueError, TypeError):
            valid = False
        if not valid:
            raise SourceError("Dataverse pagination URL failed same-origin validation.")
        if params:
            url += ("&" if parsed.query else "?") + urllib.parse.urlencode(params)
        return url

    def get(self, path, params=None):
        url = self._url(path, params)
        for attempt in range(4):
            request = urllib.request.Request(url, headers={
                "Authorization": "Bearer " + self._token,
                "Accept": "application/json",
                "OData-Version": "4.0",
                "OData-MaxVersion": "4.0",
                "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=5000',
            })
            delay = 2 ** attempt
            try:
                with self._opener.open(request, timeout=45) as response:
                    content = response.read(MAX_BYTES + 1)
                    if len(content) > MAX_BYTES:
                        raise SourceError("Dataverse response exceeded the safety limit.")
                data = json.loads(content)
                if not isinstance(data, dict):
                    raise SourceError("Dataverse returned an invalid response.")
                return data
            except urllib.error.HTTPError as error:
                code = error.code
                retry_after = error.headers.get("Retry-After", "")
                error.close()
                if code not in (408, 429, 500, 502, 503, 504) or attempt == 3:
                    raise SourceError(f"Dataverse request failed (HTTP {code}).") from None
                if retry_after.isdigit():
                    delay = min(30, max(delay, int(retry_after)))
            except urllib.error.URLError as error:
                reason = error.reason
                transient = isinstance(reason, (TimeoutError, ConnectionError)) or (
                    isinstance(reason, OSError) and reason.errno in {
                        errno.ECONNRESET, errno.ECONNABORTED, errno.ETIMEDOUT, errno.ECONNREFUSED,
                        socket.EAI_AGAIN, 10053, 10054, 10060, 10061,
                    }
                )
                if not transient or attempt == 3:
                    raise SourceError("Dataverse connection failed; authentication or network access may be unavailable.") from None
            except (TimeoutError, ConnectionError, http.client.IncompleteRead, http.client.RemoteDisconnected):
                if attempt == 3:
                    raise SourceError("Dataverse connection failed after bounded retries.") from None
            except (ValueError, UnicodeError):
                raise SourceError("Dataverse returned invalid JSON.") from None
            time.sleep(delay)
        raise SourceError("Dataverse request failed.")

    def rows(self, path, params=None, *, metadata=False):
        url = self._url(path, params)
        seen = set()
        rows = []
        while url:
            if url in seen:
                raise SourceError("Dataverse pagination loop rejected.")
            seen.add(url)
            data = self.get(url)
            page = data.get("value")
            if not isinstance(page, list) or any(not isinstance(row, dict) for row in page):
                raise SourceError("Dataverse returned an invalid collection.")
            rows.extend(page)
            if not metadata:
                self._rows_read += len(page)
            if len(rows) > MAX_RECORDS or self._rows_read > MAX_RECORDS or len(seen) > 1000:
                raise SourceError("Dataverse record/page safety limit reached; results are incomplete.")
            next_url = data.get("@odata.nextLink")
            if next_url is not None and not isinstance(next_url, str):
                raise SourceError("Dataverse returned an invalid pagination link.")
            url = self._url(next_url) if next_url else None
        return rows

    def attributes(self, entity):
        if entity not in self._metadata:
            rows = self.rows(
                f"EntityDefinitions(LogicalName='{entity}')/Attributes",
                {"$select": "LogicalName,AttributeType,IsValidForRead"}, metadata=True,
            )
            self._metadata[entity] = {row["LogicalName"]: row for row in rows}
        return self._metadata[entity]

    def require(self, entity, fields):
        attributes = self.attributes(entity)
        for field, kind in fields.items():
            actual = attributes.get(field, {})
            if actual.get("IsValidForRead") is False or not actual or (kind and actual.get("AttributeType") != kind):
                raise SourceError(f"Dataverse {entity} schema validation failed.")

    def select(self, entity, fields):
        attributes = self.attributes(entity)
        selected = []
        for field in fields:
            name = field[1:-6] if field.startswith("_") and field.endswith("_value") else field
            if name in attributes and attributes[name].get("IsValidForRead") is not False:
                selected.append(field)
        return ",".join(selected)

    def option_labels(self, entity, field):
        self.require(entity, {field: "Picklist"})
        data = self.get(
            f"EntityDefinitions(LogicalName='{entity}')/Attributes(LogicalName='{field}')"
            "/Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
            {"$select": "LogicalName", "$expand": "OptionSet"},
        )
        options = data.get("OptionSet", {}).get("Options")
        if data.get("LogicalName") != field or not isinstance(options, list) or not options:
            raise SourceError("Dataverse milestone status option metadata is unavailable.")
        labels = {}
        for option in options:
            value = option.get("Value")
            label_data = option.get("Label") or {}
            label = next(
                (item.get("Label") for item in label_data.get("LocalizedLabels", [])
                 if item.get("LanguageCode") == 1033),
                None,
            ) or (label_data.get("UserLocalizedLabel") or {}).get("Label")
            if type(value) is not int or not isinstance(label, str) or not label.strip():
                raise SourceError("Dataverse milestone status option metadata is invalid.")
            labels[value] = label.strip()
        return labels

    def currency(self, identifier):
        if not identifier:
            return ""
        identifier = _guid(identifier)
        if identifier not in self._currency:
            data = self.get(f"transactioncurrencies({identifier})", {"$select": "isocurrencycode"})
            code = data.get("isocurrencycode")
            if not isinstance(code, str) or not re.fullmatch(r"[A-Za-z]{3}", code):
                raise SourceError("Dataverse currency code is unavailable.")
            self._currency[identifier] = code.upper()
        return self._currency[identifier]

    def base_currency(self):
        orgs = self.rows("organizations", {"$select": "_basecurrencyid_value", "$top": "2"})
        if len(orgs) != 1:
            raise SourceError("Dataverse organization currency could not be verified.")
        return self.currency(orgs[0].get("_basecurrencyid_value"))


class _MintClient:
    """Sequential MCP client; reader threads only drain the two IPC streams."""

    def __init__(self, bundle):
        try:
            self.bundle = Path(validate_bundle(bundle))
        except ConfigError:
            raise SourceError("The configured installed MSX MCP bundle is unavailable; update setup explicitly.") from None
        self.process = None
        self.messages = queue.Queue()
        self.counter = 0
        self.threads = []

    def __enter__(self):
        node = shutil.which("node")
        if not node or not self.bundle.is_file():
            raise SourceError("The installed MSX MCP runtime is unavailable.")
        env = dict(os.environ)
        env["MSX_MCP_MINT_AUTOCAPTURE"] = "launch"
        try:
            self.process = subprocess.Popen(
                [node, str(self.bundle)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, env=env,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            for target in (self._read_stdout, self._drain_stderr):
                thread = threading.Thread(target=target, daemon=True)
                thread.start()
                self.threads.append(thread)
            result = self.call("initialize", {
                "protocolVersion": "2024-11-05", "capabilities": {},
                "clientInfo": {"name": "manager-sources", "version": "1.0"},
            }, timeout=45)
            if not isinstance(result, dict) or not result.get("protocolVersion"):
                raise SourceError("MINT MCP initialization failed.")
            self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})
            return self
        except SourceError:
            self.close()
            raise
        except OSError:
            self.close()
            raise SourceError("MINT MCP process could not start.") from None

    def _read_stdout(self):
        try:
            while True:
                line = self.process.stdout.readline(MAX_BYTES + 1)
                if not line:
                    break
                if len(line) > MAX_BYTES:
                    self.messages.put(None)
                    return
                try:
                    message = json.loads(line)
                except (ValueError, UnicodeError):
                    continue
                if isinstance(message, dict) and "id" in message:
                    self.messages.put(message)
        except (OSError, ValueError):
            pass
        finally:
            self.messages.put(None)

    def _drain_stderr(self):
        try:
            while self.process.stderr.read(65536):
                pass
        except (OSError, ValueError):
            pass

    def _send(self, message):
        try:
            self.process.stdin.write((json.dumps(message) + "\n").encode("utf-8"))
            self.process.stdin.flush()
        except (OSError, ValueError, AttributeError):
            raise SourceError("MINT MCP IPC closed unexpectedly.") from None

    def call(self, method, params, timeout=240):
        self.counter += 1
        request_id = self.counter
        self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        deadline = time.monotonic() + timeout
        while True:
            try:
                message = self.messages.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty:
                raise SourceError("MINT MCP request timed out.") from None
            if message is None:
                raise SourceError("MINT MCP exited before returning a response.")
            if message.get("id") != request_id:
                continue
            if "error" in message:
                raise SourceError("MINT MCP returned a protocol error.")
            return message.get("result")

    def earnings(self, arguments):
        result = self.call("tools/call", {"name": "get_earnings", "arguments": arguments})
        if not isinstance(result, dict) or result.get("isError"):
            raise SourceError("MINT earnings tool failed; cached authentication may need renewal.")
        content = result.get("content", [])
        if not isinstance(content, list):
            raise SourceError("MINT MCP returned invalid content.")
        text = "\n".join(item["text"] for item in content
                         if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str))
        try:
            data = json.loads(text)
        except (ValueError, TypeError):
            raise SourceError("MINT earnings tool returned a non-JSON response.") from None
        if not isinstance(data, dict) or data.get("tool") != "get_earnings" or not isinstance(data.get("sections"), dict):
            raise SourceError("MINT earnings envelope validation failed.")
        return data

    def close(self):
        if self.process is None:
            return
        if self.process.stdin:
            try:
                self.process.stdin.close()
            except OSError:
                pass
        try:
            try:
                self.process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                try:
                    self.process.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=4)
        except (OSError, subprocess.TimeoutExpired):
            raise SourceError("MINT MCP process cleanup failed.") from None
        for thread in self.threads:
            thread.join(timeout=1)
        for stream in (self.process.stdout, self.process.stderr):
            if stream:
                stream.close()

    def __exit__(self, *_):
        self.close()


def _quarter_dates(fiscal_year, quarter):
    if type(fiscal_year) is not int or not 2000 <= fiscal_year <= 2200 or type(quarter) is not int or quarter not in (1, 2, 3, 4):
        raise SourceError("A valid fiscal year and quarter 1-4 are required.")
    start_month = (6 + (quarter - 1) * 3) % 12 + 1
    year = fiscal_year - 1 if quarter <= 2 else fiscal_year
    start = dt.date(year, start_month, 1)
    end = dt.date(year + (start_month + 2) // 12, (start_month + 2) % 12 + 1, 1)
    return start, end


def _selected_partition(bootstrap, fiscal_year, quarter):
    _, quarter_end = _quarter_dates(fiscal_year, quarter)
    participation = bootstrap.get("context", {}).get("participation", {})
    if participation.get("fiscalYearId") != fiscal_year:
        raise SourceError("MINT participation does not match the selected fiscal year.")
    expected = f"FY{fiscal_year % 100:02d}-Q{quarter}"
    matches = []
    for group in participation.get("availablePartitions", []):
        if str(group.get("partitionCadence", "")).casefold() != "quarterly":
            continue
        for partition in group.get("partitions", []):
            if str(partition.get("title", "")).upper().replace(" ", "") == expected:
                start_text = _date(partition.get("startDate"))
                end_text = _date(partition.get("endDate"))
                if not start_text or not end_text:
                    raise SourceError("MINT official partition dates are unavailable.")
                start = dt.date.fromisoformat(start_text)
                end_inclusive = dt.date.fromisoformat(end_text)
                if not dt.date(fiscal_year - 1, 7, 1) <= start <= end_inclusive:
                    raise SourceError("MINT official partition start is outside the selected fiscal year.")
                if end_inclusive != quarter_end - dt.timedelta(days=1):
                    raise SourceError("MINT quarter end does not match the requested period.")
                value = partition.get("order")
                if type(value) is not int or value <= 0:
                    raise SourceError("MINT quarter identifier is unavailable.")
                # Quarterly partitions carry official YTD dates, not quarter-only dates.
                # The plugin strips times, so advance its inclusive end to the next day.
                matches.append((value, start, end_inclusive + dt.timedelta(days=1)))
    if len(set(matches)) != 1:
        raise SourceError("MINT selected quarterly partition is missing or ambiguous.")
    return matches[0]


def _month_in_period(value, start, end):
    if not isinstance(value, str) or not value.strip() or start >= end:
        return False
    # Labels identify calendar months, not the precise official calculation start.
    first_month = start.replace(day=1)
    value = value.strip()
    if re.match(r"^\d{4}-\d{2}", value):
        try:
            date = dt.date.fromisoformat(value[:7] + "-01")
            return first_month <= date < end
        except ValueError:
            return False
    months = ("january", "february", "march", "april", "may", "june",
              "july", "august", "september", "october", "november", "december")
    lowered = value.casefold()
    fiscal_year = start.year + (start.month >= 7)
    fiscal_match = re.fullmatch(r"fy(\d{2}|\d{4})[- ]([a-z]+)", lowered)
    calendar_match = re.fullmatch(r"([a-z]+)[,\s-]+(fy\s*)?(\d{2}|\d{4})", lowered)
    year = None
    if fiscal_match:
        year = int(fiscal_match[1])
        year += 2000 if year < 100 else 0
        if year != fiscal_year:
            return False
        lowered = fiscal_match[2]
        year = None
    elif calendar_match:
        lowered = calendar_match[1]
        year = int(calendar_match[3])
        year += 2000 if year < 100 else 0
        if calendar_match[2]:
            if year != fiscal_year:
                return False
            year = None
    for number, name in enumerate(months, 1):
        if lowered in (name, name[:3]):
            calendar_year = year if year is not None else fiscal_year - (number >= 7)
            try:
                return first_month <= dt.date(calendar_year, number, 1) < end
            except ValueError:
                return False
    return False


def fetch_earnings(fiscal_year: int, quarter: int, config=None) -> dict:
    """Return the official selected-partition/YTD envelope; never persist it."""
    _quarter_dates(fiscal_year, quarter)
    config = _configuration(config)
    with _MintClient(config["msxBundle"]) as client:
        bootstrap = client.earnings({
            "fiscalYearId": fiscal_year, "sections": ["config", "partitions"],
            "grain": "all", "format": "json", "top": 500,
        })
        partition, start, end = _selected_partition(bootstrap, fiscal_year, quarter)
        data = client.earnings({
            "fiscalYearId": fiscal_year, "fiscalQuarterId": partition,
            "startDate": start.isoformat(), "endDate": end.isoformat(),
            "sections": ["summary", "performance", "pcg"],
            "grain": "all", "format": "json", "top": 500,
        })
    query = data.get("query", {})
    if (query.get("fiscalYearId") != fiscal_year or query.get("fiscalQuarterId") != partition
            or _date(query.get("startDate")) != start.isoformat() or _date(query.get("endDate")) != end.isoformat()):
        raise SourceError("MINT returned a different earnings period.")
    sections = data["sections"]
    if any(not isinstance(sections.get(key), dict) for key in ("summary", "performance", "pcg")):
        raise SourceError("MINT did not return all requested earnings sections.")
    performance = sections["performance"]
    if performance.get("fiscalYearId") != fiscal_year or performance.get("fiscalQuarterId") != partition:
        raise SourceError("MINT official performance does not match the selected fiscal quarter.")
    summary = sections["summary"]
    for grain in ("accountSummary", "productSummary", "territorySummary", "attainmentSummary"):
        rows = summary.get(grain)
        count = summary.get("counts", {}).get(grain)
        if not isinstance(rows, list) or type(count) is not int or count != len(rows):
            raise SourceError("MINT summary is missing or truncated; complete earnings cannot be reported.")
    for row in summary["accountSummary"]:
        if not isinstance(row, dict):
            raise SourceError("MINT account summary shape validation failed.")
        months = row.get("months")
        if not isinstance(months, list) or not months or any(not _month_in_period(value, start, end) for value in months):
            raise SourceError("MINT aggregated account months extend outside the official selected period or are unverified.")
    if not isinstance(performance.get("pcgDetails"), list) or not isinstance(sections["pcg"].get("pcgGrainResults"), list):
        raise SourceError("MINT performance/PCG shape validation failed.")
    data["status"] = "complete"
    data["asOf"] = data.get("generatedAt") or _now()
    return data


OPPORTUNITY_FIELDS = [
    "opportunityid", "msp_opportunitynumber", "_parentaccountid_value", "_customerid_value",
    "name", "_ownerid_value", "msp_activesalesstage", "msp_solutionarea", "msp_salesplay",
    "msp_opportunitytype", "estimatedvalue", "estimatedvalue_base", "estimatedclosedate",
    "statecode", "msp_forecastcomments", "_transactioncurrencyid_value",
]
MILESTONE_FIELDS = [
    "msp_engagementmilestoneid", "msp_milestonenumber", "_msp_opportunityid_value",
    "msp_name", "_ownerid_value", "msp_milestonecategory", "msp_milestonestatus",
    "msp_commitmentrecommendation", "msp_monthlyuse", "msp_monthlyuse_base",
    "msp_milestonedate", "msp_workload", "msp_milestoneworkload", "_msp_workloadlkid_value",
    "msp_forecastcomments", "_transactioncurrencyid_value", "statecode",
]


def _money(client, row, field, base_currency):
    if base_currency == "USD" and row.get(field + "_base") is not None:
        return _number(row[field + "_base"]), "USD"
    return _number(row.get(field)), client.currency(row.get("_transactioncurrencyid_value"))


def _canonical_account(row, accounts):
    parent_id = row.get("_parentaccountid_value")
    customer_id = row.get("_customerid_value")
    parent_id = _guid(parent_id) if parent_id else None
    customer_id = _guid(customer_id) if customer_id else None
    parent = accounts.get(parent_id)
    customer = accounts.get(customer_id)
    # Prefer a roster parent; customer attribution is only a fallback when the
    # parent is outside this roster or its account record could not be obtained.
    account_id = parent_id if parent is not None else customer_id
    account = parent if parent is not None else customer
    if account is None:
        raise SourceError("Dataverse opportunity account scope verification failed.")
    tpid = str(account["msp_mstopparentid"])
    conflict = set()
    if parent is not None and customer is not None:
        parent_tpid = str(parent["msp_mstopparentid"])
        customer_tpid = str(customer["msp_mstopparentid"])
        if parent_tpid != customer_tpid:
            conflict = {parent_tpid, customer_tpid}
    return account_id, tpid, conflict


def _opportunity(client, row, accounts, tpid, base_currency):
    account_id, canonical_tpid, _ = _canonical_account(row, accounts)
    if canonical_tpid != tpid:
        raise SourceError("Dataverse opportunity account scope verification failed.")
    value, currency = _money(client, row, "estimatedvalue", base_currency)
    if row.get("statecode") not in (0, 1):
        raise SourceError("Dataverse opportunity state verification failed.")
    state = {0: "Open", 1: "Won"}[row["statecode"]]
    return {
        "id": _guid(row.get("opportunityid")), "number": row.get("msp_opportunitynumber") or "",
        "tpid": tpid, "account": accounts[account_id].get("name") or "",
        "name": row.get("name") or "", "owner": _label(row, "_ownerid_value"),
        "stage": _label(row, "msp_activesalesstage"), "solutionArea": _label(row, "msp_solutionarea"),
        "salesPlay": _label(row, "msp_salesplay"), "intent": _label(row, "msp_opportunitytype"),
        "estimatedValue": value, "currency": currency,
        # "Consumed Recurring" metadata does not establish a monthly time grain.
        "monthlyRunRate": None, "closeDate": _date(row.get("estimatedclosedate")),
        "state": state, "forecastComments": row.get("msp_forecastcomments") or "",
    }


def _milestone(client, row, opportunities, base_currency, status_labels=None):
    opportunity_id = _guid(row.get("_msp_opportunityid_value"))
    parent = opportunities.get(opportunity_id)
    if parent is None:
        raise SourceError("Dataverse milestone parent scope verification failed.")
    raw_status = row.get("msp_milestonestatus")
    status = (status_labels or {}).get(raw_status) or _label(row, "msp_milestonestatus")
    if not status:
        status = "Unknown - source status missing"
    if row.get("statecode") != 0 or status.strip().casefold() in TERMINAL_STATUSES:
        return None
    active = True if status.strip().casefold() in ACTIVE_STATUSES else None
    monthly, currency = _money(client, row, "msp_monthlyuse", base_currency)
    return {
        "id": _guid(row.get("msp_engagementmilestoneid")), "number": row.get("msp_milestonenumber") or "",
        "opportunityId": opportunity_id, "opportunityName": parent["name"],
        "tpid": parent["tpid"], "account": parent["account"], "name": row.get("msp_name") or "",
        "owner": _label(row, "_ownerid_value"), "category": _label(row, "msp_milestonecategory"),
        "status": status, "commitment": _label(row, "msp_commitmentrecommendation"),
        "monthly": monthly, "date": _date(row.get("msp_milestonedate")),
        "workload": _label(row, "_msp_workloadlkid_value") or _label(row, "msp_workload") or _label(row, "msp_milestoneworkload"),
        "forecastComments": row.get("msp_forecastcomments") or "", "currency": currency, "active": active,
    }


def fetch_pipeline(tpids: list[str], config=None) -> dict:
    """Return visible deals and nonterminal milestones, retaining uncertain statuses."""
    if not isinstance(tpids, list) or not tpids or len(tpids) > 200:
        raise SourceError("A bounded nonempty TPID list is required.")
    if any(not isinstance(tpid, str) or not re.fullmatch(r"\d{1,20}", tpid) for tpid in tpids):
        raise SourceError("TPIDs must be numeric strings.")
    tpids = list(dict.fromkeys(tpids))
    result = {
        "status": "unavailable", "asOf": _now(), "errors": [],
        "accountStatus": {tpid: "unavailable" for tpid in tpids},
        "opportunities": [], "milestones": [],
    }
    try:
        client = _Dataverse(config=config)
        client.require("account", {"accountid": "Uniqueidentifier", "msp_mstopparentid": "String"})
        client.require("opportunity", {
            "opportunityid": "Uniqueidentifier", "parentaccountid": "Lookup",
            "estimatedvalue": "Money", "statecode": "State",
        })
        client.require("msp_engagementmilestone", {
            "msp_engagementmilestoneid": "Uniqueidentifier", "msp_opportunityid": "Lookup",
            "msp_monthlyuse": "Money", "msp_milestonestatus": "Picklist", "statecode": "State",
        })
        base_currency = client.base_currency()
        opportunity_select = client.select("opportunity", OPPORTUNITY_FIELDS)
        milestone_select = client.select("msp_engagementmilestone", MILESTONE_FIELDS)
        status_labels = client.option_labels("msp_engagementmilestone", "msp_milestonestatus")
    except SourceError as error:
        result["errors"].append(str(error))
        return result
    accounts = {}
    account_ids = {}
    opportunities = {}
    milestones = {}
    attribution_conflicts = {tpid: set() for tpid in tpids}
    ambiguous_opportunities = {}
    ambiguous_milestones = {}
    opportunity_failures = set()
    # Finish the roster account pass before attributing any opportunity. A
    # customer lookup may refer to a different roster TPID than its parent.
    for tpid in tpids:
        try:
            records = client.rows("accounts", {
                "$select": "accountid,name,msp_mstopparentid",
                "$filter": f"msp_mstopparentid eq '{tpid}'",
            })
            if not records:
                raise SourceError("No visible matching account record; pipeline availability is unknown.")
            if any(str(row.get("msp_mstopparentid")) != tpid for row in records):
                raise SourceError("Dataverse account TPID scope verification failed.")
            resolved_accounts = {_guid(row.get("accountid")): row for row in records}
            for identifier, row in resolved_accounts.items():
                if identifier in accounts and str(accounts[identifier]["msp_mstopparentid"]) != tpid:
                    result["errors"].append("Dataverse account TPID attribution changed during retrieval; refresh is unavailable.")
                    return result
            for identifier, row in resolved_accounts.items():
                accounts[identifier] = row
            account_ids[tpid] = list(resolved_accounts)
        except SourceError as error:
            result["errors"].append(f"TPID {tpid}: {error}")

    for tpid, identifiers in account_ids.items():
        result["accountStatus"][tpid] = "complete"
        for batch in _chunks(identifiers):
            try:
                scope = " or ".join(
                    f"_parentaccountid_value eq {identifier} or _customerid_value eq {identifier}"
                    for identifier in batch
                )
                rows = client.rows("opportunities", {
                    "$select": opportunity_select,
                    "$filter": f"(statecode eq 0 or statecode eq 1) and ({scope})",
                })
                for row in rows:
                    _, canonical_tpid, conflict = _canonical_account(row, accounts)
                    normalized = _opportunity(client, row, accounts, canonical_tpid, base_currency)
                    identifier = normalized["id"]
                    for affected_tpid in conflict:
                        attribution_conflicts[affected_tpid].add(identifier)
                    if identifier in ambiguous_opportunities:
                        ambiguous_opportunities[identifier].add(canonical_tpid)
                        continue
                    previous = opportunities.get(identifier)
                    if previous is not None and previous["tpid"] != canonical_tpid:
                        ambiguous_opportunities[identifier] = {previous["tpid"], canonical_tpid}
                        del opportunities[identifier]
                        continue
                    opportunities.setdefault(identifier, normalized)
            except SourceError as error:
                opportunity_failures.add(tpid)
                message = f"TPID {tpid}: {error}"
                if message not in result["errors"]:
                    result["errors"].append(message)

    for tpid in tpids:
        identifiers = [identifier for identifier, row in opportunities.items() if row["tpid"] == tpid]
        if tpid in opportunity_failures:
            result["accountStatus"][tpid] = "partial" if identifiers else "unavailable"
        for batch in _chunks(identifiers):
            try:
                scope = " or ".join(f"_msp_opportunityid_value eq {identifier}" for identifier in batch)
                rows = client.rows("msp_engagementmilestones", {
                    "$select": milestone_select,
                    "$filter": f"statecode eq 0 and ({scope})",
                })
                for row in rows:
                    normalized = _milestone(client, row, opportunities, base_currency, status_labels)
                    if normalized is not None:
                        identifier = normalized["id"]
                        if identifier in ambiguous_milestones:
                            ambiguous_milestones[identifier].add(normalized["tpid"])
                            continue
                        previous = milestones.get(identifier)
                        if previous is not None and previous["opportunityId"] != normalized["opportunityId"]:
                            ambiguous_milestones[identifier] = {previous["tpid"], normalized["tpid"]}
                            del milestones[identifier]
                            continue
                        milestones.setdefault(identifier, normalized)
            except SourceError as error:
                result["accountStatus"][tpid] = "partial"
                message = f"TPID {tpid}: {error}"
                if message not in result["errors"]:
                    result["errors"].append(message)

    for tpid in tpids:
        conflict_count = len(attribution_conflicts[tpid])
        if conflict_count:
            result["accountStatus"][tpid] = "partial"
            result["errors"].append(
                f"TPID {tpid}: Quality warning: {conflict_count} opportunity record(s) have different "
                "roster TPIDs on parent and customer lookups; canonical parent attribution applied once."
            )
        ambiguous_count = sum(tpid in owners for owners in ambiguous_opportunities.values())
        ambiguous_count += sum(tpid in owners for owners in ambiguous_milestones.values())
        if ambiguous_count:
            result["accountStatus"][tpid] = "partial"
            result["errors"].append(
                f"TPID {tpid}: Quality warning: {ambiguous_count} record(s) changed canonical attribution "
                "during retrieval and were excluded to prevent double counting."
            )
        unknown_status_count = sum(row["active"] is None and row["tpid"] == tpid for row in milestones.values())
        if unknown_status_count:
            result["accountStatus"][tpid] = "partial"
            result["errors"].append(
                f"TPID {tpid}: Quality warning: {unknown_status_count} milestone(s) have missing or "
                "unrecognized source status; retained with active=null and excluded from candidate coverage."
            )
    # Won parents remain when needed to explain active or unclassified milestones.
    milestone_parents = {row["opportunityId"] for row in milestones.values()}
    result["opportunities"] = [
        row for identifier, row in opportunities.items()
        if row["state"] == "Open" or identifier in milestone_parents
    ]
    result["milestones"] = list(milestones.values())
    statuses = list(result["accountStatus"].values())
    result["status"] = ("complete" if all(value == "complete" for value in statuses)
                        else "unavailable" if all(value == "unavailable" for value in statuses)
                        else "partial")
    result["asOf"] = _now()
    return result
