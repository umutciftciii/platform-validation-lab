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

import {
  APPLICATION_SCENES as SCENES,
  APPLICATIONS_COPY as COPY,
} from "@/content/applications-showcase";

/**
 * Three layouts share one DOM, so the text order and the image alts never change:
 * - Cinematic: desktop with motion. The stage is sticky and the page's own scroll drives
 *   it, so nothing intercepts the wheel. The same query is in globals.css.
 * - Reveal: phones and short screens. Stacked; each scene fades in once as it arrives.
 *   The scroll driver is not even mounted, so no code runs on scroll.
 * - Static: reduced motion or no script. Stacked, with no animation.
 */
const CINEMATIC_QUERY =
  "(scripting: enabled) and (min-width: 900px) and (min-height: 560px) and (prefers-reduced-motion: no-preference)";
/** False on the server and without script, so nothing starts out hidden. */
const REVEAL_QUERY =
  "(scripting: enabled) and (prefers-reduced-motion: no-preference) and ((max-width: 899.98px) or (max-height: 559.98px))";

/** Same follow speed as the other scroll scenes on this page. */
const SCROLL_SPRING = { stiffness: 80, damping: 25, restDelta: 0.001 };

/** The first image grows from a window to the full frame over this range. */
const GROW: readonly [number, number] = [0.015, 0.15];
/** The opening heading leaves over this range, before the first scene's text arrives. */
const INTRO_OUT: readonly [number, number] = [0.02, 0.065];
/** The small label takes over in the same spot only once the heading has gone. */
const TAG_IN: readonly [number, number] = [0.07, 0.11];
/** Scroll progress at which each scene hands over to the next. */
const HANDOVERS = [
  [0.4, 0.52],
  [0.7, 0.82],
] as const;
/** Where a scene button lands: the middle of that scene's hold. */
const SCENE_ANCHORS = [0.27, 0.61, 0.92];
const FIRST_TEXT_IN: readonly [number, number] = [0.12, 0.17];
/** Text changes inside this share of the handover, so two scenes never overlap. */
const TEXT_OUT_END = 0.42;
const TEXT_IN_START = 0.58;

/** Never below 1.03: the parallax shift below must not uncover the image's edge. */
const SCALE_ARRIVE = 1.14;
const SCALE_HOLD_START = 1.03;
const SCALE_HOLD_END = 1.06;
const SCALE_LEAVE = 1.12;
/** Image drift across one scene, in percent of its own height. Slower than the text. */
const IMAGE_DRIFT = 1.6;
/** Text drift across one scene, in px. Faster than the image, so the two separate. */
const TEXT_ARRIVE_PX = 56;
const TEXT_LEAVE_PX = 36;

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

function linear(value: number, start: number, end: number) {
  return Math.min(1, Math.max(0, (value - start) / (end - start)));
}

/** Opacity, scale and shift of one image, and the opacity and offset of its text. */
function sceneFrame(index: number, progress: number) {
  const before = index > 0 ? HANDOVERS[index - 1] : null;
  const after = index < HANDOVERS.length ? HANDOVERS[index] : null;

  const enter = before ? ramp(progress, before[0], before[1]) : ramp(progress, GROW[0], GROW[1]);
  const exit = after ? ramp(progress, after[0], after[1]) : 0;
  const holdStart = before ? before[1] : GROW[1];
  const holdEnd = after ? after[0] : 1;
  const hold = ramp(progress, holdStart, holdEnd);

  const scale =
    SCALE_ARRIVE +
    (SCALE_HOLD_START - SCALE_ARRIVE) * enter +
    (SCALE_HOLD_END - SCALE_HOLD_START) * hold +
    (SCALE_LEAVE - SCALE_HOLD_END) * exit;

  // Linear, so the image never stops drifting while the page moves.
  const span = linear(progress, before ? before[0] : 0, after ? after[1] : 1);

  const textIn = before
    ? ramp(progress, before[0] + (before[1] - before[0]) * TEXT_IN_START, before[1])
    : ramp(progress, FIRST_TEXT_IN[0], FIRST_TEXT_IN[1]);
  const textOut = after
    ? ramp(progress, after[0], after[0] + (after[1] - after[0]) * TEXT_OUT_END)
    : 0;

  return {
    // The first image is on screen from the start, as a window. It never fades in.
    imageOpacity: (before ? enter : 1) * (1 - exit),
    scale,
    imageY: IMAGE_DRIFT - span * 2 * IMAGE_DRIFT,
    textOpacity: textIn * (1 - textOut),
    textY: (1 - textIn) * TEXT_ARRIVE_PX - textOut * TEXT_LEAVE_PX,
  };
}

