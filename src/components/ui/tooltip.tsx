"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

const domTooltipDelayMs = 500
const domTooltipSelector = "[data-tooltip]"

type DomTooltipSnapshot = {
  target: HTMLElement
  content: string
  rect: DOMRect
}

function findDomTooltipTarget(value: EventTarget | null) {
  if (!(value instanceof Element)) return null
  const target = value.closest<HTMLElement>(domTooltipSelector)
  if (!target?.dataset.tooltip || target.matches(":disabled")) return null
  return target
}

function TooltipProvider({ delayDuration = 500, skipDelayDuration = 120, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props} />
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root {...props} />
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger {...props} />
}

function TooltipContent({ className, sideOffset = 7, collisionPadding = 8, children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "mk-tooltip-content z-[120] max-w-64 rounded-[6px] border border-slate-200/90 bg-white/96 px-2.5 py-1.5 text-xs font-medium leading-5 text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.12)] backdrop-blur-md data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=delayed-open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=delayed-open]:zoom-in-95 data-[state=closed]:zoom-out-95 dark:border-zinc-700/90 dark:bg-zinc-900/96 dark:text-zinc-200 dark:shadow-[0_10px_28px_rgba(0,0,0,0.28)]",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="mk-tooltip-arrow fill-white" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

type TooltipPlacementProps = {
  tooltipSide?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"]
  tooltipAlign?: React.ComponentProps<typeof TooltipPrimitive.Content>["align"]
  tooltipSideOffset?: number
}

function TooltipAnchor({ content, children, tooltipSide = "top", tooltipAlign = "center", tooltipSideOffset }: { content?: React.ReactNode; children: React.ReactElement } & TooltipPlacementProps) {
  if (!content) return children

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={tooltipSide} align={tooltipAlign} sideOffset={tooltipSideOffset}>{content}</TooltipContent>
    </Tooltip>
  )
}

/**
 * CodeMirror widgets are imperative DOM, so they cannot use TooltipTrigger directly.
 * This shared bridge positions one Radix tooltip over the hovered data-tooltip element.
 */
function DomTooltipLayer() {
  const hoveredRef = React.useRef<HTMLElement | null>(null)
  const focusedRef = React.useRef<HTMLElement | null>(null)
  const [target, setTarget] = React.useState<HTMLElement | null>(null)
  const [snapshot, setSnapshot] = React.useState<DomTooltipSnapshot | null>(null)

  React.useEffect(() => {
    const syncTarget = () => setTarget(hoveredRef.current ?? focusedRef.current)
    const handlePointerOver = (event: PointerEvent) => {
      hoveredRef.current = findDomTooltipTarget(event.target)
      syncTarget()
    }
    const handlePointerOut = (event: PointerEvent) => {
      if (event.relatedTarget instanceof Node && hoveredRef.current?.contains(event.relatedTarget)) return
      hoveredRef.current = findDomTooltipTarget(event.relatedTarget)
      syncTarget()
    }
    const handleFocusIn = (event: FocusEvent) => {
      focusedRef.current = findDomTooltipTarget(event.target)
      syncTarget()
    }
    const handleFocusOut = (event: FocusEvent) => {
      focusedRef.current = findDomTooltipTarget(event.relatedTarget)
      syncTarget()
    }

    document.addEventListener("pointerover", handlePointerOver, true)
    document.addEventListener("pointerout", handlePointerOut, true)
    document.addEventListener("focusin", handleFocusIn, true)
    document.addEventListener("focusout", handleFocusOut, true)
    return () => {
      document.removeEventListener("pointerover", handlePointerOver, true)
      document.removeEventListener("pointerout", handlePointerOut, true)
      document.removeEventListener("focusin", handleFocusIn, true)
      document.removeEventListener("focusout", handleFocusOut, true)
    }
  }, [])

  React.useEffect(() => {
    setSnapshot(null)
    if (!target) return undefined
    const timer = window.setTimeout(() => {
      const content = target.dataset.tooltip
      if (target.isConnected && content && !target.matches(":disabled")) {
        setSnapshot({ target, content, rect: target.getBoundingClientRect() })
      }
    }, domTooltipDelayMs)
    return () => window.clearTimeout(timer)
  }, [target])

  React.useEffect(() => {
    if (!snapshot) return undefined
    const { target: activeTarget } = snapshot
    const refresh = () => {
      const content = activeTarget.dataset.tooltip
      if (!activeTarget.isConnected || !content || activeTarget.matches(":disabled")) {
        setSnapshot(null)
        return
      }
      setSnapshot({ target: activeTarget, content, rect: activeTarget.getBoundingClientRect() })
    }
    const resizeObserver = new ResizeObserver(refresh)
    const mutationObserver = new MutationObserver(refresh)
    resizeObserver.observe(activeTarget)
    mutationObserver.observe(activeTarget, { attributes: true, attributeFilter: ["data-tooltip", "disabled"] })
    window.addEventListener("resize", refresh)
    window.addEventListener("scroll", refresh, true)
    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener("resize", refresh)
      window.removeEventListener("scroll", refresh, true)
    }
  }, [snapshot?.target])

  if (!snapshot) return null
  return (
    <Tooltip open>
      <TooltipTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed"
          style={{
            left: snapshot.rect.left,
            top: snapshot.rect.top,
            width: Math.max(1, snapshot.rect.width),
            height: Math.max(1, snapshot.rect.height),
          }}
        />
      </TooltipTrigger>
      <TooltipContent>{snapshot.content}</TooltipContent>
    </Tooltip>
  )
}

export { DomTooltipLayer, Tooltip, TooltipAnchor, TooltipContent, TooltipProvider, TooltipTrigger, type TooltipPlacementProps }

// TooltipButton 在 button.tsx 里定义（基于 Button 组件，支持 variant/size），从此处重导出。
export { TooltipButton } from "@/components/ui/button"
