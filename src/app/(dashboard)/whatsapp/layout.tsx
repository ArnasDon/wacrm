import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "WhatsApp",
};

export default function WhatsAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
