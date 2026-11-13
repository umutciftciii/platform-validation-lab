"use client";

import { useMotionValueEvent, useScroll, useSpring } from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from "react";

import { CTL_COPY as COPY, CTL_STAGES as STAGES } from "@/content/ctl-technology";

/**
 * Three layouts share one DOM, so the text order and the image alts never change:
 * - Cinematic: desktop with motion. The stage is sticky and the page's own scroll
 *   drives it, so nothing intercepts the wheel. The same query is in globals.css.
 * - Reveal: phones and short screens. Stacked; each stage fades in once as it arrives.
 *   The scroll driver is not even mounted, so no code runs on scroll.
 * - Static: reduced motion or no script. Stacked, with no animation.
 */
const CINEMATIC_QUERY =
  "(scripting: enabled) and (min-width: 900px) and (min-height: 560px) and (prefers-reduced-motion: no-preference)";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** Same follow speed as the hero, so the two scroll scenes feel alike. */
const SCROLL_SPRING = { stiffness: 80, damping: 25, restDelta: 0.001 };

/** Scroll progress at which each image hands over to the next. */
const HANDOVERS = [
  [0.28, 0.42],
  [0.62, 0.76],
] as const;
/** Where a stage button lands: the middle of that stage's hold. */
const STAGE_ANCHORS = [0.14, 0.52, 0.88];
/** Text changes inside this share of the handover, so two stages never overlap. */
const TEXT_OUT_END = 0.42;
const TEXT_IN_START = 0.58;

/** Never below 1: the frame runs off the page edge, so a smaller image would show its side. */
const SCALE_ENTER = 1;
const SCALE_HOLD_START = 1.06;
const SCALE_HOLD_END = 1.1;
const SCALE_EXIT = 1.24;
const TEXT_TRAVEL_PX = 22;

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

