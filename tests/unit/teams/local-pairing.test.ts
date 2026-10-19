import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { localConnectionVersion } from '../../../packages/common/contracts/local-connection.js'
import { LocalPairingAuthority } from '../../../apps/teams/src/local-pairing.js'
import type { NativeIdentity } from '../../../apps/teams/src/native-identity.js'

const origin = 'https://localhost:3978'
const verifier = () => randomBytes(32).toString('base64url')
function request(value = verifier()) {
  return { value, input: { contractVersion: localConnectionVersion, challenge: createHash('sha256').update(value).digest('base64url') } }
}
function fixture() {
  let now = Date.now()
  let identity: NativeIdentity | undefined = {
    account: 'local-owner@example.test', generation: 1,
    principal: { key: 'tenant:user', tenantId: '77777777-7777-4777-8777-777777777777', userId: '99999999-9999-4999-8999-999999999999', mode: 'live', environmentId: 'native', roles: ['TLC.Teams.User'], expiresAt: now + 3600_000 }
  }
  const authority = new LocalPairingAuthority(origin, () => identity, { now: () => now })
  return { authority, identity: () => identity, change: (value: NativeIdentity | undefined) => { identity = value }, advance: (ms: number) => { now += ms } }
}
describe('owner-approved local pairing', () => {
  it('gives no source authority before owner approval and exchanges once for an opaque capability', () => {
    const { authority } = fixture()
    const { input, value } = request()
    const pending = authority.begin(input, origin)
    const exchange = { contractVersion: localConnectionVersion, requestId: pending.requestId, verifier: value }
    expect(authority.exchange(exchange, origin).state).toBe('pending-owner-approval')
    expect(() => authority.authenticate('downstream.msx.jwt')).toThrow()
    authority.approve(pending.userCode)
    const paired = authority.exchange(exchange, origin)
    expect(paired.state).toBe('paired')
    if (paired.state !== 'paired') throw new Error('Pairing failed.')
    expect(paired.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authority.authenticate(paired.token).userId).toBe('99999999-9999-4999-8999-999999999999')
    expect(() => authority.exchange(exchange, origin)).toThrow()
    expect(JSON.stringify(authority.pending())).not.toContain(paired.token)
  })
  it('rejects forged authority, hostile origins and a wrong verifier', () => {
    const { authority } = fixture()
    const { input } = request()
    expect(() => authority.begin({ ...input, roles: ['TLC.Teams.Writer'] }, origin)).toThrow()
    expect(() => authority.begin(input, 'https://hostile.test')).toThrow()
    const pending = authority.begin(input, origin)
    authority.approve(pending.userCode)
    expect(() => authority.exchange({ contractVersion: localConnectionVersion, requestId: pending.requestId, verifier: verifier() }, origin)).toThrow()
    expect(() => authority.exchange({ contractVersion: localConnectionVersion, requestId: pending.requestId, verifier: verifier() }, 'https://hostile.test')).toThrow()
  })
  it('bounds pending requests and expires them', () => {
    const { authority, advance } = fixture()
    for (let index = 0; index < 3; index++) authority.begin(request().input, origin)
    expect(() => authority.begin(request().input, origin)).toThrow()
    advance(300_001)
    expect(authority.pending()).toEqual([])
    expect(authority.begin(request().input, origin).state).toBe('pending-owner-approval')
  })
  it('invalidates paired pages on account/generation changes and expiry', () => {
    const { authority, identity, change, advance } = fixture()
    const { input, value } = request()
    const pending = authority.begin(input, origin)
    authority.approve(pending.userCode)
    const paired = authority.exchange({ contractVersion: localConnectionVersion, requestId: pending.requestId, verifier: value }, origin)
    if (paired.state !== 'paired') throw new Error('Pairing failed.')
    const previous = identity()
    if (!previous) throw new Error('Missing fixture identity.')
    change({ ...previous, generation: 2 })
    expect(() => authority.authenticate(paired.token)).toThrow()
    change(previous)
    advance(900_001)
    expect(() => authority.authenticate(paired.token)).toThrow()
  })
  it('cannot approve without a connected owner or pair a different Teams identity', () => {
    const { authority, change } = fixture()
    const mismatch = authority.begin({ ...request().input, contextUserId: '88888888-8888-4888-8888-888888888888' }, origin)
    expect(() => authority.approve(mismatch.userCode)).toThrow()
    const pending = authority.begin(request().input, origin)
    change(undefined)
    expect(() => authority.approve(pending.userCode)).toThrow()
  })
  it('derives current roles from verified native identity instead of freezing old writer privileges', () => {
    const { authority, identity, change } = fixture()
    const { input, value } = request()
    const pending = authority.begin(input, origin)
    authority.approve(pending.userCode)
    const paired = authority.exchange({ contractVersion: localConnectionVersion, requestId: pending.requestId, verifier: value }, origin)
    if (paired.state !== 'paired') throw new Error('Pairing failed.')
    const previous = identity()
    if (!previous) throw new Error('Missing fixture identity.')
    change({ ...previous, principal: { ...previous.principal, roles: [] } })
    expect(() => authority.authenticate(paired.token)).toThrow()
  })
  it('changes the review boundary across native epochs and runtime restarts', () => {
    const { authority, identity, change } = fixture()
    const first = authority.reviewGeneration()
    const current = identity()
    if (!current) throw new Error('Missing native fixture.')
    change({ ...current, generation: current.generation + 1 })
    expect(authority.reviewGeneration()).not.toBe(first)
    expect(fixture().authority.reviewGeneration()).not.toBe(first)
  })
  it('does not count revoked native generations against the active page-session limit', () => {
    const { authority, identity, change } = fixture()
    const pair = () => {
      const { input, value } = request()
      const pending = authority.begin(input, origin)
      authority.approve(pending.userCode)
      return authority.exchange({ contractVersion: localConnectionVersion, requestId: pending.requestId, verifier: value }, origin)
    }
    for (let index = 0; index < 8; index++) expect(pair().state).toBe('paired')
    const previous = identity()
    if (!previous) throw new Error('Missing native fixture.')
    change({ ...previous, generation: previous.generation + 1 })
    expect(pair().state).toBe('paired')
  })
})
