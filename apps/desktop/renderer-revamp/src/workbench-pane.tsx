import { useState, type PropsWithChildren } from 'react'
import { ChevronDoubleLeft20Regular, ChevronDoubleRight20Regular, FullScreenMaximize20Regular, FullScreenMinimize20Regular } from '@fluentui/react-icons'

export function WorkbenchPane({ collapsed, mobileActive, stageBoardActive, onToggleCollapsed, children }: PropsWithChildren<{
    collapsed: boolean
    mobileActive: boolean
    stageBoardActive: boolean
    onToggleCollapsed(): void
}>) {
    const [maximized, setMaximized] = useState(false)

    return <section className={`center-pane ${collapsed ? 'guidance-collapsed' : ''} ${mobileActive ? 'mobile-active' : ''} ${stageBoardActive ? 'stage-board-active' : ''} ${maximized && !collapsed ? 'guidance-maximized' : ''}`} aria-label="Opportunity workbench">
        <div className="workbench-pane-toolbar desktop-only">
            {!collapsed && <strong>Guidance</strong>}
            <div className="workbench-pane-controls" role="group" aria-label="Guidance pane controls">
                {!collapsed && <button
                    type="button"
                    className="icon-button"
                    onClick={() => setMaximized((current) => !current)}
                    aria-label={`${maximized ? 'Restore' : 'Maximize'} Guidance pane`}
                    aria-pressed={maximized}
                    title={`${maximized ? 'Restore' : 'Maximize'} Guidance pane`}
                >{maximized ? <FullScreenMinimize20Regular /> : <FullScreenMaximize20Regular />}</button>}
                <button
                    type="button"
                    className="icon-button"
                    onClick={() => {
                        setMaximized(false)
                        onToggleCollapsed()
                    }}
                    aria-label={`${collapsed ? 'Expand' : 'Collapse'} Guidance pane`}
                    aria-expanded={!collapsed}
                    aria-controls="guidance-pane-content"
                    title={`${collapsed ? 'Expand' : 'Collapse'} Guidance pane`}
                >{collapsed ? <ChevronDoubleRight20Regular /> : <ChevronDoubleLeft20Regular />}</button>
            </div>
        </div>
        <div id="guidance-pane-content" className="workbench-pane-content">{children}</div>
    </section>
}
