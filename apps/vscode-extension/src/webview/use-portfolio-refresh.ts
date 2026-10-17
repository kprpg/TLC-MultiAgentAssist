import { useCallback, useState } from 'react'

export function usePortfolioRefresh() {
    const [revision, setRevision] = useState(0)
    const refresh = useCallback(() => setRevision((current) => current + 1), [])
    return { revision, refresh }
}
