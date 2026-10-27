import { useState, type PropsWithChildren } from 'react'
import { FullScreenMaximize20Regular, FullScreenMinimize20Regular } from '@fluentui/react-icons'
import './guidance-pane.css'

export function GuidancePaneToggle({ maximized, onToggle, controls, className = '' }: {
    maximized: boolean
    onToggle(): void
    controls: string
    className?: string
}) {
    const label = `${maximized ? 'Restore' : 'Maximize'} Guidance pane`
    return <button type="button" className={`guidance-pane-toggle ${className}`} onClick={onToggle}
        aria-label={label} aria-pressed={maximized} aria-controls={controls} title={label}>
        {maximized ? <FullScreenMinimize20Regular /> : <FullScreenMaximize20Regular />}
    </button>
}

export function GuidanceWorkbenchPane({ id, className, hidden = false, children }: PropsWithChildren<{
    id: string
    className: string
    hidden?: boolean
}>) {
    const [maximized, setMaximized] = useState(false)
    const contentId = `${id}-content`
    return <section id={id} className={`${className} guidance-pane-frame${maximized && !hidden ? ' guidance-maximized' : ''}`}
        hidden={hidden} aria-label="Opportunity details">
        <header className="guidance-pane-toolbar">
            <strong>Guidance</strong>
            <div role="group" aria-label="Guidance pane controls">
                <GuidancePaneToggle maximized={maximized} onToggle={() => setMaximized((current) => !current)} controls={contentId} />
            </div>
        </header>
        <div id={contentId}>{children}</div>
    </section>
}
