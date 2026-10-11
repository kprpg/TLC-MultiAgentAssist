import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import {
    sellerDashboardContractVersion, sellerDashboardSnapshotSchema,
    type SellerDashboardResponse, type SellerDashboardSnapshot
} from '../../common/contracts/seller-dashboard.js'

export interface SellerDashboardConnector {
    read(): Promise<SellerDashboardSnapshot>
    refresh(asOf?: string): Promise<SellerDashboardSnapshot>
}

type UnavailableCode = Extract<SellerDashboardResponse, { kind: 'unavailable' }>['code']

export class SellerDashboardSourceError extends Error {
    constructor(readonly code: UnavailableCode, message: string) {
        super(message)
        this.name = 'SellerDashboardSourceError'
    }
}

export interface CollectorCommand {
    executable: string
    args: string[]
    timeout: number
}

export type CollectorRunner = (command: CollectorCommand) => Promise<string>

const collectorBridge = `
import contextlib, io, json, pathlib, sys
root, profile, action, as_of = sys.argv[1:5]
sys.path.insert(0, str(pathlib.Path(root) / "scripts"))
try:
    from dashboard_config import load_state
    result = 0
    if action == "refresh":
        from manager_runner import main
        arguments = ["--refresh", "--profile", profile]
        if as_of:
            arguments.extend(["--as-of", as_of])
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = main(arguments)
    state = load_state(profile)
    if not state.get("dashboard"):
        raise ValueError("No successful dashboard")
    status = state.get("lastRun", {}).get("status")
    print(json.dumps({
        "report": state["dashboard"],
        "supplement": state.get("sellerDashboardSupplement"),
        "stale": result != 0 or status in ("failed", "setup-pending-refresh")
    }, ensure_ascii=True, allow_nan=False))
except (OSError, ValueError, KeyError, TypeError, ImportError):
    print("The protected seller profile could not be loaded. Complete setup and a successful manual refresh.", file=sys.stderr)
    sys.exit(2)
`.trim()

const isolatedCollectorBridge = `
import ctypes, subprocess, sys, threading
from ctypes import wintypes

class BasicLimits(ctypes.Structure):
    _fields_ = [
        ("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
        ("flags", wintypes.DWORD), ("min_working_set", ctypes.c_size_t),
        ("max_working_set", ctypes.c_size_t), ("active_processes", wintypes.DWORD),
        ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD),
        ("scheduling", wintypes.DWORD)
    ]

class IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in (
        "read_operations", "write_operations", "other_operations",
        "read_bytes", "write_bytes", "other_bytes"
    )]

class ExtendedLimits(ctypes.Structure):
    _fields_ = [
        ("basic", BasicLimits), ("io", IoCounters),
        ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
        ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t)
    ]

kernel = ctypes.WinDLL("kernel32", use_last_error=True)
kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
kernel.CreateJobObjectW.restype = wintypes.HANDLE
kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
kernel.SetInformationJobObject.restype = wintypes.BOOL
kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel.OpenProcess.restype = wintypes.HANDLE
kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
kernel.AssignProcessToJobObject.restype = wintypes.BOOL
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
kernel.CloseHandle.restype = wintypes.BOOL
job = kernel.CreateJobObjectW(None, None)
worker = None
try:
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    limits = ExtendedLimits()
    limits.basic.flags = 0x00002000
    if not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
        raise ctypes.WinError(ctypes.get_last_error())
    code = ${JSON.stringify('import sys\nif sys.stdin.buffer.read(1) != b"1":\n    sys.exit(3)\n' + collectorBridge)}
    worker = subprocess.Popen(
        [sys.executable, "-B", "-c", code, *sys.argv[1:]],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW
    )
    process = kernel.OpenProcess(0x0101, False, worker.pid)
    try:
        if not process or not kernel.AssignProcessToJobObject(job, process):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        if process:
            kernel.CloseHandle(process)
    failures = []
    def pump(source, target):
        try:
            for chunk in iter(lambda: source.read(65536), b""):
                target.write(chunk)
                target.flush()
        except (OSError, ValueError) as error:
            failures.append(error)
            if worker.poll() is None:
                worker.terminate()
    threads = [
        threading.Thread(target=pump, args=(worker.stdout, sys.stdout.buffer), daemon=True),
        threading.Thread(target=pump, args=(worker.stderr, sys.stderr.buffer), daemon=True)
    ]
    for thread in threads:
        thread.start()
    # Collection starts only after job assignment; exit closes inherited child pipes.
    worker.stdin.write(b"1")
    worker.stdin.close()
    result = worker.wait()
    if not kernel.CloseHandle(job):
        raise ctypes.WinError(ctypes.get_last_error())
    job = None
    for thread in threads:
        thread.join()
    worker.stdout.close()
    worker.stderr.close()
    if failures:
        raise OSError("Collector output channel failed")
    sys.exit(result)
except OSError:
    if worker is not None and worker.poll() is None:
        worker.terminate()
        worker.communicate()
    print("Windows could not isolate the protected seller collector.", file=sys.stderr)
    sys.exit(2)
finally:
    if job:
        kernel.CloseHandle(job)
`.trim()

