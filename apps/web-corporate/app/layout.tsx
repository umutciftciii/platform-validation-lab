import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dream Petroleum — corporate (skeleton)",
  // Skeleton only: keep it out of search engines until the real site exists.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
