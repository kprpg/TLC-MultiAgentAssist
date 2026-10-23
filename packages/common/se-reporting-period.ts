import { seReportPeriodSchema } from './contracts/se-reporting.js'

export function seReportingDates(period: string) {
    seReportPeriodSchema.parse(period)
    const year = Number(period.slice(0, 4))
    const month = Number(period.slice(5))
    const fiscalYear = month >= 7 ? year + 1 : year
    return {
        start: `${period}-01`, end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
        fiscal: { year: fiscalYear, start: `${fiscalYear - 1}-07-01`, end: `${fiscalYear}-06-30` }
    }
}
