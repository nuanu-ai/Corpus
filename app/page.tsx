import type { Metadata } from "next";
import { headers } from "next/headers";

import { MarketingLanding } from "@/app/_components/marketing-landing";
import { resolveLocaleFromAcceptLanguage } from "@/lib/i18n/config";
import { getLandingCopy, getLandingLocale } from "@/lib/landing-copy";
import { getLandingCustomerProof } from "@/lib/landing-proof";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://corpus.example";

function getBaseUrl() {
  try {
    return new URL(appUrl);
  } catch {
    return new URL("https://corpus.example");
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const requestLocale = await getBrowserLocale();
  const copy = getLandingCopy(requestLocale);
  const baseUrl = getBaseUrl();

  return {
    title: copy.metadata.title,
    description: copy.metadata.description,
    keywords: copy.metadata.keywords,
    metadataBase: baseUrl,
    alternates: {
      canonical: copy.metadata.canonicalPath,
      languages: {
        en: "/",
        ru: "/",
      },
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      type: "website",
      url: copy.metadata.canonicalPath,
      siteName: "Corpus",
      title: copy.metadata.ogTitle,
      description: copy.metadata.ogDescription,
      locale: copy.metadata.ogLocale,
      images: [
        {
          url: "/opengraph-image?social=og",
          width: 1200,
          height: 630,
          alt: "Corpus landing page",
        },
      ],
    },
    twitter: {
      card: copy.metadata.twitterCard,
      title: copy.metadata.ogTitle,
      description: copy.metadata.ogDescription,
      images: ["/opengraph-image?social=twitter"],
    },
  };
}

async function getBrowserLocale() {
  const requestHeaders = await headers();
  return resolveLocaleFromAcceptLanguage(requestHeaders.get("accept-language"));
}

export default async function Home() {
  const requestLocale = await getBrowserLocale();
  const locale = getLandingLocale(requestLocale);
  const copy = getLandingCopy(locale);
  const customerProof = await getLandingCustomerProof();

  const softwareApplicationJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Corpus",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: copy.metadata.description,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: copy.faq.items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <MarketingLanding copy={copy} locale={locale} customerProof={customerProof} />
    </>
  );
}
