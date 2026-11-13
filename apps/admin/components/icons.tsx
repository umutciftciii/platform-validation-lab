import Image from "next/image";
import type { SVGProps } from "react";

/**
 * Minimal line icon set: 20px grid, 1.6px stroke, round joins. Decorative by default
 * (aria-hidden); pass a label through the surrounding control, not the icon.
 */
const PATHS = {
  overview: "M3.5 10.5 10 4l6.5 6.5M5.5 9v7h3.5v-4h2v4h3.5V9",
  content: "M6 3.5h5.5L15 7v9.5H6zM11.5 3.5V7H15M8.5 10.5h4M8.5 13.5h4",
  products: "M10 3 16 6.3v7.4L10 17l-6-3.3V6.3zM4 6.3l6 3.3 6-3.3M10 9.6V17",
  sites:
    "M10 16.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM3.5 10h13M10 3.5c1.8 1.8 2.6 4 2.6 6.5S11.8 14.7 10 16.5M10 3.5C8.2 5.3 7.4 7.5 7.4 10s.8 4.7 2.6 6.5",
  staff:
    "M7.5 9.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM2.75 16c.5-2.6 2.4-4.2 4.75-4.2s4.25 1.6 4.75 4.2M13 4.3a2.6 2.6 0 0 1 0 5M14.5 11.9c1.5.5 2.5 1.9 2.75 4.1",
  audit: "M5 3.5h10v13H5zM7.75 7h4.5M7.75 10h4.5M7.75 13h2.5",
  settings:
    "M10 12.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM10 2.75v2M10 15.25v2M17.25 10h-2M4.75 10h-2M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3 4.9 4.9",
  menu: "M3.5 6h13M3.5 10h13M3.5 14h13",
  close: "M5 5l10 10M15 5 5 15",
  sun: "M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM10 2.5v1.5M10 16v1.5M17.5 10H16M4 10H2.5M15.3 4.7l-1.06 1.06M5.76 14.24 4.7 15.3M15.3 15.3l-1.06-1.06M5.76 5.76 4.7 4.7",
  moon: "M15.5 12.2A6 6 0 0 1 7.8 4.5a6 6 0 1 0 7.7 7.7Z",
  monitor: "M3 4.5h14v9H3zM7.5 16.5h5M10 13.5v3",
  logout: "M8 4H4.5v12H8M12.5 6.5 16 10l-3.5 3.5M16 10H8",
  plus: "M10 4.5v11M4.5 10h11",
  arrow: "M7 13 13 7M8 7h5v5",
  chevron: "m8 5 5 5-5 5",
  publish: "M10 15.5v-9M6.5 9.5 10 6l3.5 3.5M4.5 4h11",
  edit: "M12.8 4.2 15.8 7.2 7.5 15.5H4.5v-3zM11.3 5.7l3 3",
  key: "M7.5 12.5a3.5 3.5 0 1 1 3.3-4.7l5.7.02v2.4h-1.8v1.7h-2v-1.7h-1.9a3.5 3.5 0 0 1-3.3 2.28Z",
  shield: "M10 3 16 5.3v4.4c0 3.4-2.5 6.1-6 7.3-3.5-1.2-6-3.9-6-7.3V5.3z",
  alert: "M10 3.5 17 16H3zM10 8.5v3.5M10 14v.01",
  refresh:
    "M15.5 8.5A5.75 5.75 0 0 0 5 6.4M4.5 11.5A5.75 5.75 0 0 0 15 13.6M5 3.5v3h3M15 16.5v-3h-3",
  inbox: "M3.5 11 5.5 4.5h9l2 6.5v4.5h-13zM3.5 11h4l1 2h3l1-2h4",
  // PM-1 (product catalogue)
  search: "M9 14.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM13 13l3.5 3.5",
  folder: "M3.5 5.5h4.5l1.5 1.75h7v8.25h-13z",
  trash: "M4.5 6h11M8 6V4.25h4V6M6 6l.75 10h6.5L14 6M8.75 9v4.5M11.25 9v4.5",
  star: "m10 3.5 1.9 4 4.35.55-3.2 3 .82 4.3L10 13.2l-3.87 2.15.82-4.3-3.2-3 4.35-.55z",
  archive: "M3.5 4.5h13v3h-13zM4.75 7.5v8h10.5v-8M8 10.5h4",
  back: "M12 5 7 10l5 5",
  check: "m4.5 10.5 3.5 3.5 7.5-8",
  upload: "M10 13.5V4M6.5 7.5 10 4l3.5 3.5M4 13v3h12v-3",
  download: "M10 4v9.5M6.5 10 10 13.5l3.5-3.5M4 13v3h12v-3",
  document: "M6 3.5h5.5L15 7v9.5H6zM11.5 3.5V7H15M8 11h5M8 13.5h3.5",
  history: "M4 10a6 6 0 1 0 1.8-4.3M4 4v3.5h3.5M10 7v3.25l2.25 1.5",
  grip: "M7.5 5.5h.01M12.5 5.5h.01M7.5 10h.01M12.5 10h.01M7.5 14.5h.01M12.5 14.5h.01",
  image:
    "M3.5 4.5h13v11h-13zM3.5 13l4-4 3 3 2-2 4 4M12.5 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z",
  list: "M7.5 6h9M7.5 10h9M7.5 14h9M3.75 6h.01M3.75 10h.01M3.75 14h.01",
  eye: "M2.75 10S5.5 4.75 10 4.75 17.25 10 17.25 10 14.5 15.25 10 15.25 2.75 10 2.75 10ZM10 12.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z",
  eyeOff:
    "M3.5 3.5l13 13M8.3 8.4a2.25 2.25 0 0 0 3.2 3.2M6.2 6.3C4 7.6 2.75 10 2.75 10S5.5 15.25 10 15.25c1.4 0 2.6-.5 3.7-1.2M9 4.8c.3 0 .7-.05 1-.05 4.5 0 7.25 5.25 7.25 5.25s-.6 1.2-1.75 2.4",
} as const;

