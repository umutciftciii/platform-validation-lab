import type { ReactNode } from "react";

export interface SkeletonShellProps {
  title: string;
  service: string;
  children?: ReactNode;
}

/**
 * Neutral placeholder layout for apps that have no design yet (web-corporate, admin).
 * It must not carry brand claims or business content.
 */
export function SkeletonShell({ title, service, children }: SkeletonShellProps) {
  return (
    <main
      style={{
        minHeight: "100svh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        fontFamily: "system-ui, sans-serif",
        background: "#0f1115",
        color: "#e8e8ea",
      }}
    >
      <div style={{ maxWidth: "36rem" }}>
        <p style={{ opacity: 0.6, fontSize: "0.875rem", margin: 0 }}>{service}</p>
        <h1 style={{ fontSize: "1.75rem", margin: "0.5rem 0 1rem" }}>{title}</h1>
        {children}
      </div>
    </main>
  );
}
