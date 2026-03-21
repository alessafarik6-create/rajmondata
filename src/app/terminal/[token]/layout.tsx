import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Docházkový terminál",
  description: "Docházkový terminál pro tablet",
  robots: "noindex, nofollow",
};

export default function TerminalTokenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