/** The amber light that crosses the frame during a handover: 0 at rest, 1 mid-crossing. */
function sweepAt(progress: number) {
  for (const [start, end] of HANDOVERS) {
    if (progress <= start || progress >= end) continue;
    const t = (progress - start) / (end - start);
    return { opacity: Math.sin(t * Math.PI), x: t * 2 - 1 };
  }
  return { opacity: 0, x: -1 };
}

/** The scene named by the buttons switches halfway through each handover. */
function sceneAt(progress: number) {
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

export default function ApplicationsShowcase() {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const figureRefs = useRef<(HTMLElement | null)[]>([]);
  const imageRefs = useRef<(HTMLImageElement | null)[]>([]);
  const textRefs = useRef<(HTMLDivElement | null)[]>([]);
  const sceneRefs = useRef<(HTMLLIElement | null)[]>([]);

  const cinematic = useMediaQuery(CINEMATIC_QUERY);
  const reveals = useMediaQuery(REVEAL_QUERY);
  const [activeScene, setActiveScene] = useState(0);
  const [isNear, setIsNear] = useState(false);
  const [visibleScenes, setVisibleScenes] = useState<ReadonlySet<number>>(() => new Set());

  // Written straight to the elements, so scrolling never re-renders the section. Only
  // transform and opacity change, plus the two variables they are calculated from.
  const paint = (value: number) => {
    const sticky = stickyRef.current;
    if (sticky) {
      const sweep = sweepAt(value);
      sticky.style.setProperty("--apps-grow", `${ramp(value, GROW[0], GROW[1])}`);
      sticky.style.setProperty("--apps-intro-out", `${ramp(value, INTRO_OUT[0], INTRO_OUT[1])}`);
      sticky.style.setProperty("--apps-tag", `${ramp(value, TAG_IN[0], TAG_IN[1])}`);
      sticky.style.setProperty("--apps-sweep-opacity", `${sweep.opacity}`);
      sticky.style.setProperty("--apps-sweep-x", `${sweep.x}`);
    }
    SCENES.forEach((_, index) => {
      const frame = sceneFrame(index, value);
      const figure = figureRefs.current[index];
      const image = imageRefs.current[index];
      const text = textRefs.current[index];
      if (figure) {
        figure.style.opacity = `${frame.imageOpacity}`;
        figure.style.visibility = frame.imageOpacity > 0 ? "visible" : "hidden";
      }
      if (image) {
        image.style.transform = `translate3d(0, ${frame.imageY}%, 0) scale(${frame.scale})`;
      }
      if (text) {
        // Stays in the accessibility tree, so a screen reader reads all three scenes.
        text.style.opacity = `${frame.textOpacity}`;
        text.style.transform = `translate3d(0, ${frame.textY}px, 0)`;
        text.style.pointerEvents = frame.textOpacity > 0.5 ? "auto" : "none";
      }
    });
  };

  const onProgress = (value: number) => {
    paint(value);
    const scene = sceneAt(value);
    setActiveScene((current) => (current === scene ? current : scene));
  };

  // Leaving cinematic clears every written style, so the stacked layout is purely what
  // the stylesheet says.
  useEffect(() => {
    if (cinematic) return;
    stickyRef.current?.removeAttribute("style");
    SCENES.forEach((_, index) => {
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

  useEffect(() => {
    if (!reveals) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const index = sceneRefs.current.indexOf(entry.target as HTMLLIElement);
          setVisibleScenes((current) => new Set(current).add(index));
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.15 },
    );
    sceneRefs.current.forEach((scene) => {
      if (scene) observer.observe(scene);
    });
    return () => observer.disconnect();
  }, [reveals]);

  const goToScene = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const top = track.getBoundingClientRect().top + window.scrollY;
    const range = track.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + SCENE_ANCHORS[index] * range, behavior: "smooth" });
  };

  // A link in a scene that is not fully on screen is faded out, so Tab must bring it in.
  const onSceneFocus = (index: number) => {
    if (cinematic && textRefs.current[index]?.style.opacity !== "1") goToScene(index);
  };

  return (
    <section
      ref={sectionRef}
      id="applications"
      className="apps"
      aria-labelledby="applications-title"
      data-reveal={reveals}
    >
      <a href="#applications-validation" className="skip-link">
        {COPY.skip}
      </a>

      <div ref={trackRef} className="apps-track">
        {cinematic ? <ScrollDriver target={trackRef} onProgress={onProgress} /> : null}

        <div ref={stickyRef} className="apps-sticky">
          <header className="apps-head">
            <p className="apps-eyebrow">{COPY.eyebrow}</p>
            <h2 id="applications-title" className="apps-title">
              {COPY.title} <span className="apps-title-status">— {COPY.status}</span>
            </h2>
            <p className="apps-intro">{COPY.intro}</p>
          </header>

          {/* Keeps the label on screen after the heading has left. The heading is the real one. */}
          <p className="apps-tag" aria-hidden="true">
            {COPY.title} — {COPY.status}
          </p>

          <ol className="apps-scenes" aria-label={COPY.scenesLabel}>
            {SCENES.map((scene, index) => (
              <li
                key={scene.id}
                ref={(node) => {
                  sceneRefs.current[index] = node;
                }}
                className="apps-scene"
                data-visible={visibleScenes.has(index)}
              >
                <figure
                  ref={(node) => {
                    figureRefs.current[index] = node;
                  }}
                  className="apps-figure"
                  data-scene={index}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- already sized WebP files; a CMS would supply plain URLs. */}
                  <img
                    ref={(node) => {
                      imageRefs.current[index] = node;
                    }}
                    className="apps-image"
                    src={scene.image.src}
                    srcSet={`${scene.image.srcSmall} 828w, ${scene.image.src} 1448w`}
                    // 276 px is 828 / 3: every phone, whatever its pixel density, takes the small file.
                    sizes="(max-width: 599.98px) 276px, 100vw"
                    width={scene.image.width}
                    height={scene.image.height}
                    alt={scene.image.alt}
                    loading={isNear ? "eager" : "lazy"}
                    decoding="async"
                    style={
                      { "--apps-position-desktop": scene.image.positionDesktop } as CSSProperties
                    }
                  />
                </figure>
                <div
                  ref={(node) => {
                    textRefs.current[index] = node;
                  }}
                  className="apps-text"
                  data-scene={index}
                  onFocus={() => onSceneFocus(index)}
                >
                  <h3 className="apps-scene-title">{scene.title}</h3>
                  <div className="apps-scene-copy">
                    <p className="apps-scene-body">{scene.description}</p>
                    <p className="apps-scene-note">{scene.disclosure}</p>
                    <a href={scene.cta.href} className="apps-cta">
                      {scene.cta.label}
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="apps-sweep" aria-hidden="true" />
          <div className="apps-scrim" aria-hidden="true" />

          <nav className="apps-nav" aria-label={COPY.sceneNavLabel}>
            {SCENES.map((scene, index) => (
              <button
                key={scene.id}
                type="button"
                className="apps-nav-item"
                aria-current={index === activeScene ? "step" : undefined}
                onClick={() => goToScene(index)}
              >
                {scene.title}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div id="applications-validation" tabIndex={-1} className="apps-validation">
        <h3 className="apps-validation-title">{COPY.validation.title}</h3>
        <div className="apps-validation-body">
          <p className="apps-validation-intro">{COPY.validation.intro}</p>
          <ul className="apps-validation-list">
            {COPY.validation.requirements.map((requirement) => (
              <li key={requirement}>{requirement}</li>
            ))}
          </ul>
          <p className="apps-validation-note">{COPY.validation.note}</p>
          <a href={COPY.validation.cta.href} className="apps-cta">
            {COPY.validation.cta.label}
          </a>
        </div>
      </div>
    </section>
  );
}
