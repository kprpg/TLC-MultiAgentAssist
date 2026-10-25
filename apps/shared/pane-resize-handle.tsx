import { useEffect, useRef, useState, type PointerEvent } from 'react'
import './pane-resizing.css'

export function PaneResizeHandle({ label, width, minWidth, maxWidth, defaultWidth, onResize, edge = 'end', className = '', controls }: {
    label: string
    width: number
    minWidth: number
    maxWidth: number
    defaultWidth: number
    onResize(width: number): void
    edge?: 'start' | 'end'
    className?: string
    controls?: string
}) {
    const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
    const [dragging, setDragging] = useState(false)

    useEffect(() => {
        if (!dragging) return
        document.body.classList.add('resizing-pane')
        return () => document.body.classList.remove('resizing-pane')
    }, [dragging])

    function resize(nextWidth: number) {
        onResize(Math.min(maxWidth, Math.max(minWidth, nextWidth)))
    }

    function finishResize(event: PointerEvent<HTMLDivElement>) {
        if (drag.current?.pointerId !== event.pointerId) return
        drag.current = null
        setDragging(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }

    return <div
        className={`pane-resize-handle ${edge} ${className}${dragging ? ' is-dragging' : ''}`.trim()}
        role="separator"
        aria-label={`Resize ${label}`}
        aria-controls={controls}
        aria-orientation="vertical"
        aria-valuemin={Math.round(minWidth)}
        aria-valuemax={Math.round(maxWidth)}
        aria-valuenow={Math.round(width)}
        aria-valuetext={`${Math.round(width)} pixels`}
        tabIndex={0}
        title={`Drag to resize ${label}. Use arrow keys or double-click to reset.`}
        onDoubleClick={() => resize(defaultWidth)}
        onKeyDown={(event) => {
            const step = event.shiftKey ? 50 : 10
            if (event.key === 'Home') resize(minWidth)
            else if (event.key === 'End') resize(maxWidth)
            else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                const delta = event.key === 'ArrowRight' ? step : -step
                resize(width + (edge === 'end' ? delta : -delta))
            } else return
            event.preventDefault()
        }}
        onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return
            drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
            event.currentTarget.setPointerCapture(event.pointerId)
            event.currentTarget.focus()
            setDragging(true)
            event.preventDefault()
        }}
        onPointerMove={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return
            const delta = event.clientX - drag.current.startX
            resize(drag.current.startWidth + (edge === 'end' ? delta : -delta))
        }}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onLostPointerCapture={finishResize}
    >
        <span className="pane-resize-grip" aria-hidden="true"><span /><span /><span /></span>
    </div>
}
