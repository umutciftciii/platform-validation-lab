"use client";

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useMotionValueEvent,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
} from "react";

import {
  LabVesselMedia,
  TEMP_VESSEL_MEDIA,
} from "@/components/ui/lab-vessel-media";
import {
  ICCSYN_APPLICATIONS,
  ICCSYN_HERO_COPY as COPY,
  type IccsynApplication,
} from "@/content/iccsyn-hero";

type Layout = "spatial" | "deck";
type TitleLine = "brand" | "tagline";

/* -------------------------------------------------------------------------- */
/* Timeline, as a share of the section's scroll distance (0 to 1)              */
/* -------------------------------------------------------------------------- */

// Each layer has its own range and the ranges overlap, so the title, the oil and
// the cards hand over to one another with no stage where the glass stands alone.
const TITLE_START = 0.07;
const TITLE_END = 0.25;
const VESSEL_IN: [number, number] = [0.05, 0.25];

// Left and right cards of a row open almost together. Motion eases out: they clear
// the glass early, then settle into their final positions by 70%.
const SPATIAL_CARDS_START = 0.12;
const SPATIAL_ROW_STAGGER = 0.07;
const SPATIAL_SIDE_STAGGER = 0.012;
const SPATIAL_CARD_LENGTH = 0.42;
const SPATIAL_CARD_FADE = 0.08;
const SPREAD_ACTIVE = 0.66;

const DECK_CARDS_START = 0.12;
const DECK_CARDS_END = 0.7;

const DECK_FINALE: [number, number] = [0.68, 0.82];

// Everything is at rest from 85%, leaving the rest of the section for reading.
const CTA_IN: [number, number] = [0.7, 0.85];

// Mobile only: the title lifts clear of the first card just before it arrives.
const DECK_TITLE_LIFT: [number, number] = [0.07, 0.12];
const DECK_TITLE_LIFT_SVH = -4;

// Desktop: when a letter must be gone, measured from where the cards pass through
// the title at 1440x900. Keys are distance from the middle of the line (0 to 1).
const BRAND_CLEAR_BY: [number, number][] = [
  [0, 0.125],
  [0.33, 0.128],
  [0.47, 0.16],
  [0.6, 0.195],
  [0.73, 0.226],
  [1, 0.25],
];
const LETTER_FADE = 0.05;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const linear = (t: number) => t;

/* -------------------------------------------------------------------------- */
/* Card placement                                                              */
/* -------------------------------------------------------------------------- */

// Hand-placed scatter, as in the source. Cards keep clear of the central vessel
// and sit at different depths without pushing any text out of reading size.
const SPATIAL_COORDINATES = [
  { x: -31, y: -29, z: -110 },
  { x: 33, y: -28, z: 30 },
  { x: -33, y: -2, z: 35 },
  { x: 35, y: -1, z: -90 },
  { x: -30, y: 25, z: 10 },
  { x: 33, y: 26, z: -40 },
];

const STACKED_Z = -240;
const DECK_Y = 19;

// Fluid physics for the 3D scene tilt and scroll smoothing (source values).
const SCENE_SPRING = { stiffness: 40, damping: 30, mass: 1 };
const SCROLL_SPRING = { stiffness: 80, damping: 25, restDelta: 0.001 };
const FLATTEN_SPRING = { stiffness: 300, damping: 30 };

