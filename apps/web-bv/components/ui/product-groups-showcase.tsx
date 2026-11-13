"use client";

import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import {
  AUTO_ADVANCE_MS,
  type ProductGroup,
  type ProductGroupsCopy,
} from "@/content/product-groups";

const MAX_FRAME_MS = 100;
const MEDIA_SIZES = "(max-width: 899px) 100vw, min(56vw, 880px)";

function subscribeToReducedMotion(notify: () => void) {
  const list = window.matchMedia("(prefers-reduced-motion: reduce)");
  list.addEventListener("change", notify);
  return () => list.removeEventListener("change", notify);
}

function useReducedMotion() {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

function subscribeToVisibility(notify: () => void) {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
}

function useTabVisible() {
  return useSyncExternalStore(
    subscribeToVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
}

/** Same rule as the hero's vessel: no heavy media on Save-Data or 2G. */
function isLowData() {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  return Boolean(
    connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? ""),
  );
}

/** Poster underneath, so a slide is never empty while its animation loads. */
function GroupMedia({
  group,
  isActive,
  isMoving,
}: {
  group: ProductGroup;
  isActive: boolean;
  isMoving: boolean;
}) {
  const { media } = group;
  return (
    <div className="pg-media" data-active={isActive} data-kind={media.kind}>
      <Image
        src={media.poster}
        alt={group.mediaAlt}
        fill
        sizes={MEDIA_SIZES}
        unoptimized
        draggable={false}
      />
      {isActive && isMoving && media.kind === "gif" ? (
        <Image
          src={media.src}
          alt=""
          fill
          sizes={MEDIA_SIZES}
          unoptimized
          loading="eager"
          draggable={false}
        />
      ) : null}
      {isActive && isMoving && media.kind === "video" ? (
        <video aria-hidden autoPlay muted loop playsInline poster={media.poster}>
          {media.webm ? <source src={media.webm} type="video/webm" /> : null}
          <source src={media.mp4} type="video/mp4" />
        </video>
      ) : null}
    </div>
  );
}

function Arrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      aria-hidden
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={direction === "left" ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M3 10h14M11.5 4.5 17 10l-5.5 5.5" />
    </svg>
  );
}

