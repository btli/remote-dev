import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In — Remote Dev",
  description: "Sign in to Remote Dev terminal interface",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
