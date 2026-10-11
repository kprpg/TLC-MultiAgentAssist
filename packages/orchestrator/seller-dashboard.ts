import {
    sellerDashboardContractVersion, sellerDashboardRequestSchema, sellerDashboardResponseSchema,
    type SellerDashboardResponse
} from '../common/contracts/seller-dashboard.js'
import { createSampleSellerDashboard } from '../common/fixtures/seller-dashboard.js'
import {
    SellerDashboardSourceError, WindowsSellerDashboardConnector,
    type SellerDashboardConnector, type WindowsSellerDashboardOptions
} from '../connectors/common/seller-dashboard.js'

export interface SellerDashboardHost {
    invoke(request: unknown): Promise<SellerDashboardResponse>
}

export class SharedSellerDashboardHost implements SellerDashboardHost {
    constructor(private readonly connector: SellerDashboardConnector) { }

    async invoke(rawRequest: unknown): Promise<SellerDashboardResponse> {
        const request = sellerDashboardRequestSchema.parse(rawRequest)
        try {
            const result = request.operation === 'get'
                ? await this.connector.read()
                : await this.connector.refresh(request.asOf)
            return sellerDashboardResponseSchema.parse(result)
        } catch (error) {
            if (!(error instanceof SellerDashboardSourceError)) throw error
            return sellerDashboardResponseSchema.parse({
                contractVersion: sellerDashboardContractVersion, kind: 'unavailable',
                mode: 'live', code: error.code, message: error.message
            })
        }
    }
}

export function createSellerDashboardHost(
    options: WindowsSellerDashboardOptions & { mode: 'sample' | 'live'; allowLocalProfile?: boolean }
): SellerDashboardHost {
    if (options.mode === 'sample') {
        return new SharedSellerDashboardHost({
            read: async () => createSampleSellerDashboard(),
            refresh: async () => createSampleSellerDashboard()
        })
    }
    if (options.allowLocalProfile === false) {
        const denied = async (): Promise<never> => {
            throw new SellerDashboardSourceError('hosted-profile-denied',
                'Hosted multi-user Web cannot read a server user’s private earnings profile. Use a configured local Windows host or an identity-scoped earnings provider.')
        }
        return new SharedSellerDashboardHost({ read: denied, refresh: denied })
    }
    return new SharedSellerDashboardHost(new WindowsSellerDashboardConnector(options))
}
