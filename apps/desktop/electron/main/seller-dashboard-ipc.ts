import type { SellerDashboardHost } from '../../../../packages/orchestrator/seller-dashboard.js'

export const sellerDashboardIpcChannel = 'tlc:seller-dashboard'

export function createSellerDashboardIpcHandler(host: SellerDashboardHost) {
    return (request: unknown) => host.invoke(request)
}
