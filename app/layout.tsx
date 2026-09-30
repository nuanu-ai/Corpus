import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { ThemeProvider } from "next-themes";
import { ToastProvider } from "@/components/ui/toaster";
import { getAppCopy } from "@/lib/i18n/copy";
import { getRequestLocaleValue } from "@/lib/i18n/request-locale";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "cyrillic"],
});

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://corpus.example";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocaleValue();
  const copy = getAppCopy(locale).site;

  return {
    title: copy.appName,
    description: copy.appDescription,
    metadataBase: new URL(appUrl),
    applicationName: copy.appName,
    alternates: {
      canonical: "/",
    },
    openGraph: {
      type: "website",
      url: "/",
      siteName: copy.appName,
      title: copy.appName,
      description: copy.appDescription,
      images: [
        {
          url: "/opengraph-image?social=og",
          width: 1200,
          height: 630,
          alt: `${copy.appName} platform overview`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: copy.appName,
      description: copy.appDescription,
      images: ["/opengraph-image?social=twitter"],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocaleValue();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.variable} ${jetBrainsMono.variable} antialiased`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
            <ToastProvider>
              {children}
            </ToastProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
