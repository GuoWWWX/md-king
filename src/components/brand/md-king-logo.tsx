import type { ImgHTMLAttributes } from "react";
import logoUrl from "@/assets/md-king-logo.png";

type MdKingLogoProps = ImgHTMLAttributes<HTMLImageElement> & {
  title?: string;
};

export function MdKingLogo({ title = "md-king", alt, ...props }: MdKingLogoProps) {
  return <img src={logoUrl} alt={alt ?? title} draggable={false} {...props} />;
}
