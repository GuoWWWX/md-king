import type { SVGProps } from "react";

type MdKingLogoProps = SVGProps<SVGSVGElement> & {
  title?: string;
};

export function MdKingLogo({ title = "md-king", ...props }: MdKingLogoProps) {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={title} {...props}>
      <defs>
        <linearGradient id="md-king-logo-bg" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4F46E5" />
          <stop offset="0.52" stopColor="#2563EB" />
          <stop offset="1" stopColor="#10B981" />
        </linearGradient>
        <linearGradient id="md-king-logo-mark" x1="18" y1="18" x2="47" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#DBEAFE" />
        </linearGradient>
        <filter id="md-king-logo-shadow" x="4" y="4" width="56" height="58" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#1E1B4B" floodOpacity="0.22" />
        </filter>
      </defs>
      <rect x="8" y="7" width="48" height="50" rx="15" fill="url(#md-king-logo-bg)" filter="url(#md-king-logo-shadow)" />
      <path d="M21 44V22l7.1 9.1L35.2 22v22" fill="none" stroke="url(#md-king-logo-mark)" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M37.5 26h7.2c3.9 0 6.3 2.2 6.3 5.5S48.6 37 44.7 37h-3.1" fill="none" stroke="#E0F2FE" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M42.2 37l5.6 7" fill="none" stroke="#E0F2FE" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M20 16l4 4 5-6 5 6 5-6 5 6 4-4" fill="none" stroke="#FDE68A" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 49h28" stroke="#A7F3D0" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}
