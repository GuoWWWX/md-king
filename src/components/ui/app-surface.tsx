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
  plain: "border border-white/70 bg-white/52 shadow-inner shadow-blue-100/50",
};

const surfacePadding = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

const surfaceRadius = {
  sm: "rounded-[12px]",
  md: "rounded-[16px]",
  lg: "rounded-[18px]",
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
  return <Button className={cn("mk-blue-button rounded-[12px]", className)} {...props} />;
}

export function SoftActionButton({ className, variant = "outline", ...props }: AppButtonProps) {
  return <Button variant={variant} className={cn("rounded-[12px] border-white/70 bg-white/68", className)} {...props} />;
}

export function DocPreviewSurface({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mk-doc-preview rounded-[14px]", className)} {...props} />;
}
