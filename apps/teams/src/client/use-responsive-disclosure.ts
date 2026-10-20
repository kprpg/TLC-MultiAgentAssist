import { useEffect, useRef } from 'react'

export function useResponsiveDisclosure(breakpoint: number, visible: boolean) {
  const disclosure = useRef<HTMLDetailsElement>(null)
  const previousVisible = useRef(visible)
  useEffect(() => {
    const element = disclosure.current
    const container = element?.closest('.portfolio-workbench')
    if (!element || !container) return
    let wasWide: boolean | undefined
    const update = (width: number) => {
      const wide = width >= breakpoint
      if (wasWide !== wide) { element.open = wide; wasWide = wide }
    }
    update(container.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => { if (entry) update(entry.contentRect.width) })
    observer.observe(container)
    return () => observer.disconnect()
  }, [breakpoint])
  useEffect(() => {
    if (visible && !previousVisible.current && disclosure.current) disclosure.current.open = true
    previousVisible.current = visible
  }, [visible])
  return disclosure
}
