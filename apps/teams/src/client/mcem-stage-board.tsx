import type { McemResponse, Opportunity } from '../../../../packages/common/contracts/index.js'
import { McemStageColumns } from '../../../shared/mcem-stage-board.js'

export function TeamsMcemStageBoard({ accountName, opportunities, selectedId, evaluation, onSelect }: {
  accountName: string; opportunities: readonly Opportunity[]; selectedId: string
  evaluation: McemResponse | undefined; onSelect(id: string): void
}) {
  return <section className="teams-mcem-board" aria-label="MCEM Stage Management">
    <h3>MCEM Stage Management</h3>
    <p className="muted">Account opportunities by recorded stage and accountable role. Select a card to inspect its evidence and review an adjacent stage change.</p>
    <div className="record-table-wrap" role="region" aria-label="MCEM stage board" tabIndex={0}>
      <McemStageColumns label={`MCEM stages for ${accountName}`} opportunities={opportunities} renderOpportunity={(item) => {
        const result = item.id === selectedId ? evaluation : undefined
        const met = result?.criteria.filter((criterion) => criterion.status === 'met').length ?? 0
        const total = result?.criteria.length ?? 0
        return <article className={`mcem-card${item.id === selectedId ? ' selected' : ''}`} role="button" tabIndex={0}
          aria-label={item.name} aria-pressed={item.id === selectedId}
          onClick={() => onSelect(item.id)} onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(item.id) }
          }}>
          <strong>{item.name}</strong><span>{item.owner ?? 'Unassigned'}</span>
          <span className={total > 0 && met === total ? 'gates-met' : 'gates-open'}>{total ? `${met}/${total} exit criteria met` : 'Not evaluated'}</span>
        </article>
      }} />
    </div>
  </section>
}
