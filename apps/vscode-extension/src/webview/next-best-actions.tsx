import type { ReactElement } from 'react'
import type { McemView } from './view-types.js'

export function NextBestActions({
    evaluation,
    loading,
    error,
    onRun
}: {
    evaluation?: McemView | undefined
    loading: boolean
    error?: string | undefined
    onRun(): void
}): ReactElement {
    const recommendations = evaluation?.recommendations ?? []

    return (
        <aside id="next-best-actions-panel" className="pane next-best-actions-pane" aria-labelledby="next-best-actions-title">
            <div className="next-best-actions-heading">
                <div>
                    <span className="eyebrow">ROLE BASED</span>
                    <h3 id="next-best-actions-title">Next Best Actions</h3>
                </div>
                <span className="badge" aria-label={`${recommendations.length} recommendations`}>{recommendations.length}</span>
            </div>
            {evaluation && (
                <p className="muted">
                    {evaluation.evidenceBasedStage > evaluation.recordedStage
                        ? `Confirm completed exit criteria before progressing to Stage ${evaluation.evidenceBasedStage}.`
                        : `Resolve these gaps before treating this opportunity as Stage ${evaluation.recordedStage} ready.`}
                </p>
            )}
            {recommendations.length > 0 ? (
                <div className="next-best-actions-list">
                    {recommendations.map((recommendation, index) => (
                        <article className="next-best-action" key={recommendation.id}>
                            <div className="next-best-action-meta">
                                <span>{index + 1}</span>
                                <strong>{recommendation.ownerRole}</strong>
                            </div>
                            <h4>{recommendation.action}</h4>
                            <small>{recommendation.confidence} confidence</small>
                        </article>
                    ))}
                </div>
            ) : (
                <div className="next-best-actions-empty">
                    <p className="muted">Run MCEM Coach to generate evidence-based, role-owned actions.</p>
                    <button className="primary" disabled={loading} onClick={onRun}>{loading ? 'Evaluating...' : 'Run MCEM Coach'}</button>
                    {error && <p className="error">{error}</p>}
                </div>
            )}
            <p className="read-only-note">Read-only preview. Review recommendations before acting.</p>
        </aside>
    )
}