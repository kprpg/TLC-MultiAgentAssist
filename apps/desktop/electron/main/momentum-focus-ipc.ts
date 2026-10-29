import { momentumFocusRequestSchema, momentumFocusResponseSchema } from '../../../../packages/common/contracts/momentum-focus.js'
import type { MomentumFocusHost } from '../../../../packages/orchestrator/momentum-focus/host.js'

export const momentumFocusIpcChannel = 'tlc:momentum-focus'
export function createMomentumFocusIpcHandler(host: MomentumFocusHost) {
    return async (request: unknown) => momentumFocusResponseSchema.parse(await host.invoke(momentumFocusRequestSchema.parse(request)))
}
