import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

export const metadata: Metadata = {
  title: "QA Exam Platform",
  description: "Internal QA evaluation platform for support agents",
  icons: {
    icon: [
      { url: "/icon.png?v=3", type: "image/png" },
      { url: "/favicon-32x32.png?v=3", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png?v=3", sizes: "16x16", type: "image/png" },
      { url: "/favicon.ico?v=3", sizes: "any" },
    ],
    apple: [
      { url: "/apple-icon.png?v=3", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico?v=3" sizes="any" />
        <link rel="icon" href="/icon.png?v=3" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-icon.png?v=3" />
      </head>
      <body className="bg-surface text-slate-900 antialiased dark:bg-surface-dark dark:text-slate-100">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
