import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createSampleSellerDashboard } from '../../../packages/common/fixtures/seller-dashboard.js'
import {
    SellerDashboardSourceError, WindowsSellerDashboardConnector, type CollectorRunner
} from '../../../packages/connectors/common/seller-dashboard.js'

const execute = promisify(execFile)
const runWindowsCollectorSmoke = process.platform === 'win32' && process.env['TLC_RUN_SELLER_COLLECTOR_SMOKE'] === '1'

function processAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
        throw error
    }
}

describe('Windows protected seller-profile connector', () => {
    const roots: string[] = []
    afterEach(async () => {
        for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
    })
    async function connector(changes: {
        owner?: string; user?: string; profile?: string; platform?: NodeJS.Platform; stale?: boolean; payload?: unknown
    } = {}) {
        const root = await mkdtemp(join(tmpdir(), 'tlc-seller-connector-'))
        roots.push(root)
        await mkdir(join(root, 'scripts'))
        await Promise.all(['dashboard_config.py', 'manager_runner.py', 'secure_dashboard.py'].map((file) => writeFile(join(root, 'scripts', file), '')))
        const sample = createSampleSellerDashboard()
        const run = vi.fn<CollectorRunner>().mockResolvedValue(JSON.stringify(changes.payload ?? {
            report: sample.report, supplement: null, stale: changes.stale ?? false
        }))
        const instance = new WindowsSellerDashboardConnector({
            environment: {
                TLC_SELLER_DASHBOARD_SKILL_ROOT: root,
                TLC_SELLER_DASHBOARD_PROFILE: changes.profile ?? 'own-profile',
                TLC_SELLER_DASHBOARD_OWNER_EMAIL: changes.owner ?? 'seller@example.test'
            },
            platform: changes.platform ?? 'win32', resolveUserEmail: async () => changes.user ?? 'seller@example.test',
            run, now: () => new Date('2026-10-10T12:00:00Z')
        })
        return { instance, run, root }
    }

    it('reads only the normalized encrypted snapshot through a private no-shell process pipe', async () => {
        const { instance, run, root } = await connector()
        const result = await instance.read()
        expect(result).toMatchObject({ kind: 'snapshot', mode: 'live', state: 'ready', supplement: null })
        expect(run).toHaveBeenCalledOnce()
        const command = run.mock.calls[0]![0]
        expect(command.args.slice(-4)).toEqual([root, 'own-profile', 'get', ''])
        expect(command.args[0]).toBe('-B')
        expect(command.timeout).toBe(30_000)
        expect(command.args[2]).toContain('load_state(profile)')
        expect(command.args[2]).not.toContain('accessToken')
    })

    it('blocks identity mismatch and unsafe profiles before reading a private snapshot', async () => {
        const mismatched = await connector({ user: 'other@example.test' })
        await expect(mismatched.instance.read()).rejects.toMatchObject({ code: 'identity-mismatch' })
        expect(mismatched.run).not.toHaveBeenCalled()
        const unsafe = await connector({ profile: '../other-user' })
        await expect(unsafe.instance.read()).rejects.toMatchObject({ code: 'not-configured' })
        expect(unsafe.run).not.toHaveBeenCalled()
    })

    it('requires Windows and explicit configuration without searching or guessing a profile', async () => {
        const { instance, run } = await connector({ platform: 'linux' })
        await expect(instance.read()).rejects.toMatchObject({ code: 'unsupported-platform' })
        expect(run).not.toHaveBeenCalled()
        const unconfigured = new WindowsSellerDashboardConnector({
            environment: {}, platform: 'win32', resolveUserEmail: vi.fn()
        })
        await expect(unconfigured.read()).rejects.toMatchObject({ code: 'not-configured' })
    })

    it('retains source dates and marks failed-refresh or old snapshots stale', async () => {
        const { instance, run } = await connector({ stale: true })
        const retained = await instance.refresh('2026-10-10')
        expect(retained.state).toBe('stale')
        expect(retained.report.generatedAt).toBe('2026-10-10T09:00:00.000Z')
        expect(run.mock.calls[0]![0].args.at(-2)).toBe('refresh')
        expect(run.mock.calls[0]![0].args.at(-1)).toBe('2026-10-10')
        const old = createSampleSellerDashboard()
        old.report.sources.earnings.refreshedAt = '2026-09-01T00:00:00Z'
        const stale = await connector({ payload: { report: old.report, supplement: null, stale: false } })
        expect((await stale.instance.read()).state).toBe('stale')
    })

    it('rejects malformed/private source shapes with a public error, never payload text', async () => {
        const payload = { report: { secret: 'never-echo-private-value' }, supplement: null, stale: false }
        const { instance } = await connector({ payload })
        try {
            await instance.read()
            throw new Error('Expected invalid source rejection.')
        } catch (error) {
            expect(error).toBeInstanceOf(SellerDashboardSourceError)
            expect(String(error)).not.toContain('never-echo-private-value')
            expect(error).toMatchObject({ code: 'invalid-snapshot' })
        }
    })

    it.each(['read', 'refresh'] as const)('rejects incomplete account metrics during protected-source %s', async (operation) => {
        const { report } = createSampleSellerDashboard()
        report.accounts[0]!.metrics.pop()
        const { instance } = await connector({ payload: { report, supplement: null, stale: false } })
        const result = operation === 'read' ? instance.read() : instance.refresh('2026-10-10')
        await expect(result).rejects.toMatchObject({ code: 'invalid-snapshot' })
    })

    it('does not accept a success-shaped refresh for a different confirmed reporting date', async () => {
        const { instance } = await connector()
        await expect(instance.refresh('2026-10-11')).rejects.toMatchObject({ code: 'invalid-snapshot' })
    })

    async function collectorSmoke(timeout: boolean) {
        const configured = await connector()
        const snapshot = createSampleSellerDashboard()
        await writeFile(join(configured.root, 'report.json'), JSON.stringify(snapshot.report))
        await writeFile(join(configured.root, 'scripts', 'dashboard_config.py'), `
import json
from pathlib import Path
def load_state(profile):
    return {"dashboard": json.loads((Path(__file__).parent.parent / "report.json").read_text()), "lastRun": {"status": "updated"}}
`)
        await writeFile(join(configured.root, 'scripts', 'manager_runner.py'), `
import json, os, subprocess, sys, time
from pathlib import Path
def main(arguments):
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(8)"])
    (Path(__file__).parent.parent / "owned-processes.json").write_text(json.dumps([os.getpid(), child.pid]))
    ${timeout ? 'time.sleep(30)' : 'pass'}
    return 0
`)
        await configured.instance.refresh('2026-10-10')
        const command = configured.run.mock.calls[0]![0]
        const operation = execute(command.executable, command.args, {
            windowsHide: true, timeout: timeout ? 3000 : 10_000, maxBuffer: 64 * 1024 * 1024
        })
        if (timeout) await expect(operation).rejects.toThrow()
        else expect(JSON.parse((await operation).stdout).report.official.weightedAttainment).toBe(78)
        const pids = z.array(z.number().int().positive()).length(2).parse(
            JSON.parse(await readFile(join(configured.root, 'owned-processes.json'), 'utf8'))
        )
        for (const pid of pids) {
            await expect.poll(() => processAlive(pid), { timeout: 2000 }).toBe(false)
        }
    }

    it.runIf(runWindowsCollectorSmoke)('closes owned collector descendants and inherited output pipes on normal completion', async () => {
        await collectorSmoke(false)
    }, 15_000)

    it.runIf(runWindowsCollectorSmoke)('kills only the owned collector job on parent timeout', async () => {
        await collectorSmoke(true)
    }, 15_000)
})
