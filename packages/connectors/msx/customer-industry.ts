const hlsVerticalLabels = ['Health Payor', 'Health Pharma', 'Health Provider', 'MedTech'] as const

export class CustomerIndustryScopeError extends Error {
    constructor(message: string) { super(message); this.name = 'CustomerIndustryScopeError' }
}

export function hlsVerticalValues(choices: ReadonlyArray<{ value: number; label: string }>): ReadonlySet<number> {
    const values = new Set<number>()
    for (const label of hlsVerticalLabels) {
        const matches = choices.filter((choice) => choice.label.trim().toLowerCase() === label.toLowerCase())
        if (matches.length !== 1 || !Number.isSafeInteger(matches[0]!.value)) {
            throw new CustomerIndustryScopeError('HLS customer classification metadata is missing, invalid or ambiguous. No unfiltered customer list was substituted.')
        }
        values.add(matches[0]!.value)
    }
    if (values.size !== hlsVerticalLabels.length) throw new CustomerIndustryScopeError('HLS vertical option values are ambiguous.')
    return values
}