/** CMS S2: groups and copy come from the published `bv.home` page (lib/cms-home.ts). */
export default function ProductGroupsShowcase({
  groups: PRODUCT_GROUPS,
  copy: COPY,
}: {
  groups: ProductGroup[];
  copy: ProductGroupsCopy;
}) {
  const COUNT = PRODUCT_GROUPS.length;
  const sectionRef = useRef<HTMLElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef(0);

  const [active, setActive] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [inView, setInView] = useState(false);
  const [nearView, setNearView] = useState(false);
  const [lowData, setLowData] = useState(false);

  const reduceMotion = useReducedMotion();
  const tabVisible = useTabVisible();

  const rotating =
    !reduceMotion && !userPaused && !hovering && !keyboardFocus && tabVisible && inView;
  // Hover and focus pause only the timer. Pause, reduced motion and low-data stop
  // the animation too. A GIF cannot pause, so it is swapped for its first frame.
  const isMoving = nearView && !reduceMotion && !userPaused && !lowData;

  // Any selection starts the seven seconds again.
  const goTo = (index: number) => {
    elapsedRef.current = 0;
    if (fillRef.current) fillRef.current.style.transform = "scaleX(0)";
    setActive((index + COUNT) % COUNT);
  };

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const visible = new IntersectionObserver(
      ([entry]) => setInView(entry.intersectionRatio >= 0.5),
      { threshold: [0, 0.5, 1] },
    );
    const near = new IntersectionObserver(
      ([entry]) => {
        setNearView(entry.isIntersecting);
        if (entry.isIntersecting) setLowData(isLowData());
      },
      { rootMargin: "50% 0px" },
    );
    visible.observe(section);
    near.observe(section);
    return () => {
      visible.disconnect();
      near.disconnect();
    };
  }, []);

  // The bar is written directly, so a running timer never re-renders the section.
  useEffect(() => {
    if (!rotating) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsedRef.current += Math.min(now - last, MAX_FRAME_MS);
      last = now;
      if (elapsedRef.current >= AUTO_ADVANCE_MS) {
        elapsedRef.current = 0;
        if (fillRef.current) fillRef.current.style.transform = "scaleX(0)";
        setActive((current) => (current + 1) % COUNT);
      } else if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${elapsedRef.current / AUTO_ADVANCE_MS})`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [rotating, COUNT]);

  // Loads the next animation ahead of time, so its first frames are ready.
  useEffect(() => {
    if (!isMoving) return;
    const next = PRODUCT_GROUPS[(active + 1) % COUNT].media;
    if (next.kind !== "gif") return;
    const preload = document.createElement("img");
    preload.src = next.src;
  }, [active, isMoving, COUNT, PRODUCT_GROUPS]);

  const onFocus = (event: FocusEvent<HTMLElement>) => {
    if (event.target.matches(":focus-visible")) setKeyboardFocus(true);
  };
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowLeft") goTo(active - 1);
    else if (event.key === "ArrowRight") goTo(active + 1);
  };
  // A mouse anywhere over the section holds the timer. Touch has no hover, so a tap
  // must not leave it stuck on.
  const onPointerEnter = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse") setHovering(true);
  };
  const onPointerLeave = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse") setHovering(false);
  };

  return (
    <section
      ref={sectionRef}
      id="product-groups"
      className="pg"
      aria-roledescription={COPY.carouselRole}
      aria-label={COPY.label}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {/* Without JavaScript every group is listed in normal flow. */}
      <noscript>
        <style>
          {
            ".pg-stage { display: block; } .pg-slide { max-width: 38rem; margin-bottom: 3rem; visibility: visible; opacity: 1; } .pg-slide > * { transform: none; } .pg-controls { display: none; }"
          }
        </style>
      </noscript>

      <h2 className="sr-only">{COPY.label}</h2>

      <div className="pg-media-stage">
        {PRODUCT_GROUPS.map((group, index) => (
          <GroupMedia
            key={group.id}
            group={group}
            isActive={index === active}
            isMoving={isMoving}
          />
        ))}
      </div>

      <div className="pg-stage" aria-live={rotating ? "off" : "polite"}>
        {PRODUCT_GROUPS.map((group, index) => (
          <article
            key={group.id}
            className="pg-slide"
            data-active={index === active}
            aria-roledescription={COPY.slideRole}
            aria-label={`${index + 1} of ${COUNT}`}
          >
            <p className="pg-eyebrow">{group.eyebrow}</p>
            <h3 className="pg-title">
              {group.name.word} <span>{group.name.numeral}</span>
            </h3>
            <p className="pg-text">{group.description}</p>
            {group.note ? <p className="pg-note">{group.note}</p> : null}
            <p className="pg-samples">{group.samples}</p>
            <a href={group.cta.href} className="pg-cta">
              {group.cta.label}
              <Arrow direction="right" />
            </a>
            <p className="pg-disclosure">{COPY.disclosure}</p>
          </article>
        ))}
      </div>

      <div className="pg-controls">
        <div className="pg-nav">
          <button
            type="button"
            className="pg-arrow"
            aria-label={COPY.previous}
            onClick={() => goTo(active - 1)}
          >
            <Arrow direction="left" />
          </button>

          <div className="pg-groups">
            {PRODUCT_GROUPS.map((group, index) => (
              <button
                key={group.id}
                type="button"
                className="pg-group"
                aria-current={index === active ? "true" : undefined}
                onClick={() => goTo(index)}
              >
                <span aria-hidden className="pg-group-dot" />
                {group.name.word} {group.name.numeral}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="pg-arrow"
            aria-label={COPY.next}
            onClick={() => goTo(active + 1)}
          >
            <Arrow direction="right" />
          </button>
        </div>

        {/* With reduced motion nothing advances, so there is nothing to pause. */}
        {reduceMotion ? null : (
          <div className="pg-timing">
            <button
              type="button"
              className="pg-toggle"
              aria-label={userPaused ? COPY.play : COPY.pause}
              onClick={() => setUserPaused((paused) => !paused)}
            >
              <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                {userPaused ? (
                  <path d="M5 3.2v11.6c0 .5.5.8 1 .5l9-5.8c.4-.2.4-.8 0-1l-9-5.8c-.5-.3-1 0-1 .5Z" />
                ) : (
                  <path d="M4.5 3h3v12h-3zM10.5 3h3v12h-3z" />
                )}
              </svg>
            </button>
            <div aria-hidden className="pg-track" data-held={hovering || keyboardFocus}>
              <div ref={fillRef} className="pg-fill" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
