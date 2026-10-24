import { describe, expect, it } from 'vitest'
import { createWebSeReportingResolver } from '../../../apps/web/src/runtime.js'

const user = (index: number) => ({ userEmail: `user${index}@example.com` }) as never

describe('Web SE reporting resolver', () => {
    it('admits new users after earlier sessions have expired', () => {
        let clock = 0
        const resolve = createWebSeReportingResolver('sample', undefined, () => clock)
        for (let index = 0; index < 50; index += 1) resolve(user(index))
        expect(() => resolve(user(50))).toThrow('limit')
        clock = 3_600_001
        expect(() => resolve(user(50))).not.toThrow()
    })
})
