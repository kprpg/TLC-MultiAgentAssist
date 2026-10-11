"""Windows-user-encrypted snapshots and a private, loopback-only viewer."""
import ctypes
from ctypes import wintypes
from contextlib import contextmanager
import errno
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import stat
import tempfile
import threading
import time
from urllib.parse import urlparse
import webbrowser


STATE_FILE = "profile-state.dpapi"


class ProfileBusyError(ValueError):
    pass


class DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def protect(data, decrypt=False):
    if os.name != "nt":
        raise OSError("This confidential dashboard requires Windows user encryption")
    buffer = ctypes.create_string_buffer(data)
    source = DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    output = DataBlob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes = [wintypes.HLOCAL]
    kernel.LocalFree.restype = wintypes.HLOCAL
    if decrypt:
        function = crypt.CryptUnprotectData
        function.argtypes = [ctypes.POINTER(DataBlob), ctypes.c_void_p, ctypes.c_void_p,
                             ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD,
                             ctypes.POINTER(DataBlob)]
        args = (ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output))
    else:
        function = crypt.CryptProtectData
        function.argtypes = [ctypes.POINTER(DataBlob), wintypes.LPCWSTR, ctypes.c_void_p,
                             ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD,
                             ctypes.POINTER(DataBlob)]
        args = (ctypes.byref(source), "Private attainment snapshot", None, None, None,
                1, ctypes.byref(output))
    function.restype = wintypes.BOOL
    if not function(*args):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        kernel.LocalFree(output.pbData)


def validate_profile(profile):
    if isinstance(profile, dict):
        profile = profile.get("profile")
    elif not isinstance(profile, str):
        profile = getattr(profile, "profile", None)
    if (not isinstance(profile, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,47}", profile)
            or profile in {"con", "prn", "aux", "nul"}
            or re.fullmatch(r"(?:com|lpt)[0-9]", profile)):
        raise ValueError("--profile must be a safe lowercase slug of 1-48 letters, digits, underscores or hyphens.")
    return profile


def _safe_state_path(path):
    if (not path.is_absolute() or ".." in path.parts
            or path == Path(path.anchor) or any(
                part.casefold() in {"quotaattainment", ".ssh", ".azure", ".msx-mcp"}
                for part in path.parts)):
        raise ValueError("Dashboard state requires a dedicated absolute directory, not a legacy or sensitive path.")
    resolved = path.resolve()
    if any(part.casefold() in {"quotaattainment", ".ssh", ".azure", ".msx-mcp"}
           for part in resolved.parts):
        raise ValueError("Dashboard state cannot resolve into legacy or sensitive storage.")
    try:
        info = path.lstat()
    except FileNotFoundError:
        return path
    if (path.is_symlink()
            or getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT):
        raise ValueError("Dashboard state cannot itself be a symbolic link or reparse point.")
    return path


def private_directory(profile="default", *, create=True):
    profile = validate_profile(profile)
    override = os.environ.get("MCAPS_DASHBOARD_STATE_DIR")
    if override is not None:
        if not override.strip():
            raise ValueError("MCAPS_DASHBOARD_STATE_DIR must be an explicit absolute local directory.")
        base = _safe_state_path(Path(override))
    else:
        local = os.environ.get("LOCALAPPDATA")
        if not local:
            raise OSError("LOCALAPPDATA is unavailable; Windows per-user storage is required.")
        base = _safe_state_path(Path(local) / "MicrosoftScout" / "MCAPSSellerPerformanceDashboard")
    root = _safe_state_path(base / profile)
    if create:
        root.mkdir(parents=True, exist_ok=True)
    return root


@contextmanager
def profile_lock(profile="default"):
    """Serialize manual and scheduled mutations for the same Windows profile."""
    if os.name != "nt":
        raise OSError("Profile transactions require Windows.")
    import msvcrt

    path = _safe_state_path(private_directory(profile) / "transaction.lock")
    with path.open("a+b") as stream:
        if stream.seek(0, os.SEEK_END) == 0:
            stream.write(b"\0")
            stream.flush()
        stream.seek(0)
        try:
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as error:
            if error.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                raise ProfileBusyError("Another setup, refresh or rebuild is active for this profile; retry after it finishes.") from None
            raise
        try:
            yield
        finally:
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)


def _private_target(name, profile, *, create):
    if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9-]*\.dpapi", name):
        raise ValueError("Private state filenames must be simple DPAPI filenames.")
    return _safe_state_path(private_directory(profile, create=create) / name)


def save_private(name, value, profile="default"):
    target = _private_target(name, profile, create=True)
    root = target.parent
    encrypted = protect(json.dumps(value, ensure_ascii=True, allow_nan=False).encode("utf-8"))
    fd, temporary = tempfile.mkstemp(prefix=".pending-", dir=root)
    try:
        with os.fdopen(fd, "wb") as file:
            file.write(encrypted)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return target


def load_private(name, profile="default"):
    target = _private_target(name, profile, create=False)
    return json.loads(protect(target.read_bytes(), decrypt=True))


def render(template, model):
    text = Path(template).read_text(encoding="utf-8")
    if text.count("__DASHBOARD_DATA__") != 1:
        raise ValueError("Dashboard template must contain exactly one data placeholder")
    payload = json.dumps(model, ensure_ascii=True, allow_nan=False)
    payload = payload.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return text.replace("__DASHBOARD_DATA__", payload).encode("utf-8")


def serve(template, open_browser=True, profile="default"):
    profile = validate_profile(profile)
    state = load_private(STATE_FILE, profile)
    if not isinstance(state.get("dashboard"), dict):
        raise ValueError("No successful dashboard snapshot for this profile; run --refresh first.")
    render(template, state["dashboard"])
    token = secrets.token_urlsafe(32)
    last_request = [time.monotonic()]

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            # Host validation prevents DNS rebinding; the path capability blocks cross-origin reads.
            if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
                self.send_error(403)
                return
            path = urlparse(self.path).path
            if not secrets.compare_digest(path, "/" + token):
                self.send_error(404)
                return
            if self.headers.get("Origin") not in (None, f"http://127.0.0.1:{self.server.server_port}"):
                self.send_error(403)
                return
            last_request[0] = time.monotonic()
            try:
                state = load_private(STATE_FILE, profile)
                model = state["dashboard"]
                run_status = state.get("lastRun") or {}
                if run_status.get("status") in {"failed", "setup-pending-refresh"}:
                    model["warnings"].insert(
                        0, "The latest setup or refresh has not produced a new snapshot. "
                           "Showing the dated last successful snapshot, not current data."
                    )
                body = render(template, model)
            except (OSError, ValueError, KeyError):
                self.send_error(503, "Dashboard unavailable; run the refresh on this Windows account.")
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy",
                             "default-src 'none'; script-src 'unsafe-inline'; "
                             "style-src 'unsafe-inline'; img-src data:; "
                             "connect-src 'none'; frame-ancestors 'none'; base-uri 'none'")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    url = f"http://127.0.0.1:{server.server_port}/{token}"
    save_private("viewer.dpapi", {"url": url, "pid": os.getpid()}, profile)

    def expire():
        while time.monotonic() - last_request[0] < 3600:
            time.sleep(30)
        server.shutdown()

    threading.Thread(target=expire, daemon=True).start()
    print(json.dumps({"status": "ready", "url": url, "pid": os.getpid()}), flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    finally:
        server.server_close()
