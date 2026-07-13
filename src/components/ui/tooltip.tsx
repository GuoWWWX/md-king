"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function TooltipProvider({ delayDuration = 500, skipDelayDuration = 120, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props} />
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root {...props} />
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger {...props} />
}

function TooltipContent({ className, sideOffset = 7, children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-[120] max-w-64 rounded-[6px] border border-slate-200/90 bg-white/96 px-2.5 py-1.5 text-xs font-medium leading-5 text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.12)] backdrop-blur-md data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=delayed-open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=delayed-open]:zoom-in-95 data-[state=closed]:zoom-out-95 dark:border-zinc-700/90 dark:bg-zinc-900/96 dark:text-zinc-200 dark:shadow-[0_10px_28px_rgba(0,0,0,0.28)]",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-white dark:fill-zinc-900" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

function TooltipAnchor({ content, children }: { content?: React.ReactNode; children: React.ReactElement }) {
  if (!content) return children

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  )
}

function TooltipButton({ tooltip, ...props }: React.ComponentProps<"button"> & { tooltip?: React.ReactNode }) {
  return (
    <TooltipAnchor content={tooltip}>
      <button {...props} />
    </TooltipAnchor>
  )
}

export { Tooltip, TooltipAnchor, TooltipButton, TooltipContent, TooltipProvider, TooltipTrigger }