const runCollector: CollectorRunner = (command) => new Promise((resolve, reject) => {
    execFile(command.executable, command.args, {
        windowsHide: true, timeout: command.timeout, maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
    }, (error, stdout) => {
        if (error) {
            reject(new SellerDashboardSourceError('runtime-failed',
                'The protected seller collector failed or timed out. Verify Python, the trusted runtime, profile setup and authorized access.'))
        } else resolve(stdout)
    })
})

export interface WindowsSellerDashboardOptions {
    environment?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
    resolveUserEmail(): Promise<string | undefined>
    run?: CollectorRunner
    now?: () => Date
}

export class WindowsSellerDashboardConnector implements SellerDashboardConnector {
    constructor(private readonly options: WindowsSellerDashboardOptions) { }

    read(): Promise<SellerDashboardSnapshot> {
        return this.collect('get')
    }

    refresh(asOf?: string): Promise<SellerDashboardSnapshot> {
        return this.collect('refresh', asOf)
    }

    private async collect(operation: 'get' | 'refresh', asOf?: string): Promise<SellerDashboardSnapshot> {
        if ((this.options.platform ?? process.platform) !== 'win32') {
            throw new SellerDashboardSourceError('unsupported-platform',
                'The supplied collector requires Windows user encryption. Use a configured local Windows host; no live sample fallback is permitted.')
        }
        const environment = this.options.environment ?? process.env
        const root = environment['TLC_SELLER_DASHBOARD_SKILL_ROOT']?.trim()
        const profile = environment['TLC_SELLER_DASHBOARD_PROFILE']?.trim()
        const owner = environment['TLC_SELLER_DASHBOARD_OWNER_EMAIL']?.trim().toLowerCase()
        if (!root || !isAbsolute(root) || root.split(/[\\/]/).includes('..') ||
            !profile || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(profile) ||
            /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(profile) ||
            !owner || owner.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner)) {
            throw new SellerDashboardSourceError('not-configured',
                'Configure a trusted skill root, an explicit profile and its owner email after onboarding with your own MSX Earnings Quota by Accounts CSV.')
        }
        const user = (await this.options.resolveUserEmail())?.trim().toLowerCase()
        if (!user || user !== owner) {
            throw new SellerDashboardSourceError('identity-mismatch',
                'The current authenticated seller does not match the configured earnings-profile owner. No private data was read.')
        }
        try {
            await Promise.all(['dashboard_config.py', 'manager_runner.py', 'secure_dashboard.py']
                .map((file) => access(join(root, 'scripts', file))))
        } catch (error) {
            if (error instanceof Error && 'code' in error && ['ENOENT', 'EACCES', 'EPERM'].includes(String(error.code))) {
                throw new SellerDashboardSourceError('not-configured', 'The explicitly configured trusted dashboard runtime is unavailable.')
            }
            throw error
        }
        const output = await (this.options.run ?? runCollector)({
            executable: environment['TLC_SELLER_DASHBOARD_PYTHON']?.trim() || 'python',
            args: ['-B', '-c', isolatedCollectorBridge, root, profile, operation, asOf ?? ''],
            timeout: operation === 'get' ? 30_000 : 480_000
        })
        let payload: unknown
        try {
            payload = JSON.parse(output)
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new SellerDashboardSourceError('invalid-snapshot', 'The protected collector returned an invalid dashboard envelope.')
            }
            throw error
        }
        if (!payload || typeof payload !== 'object' || !('report' in payload) ||
            !('supplement' in payload) || !('stale' in payload) || typeof payload.stale !== 'boolean') {
            throw new SellerDashboardSourceError('invalid-snapshot', 'The protected collector returned an unsupported dashboard envelope.')
        }
        const parsed = sellerDashboardSnapshotSchema.safeParse({
            contractVersion: sellerDashboardContractVersion, kind: 'snapshot', mode: 'live',
            state: payload.stale ? 'stale' : 'ready',
            message: payload.stale
                ? 'The last successful protected snapshot is retained. The latest refresh/setup did not establish current reconciled data.'
                : 'Read from this seller’s Windows-user-encrypted snapshot. Reloading this view performs no live source calls.',
            report: payload.report, supplement: payload.supplement
        })
        if (!parsed.success) {
            throw new SellerDashboardSourceError('invalid-snapshot',
                'The protected dashboard failed schema or monetary reconciliation checks. Verify the supported USD plan and complete source data.')
        }
        const snapshot = parsed.data
        if (operation === 'refresh' && !payload.stale && asOf && snapshot.report.period.today !== asOf) {
            throw new SellerDashboardSourceError('invalid-snapshot',
                'The refreshed dashboard does not match the confirmed reporting date. No replacement data was accepted.')
        }
        const refreshedAt = snapshot.report.sources.earnings.refreshedAt
        const now = (this.options.now ?? (() => new Date()))()
        const ageMs = refreshedAt ? now.getTime() - Date.parse(refreshedAt) : Infinity
        const asOfAgeMs = Date.parse(now.toISOString().slice(0, 10)) - Date.parse(snapshot.report.period.today)
        if (snapshot.report.sources.earnings.status === 'stale' || ageMs > 2 * 86_400_000 || asOfAgeMs > 2 * 86_400_000) {
            snapshot.state = 'stale'
            snapshot.message = 'Official earnings are stale or undated. The displayed source timestamps are unchanged; reload does not refresh source data.'
        }
        return snapshot
    }
}
