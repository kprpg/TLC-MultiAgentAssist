import { Fragment, type ReactNode } from 'react'
import { mcemStages } from './mcem-stages.js'
import './mcem-stage-board.css'

export function McemStageColumns<T extends { id: string; recordedStage: number }>({ label, opportunities, renderOpportunity, dropTargetStage }: {
  label: string
  opportunities: readonly T[]
  renderOpportunity(opportunity: T, stage: (typeof mcemStages)[number]): ReactNode
  dropTargetStage?: number | null
}) {
  return <div className="mcem-board" aria-label={label}>
    {mcemStages.map((stage) => <section key={stage.id}
      className={`mcem-column${dropTargetStage === stage.id ? ' drop-target' : ''}`}
      aria-label={`Stage ${stage.id}: ${stage.name}`} data-stage={stage.id}>
      <header><span>Stage {stage.id}</span><strong>{stage.name}</strong><small>{stage.role}</small></header>
      <div className="mcem-column-cards">
        {opportunities.filter((item) => item.recordedStage === stage.id).map((item) => <Fragment key={item.id}>{renderOpportunity(item, stage)}</Fragment>)}
      </div>
    </section>)}
  </div>
}
