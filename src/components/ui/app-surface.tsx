import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SurfaceElement = "div" | "section" | "article" | "aside";

type AppSurfaceProps = React.HTMLAttributes<HTMLElement> & {
  as?: SurfaceElement;
  variant?: "glass" | "solid" | "plain";
  padding?: "none" | "sm" | "md" | "lg";
  radius?: "sm" | "md" | "lg";
  interactive?: boolean;
};

const surfaceVariants = {
  glass: "mk-card",
  solid: "mk-card-solid",
  plain: "border border-slate-200/80 bg-white shadow-none dark:border-zinc-800 dark:bg-zinc-950",
};

const surfacePadding = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

const surfaceRadius = {
  sm: "rounded-[8px]",
  md: "rounded-[8px]",
  lg: "rounded-[10px]",
};

export function AppSurface({
  as = "div",
  variant = "glass",
  padding = "md",
  radius = "md",
  interactive = false,
  className,
  ...props
}: AppSurfaceProps) {
  return React.createElement(as, {
    className: cn(
      surfaceVariants[variant],
      surfacePadding[padding],
      surfaceRadius[radius],
      interactive && "transition hover:-translate-y-0.5",
      className,
    ),
    ...props,
  });
}

type AppButtonProps = React.ComponentProps<typeof Button>;

export function PrimaryActionButton({ className, ...props }: AppButtonProps) {
  return <Button className={cn("mk-blue-button rounded-[8px]", className)} {...props} />;
}

export function SoftActionButton({ className, variant = "outline", ...props }: AppButtonProps) {
  return <Button variant={variant} className={cn("rounded-[8px] border-slate-200 bg-white dark:border-zinc-700 dark:bg-zinc-900", className)} {...props} />;
}

export function DocPreviewSurface({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mk-doc-preview rounded-[8px]", className)} {...props} />;
}
