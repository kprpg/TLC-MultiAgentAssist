import { useId, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { RecordTooltipContent } from './portfolio-record-details.js'

type TooltipPosition = {
    placement: 'above' | 'below'
    style: CSSProperties
}

export function RecordTooltip({
    children,
    title,
    details
}: RecordTooltipContent & { children: (tooltipId: string) => ReactElement }): ReactElement {
    const tooltipId = useId()
    const anchorRef = useRef<HTMLSpanElement>(null)
    const [position, setPosition] = useState<TooltipPosition | undefined>(undefined)

    const showTooltip = (): void => {
        const bounds = anchorRef.current?.getBoundingClientRect()
        if (!bounds) return

        const viewportWidth = document.documentElement.clientWidth
        const halfTooltipWidth = Math.min(150, Math.max(0, (viewportWidth - 16) / 2))
        const centeredLeft = bounds.left + (bounds.width / 2)
        const left = Math.min(Math.max(centeredLeft, halfTooltipWidth + 8), viewportWidth - halfTooltipWidth - 8)
        const placement = bounds.top < 150 ? 'below' : 'above'
        setPosition({
            placement,
            style: {
                left,
                top: placement === 'below' ? bounds.bottom : bounds.top
            }
        })
    }

    const hideTooltip = (): void => setPosition(undefined)

    return (
        <span
            ref={anchorRef}
            className="record-tooltip-anchor"
            onMouseEnter={showTooltip}
            onMouseLeave={hideTooltip}
            onFocus={showTooltip}
            onBlur={hideTooltip}
            onKeyDown={(event) => {
                if (event.key === 'Escape') hideTooltip()
            }}
        >
            {children(tooltipId)}
            {position && createPortal(
                <span
                    id={tooltipId}
                    className={`record-hover-tooltip ${position.placement}`}
                    role="tooltip"
                    style={position.style}
                >
                    <strong>{title}</strong>
                    {details.map((detail) => (
                        <span key={detail.label}><em>{detail.label}:</em> {detail.value}</span>
                    ))}
                </span>,
                document.body
            )}
        </span>
    )
}
