import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// ── Types ────────────────────────────────────────────────────

export interface WebsiteAnalysis {
  url: string;
  businessType: string;
  detectedProviders: string[];
  pricingModel: string | null;
  techStack: string[];
  markets: string[];
  legalEntityMentions: string[];
  confidence: number;
}

const MAX_SCRAPER_RESPONSE_BYTES = 500_000;

// ── Provider patterns ────────────────────────────────────────

const PROVIDER_PATTERNS: Record<string, RegExp[]> = {
  stripe: [/js\.stripe\.com/, /stripe\.js/, /stripe\.com/],
  paypal: [/paypal\.com\/sdk/, /paypalobjects\.com/, /paypal\.com/],
  shopify: [/cdn\.shopify\.com/, /myshopify\.com/, /shopify/],
  square: [/squareup\.com/],
  braintree: [/braintreegateway\.com/],
  adyen: [/adyen\.com/],
  paddle: [/paddle\.com/, /paddle\.js/],
  gocardless: [/gocardless/],
  truelayer: [/truelayer/],
  mercury: [/mercury\.com/],
};

// ── Business type signals ────────────────────────────────────

const BUSINESS_TYPE_SIGNALS: Record<string, RegExp[]> = {
  Fintech: [
    /\bpayment engine\b/,
    /\bon-ramp\b/,
    /\boff-ramp\b/,
    /\bpay-?in\b/,
    /\bpay-?out\b/,
    /\bpayouts?\b/,
    /\bmerchant balance\b/,
    /\bdigital assets?\b/,
    /\bcrypto\b/,
    /\bfiat\b/,
    /\bkyc\b/,
    /\bkyb\b/,
    /\baml\b/,
    /\bsettlement\b/,
    /\bpayment methods?\b/,
  ],
  SaaS: [
    /\bpricing\b/,
    /\bplans\b/,
    /\bsubscription\b/,
    /\bmonthly\b/,
    /\bannual\b/,
    /\bper seat\b/,
    /\bper user\b/,
  ],
  "E-commerce": [
    /\bshop\b/,
    /\bcart\b/,
    /\badd to cart\b/,
    /\bcheckout\b/,
    /\bproduct\b/,
    /\bbuy now\b/,
  ],
  Marketplace: [
    /\bmarketplace\b/,
    /\bsellers\b/,
    /\bbuyers\b/,
    /\blist your\b/,
    /\bearn money\b/,
  ],
  Agency: [
    /\bservices\b/,
    /\bportfolio\b/,
    /\bclients\b/,
    /\bcase studies\b/,
    /\bconsulting\b/,
  ],
};

// ── Pricing model signals ────────────────────────────────────

const PRICING_MODEL_SIGNALS: Record<string, RegExp[]> = {
  subscription: [/\bmonthly\b/, /\bannual\b/, /\/mo\b/, /\/year\b/, /\bsubscribe\b/],
  freemium: [/\bfree plan\b/, /\bfree tier\b/, /\bget started free\b/],
  "usage-based": [
    /\bpay as you go\b/,
    /\bper api call\b/,
    /\busage-based\b/,
    /\bmetered\b/,
  ],
  "one-time": [/\bone-time\b/, /\blifetime\b/, /\bpay once\b/],
};

// ── Tech stack patterns ──────────────────────────────────────

const TECH_STACK_PATTERNS: Record<string, RegExp[]> = {
  "next.js": [/__next_data__/, /_next\//],
  react: [/react\.production/, /react\.development/, /reactdom/],
  vercel: [/vercel/],
  wordpress: [/wp-content/, /wp-includes/],
  webflow: [/webflow/],
  wix: [/wix/],
  gatsby: [/gatsby/],
  vue: [/vue\.js/, /vuejs/],
  angular: [/ng-version/],
};

// ── Market detection ─────────────────────────────────────────

interface MarketSignal {
  market: string;
  patterns: RegExp[];
}

const MARKET_SIGNALS: MarketSignal[] = [
  { market: "US", patterns: [/\busd\b/, /\$\d/] },
  { market: "EU", patterns: [/\beur\b/, /\u20ac/] },
  { market: "UK", patterns: [/\bgbp\b/, /\u00a3/] },
];

const GLOBAL_PATTERNS: RegExp[] = [/\bglobal\b/, /\bworldwide\b/];

// ── Legal entity regex ───────────────────────────────────────

const LEGAL_ENTITY_RE =
  /((?:[A-Z][A-Za-z0-9&'.]*)(?:\s+[A-Z][A-Za-z0-9&'.]*)*)\s+(Inc\.?|LLC|Ltd\.?|GmbH|SRL|O\u00dc|AG|Corp\.?|Pty|BV|SAS|SARL)/g;

// ── Core analysis functions ──────────────────────────────────

function detectProviders(html: string): string[] {
  const found: string[] = [];
  for (const [provider, patterns] of Object.entries(PROVIDER_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(html)) {
        found.push(provider);
        break;
      }
    }
  }
  return found;
}

