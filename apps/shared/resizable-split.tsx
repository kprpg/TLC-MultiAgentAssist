import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { PaneResizeHandle } from './pane-resize-handle.js'

const handleWidth = 16

export function ResizableSplit({ children, className, label, controls, defaultRatio, minFirst = 240, minSecond = 240, firstVisible = true, secondVisible = true }: {
    children: [ReactNode, ReactNode]
    className: string
    label: string
    controls: string
    defaultRatio: number
    minFirst?: number
    minSecond?: number
    firstVisible?: boolean
    secondVisible?: boolean
}) {
    const container = useRef<HTMLDivElement>(null)
    const [containerWidth, setContainerWidth] = useState(0)
    const [ratio, setRatio] = useState(defaultRatio)

    useEffect(() => {
        const element = container.current
        if (!element) return
        const observer = new ResizeObserver(([entry]) => {
            if (entry) setContainerWidth(entry.contentRect.width)
        })
        observer.observe(element)
        return () => observer.disconnect()
    }, [])

    const available = Math.max(0, containerWidth - handleWidth)
    const minimum = Math.min(minFirst, available)
    const maximum = Math.max(minimum, available - minSecond)
    const firstWidth = Math.min(maximum, Math.max(minimum, ratio * available))
    const fraction = available > 0 ? firstWidth / available : ratio
    const style: CSSProperties & { '--pane-columns': string } = {
        '--pane-columns': `minmax(0, ${fraction}fr) ${handleWidth}px minmax(0, ${1 - fraction}fr)`
    }
    const bothVisible = firstVisible && secondVisible

    return <div ref={container} className={`resizable-split ${className}${bothVisible ? '' : ' single-column'}`} style={style} hidden={!firstVisible && !secondVisible}>
        <div className="resizable-split-cell" hidden={!firstVisible}>{children[0]}</div>
        {bothVisible && <PaneResizeHandle
            label={label}
            controls={controls}
            width={firstWidth}
            minWidth={minimum}
            maxWidth={maximum}
            defaultWidth={defaultRatio * available}
            onResize={(width) => setRatio(width / Math.max(1, available))}
        />}
        <div className="resizable-split-cell" hidden={!secondVisible}>{children[1]}</div>
    </div>
}