function ramp(value: number, start: number, end: number) {
  const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

/** Opacity and scale of one image, and the opacity and offset of its text. */
function stageFrame(index: number, progress: number) {
  const before = index > 0 ? HANDOVERS[index - 1] : null;
  const after = index < HANDOVERS.length ? HANDOVERS[index] : null;

  const enter = before ? ramp(progress, before[0], before[1]) : 1;
  const exit = after ? ramp(progress, after[0], after[1]) : 0;
  const holdStart = before ? before[1] : 0;
  const holdEnd = after ? after[0] : 1;
  const hold = ramp(progress, holdStart, holdEnd);

  const scale =
    SCALE_ENTER +
    (SCALE_HOLD_START - SCALE_ENTER) * enter +
    (SCALE_HOLD_END - SCALE_HOLD_START) * hold +
    (SCALE_EXIT - SCALE_HOLD_END) * exit;

  const textIn = before
    ? ramp(progress, before[0] + (before[1] - before[0]) * TEXT_IN_START, before[1])
    : 1;
  const textOut = after
    ? ramp(progress, after[0], after[0] + (after[1] - after[0]) * TEXT_OUT_END)
    : 0;

  return {
    imageOpacity: enter * (1 - exit),
    scale,
    textOpacity: textIn * (1 - textOut),
    textY: (1 - textIn) * TEXT_TRAVEL_PX - textOut * TEXT_TRAVEL_PX,
  };
}

/** The stage named by the buttons switches halfway through each handover. */
function stageAt(progress: number) {
  return HANDOVERS.filter(([start, end]) => progress >= (start + end) / 2).length;
}

/** Mounted only in the cinematic layout, so the other layouts never track scroll. */
function ScrollDriver({
  target,
  onProgress,
}: {
  target: RefObject<HTMLElement | null>;
  onProgress: (value: number) => void;
}) {
  const { scrollYProgress } = useScroll({ target, offset: ["start start", "end end"] });
  const progress = useSpring(scrollYProgress, SCROLL_SPRING);
  useMotionValueEvent(progress, "change", onProgress);

  // Paints the position the page is already at, for a reload partway down.
  const latestOnProgress = useRef(onProgress);
  useEffect(() => {
    latestOnProgress.current = onProgress;
  });
  useEffect(() => {
    latestOnProgress.current(progress.get());
  }, [progress]);

  return null;
}

export default function CtlTechnology() {
  const sectionRef = useRef<HTMLElement>(null);
  const figureRefs = useRef<(HTMLElement | null)[]>([]);
  const imageRefs = useRef<(HTMLImageElement | null)[]>([]);
  const textRefs = useRef<(HTMLDivElement | null)[]>([]);
  const stageRefs = useRef<(HTMLLIElement | null)[]>([]);

  const cinematic = useMediaQuery(CINEMATIC_QUERY);
  const reduced = useMediaQuery(REDUCED_QUERY);
  const [activeStage, setActiveStage] = useState(0);
  const [isNear, setIsNear] = useState(false);
  const [visibleStages, setVisibleStages] = useState<ReadonlySet<number>>(() => new Set());

  // Written straight to the elements, so scrolling never re-renders the section. Only
  // transform and opacity change, which the compositor handles without new layout.
  const paint = (value: number) => {
    STAGES.forEach((_, index) => {
      const frame = stageFrame(index, value);
      const figure = figureRefs.current[index];
      const image = imageRefs.current[index];
      const text = textRefs.current[index];
      if (figure) {
        figure.style.opacity = `${frame.imageOpacity}`;
        figure.style.visibility = frame.imageOpacity > 0 ? "visible" : "hidden";
      }
      if (image) image.style.transform = `scale(${frame.scale})`;
      if (text) {
        // Stays in the accessibility tree, so a screen reader reads all three stages.
        text.style.opacity = `${frame.textOpacity}`;
        text.style.transform = `translateY(${frame.textY}px)`;
      }
    });
  };

  const onProgress = (value: number) => {
    paint(value);
    const stage = stageAt(value);
    setActiveStage((current) => (current === stage ? current : stage));
  };

  // Leaving cinematic clears every written style, so the stacked layout is purely what
  // the stylesheet says.
  useEffect(() => {
    if (cinematic) return;
    STAGES.forEach((_, index) => {
      figureRefs.current[index]?.removeAttribute("style");
      imageRefs.current[index]?.style.removeProperty("transform");
      textRefs.current[index]?.removeAttribute("style");
    });
  }, [cinematic]);

  // Lazy loading would start each image only as it turned visible, in the middle of
  // its crossfade. All three load as the section nears.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setIsNear(true);
        near.disconnect();
      },
      { rootMargin: "100% 0px" },
    );
    near.observe(section);
    return () => near.disconnect();
  }, []);

  const reveals = !cinematic && !reduced;
  useEffect(() => {
    if (!reveals) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const index = stageRefs.current.indexOf(entry.target as HTMLLIElement);
          setVisibleStages((current) => new Set(current).add(index));
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.15 },
    );
    stageRefs.current.forEach((stage) => {
      if (stage) observer.observe(stage);
    });
    return () => observer.disconnect();
  }, [reveals]);

  const goToStage = (index: number) => {
    const section = sectionRef.current;
    if (!section) return;
    const top = section.getBoundingClientRect().top + window.scrollY;
    const range = section.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + STAGE_ANCHORS[index] * range, behavior: "smooth" });
  };

  return (
    <section
      ref={sectionRef}
      id="ctl-technology"
      className="ctl"
      aria-labelledby="ctl-title"
      data-reveal={reveals}
    >
      {cinematic ? <ScrollDriver target={sectionRef} onProgress={onProgress} /> : null}

      <a href="#after-ctl-technology" className="skip-link">
        {COPY.skip}
      </a>

      <div className="ctl-sticky">
        <header className="ctl-head">
          <p className="ctl-eyebrow">{COPY.eyebrow}</p>
          <h2 id="ctl-title" className="ctl-title">
            {COPY.title}
          </h2>
        </header>

        <ol className="ctl-stages" aria-label={COPY.stagesLabel}>
          {STAGES.map((stage, index) => (
            <li
              key={stage.id}
              ref={(node) => {
                stageRefs.current[index] = node;
              }}
              className="ctl-stage"
              data-visible={visibleStages.has(index)}
            >
              <figure
                ref={(node) => {
                  figureRefs.current[index] = node;
                }}
                className="ctl-figure"
                data-stage={index}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- already sized WebP files; a CMS would supply plain URLs. */}
                <img
                  ref={(node) => {
                    imageRefs.current[index] = node;
                  }}
                  className="ctl-image"
                  src={stage.image.src}
                  width={stage.image.width}
                  height={stage.image.height}
                  alt={stage.image.alt}
                  loading={isNear ? "eager" : "lazy"}
                  decoding="async"
                  style={
                    {
                      "--ctl-position-desktop": stage.image.positionDesktop,
                      "--ctl-position-mobile": stage.image.positionMobile,
                    } as CSSProperties
                  }
                />
              </figure>
              <div
                ref={(node) => {
                  textRefs.current[index] = node;
                }}
                className="ctl-text"
                data-stage={index}
              >
                <h3 className="ctl-stage-title">{stage.title}</h3>
                <p className="ctl-stage-body">{stage.description}</p>
                <p className="ctl-stage-note">{stage.disclosure}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="ctl-foot">
          <nav className="ctl-nav" aria-label={COPY.stageNavLabel}>
            {STAGES.map((stage, index) => (
              <button
                key={stage.id}
                type="button"
                className="ctl-nav-item"
                aria-current={index === activeStage ? "step" : undefined}
                onClick={() => goToStage(index)}
              >
                {stage.title}
              </button>
            ))}
          </nav>
          <a href={COPY.document.href} className="ctl-document">
            {COPY.document.label}
          </a>
        </div>
      </div>

      <span id="after-ctl-technology" tabIndex={-1} className="ctl-end" />
    </section>
  );
}