function detectBusinessType(html: string): string {
  let bestType = "Unknown";
  let bestCount = 0;

  for (const [type, patterns] of Object.entries(BUSINESS_TYPE_SIGNALS)) {
    let count = 0;
    for (const pattern of patterns) {
      if (pattern.test(html)) {
        count++;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestType = type;
    }
  }

  return bestType;
}

function detectPricingModel(html: string): string | null {
  let bestModel: string | null = null;
  let bestCount = 0;

  for (const [model, patterns] of Object.entries(PRICING_MODEL_SIGNALS)) {
    let count = 0;
    for (const pattern of patterns) {
      if (pattern.test(html)) {
        count++;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestModel = model;
    }
  }

  return bestModel;
}

function detectTechStack(html: string): string[] {
  const found: string[] = [];
  for (const [tech, patterns] of Object.entries(TECH_STACK_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(html)) {
        found.push(tech);
        break;
      }
    }
  }
  return found;
}

function detectMarkets(html: string): string[] {
  const markets: string[] = [];

  for (const signal of MARKET_SIGNALS) {
    for (const pattern of signal.patterns) {
      if (pattern.test(html)) {
        markets.push(signal.market);
        break;
      }
    }
  }

  for (const pattern of GLOBAL_PATTERNS) {
    if (pattern.test(html)) {
      if (!markets.includes("Global")) {
        markets.push("Global");
      }
      break;
    }
  }

  // Multiple distinct currencies also signal "Global"
  if (markets.length >= 2 && !markets.includes("Global")) {
    markets.push("Global");
  }

  return markets;
}

function extractLegalEntities(rawHtml: string): string[] {
  // Use the original (non-lowercased) HTML to preserve casing
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  LEGAL_ENTITY_RE.lastIndex = 0;

  while ((match = LEGAL_ENTITY_RE.exec(rawHtml)) !== null) {
    const full = match[0].trim();
    if (!matches.includes(full)) {
      matches.push(full);
    }
  }

  return matches;
}

function calculateConfidence(analysis: Omit<WebsiteAnalysis, "confidence">): number {
  let signals = 0;
  let maxSignals = 5; // providers, businessType, pricingModel, techStack, markets

  if (analysis.detectedProviders.length > 0) signals++;
  if (analysis.businessType !== "Unknown") signals++;
  if (analysis.pricingModel !== null) signals++;
  if (analysis.techStack.length > 0) signals++;
  if (analysis.markets.length > 0) signals++;

  // Bonus for multiple providers or tech stack items
  if (analysis.detectedProviders.length > 1) {
    signals += 0.5;
    maxSignals += 0.5;
  }
  if (analysis.techStack.length > 1) {
    signals += 0.5;
    maxSignals += 0.5;
  }
  if (analysis.legalEntityMentions.length > 0) {
    signals += 0.5;
    maxSignals += 0.5;
  }

  return Math.min(1, Math.round((signals / maxSignals) * 100) / 100);
}

// ── URL validation (SSRF protection) ────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "metadata.google.internal",
  "169.254.169.254",
]);

function isBlockedIpv4(value: string): boolean {
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    a === 169 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isBlockedIpv6(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

function isBlockedAddress(value: string): boolean {
  const ipVersion = isIP(value);
  if (ipVersion === 4) return isBlockedIpv4(value);
  if (ipVersion === 6) return isBlockedIpv6(value);
  return false;
}

async function hostnameResolvesToPublicInternet(hostname: string): Promise<boolean> {
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return false;
  }

  if (isBlockedAddress(hostname)) {
    return false;
  }

  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    if (records.length === 0) return false;
    return records.every((record) => !isBlockedAddress(record.address));
  } catch {
    return false;
  }
}

function isAllowedUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  return !BLOCKED_HOSTNAMES.has(hostname) && !isBlockedAddress(hostname);
}

// ── Main export ──────────────────────────────────────────────

export async function analyzeWebsite(url: string): Promise<WebsiteAnalysis> {
  const emptyResult: WebsiteAnalysis = {
    url,
    businessType: "Unknown",
    detectedProviders: [],
    pricingModel: null,
    techStack: [],
    markets: [],
    legalEntityMentions: [],
    confidence: 0,
  };

  if (!isAllowedUrl(url)) {
    return emptyResult;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return emptyResult;
  }

  if (!(await hostnameResolvesToPublicInternet(parsedUrl.hostname.toLowerCase()))) {
    return emptyResult;
  }

  let rawHtml: string;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; CorpusBot/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "error",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return emptyResult;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml")) {
      return emptyResult;
    }

    const contentLength = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(contentLength) && contentLength > MAX_SCRAPER_RESPONSE_BYTES) {
      return emptyResult;
    }

    rawHtml = await response.text();
  } catch {
    return emptyResult;
  }

  if (!rawHtml || rawHtml.trim().length === 0) {
    return emptyResult;
  }
  if (rawHtml.length > MAX_SCRAPER_RESPONSE_BYTES) {
    return emptyResult;
  }

  const html = rawHtml.toLowerCase();

  const partial = {
    url,
    businessType: detectBusinessType(html),
    detectedProviders: detectProviders(html),
    pricingModel: detectPricingModel(html),
    techStack: detectTechStack(html),
    markets: detectMarkets(html),
    legalEntityMentions: extractLegalEntities(rawHtml),
  };

  return {
    ...partial,
    confidence: calculateConfidence(partial),
  };
}