export type IconKey = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  ...rest
}: { name: IconKey; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

// Official Dream Petroleum BV artwork (public/brand). dream-petroleum-logo.svg is a byte-identical
// copy of web-bv's logo (extracted from the logo PDF, for dark backgrounds: the wordmark is light
// grey). dream-petroleum-mark.svg is the same file with the wordmark removed and the view box
// cropped to the DP ring; it reads on light and dark backgrounds.
const LOGO = { src: "/brand/dream-petroleum-logo.svg", width: 870.5, height: 240 } as const;
const MARK = { src: "/brand/dream-petroleum-mark.svg", width: 246, height: 240 } as const;

/** The DP ring on its own: compact places and light backgrounds. Decorative by default. */
export function BrandMark({ size = 32, alt = "" }: { size?: number; alt?: string }) {
  return (
    <Image
      src={MARK.src}
      alt={alt}
      width={Math.round((size * MARK.width) / MARK.height)}
      height={size}
      unoptimized
      priority
      className="shrink-0"
    />
  );
}

/** Full horizontal logo with wordmark and tagline. Dark backgrounds only. */
export function BrandLogo({ height = 44, alt = "" }: { height?: number; alt?: string }) {
  return (
    <Image
      src={LOGO.src}
      alt={alt}
      width={Math.round((height * LOGO.width) / LOGO.height)}
      height={height}
      unoptimized
      priority
      className="shrink-0"
    />
  );
}

/**
 * Brand signature: concentric quarter-rings echoing the ring of the DP mark. One ring carries the
 * brand orange, the rest the rail accent. Purely decorative; position it with `className`.
 * `corner` picks which corner of the box the rings grow from.
 */
export function RingMotif({
  size = 260,
  rings = 5,
  corner = "top-right",
  className,
}: {
  size?: number;
  rings?: number;
  corner?: "top-right" | "bottom-right";
  className?: string;
}) {
  const step = (size * 0.82) / rings;
  const base = size * 0.18;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
    >
      {Array.from({ length: rings }, (_, i) => {
        const r = base + i * step;
        const brand = i === Math.floor(rings / 2);
        const d =
          corner === "top-right"
            ? `M${size - r} 0 A${r} ${r} 0 0 0 ${size} ${r}`
            : `M${size - r} ${size} A${r} ${r} 0 0 1 ${size} ${size - r}`;
        return (
          <path
            key={i}
            d={d}
            stroke={brand ? "var(--brand)" : "var(--rail-accent)"}
            strokeOpacity={brand ? 0.75 : 0.45 - i * 0.06}
            strokeWidth={brand ? 1.6 : 1.1}
          />
        );
      })}
    </svg>
  );
}