/* -------------------------------------------------------------------------- */
/* Environment                                                                 */
/* -------------------------------------------------------------------------- */

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function useSceneParallax(active: boolean) {
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const tiltX = useSpring(rawX, SCENE_SPRING);
  const tiltY = useSpring(rawY, SCENE_SPRING);

  useEffect(() => {
    if (!active) {
      rawX.set(0);
      rawY.set(0);
      return;
    }
    const onMove = (e: PointerEvent) => {
      // Narrower range than the source (±7.5°), so card text stays easy to read.
      rawX.set((e.clientY / window.innerHeight - 0.5) * -8);
      rawY.set((e.clientX / window.innerWidth - 0.5) * 8);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [active, rawX, rawY]);

  return { tiltX, tiltY };
}

/* -------------------------------------------------------------------------- */
/* Title dissolve                                                              */
/* -------------------------------------------------------------------------- */

function clearByDistance(distance: number) {
  const next = BRAND_CLEAR_BY.findIndex(([d]) => d >= distance);
  if (next <= 0) return BRAND_CLEAR_BY[0][1];
  const [d0, t0] = BRAND_CLEAR_BY[next - 1];
  const [d1, t1] = BRAND_CLEAR_BY[next];
  return t0 + ((t1 - t0) * (distance - d0)) / (d1 - d0);
}

/** When one letter fades. Title lines dissolve from the centre outward in both layouts. */
function letterRange(distance: number, line: TitleLine, isDeck: boolean): [number, number] {
  if (isDeck) {
    const start = TITLE_START + distance * 0.09;
    return [start, start + 0.09];
  }
  // The tagline sits in the first row's path, so it has to clear first.
  if (line === "tagline") return [TITLE_START + distance * 0.015, 0.105 + distance * 0.02];
  const end = clearByDistance(distance);
  return [Math.max(TITLE_START, end - LETTER_FADE), end];
}

function DissolveChar({
  char,
  distance,
  side,
  progress,
  line,
  isDeck,
}: {
  char: string;
  line: TitleLine;
  isDeck: boolean;
  /** 0 at the middle of the line, 1 at its ends. */
  distance: number;
  side: number;
  progress: MotionValue<number>;
}) {
  // Letters clear from the centre outward, opening space for the vessel behind.
  const [start, end] = letterRange(distance, line, isDeck);
  const opacity = useTransform(progress, [start, end], [1, 0]);
  const x = useTransform(progress, [start, end], [0, side * (10 + distance * 26)]);
  return (
    <motion.span className="inline-block" style={{ opacity, x }}>
      {char}
    </motion.span>
  );
}

function DissolveText({
  text,
  progress,
  line,
  isDeck,
}: {
  text: string;
  progress: MotionValue<number>;
  line: TitleLine;
  isDeck: boolean;
}) {
  const middle = (text.length - 1) / 2;
  const words = text.split(" ");
  return (
    <span aria-hidden>
      {words.map((word, w) => {
        const wordStart = words.slice(0, w).join(" ").length + (w > 0 ? 1 : 0);
        return (
          <span key={w} className="inline-block whitespace-nowrap">
            {word.split("").map((char, c) => {
              const position = wordStart + c - middle;
              return (
                <DissolveChar
                  key={c}
                  char={char}
                  distance={Math.abs(position) / Math.max(middle, 1)}
                  side={Math.sign(position)}
                  progress={progress}
                  line={line}
                  isDeck={isDeck}
                />
              );
            })}
            {w < words.length - 1 ? " " : null}
          </span>
        );
      })}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                       */
/* -------------------------------------------------------------------------- */

type CardProps = {
  application: IccsynApplication;
  index: number;
  layout: Layout;
  progress: MotionValue<number>;
  isSpreadActive: boolean;
  hoveredIndex: number | null;
  setHoveredIndex: (index: number | null) => void;
  onKeyboardFocus: (event: FocusEvent<HTMLElement>, progress: number) => void;
};

/** Keyframes for one card, per layout. */
function cardTimeline(index: number, layout: Layout) {
  if (layout === "spatial") {
    const coords = SPATIAL_COORDINATES[index];
    const row = Math.floor(index / 2);
    const start =
      SPATIAL_CARDS_START + row * SPATIAL_ROW_STAGGER + (index % 2) * SPATIAL_SIDE_STAGGER;
    const end = start + SPATIAL_CARD_LENGTH;
    return {
      input: [start, end],
      ease: easeOutCubic,
      opacityInput: [start, start + SPATIAL_CARD_FADE],
      x: [0, coords.x],
      y: [0, coords.y],
      z: [STACKED_Z, coords.z],
      // Cards angle inward to face the viewer's centre (source formula).
      rotateY: [0, coords.x * -0.42],
      rotateX: [0, coords.y * 0.3],
      rotateZ: [(index - 2.5) * 4, (index - 2.5) * 0.5],
      scale: [0.6, 1],
      opacity: [0, 1],
      revealAt: Math.min(end, 1),
    };
  }

  // Deck: one card at a time, alternating sides, because a phone cannot hold the
  // scatter. Each card recedes before the next one reads.
  const length = (DECK_CARDS_END - DECK_CARDS_START) / ICCSYN_APPLICATIONS.length;
  const start = DECK_CARDS_START + index * length;
  const side = index % 2 === 0 ? -1 : 1;
  // The exit overlaps the next card's entrance, so the deck is never empty.
  const a = start + length * 0.22;
  const b = start + length * 0.85;
  const c = start + length * 1.2;
  return {
    input: [start, a, b, c],
    ease: linear,
    opacityInput: [start, a, b, c],
    x: [side * 62, 0, 0, side * -18],
    y: [DECK_Y, DECK_Y, DECK_Y, DECK_Y],
    z: [-160, 0, 0, -220],
    rotateY: [side * -38, 0, 0, side * 16],
    rotateX: [0, 0, 0, 0],
    rotateZ: [0, 0, 0, 0],
    scale: [1, 1, 1, 1],
    opacity: [0, 1, 1, 0],
    revealAt: (a + b) / 2,
  };
}

// Also limited by height, so three rows of photo cards fit on a short laptop screen.
const SPATIAL_CARD_WIDTH = "clamp(208px, min(19vw, 31svh), 300px)";
const SPATIAL_CARD_SIZES = "300px";
const DECK_CARD_SIZES = "min(86vw, 360px)";
const STATIC_CARD_SIZES = "(min-width: 1024px) 320px, (min-width: 640px) 45vw, 90vw";

/** Photo with the title and description on a dark gradient at its lower edge. */
function PlateContent({
  application,
  sizes,
}: {
  application: IccsynApplication;
  sizes: string;
}) {
  return (
    <>
      {/* Decorative: the text beside it already names the application. Loaded
          eagerly at low priority, so a card is never empty when scroll reveals it. */}
      <Image
        src={application.image.src}
        alt=""
        fill
        sizes={sizes}
        loading="eager"
        fetchPriority="low"
        draggable={false}
        className="plate-image"
      />
      <div className="plate-text">
        <h2 className="plate-title">{application.title}</h2>
        <p className="plate-body">{application.description}</p>
      </div>
    </>
  );
}

function SpatialCard({
  application,
  index,
  layout,
  progress,
  isSpreadActive,
  hoveredIndex,
  setHoveredIndex,
  onKeyboardFocus,
}: CardProps) {
  const t = cardTimeline(index, layout);

  // Transform coordinates based on the scroll progress.
  const motionOptions = { ease: t.ease };
  const x = useTransform(progress, t.input, t.x, motionOptions);
  const y = useTransform(progress, t.input, t.y, motionOptions);
  const z = useTransform(progress, t.input, t.z, motionOptions);
  const rotateX = useTransform(progress, t.input, t.rotateX, motionOptions);
  const rotateY = useTransform(progress, t.input, t.rotateY, motionOptions);
  const rotateZ = useTransform(progress, t.input, t.rotateZ, motionOptions);
  const scale = useTransform(progress, t.input, t.scale, motionOptions);
  const baseOpacity = useTransform(progress, t.opacityInput, t.opacity);

  const isActive = hoveredIndex === index;
  const isDimmed = hoveredIndex !== null && !isActive;

  // On hover or focus the card turns square to the viewer and comes forward. The
  // source's inner whileHover could not undo the rotation held by the parent.
  const flatten = useSpring(isActive ? 1 : 0, FLATTEN_SPRING);
  useEffect(() => {
    flatten.set(isActive ? 1 : 0);
  }, [flatten, isActive]);

  const transform = useTransform(
    [x, y, z, rotateX, rotateY, rotateZ, scale, flatten],
    ([tx, ty, tz, rx, ry, rz, s, f]: number[]) => {
      const keep = 1 - f;
      return `translate3d(calc(-50% + ${tx}vw), calc(-50% + ${ty}svh), ${tz + f * 40}px) rotateX(${rx * keep}deg) rotateY(${ry * keep}deg) rotateZ(${rz * keep}deg) scale(${s})`;
    },
  );

  const canHover = layout === "spatial" && isSpreadActive;

  return (
    <motion.li
      className="absolute left-1/2 top-1/2 list-none will-change-transform"
      style={{
        opacity: baseOpacity,
        width: layout === "spatial" ? SPATIAL_CARD_WIDTH : "min(86vw, 360px)",
        transform,
      }}
    >
      {/* Dimming uses opacity only. The source's per-card blur filter repainted
          every neighbouring card on each hover. */}
      <motion.article
        tabIndex={0}
        className="glass-plate"
        data-active={isActive}
        style={{ pointerEvents: canHover ? "auto" : "none" }}
        animate={{ opacity: isDimmed ? 0.35 : 1 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        onPointerEnter={() => canHover && setHoveredIndex(index)}
        onPointerLeave={() => canHover && setHoveredIndex(null)}
        onFocus={(event: FocusEvent<HTMLElement>) => {
          if (!event.target.matches(":focus-visible")) return;
          onKeyboardFocus(event, t.revealAt);
          setHoveredIndex(index);
        }}
        onBlur={() => setHoveredIndex(null)}
      >
        <PlateContent
          application={application}
          sizes={layout === "spatial" ? SPATIAL_CARD_SIZES : DECK_CARD_SIZES}
        />
      </motion.article>
    </motion.li>
  );
}

/* -------------------------------------------------------------------------- */
/* Call to action                                                              */
/* -------------------------------------------------------------------------- */

function HeroCta({ onFocus }: { onFocus?: (event: FocusEvent<HTMLElement>) => void }) {
  if (COPY.ctaHref) {
    return (
      <Link href={COPY.ctaHref} prefetch={false} className="hero-cta" onFocus={onFocus}>
        {COPY.cta}
      </Link>
    );
  }
  // No product page yet. It looks the same and stays reachable by keyboard for
  // review, but goes nowhere rather than ending on a 404.
  return (
    <a
      role="link"
      aria-disabled="true"
      tabIndex={0}
      title={COPY.ctaDisabledNote}
      className="hero-cta"
      onFocus={onFocus}
    >
      {COPY.cta}
    </a>
  );
}

/* -------------------------------------------------------------------------- */
/* Reduced motion: the same content, in normal flow, with nothing moving       */
/* -------------------------------------------------------------------------- */

function StaticHero({ scrollProgress }: { scrollProgress: MotionValue<number> }) {
  return (
    <section className="relative isolate overflow-hidden bg-ink px-6 pb-20 pt-24 text-center">
      <div className="hero-glow absolute inset-0 -z-10" />
      <h1 className="hero-brand">{BRAND_DISPLAY}</h1>
      <p className="hero-tagline mt-4">{COPY.tagline}</p>
      <div className="relative mx-auto mt-10 aspect-square w-full max-w-[520px]">
        <LabVesselMedia
          progress={scrollProgress}
          variant="desktop"
          scrub={false}
          alt={COPY.mediaAlt}
          sizes="(max-width: 600px) 100vw, 520px"
        />
      </div>
      <ul className="mx-auto mt-10 grid max-w-5xl gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
        {ICCSYN_APPLICATIONS.map((application) => (
          <li key={application.title} className="list-none">
            <article className="glass-plate h-full">
              <PlateContent application={application} sizes={STATIC_CARD_SIZES} />
            </article>
          </li>
        ))}
      </ul>
      <div className="mt-12 flex flex-col items-center gap-4">
        <HeroCta />
        <p className="hero-supply">{COPY.supply}</p>
        <p className="hero-legal">{COPY.legal}</p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                        */
/* -------------------------------------------------------------------------- */

const AFTER_HERO_ID = "after-iccsyn-hero";
const TAB_FOCUS_WINDOW_MS = 200;

// Keeps "BASE OILS" together when the wordmark wraps on narrow screens.
const BRAND_DISPLAY = COPY.brand.replace("BASE OILS", "BASE OILS");

export type HeroScrollLength = "standard" | "compact";

// Same timeline, stretched over a different distance. Literal classes for Tailwind.
const SECTION_HEIGHT: Record<HeroScrollLength, Record<Layout, string>> = {
  standard: { spatial: "h-[240svh]", deck: "h-[420svh]" },
  compact: { spatial: "h-[220svh]", deck: "h-[360svh]" },
};

function AnimatedHero({
  isDeck,
  scrollLength,
}: {
  isDeck: boolean;
  scrollLength: HeroScrollLength;
}) {
  const wrapRef = useRef<HTMLElement>(null);
  const layout: Layout = isDeck ? "deck" : "spatial";
  const finePointer = useMediaQuery("(hover: hover) and (pointer: fine)");

  // Track which card is currently hovered or focused.
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [spread, setSpread] = useState(false);

  const { scrollYProgress } = useScroll({
    target: wrapRef,
    offset: ["start start", "end end"],
  });

  const smoothProgress = useSpring(scrollYProgress, SCROLL_SPRING);
  const progress = smoothProgress;

  // Activate hover states only when the cards are mostly spread out.
  useMotionValueEvent(progress, "change", (p) => setSpread(p > SPREAD_ACTIVE));

  const { tiltX, tiltY } = useSceneParallax(spread && finePointer && !isDeck);

  // Headline.
  const titleBlurPx = useTransform(progress, [0.1, TITLE_END], [0, isDeck ? 0 : 7]);
  const titleFilter = useMotionTemplate`blur(${titleBlurPx}px)`;
  const titleScale = useTransform(progress, [0, TITLE_END], [1, 0.94]);
  const titleLift = useTransform(progress, DECK_TITLE_LIFT, [0, isDeck ? DECK_TITLE_LIFT_SVH : 0]);
  const titleY = useMotionTemplate`${titleLift}svh`;
  const cueOpacity = useTransform(progress, [0, 0.03], [1, 0]);

  // Vessel.
  const vesselOpacity = useTransform(progress, VESSEL_IN, [0, 1]);
  const vesselScale = useTransform(progress, VESSEL_IN, [0.84, 1]);
  // Deck only: once the last card leaves, the vessel takes back the empty space.
  const vesselFinale = useTransform(progress, DECK_FINALE, [0, isDeck ? 1 : 0]);
  const vesselTransform = useTransform(
    [vesselScale, vesselFinale],
    ([s, f]: number[]) => {
      const offset = isDeck ? -21 + f * 9 : -3;
      return `translate3d(-50%, calc(-50% + ${offset}svh), 0) scale(${s * (1 + f * 0.22)})`;
    },
  );
  const frameProgress = useTransform(progress, [VESSEL_IN[0], 1], [0, 1]);

  // Final call to action.
  const ctaOpacity = useTransform(progress, CTA_IN, [0, 1]);
  const ctaY = useTransform(progress, CTA_IN, [14, 0]);
  const ctaPointerEvents = useTransform(ctaOpacity, (o) => (o > 0.5 ? "auto" : "none"));

  // Only a Tab press may move the page. A browser also re-fires focus when the
  // window regains focus, and scrolling then pulled the page back to the focused
  // card from wherever the reader had moved on to.
  const tabPressedAt = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") tabPressedAt.current = event.timeStamp;
    };
    window.addEventListener("keydown", onKeyDown, { capture: true, passive: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  // Keyboard focus lands on content the scroll has not revealed yet, so bring the
  // scroll position to wherever that content is readable.
  const revealOnTabFocus = (event: FocusEvent<HTMLElement>, target: number) => {
    if (event.timeStamp - tabPressedAt.current > TAB_FOCUS_WINDOW_MS) return;
    const section = wrapRef.current;
    if (!section) return;
    const top = section.getBoundingClientRect().top + window.scrollY;
    const range = section.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + target * range, behavior: "smooth" });
  };

  return (
    <>
      <a href={`#${AFTER_HERO_ID}`} className="skip-link">
        Skip the ICCSYN animation
      </a>

      <section
        ref={wrapRef}
        className={`relative w-full bg-ink ${SECTION_HEIGHT[scrollLength][layout]}`}
      >
        <div
          className="sticky top-0 h-[100svh] w-full overflow-hidden"
          style={{ perspective: "1000px" }}
        >
          <div className="hero-glow absolute inset-0" />

          {/* 3D scene. Vessel and cards share one space, so cards emerge from
              behind the glass. pointer-events-none is required: the scene's own
              plane sits at z=0 and would otherwise block hover on cards behind it. */}
          <motion.div
            className="pointer-events-none absolute inset-0 z-10"
            style={{ rotateX: tiltX, rotateY: tiltY, transformStyle: "preserve-3d" }}
          >
            <motion.div
              className="absolute left-1/2 top-1/2 aspect-square will-change-transform"
              style={{
                width: isDeck ? "min(92vw, 46svh)" : "min(74svh, 44vw)",
                opacity: vesselOpacity,
                transform: vesselTransform,
              }}
            >
              <LabVesselMedia
                progress={frameProgress}
                source={TEMP_VESSEL_MEDIA}
                variant={isDeck ? "mobile" : "desktop"}
                scrub
                alt={COPY.mediaAlt}
                sizes={isDeck ? "92vw" : "44vw"}
              />
            </motion.div>

            <ul className="contents">
              {ICCSYN_APPLICATIONS.map((application, i) => (
                <SpatialCard
                  // Keyframe arrays differ per layout, so remount on a change.
                  key={`${layout}-${i}`}
                  application={application}
                  index={i}
                  layout={layout}
                  progress={progress}
                  isSpreadActive={spread}
                  hoveredIndex={hoveredIndex}
                  setHoveredIndex={setHoveredIndex}
                  onKeyboardFocus={revealOnTabFocus}
                />
              ))}
            </ul>
          </motion.div>

          {/* Headline */}
          <motion.div
            className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center px-5 text-center"
            style={{ scale: titleScale, y: titleY, filter: titleFilter }}
          >
            <h1 className="hero-brand">
              <span className="sr-only">{COPY.brand}</span>
              <DissolveText text={BRAND_DISPLAY} progress={progress} line="brand" isDeck={isDeck} />
            </h1>
            <p className="hero-tagline mt-4">
              <span className="sr-only">{COPY.tagline}</span>
              <DissolveText text={COPY.tagline} progress={progress} line="tagline" isDeck={isDeck} />
            </p>
          </motion.div>

          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-7 z-20 flex flex-col items-center gap-3"
            style={{ opacity: cueOpacity }}
          >
            <span className="hero-supply">{COPY.scrollCue}</span>
            <span className="h-10 w-px bg-glass/40" />
          </motion.div>

          {/* Final call to action */}
          <motion.div
            className="absolute inset-x-0 bottom-[max(1.25rem,3svh)] z-30 flex flex-col items-center gap-3 px-5 text-center"
            style={{ opacity: ctaOpacity, y: ctaY, pointerEvents: ctaPointerEvents }}
          >
            <HeroCta onFocus={(event) => revealOnTabFocus(event, 1)} />
            <p className="hero-supply">{COPY.supply}</p>
            <p className="hero-legal">{COPY.legal}</p>
          </motion.div>
        </div>
      </section>

      <div id={AFTER_HERO_ID} tabIndex={-1} className="outline-none" />
    </>
  );
}

export default function SpatialDepthHero({
  scrollLength = "standard",
}: {
  scrollLength?: HeroScrollLength;
}) {
  const reduce = useMediaQuery("(prefers-reduced-motion: reduce)");
  const isDeck = useMediaQuery("(max-width: 767px), (max-height: 659px)");
  const idleProgress = useMotionValue(0);

  if (reduce) return <StaticHero scrollProgress={idleProgress} />;
  return (
    <>
      {/* Without JavaScript nothing can drive the scroll scene, so it is hidden and
          the static layout takes its place. React skips this on the client. */}
      <noscript>
        <style>{".hero-animated { display: none; }"}</style>
        <StaticHero scrollProgress={idleProgress} />
      </noscript>
      <div className="hero-animated">
        <AnimatedHero
          key={isDeck ? "deck" : "spatial"}
          isDeck={isDeck}
          scrollLength={scrollLength}
        />
      </div>
    </>
  );
}
