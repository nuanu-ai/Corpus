"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  AlarmClock,
  ArrowRight,
  Atom,
  Banknote,
  BellRing,
  Brain,
  Briefcase,
  Building2,
  Check,
  Cloud,
  Code2,
  Compass,
  Droplet,
  FileOutput,
  FileSearch,
  FileSpreadsheet,
  FileText,
  FolderX,
  Ghost,
  Globe,
  HardDrive,
  Hexagon,
  KeyRound,
  Landmark,
  Layers,
  Leaf,
  Lock,
  Mail,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Notebook,
  Play,
  PlayCircle,
  Plus,
  Rocket,
  Save,
  Send,
  Share2,
  Shield,
  ShieldCheck,
  Moon,
  Smartphone,
  Sparkles,
  Star,
  Sun,
  TrendingUp,
  UploadCloud,
  UserPlus,
  Users,
  UsersRound,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import {
  type LandingCopy,
  type LandingIconName,
  type LandingLocale,
} from "@/lib/landing-copy";
import type { LandingCustomerProof } from "@/lib/landing-proof";

const ICONS: Record<LandingIconName, LucideIcon> = {
  "alarm-clock": AlarmClock,
  "arrow-right": ArrowRight,
  atom: Atom,
  banknote: Banknote,
  "bell-ring": BellRing,
  brain: Brain,
  briefcase: Briefcase,
  "building-2": Building2,
  check: Check,
  cloud: Cloud,
  "code-2": Code2,
  compass: Compass,
  droplet: Droplet,
  "file-output": FileOutput,
  "file-search": FileSearch,
  "file-spreadsheet": FileSpreadsheet,
  "file-text": FileText,
  "folder-x": FolderX,
  ghost: Ghost,
  globe: Globe,
  "hard-drive": HardDrive,
  hexagon: Hexagon,
  "key-round": KeyRound,
  landmark: Landmark,
  layers: Layers,
  leaf: Leaf,
  lock: Lock,
  mail: Mail,
  "message-circle": MessageCircle,
  "message-square": MessageSquare,
  "messages-square": MessagesSquare,
  notebook: Notebook,
  play: Play,
  "play-circle": PlayCircle,
  plus: Plus,
  rocket: Rocket,
  save: Save,
  send: Send,
  "share-2": Share2,
  shield: Shield,
  "shield-check": ShieldCheck,
  smartphone: Smartphone,
  sparkles: Sparkles,
  star: Star,
  "trending-up": TrendingUp,
  "upload-cloud": UploadCloud,
  "user-plus": UserPlus,
  users: Users,
  "users-round": UsersRound,
  zap: Zap,
};

const signInHref = "/login?mode=signin&skipOnboarding=1";
const signupHref = "/login?mode=signup";
const onboardingHref = "/onboarding";
const demoSignupHref = "/login?mode=signup&next=%2Fonboarding";

function Icon({
  name,
  className,
  fill = false,
}: {
  name: LandingIconName;
  className?: string;
  fill?: boolean;
}) {
  const Component = ICONS[name];
  return <Component className={className} style={fill ? { fill: "currentColor" } : undefined} aria-hidden="true" />;
}

function Logo() {
  return (
    <span className="logo">
      <span className="mk">AI</span>
      <span>Corpus</span>
    </span>
  );
}

function SectionHead({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="sec-head">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {subtitle ? <p className="sub">{subtitle}</p> : null}
    </div>
  );
}

type PricingPlan = LandingCopy["pricing"]["plans"][number];

type LeadFormState = {
  name: string;
  email: string;
  companyName: string;
  message: string;
};

type LandingTheme = "light" | "dark";

const emptyLeadForm: LeadFormState = {
  name: "",
  email: "",
  companyName: "",
  message: "",
};

const landingThemeStorageKey = "corpus-landing-theme";

export function MarketingLanding({
  copy,
  locale,
  customerProof,
}: {
  copy: LandingCopy;
  locale: LandingLocale;
  customerProof: LandingCustomerProof;
}) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeSection, setActiveSection] = useState("");
  const [leadPlan, setLeadPlan] = useState<PricingPlan | null>(null);
  const [leadForm, setLeadForm] = useState<LeadFormState>(emptyLeadForm);
  const [leadStatus, setLeadStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [landingTheme, setLandingTheme] = useState<LandingTheme>("light");

  const demoHref = isLoggedIn ? onboardingHref : demoSignupHref;
  const accountHref = isLoggedIn ? "/dashboard" : signupHref;
  const themeToggleLabel = locale === "ru" ? "Переключить тему" : "Toggle theme";
  const leadModalTitle =
    leadPlan?.leadIntent === "team_trial"
      ? copy.leadModal.teamTitle
      : leadPlan?.leadIntent === "holding_contact"
        ? copy.leadModal.contactTitle
        : copy.leadModal.title;

  const closeLeadModal = () => {
    if (leadStatus === "submitting") return;
    setLeadPlan(null);
    setLeadForm(emptyLeadForm);
    setLeadStatus("idle");
  };

  const openLeadModal = (plan: PricingPlan) => {
    setLeadPlan(plan);
    setLeadForm(emptyLeadForm);
    setLeadStatus("idle");
  };

  const toggleLandingTheme = () => {
    setLandingTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      window.localStorage.setItem(landingThemeStorageKey, next);
      return next;
    });
  };

  const updateLeadForm = (field: keyof LeadFormState, value: string) => {
    setLeadForm((current) => ({ ...current, [field]: value }));
  };

  const submitLead = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!leadPlan?.leadIntent || leadStatus === "submitting") return;

    setLeadStatus("submitting");
    try {
      const currentUrl = new URL(window.location.href);
      const response = await fetch("/api/landing/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: leadPlan.leadIntent,
          plan: leadPlan.name,
          locale,
          name: leadForm.name,
          email: leadForm.email,
          companyName: leadForm.companyName,
          message: leadForm.message,
          path: `${currentUrl.pathname}${currentUrl.search}`,
          referrer: document.referrer || null,
          utmSource: currentUrl.searchParams.get("utm_source"),
          utmMedium: currentUrl.searchParams.get("utm_medium"),
          utmCampaign: currentUrl.searchParams.get("utm_campaign"),
          metadata: {
            cta: leadPlan.cta,
            price: leadPlan.price,
            period: leadPlan.period,
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Lead capture failed");
      }

      setLeadStatus("success");
      if (leadPlan.leadIntent === "team_trial") {
        window.setTimeout(() => {
          window.location.assign("/login?mode=signup&plan=team-trial");
        }, 700);
      }
    } catch {
      setLeadStatus("error");
    }
  };

  useEffect(() => {
    authClient
      .getSession()
      .then((res) => {
        setIsLoggedIn(Boolean(res?.data?.session));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(landingThemeStorageKey);
    if (savedTheme === "dark" || savedTheme === "light") {
      setLandingTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    const ids = copy.nav.links
      .map((link) => link.href)
      .filter((href) => href.startsWith("#"))
      .map((href) => href.slice(1));
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActiveSection(`#${visible.target.id}`);
      },
      { rootMargin: "-110px 0px -60% 0px", threshold: [0.08, 0.18, 0.32] },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [copy.nav.links]);

  return (
    <div className="marketingLanding" data-theme={landingTheme}>
      <style>{landingCss}</style>

      <nav className="nav">
        <div className="nav-inner">
          <Link href="/" className="logo-link" aria-label="Corpus">
            <Logo />
          </Link>
          <div className="nav-links">
            {copy.nav.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={activeSection === link.href ? "active" : ""}
              >
                {link.label}
              </Link>
            ))}
          </div>
          <div className="nav-cta">
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleLandingTheme}
              aria-label={themeToggleLabel}
              title={themeToggleLabel}
            >
              {landingTheme === "dark" ? <Sun /> : <Moon />}
            </button>
            {isLoggedIn ? (
              <Link href="/dashboard" className="signin">
                {copy.nav.dashboard}
              </Link>
            ) : (
              <Link href={signInHref} className="signin">
                {copy.nav.signIn}
              </Link>
            )}
            <Link href={demoHref} className="btn">
              <Icon name="sparkles" />
              {copy.nav.tryIt}
            </Link>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="hero-inner">
          <div className="hero-grid">
            <div>
              <span className="eyebrow">
                <span className="dot" />
                {copy.hero.eyebrow}
              </span>
              <h1 className="h1">
                {copy.hero.titleStart} <span className="accent">{copy.hero.titleAccent}</span>{" "}
                {copy.hero.titleEnd}
              </h1>
              <p className="lede">{copy.hero.lede}</p>
              <div className="hero-ctas">
                <Link href={demoHref} className="btn lg">
                  <Icon name="play" />
                  {copy.hero.demoCta}
                </Link>
                <Link href={accountHref} className="btn outline lg">
                  <Icon name="user-plus" />
                  {copy.hero.accountCta}
                </Link>
              </div>
              <div className="hero-trust">
                {copy.hero.trust.map((item) => (
                  <span key={item.text} className="tk">
                    <Icon name={item.icon} />
                    {item.text}
                  </span>
                ))}
              </div>
            </div>

            <div className="mock-wrap">
              <div className="float-badge fb-1">
                <span className="ic">
                  <Icon name="shield-check" />
                </span>
                {copy.hero.mock.sourceBadge}
              </div>
              <div className="float-badge fb-2">
                <span className="ic">
                  <Icon name="zap" />
                </span>
                {copy.hero.mock.speedBadge}
              </div>
              <div className="mock" aria-hidden="true">
                <div className="mock-bar">
                  <div className="traffic">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="url">{copy.hero.mock.url}</div>
                </div>
                <div className="mock-body">
                  <div className="mock-q">{copy.hero.mock.question}</div>
                  <div className="mock-a">
                    <div className="typing">
                      <span className="pulse" />
                      {copy.hero.mock.typing}
                    </div>
                    <div>
                      {copy.hero.mock.answerStart} <b>{copy.hero.mock.salary}</b>
                      <span className="mono mock-num"> {copy.hero.mock.answerMiddle.split(": ")[1]?.split(" (")[0] ?? "$1.82M"}</span>
                      {copy.hero.mock.answerMiddle.includes(" (")
                        ? ` (${copy.hero.mock.answerMiddle.split(" (")[1]} `
                        : " "}
                      <span className="mono mock-num">{copy.hero.mock.aws}</span> {copy.hero.mock.answerEnd}{" "}
                      <span className="mono mock-num">{copy.hero.mock.stripe}</span>.
                    </div>
                    <div className="mock-sources">
                      {copy.hero.mock.sources.map((source) => (
                        <span key={source.text} className="src-chip">
                          <Icon name={source.icon} />
                          {source.text}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mock-input">
                    <Icon name="message-square" />
                    {copy.hero.mock.input}
                    <span className="send">
                      <Icon name="send" />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="trust">
          <div className="trust-inner">
            <span className="trust-label">
              {copy.hero.trustStrip.label}{" "}
              <strong>{customerProof.companyCountText}</strong>{" "}
              {copy.hero.trustStrip.countSuffix}
            </span>
            <div className="trust-logos">
              {customerProof.companies.map((company) => (
                <span key={company.name} className="lg">
                  <Icon name={company.icon} />
                  {company.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main>
        <section id="problem">
          <div className="wrap">
            <SectionHead {...copy.problem} />
            <div className="pain-grid">
              {copy.problem.cards.map((card) => (
                <div key={card.title} className="pain">
                  <div className="ic-wrap">
                    <Icon name={card.icon} />
                  </div>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                  <div className="quote">{card.quote}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="alt">
          <div className="wrap">
            <SectionHead {...copy.how} />
            <div className="verbs">
              {copy.how.steps.map((step, index) => (
                <div key={step.title} className="verb-slot">
                  <div className={`verb ${step.className}`}>
                    <span className="v-tag">{step.tag}</span>
                    <h3>
                      <span className="num">-&gt;</span>
                      {step.title}
                    </h3>
                    <div className="v-desc">{step.description}</div>
                    <div className="v-items">
                      {step.items.map((item) => (
                        <div key={item.text} className="v-item">
                          <Icon name={item.icon} />
                          {item.text}
                        </div>
                      ))}
                    </div>
                  </div>
                  {index < copy.how.steps.length - 1 ? (
                    <div className="arrow-cell">
                      <Icon name="arrow-right" />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="demo">
          <div className="wrap">
            <div className="demo-card">
              <div>
                <span className="stamp">
                  <Icon name="play-circle" />
                  {copy.demo.stamp}
                </span>
                <h2>{copy.demo.title}</h2>
                <p className="sub">{copy.demo.subtitle}</p>
                <div className="demo-bullets">
                  {copy.demo.bullets.map((bullet) => (
                    <div key={bullet} className="b">
                      <Icon name="check" />
                      {bullet}
                    </div>
                  ))}
                </div>
                <Link href={demoHref} className="btn lg">
                  <Icon name="play" />
                  {copy.demo.cta}
                </Link>
              </div>
              <div className="demo-shot" aria-hidden="true">
                <div className="topbar">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="demo-app">
                  <div className="demo-app-label">{copy.demo.mock.label}</div>
                  <div className="demo-app-title">{copy.demo.mock.title}</div>
                  <div className="demo-kpis">
                    {copy.demo.mock.kpis.map((kpi) => (
                      <div key={kpi.label} className="demo-kpi">
                        <div className="lbl">{kpi.label}</div>
                        <div className="v">{kpi.value}</div>
                        <div className={kpi.tone === "warning" ? "d warning" : "d"}>{kpi.delta}</div>
                      </div>
                    ))}
                  </div>
                  <div className="suggest-label">{copy.demo.mock.suggestionsLabel}</div>
                  <div className="demo-suggest">
                    {copy.demo.mock.suggestions.map((suggestion) => (
                      <span key={suggestion} className="ch">
                        <Icon name="sparkles" />
                        {suggestion}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="stats-section">
          <div className="wrap">
            <div className="stats-bar">
              {copy.stats.map((stat) => (
                <div key={stat.label} className="cell">
                  <div className="v">
                    {stat.value}
                    {stat.unit ? <span className="small">{stat.unit}</span> : null}
                  </div>
                  <div className="k">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="provenance" className="alt">
          <div className="wrap">
            <div className="prov-wrap">
              <div>
                <span className="eyebrow">
                  <Icon name="shield-check" />
                  {copy.provenance.eyebrow}
                </span>
                <h2 className="prov-title">
                  {copy.provenance.titleStart}{" "}
                  <span>{copy.provenance.titleAccent}</span>
                  {copy.provenance.titleEnd}
                </h2>
                <p className="prov-copy">{copy.provenance.body}</p>
                <ul className="check-list">
                  {copy.provenance.bullets.map((bullet) => (
                    <li key={bullet}>
                      <Icon name="check" />
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="prov-mock" aria-hidden="true">
                <div className="prov-q">-&gt; {copy.provenance.question}</div>
                <div className="prov-a">{copy.provenance.answer}</div>
                <div className="prov-cites">
                  {copy.provenance.citations.map((citation) => (
                    <div key={citation.name} className="prov-cite">
                      <div className={citation.tone ? `ic ${citation.tone}` : "ic"}>
                        <Icon name={citation.icon} />
                      </div>
                      <div>
                        <div className="name">{citation.name}</div>
                        <div className="meta">{citation.meta}</div>
                      </div>
                      <div className="open">{citation.open}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features">
          <div className="wrap">
            <SectionHead {...copy.features} />
            <div className="features">
              {copy.features.cards.map((feature) => (
                <div key={feature.title} className={feature.wide ? "feat wide" : "feat"}>
                  <div className="ic">
                    <Icon name={feature.icon} />
                  </div>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="testimonial-section alt">
          <div className="wrap narrow">
            <div className="testimonial">
              <div>
                <div className="stars">
                  {[0, 1, 2, 3, 4].map((star) => (
                    <Icon key={star} name="star" fill />
                  ))}
                </div>
                <div className="t-quote">
                  &quot;{copy.testimonial.quoteStart}{" "}
                  <span className="accent">{copy.testimonial.quoteAccent}</span>{" "}
                  {copy.testimonial.quoteEnd}&quot;
                </div>
                <div className="t-author">
                  <div className="av">{copy.testimonial.initials}</div>
                  <div>
                    <div className="nm">{copy.testimonial.name}</div>
                    <div className="rl">{copy.testimonial.role}</div>
                  </div>
                </div>
              </div>
              <div className="t-meta">
                {copy.testimonial.metrics.map((metric) => (
                  <div key={metric.label} className="row">
                    <span>{metric.label}</span>
                    <span className="v">{metric.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="cases">
          <div className="wrap">
            <SectionHead {...copy.cases} />
            <div className="cases">
              {copy.cases.cards.map((item) => (
                <div key={item.title} className={`case ${item.className}`}>
                  <div className="ic-big">
                    <Icon name={item.icon} />
                  </div>
                  <div>
                    <div className="who">{item.who}</div>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                    <div className="ex">{item.example}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="alt">
          <div className="wrap">
            <SectionHead {...copy.integrations} />
            <div className="integrations">
              {copy.integrations.items.map((integration) => (
                <div key={integration.name} className="int">
                  <div className="ic">
                    <Icon name={integration.icon} />
                  </div>
                  <div className="nm">{integration.name}</div>
                  <div className="tg">{integration.tag}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing">
          <div className="wrap">
            <SectionHead {...copy.pricing} />
            <div className="pricing-grid">
              {copy.pricing.plans.map((plan) => (
                <div key={plan.name} className={plan.featured ? "plan featured" : "plan"}>
                  {plan.badge ? <div className="badge-top">{plan.badge}</div> : null}
                  <h3>{plan.name}</h3>
                  <div className="price">
                    {plan.price}
                    <span className="per">{plan.period}</span>
                  </div>
                  <div className="desc">{plan.description}</div>
                  <ul>
                    {plan.features.map((feature) => (
                      <li key={feature}>
                        <Icon name="check" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  {plan.leadIntent ? (
                    <button
                      type="button"
                      className={plan.featured ? "btn ct" : "btn outline ct"}
                      onClick={() => openLeadModal(plan)}
                    >
                      {plan.featured ? <Icon name="sparkles" /> : null}
                      {plan.cta}
                    </button>
                  ) : (
                    <Link href={plan.contact ? "#contact" : accountHref} className={plan.featured ? "btn ct" : "btn outline ct"}>
                      {plan.featured ? <Icon name="sparkles" /> : null}
                      {plan.cta}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="alt">
          <div className="wrap">
            <SectionHead eyebrow={copy.faq.eyebrow} title={copy.faq.title} />
            <div className="faq">
              {copy.faq.items.map((item, index) => (
                <details key={item.question} className="q" open={index === 0}>
                  <summary>{item.question}</summary>
                  <div className="a">{item.answer}</div>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="start">
          <div className="wrap cta-wrap">
            <div className="cta-final">
              <span className="eyebrow">
                <Icon name="sparkles" />
                {copy.finalCta.eyebrow}
              </span>
              <h2>{copy.finalCta.title}</h2>
              <p>{copy.finalCta.subtitle}</p>
              <div className="cta-row">
                <Link href={demoHref} className="btn lg">
                  <Icon name="play" />
                  {copy.finalCta.demoCta}
                </Link>
                <Link href={accountHref} className="btn outline lg">
                  <Icon name="user-plus" />
                  {copy.finalCta.accountCta}
                </Link>
              </div>
              <div className="security-row">
                {copy.finalCta.badges.map((badge) => (
                  <span key={badge.text}>
                    <Icon name={badge.icon} />
                    {badge.text}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="foot-inner">
          <div className="foot-brand">
            <Link href="/" className="logo-link" aria-label="Corpus">
              <Logo />
            </Link>
            <p>{copy.footer.blurb}</p>
          </div>
          {copy.footer.columns.map((column) => (
            <div key={column.title} className="foot-col">
              <h4>{column.title}</h4>
              <ul>
                {column.links.map((link) => (
                  <li key={`${column.title}-${link.label}`}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="foot-bottom">
          <span>{copy.footer.copyright}</span>
          <span>{copy.footer.tagline}</span>
        </div>
      </footer>

      {leadPlan ? (
        <div className="lead-modal" role="dialog" aria-modal="true" aria-labelledby="lead-modal-title">
          <button type="button" className="lead-backdrop" aria-label={copy.leadModal.close} onClick={closeLeadModal} />
          <div className="lead-panel">
            <button type="button" className="lead-close" onClick={closeLeadModal} aria-label={copy.leadModal.close}>
              x
            </button>
            <div className="lead-plan">{leadPlan.name}</div>
            <h3 id="lead-modal-title">{leadModalTitle}</h3>
            <p>{copy.leadModal.subtitle}</p>
            <form onSubmit={submitLead} className="lead-form">
              <label>
                <span>{copy.leadModal.emailLabel}</span>
                <input
                  type="email"
                  required
                  value={leadForm.email}
                  onChange={(event) => updateLeadForm("email", event.target.value)}
                  autoComplete="email"
                />
              </label>
              <label>
                <span>{copy.leadModal.nameLabel}</span>
                <input
                  type="text"
                  value={leadForm.name}
                  onChange={(event) => updateLeadForm("name", event.target.value)}
                  autoComplete="name"
                />
              </label>
              <label>
                <span>{copy.leadModal.companyLabel}</span>
                <input
                  type="text"
                  value={leadForm.companyName}
                  onChange={(event) => updateLeadForm("companyName", event.target.value)}
                  autoComplete="organization"
                />
              </label>
              <label>
                <span>{copy.leadModal.messageLabel}</span>
                <textarea
                  rows={3}
                  value={leadForm.message}
                  onChange={(event) => updateLeadForm("message", event.target.value)}
                />
              </label>
              {leadStatus === "error" ? <div className="lead-error">{copy.leadModal.error}</div> : null}
              {leadStatus === "success" ? (
                <div className="lead-success">
                  {leadPlan.leadIntent === "team_trial"
                    ? copy.leadModal.successTeam
                    : copy.leadModal.successContact}
                </div>
              ) : null}
              <button type="submit" className="btn lg lead-submit" disabled={leadStatus === "submitting" || leadStatus === "success"}>
                <Icon name="send" />
                {leadStatus === "submitting" ? copy.leadModal.submitting : copy.leadModal.submit}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const landingCss = `
  .marketingLanding {
    --bg: oklch(0.992 0.001 264);
    --fg: oklch(0.15 0.02 264);
    --card: oklch(1 0 0);
    --card-2: oklch(0.972 0.006 264);
    --secondary: oklch(0.952 0.008 264);
    --muted: oklch(0.45 0.015 264);
    --border: oklch(0.9 0.008 264);
    --border-strong: oklch(0.79 0.018 264);
    --primary: oklch(0.623 0.214 259);
    --primary-soft: color-mix(in oklch, var(--primary) 18%, transparent);
    --success: oklch(0.6 0.15 162);
    --warning: oklch(0.66 0.14 75);
    --destructive: oklch(0.58 0.22 27);
    --magenta: oklch(0.58 0.18 320);
    --strong-on-card: color-mix(in oklch, var(--fg) 88%, var(--primary));
    --shadow-soft: color-mix(in oklch, black 10%, transparent);
    --shadow-medium: color-mix(in oklch, black 16%, transparent);
    --shadow-strong: color-mix(in oklch, black 24%, transparent);
    --chrome-bg: color-mix(in oklch, var(--card) 88%, var(--secondary));
    --font-sans: var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --font-mono: var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    min-height: 100vh;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font-sans);
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
    color-scheme: light;
  }
  .marketingLanding[data-theme="dark"] {
    --bg: oklch(0.098 0.023 264);
    --fg: oklch(0.97 0.005 264);
    --card: oklch(0.14 0.02 264);
    --card-2: oklch(0.16 0.02 264);
    --secondary: oklch(0.18 0.015 264);
    --muted: oklch(0.55 0.01 264);
    --border: oklch(0.25 0.015 264);
    --border-strong: oklch(0.32 0.015 264);
    --success: oklch(0.72 0.17 162);
    --warning: oklch(0.78 0.15 75);
    --destructive: oklch(0.704 0.191 22);
    --magenta: oklch(0.72 0.18 320);
    --strong-on-card: oklch(0.97 0.005 264);
    --shadow-soft: color-mix(in oklch, black 32%, transparent);
    --shadow-medium: color-mix(in oklch, black 42%, transparent);
    --shadow-strong: color-mix(in oklch, black 55%, transparent);
    --chrome-bg: color-mix(in oklch, var(--card) 80%, black);
    color-scheme: dark;
  }
  .marketingLanding *, .marketingLanding *::before, .marketingLanding *::after { box-sizing: border-box; }
  .marketingLanding a { color: inherit; text-decoration: none; }
  .marketingLanding .mono { font-family: var(--font-mono); }
  .marketingLanding button { font-family: inherit; cursor: pointer; }
  .marketingLanding svg { flex-shrink: 0; }

  .marketingLanding .nav {
    position: sticky; top: 0; z-index: 50;
    backdrop-filter: blur(14px);
    background: color-mix(in oklch, var(--bg) 78%, transparent);
    border-bottom: 1px solid color-mix(in oklch, var(--border) 60%, transparent);
  }
  .marketingLanding .nav-inner {
    max-width: 1280px; margin: 0 auto; padding: 14px 32px;
    display: flex; align-items: center; justify-content: space-between; gap: 24px;
  }
  .marketingLanding .logo-link, .marketingLanding .logo { display: inline-flex; align-items: center; }
  .marketingLanding .logo { gap: 10px; font-weight: 700; font-size: 15px; letter-spacing: -0.01em; }
  .marketingLanding .logo .mk { width: 30px; height: 30px; border-radius: 8px; background: var(--primary); color: white; display: grid; place-items: center; font-size: 11px; font-weight: 700; box-shadow: 0 4px 16px color-mix(in oklch, var(--primary) 35%, transparent); }
  .marketingLanding .nav-links { display: flex; gap: 4px; }
  .marketingLanding .nav-links a { font-size: 13px; color: var(--muted); padding: 7px 12px; border-radius: 8px; transition: all 120ms; }
  .marketingLanding .nav-links a:hover, .marketingLanding .nav-links a.active { color: var(--fg); background: var(--secondary); }
  .marketingLanding .nav-cta { display: flex; gap: 8px; align-items: center; }
  .marketingLanding .nav-cta .signin { font-size: 13px; color: var(--muted); padding: 7px 12px; border-radius: 8px; white-space: nowrap; }
  .marketingLanding .nav-cta .signin:hover { color: var(--fg); }
  .marketingLanding .theme-toggle {
    width: 38px; height: 38px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--card);
    color: var(--muted);
    display: grid;
    place-items: center;
    box-shadow: 0 6px 18px var(--shadow-soft);
    transition: color 120ms, background 120ms, border-color 120ms, transform 120ms;
  }
  .marketingLanding .theme-toggle:hover {
    color: var(--fg);
    background: var(--secondary);
    border-color: var(--border-strong);
    transform: translateY(-1px);
  }
  .marketingLanding .theme-toggle svg { width: 16px; height: 16px; }
  @media (max-width: 820px) {
    .marketingLanding .nav-links { display: none; }
    .marketingLanding .nav-inner { padding: 12px 18px; }
    .marketingLanding .nav-cta { gap: 6px; }
    .marketingLanding .nav-cta .signin { display: none; }
  }
  @media (max-width: 580px) {
    .marketingLanding .nav-cta .btn { display: none; }
  }

  .marketingLanding .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 38px;
    padding: 0 18px; border-radius: 9px;
    background: var(--primary); color: white; border: 0;
    font-weight: 500; font-size: 14px; letter-spacing: -0.005em;
    box-shadow: 0 6px 20px color-mix(in oklch, var(--primary) 28%, transparent), inset 0 1px 0 color-mix(in oklch, white 25%, transparent);
    transition: transform 120ms, box-shadow 120ms, background 120ms, border-color 120ms;
    white-space: nowrap;
  }
  .marketingLanding .btn:hover { transform: translateY(-1px); box-shadow: 0 10px 30px color-mix(in oklch, var(--primary) 40%, transparent), inset 0 1px 0 color-mix(in oklch, white 25%, transparent); }
  .marketingLanding .btn:disabled { opacity: 0.7; cursor: wait; transform: none; }
  .marketingLanding .btn svg { width: 14px; height: 14px; }
  .marketingLanding .btn.outline { background: transparent; color: var(--fg); border: 1px solid var(--border-strong); box-shadow: none; }
  .marketingLanding .btn.outline:hover { background: var(--secondary); border-color: var(--muted); box-shadow: none; }
  .marketingLanding .btn.lg { min-height: 48px; padding: 0 22px; font-size: 15px; border-radius: 11px; }
  .marketingLanding .btn.lg svg { width: 16px; height: 16px; }

  .marketingLanding section { padding: 96px 32px; position: relative; }
  .marketingLanding section.alt { background: color-mix(in oklch, var(--card) 30%, var(--bg)); }
  .marketingLanding .wrap { max-width: 1280px; margin: 0 auto; }
  .marketingLanding .wrap.narrow { max-width: 1080px; }
  .marketingLanding .eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 11px; font-family: var(--font-mono);
    letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted);
  }
  .marketingLanding .eyebrow svg { width: 13px; height: 13px; }
  .marketingLanding .eyebrow .dot { width: 6px; height: 6px; border-radius: 999px; background: var(--success); box-shadow: 0 0 0 4px color-mix(in oklch, var(--success) 22%, transparent); }
  .marketingLanding .sec-head { text-align: center; margin-bottom: 56px; }
  .marketingLanding .sec-head h2 {
    font-size: 44px; line-height: 1.08; letter-spacing: -0.025em;
    font-weight: 700; margin: 18px auto 14px; max-width: 720px;
  }
  .marketingLanding .sec-head .sub {
    font-size: 17px; color: var(--muted); max-width: 620px; margin: 0 auto;
    line-height: 1.6;
  }
  @media (max-width: 720px) {
    .marketingLanding section { padding: 64px 18px; }
    .marketingLanding .sec-head h2 { font-size: 32px; }
    .marketingLanding .sec-head .sub { font-size: 15px; }
  }

  .marketingLanding .hero {
    padding: 64px 32px 0;
    position: relative;
    overflow: hidden;
    border-bottom: 1px solid var(--border);
  }
  .marketingLanding .hero::before {
    content: ""; position: absolute; inset: -40% -10% auto -10%; height: 700px;
    background:
      radial-gradient(40% 50% at 30% 30%, color-mix(in oklch, var(--primary) 24%, transparent), transparent 60%),
      radial-gradient(40% 50% at 75% 60%, color-mix(in oklch, var(--success) 14%, transparent), transparent 65%);
    pointer-events: none;
    z-index: 0;
  }
  .marketingLanding .hero-inner { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; padding-bottom: 0; }
  .marketingLanding .hero-grid {
    display: grid; gap: 56px; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    align-items: center; padding-top: 24px;
  }
  .marketingLanding .hero-grid > *,
  .marketingLanding .demo-card > *,
  .marketingLanding .prov-wrap > *,
  .marketingLanding .testimonial > *,
  .marketingLanding .case > * { min-width: 0; }
  .marketingLanding .h1 {
    font-size: 64px; line-height: 1.02; letter-spacing: -0.03em; font-weight: 700;
    margin: 20px 0 22px;
  }
  .marketingLanding .h1 .accent { color: color-mix(in oklch, var(--primary) 82%, white); }
  .marketingLanding .lede { font-size: 19px; line-height: 1.6; color: var(--muted); max-width: 540px; margin: 0 0 32px; overflow-wrap: anywhere; }
  .marketingLanding .hero-ctas { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
  .marketingLanding .hero-trust {
    display: flex; align-items: center; gap: 18px; font-size: 12px; color: var(--muted);
    flex-wrap: wrap;
  }
  .marketingLanding .hero-trust .tk { display: inline-flex; align-items: center; gap: 6px; }
  .marketingLanding .hero-trust svg { width: 13px; height: 13px; color: var(--success); }
  @media (max-width: 1080px) {
    .marketingLanding .hero-grid { grid-template-columns: 1fr; gap: 40px; }
  }
  @media (max-width: 720px) {
    .marketingLanding .hero { padding: 42px 18px 0; }
    .marketingLanding .h1 { font-size: 42px; }
    .marketingLanding .lede { font-size: 16px; }
  }
  @media (max-width: 580px) {
    .marketingLanding .hero-inner {
      width: 100%;
      max-width: 100%;
      margin: 0;
    }
    .marketingLanding .h1,
    .marketingLanding .lede,
    .marketingLanding .hero-trust,
    .marketingLanding .mock,
    .marketingLanding .demo-card,
    .marketingLanding .demo-shot,
    .marketingLanding .prov-mock,
    .marketingLanding .stats-bar,
    .marketingLanding .cta-final {
      width: min(100%, 354px);
      max-width: 354px;
    }
    .marketingLanding .hero-grid { width: 100%; justify-items: start; }
    .marketingLanding .h1 { font-size: 40px; }
    .marketingLanding .hero-trust { align-items: flex-start; }
    .marketingLanding .mock-q,
    .marketingLanding .mock-a {
      max-width: 100%;
    }
  }

  .marketingLanding .mock-wrap { position: relative; min-width: 0; }
  .marketingLanding .mock {
    position: relative;
    max-width: 100%;
    border: 1px solid var(--border-strong);
    border-radius: 18px;
    background: linear-gradient(180deg, var(--card-2), var(--card));
    box-shadow: 0 30px 80px var(--shadow-strong), 0 0 0 1px color-mix(in oklch, white 35%, transparent) inset;
    overflow: hidden;
    transform: perspective(1400px) rotateY(-3deg) rotateX(2deg);
  }
  .marketingLanding .mock-bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--chrome-bg); }
  .marketingLanding .traffic { display: flex; gap: 6px; }
  .marketingLanding .traffic span { width: 10px; height: 10px; border-radius: 999px; background: var(--border-strong); }
  .marketingLanding .mock-bar .url {
    margin-left: 10px; padding: 4px 10px; border-radius: 6px;
    background: var(--secondary); font-family: var(--font-mono); font-size: 10px; color: var(--muted);
    flex: 1; max-width: 280px;
  }
  .marketingLanding .mock-body { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
  .marketingLanding .mock-q {
    align-self: flex-end;
    max-width: 80%;
    background: var(--primary); color: white; padding: 10px 14px;
    border-radius: 14px 14px 4px 14px; font-size: 13.5px; line-height: 1.45;
    box-shadow: 0 4px 14px color-mix(in oklch, var(--primary) 30%, transparent);
    overflow-wrap: anywhere;
  }
  .marketingLanding .mock-a {
    background: var(--secondary); border: 1px solid var(--border);
    padding: 14px 16px; border-radius: 14px 14px 14px 4px;
    font-size: 13.5px; line-height: 1.55;
    max-width: 92%;
    display: flex; flex-direction: column; gap: 10px;
    overflow-wrap: anywhere;
  }
  .marketingLanding .mock-a .typing { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; color: var(--muted); font-family: var(--font-mono); letter-spacing: 0.06em; }
  .marketingLanding .pulse { width: 6px; height: 6px; border-radius: 999px; background: color-mix(in oklch, var(--primary) 80%, white); animation: landing-pulse 1.4s ease-in-out infinite; }
  @keyframes landing-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; transform: scale(1.4); } }
  .marketingLanding .mock-num { font-family: var(--font-mono); font-weight: 600; color: var(--strong-on-card); }
  .marketingLanding .mock-sources { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .marketingLanding .src-chip {
    display: inline-flex; align-items: center; gap: 6px;
    background: color-mix(in oklch, var(--primary) 14%, transparent);
    border: 1px solid color-mix(in oklch, var(--primary) 28%, transparent);
    color: color-mix(in oklch, var(--primary) 85%, white);
    padding: 4px 9px; border-radius: 999px;
    font-family: var(--font-mono); font-size: 10.5px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .marketingLanding .src-chip svg { width: 11px; height: 11px; }
  .marketingLanding .mock-input {
    margin-top: 4px; display: flex; align-items: center; gap: 8px;
    padding: 9px 10px 9px 14px; border: 1px solid var(--border-strong); border-radius: 12px;
    background: color-mix(in oklch, var(--bg) 60%, var(--card));
    font-size: 12.5px; color: var(--muted);
  }
  .marketingLanding .mock-input svg { width: 14px; height: 14px; color: var(--muted); }
  .marketingLanding .mock-input .send {
    margin-left: auto; width: 28px; height: 28px; border-radius: 7px;
    background: var(--primary); color: white; display: grid; place-items: center;
  }
  .marketingLanding .mock-input .send svg { width: 13px; height: 13px; color: white; }
  .marketingLanding .float-badge {
    position: absolute; padding: 8px 12px;
    background: var(--card); border: 1px solid var(--border-strong); border-radius: 999px;
    font-size: 11.5px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px;
    box-shadow: 0 12px 30px var(--shadow-medium);
    z-index: 2;
  }
  .marketingLanding .float-badge .ic { width: 16px; height: 16px; display: grid; place-items: center; }
  .marketingLanding .float-badge .ic svg { width: 13px; height: 13px; }
  .marketingLanding .fb-1 { top: -16px; left: -28px; }
  .marketingLanding .fb-1 .ic { color: color-mix(in oklch, var(--success) 85%, white); }
  .marketingLanding .fb-2 { bottom: -16px; right: -22px; }
  .marketingLanding .fb-2 .ic { color: color-mix(in oklch, var(--primary) 85%, white); }
  @media (max-width: 1080px) {
    .marketingLanding .mock { transform: none; }
    .marketingLanding .fb-1, .marketingLanding .fb-2 { display: none; }
  }

  .marketingLanding .trust {
    margin-top: 64px;
    padding: 32px 32px;
    border-top: 1px solid var(--border);
    background: color-mix(in oklch, var(--card) 50%, var(--bg));
  }
  .marketingLanding .trust-inner {
    max-width: 1280px; margin: 0 auto;
    display: flex; align-items: center; gap: 32px; flex-wrap: wrap; justify-content: space-between;
  }
  .marketingLanding .trust-label { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); }
  .marketingLanding .trust-label strong { color: var(--fg); font-weight: 700; }
  .marketingLanding .trust-logos { display: flex; gap: 28px; flex-wrap: wrap; align-items: center; }
  .marketingLanding .trust-logos .lg {
    font-family: var(--font-mono); font-size: 13px; color: color-mix(in oklch, var(--fg) 65%, var(--muted));
    letter-spacing: -0.01em; font-weight: 500;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .marketingLanding .trust-logos .lg svg { width: 14px; height: 14px; color: var(--muted); }

  .marketingLanding .pain-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .marketingLanding .pain {
    border: 1px solid var(--border); border-radius: 16px; padding: 24px;
    background: var(--card); position: relative;
    display: flex; flex-direction: column; gap: 10px;
  }
  .marketingLanding .pain .ic-wrap {
    width: 42px; height: 42px; border-radius: 10px;
    background: color-mix(in oklch, var(--destructive) 14%, transparent);
    color: color-mix(in oklch, var(--destructive) 82%, white);
    display: grid; place-items: center;
    margin-bottom: 6px;
  }
  .marketingLanding .pain .ic-wrap svg { width: 18px; height: 18px; }
  .marketingLanding .pain h3 { font-size: 18px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
  .marketingLanding .pain p { font-size: 14px; color: var(--muted); margin: 0; line-height: 1.6; }
  .marketingLanding .pain .quote {
    font-family: var(--font-mono); font-size: 11.5px; color: color-mix(in oklch, var(--muted) 50%, var(--fg));
    border-left: 2px solid var(--destructive); padding-left: 10px; margin-top: 4px;
    line-height: 1.55;
  }
  @media (max-width: 900px) { .marketingLanding .pain-grid { grid-template-columns: 1fr; } }

  .marketingLanding .verbs { display: grid; grid-template-columns: 1fr 30px 1fr 30px 1fr; gap: 0; align-items: stretch; }
  .marketingLanding .verb-slot { display: contents; }
  .marketingLanding .arrow-cell { display: grid; place-items: center; color: var(--muted); }
  .marketingLanding .arrow-cell svg { width: 22px; height: 22px; }
  .marketingLanding .verb {
    border: 1px solid var(--border); border-radius: 16px; padding: 28px;
    background: linear-gradient(180deg, color-mix(in oklch, var(--card) 100%, transparent), var(--card));
    display: flex; flex-direction: column; gap: 14px;
    position: relative; overflow: hidden;
  }
  .marketingLanding .verb::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--accent-color, var(--primary)); }
  .marketingLanding .verb .v-tag { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--muted); }
  .marketingLanding .verb h3 { font-size: 30px; font-weight: 700; margin: 0; letter-spacing: -0.02em; }
  .marketingLanding .verb h3 .num { font-family: var(--font-mono); font-size: 14px; color: var(--accent-color, var(--primary)); margin-right: 8px; opacity: 0.7; vertical-align: middle; }
  .marketingLanding .verb .v-desc { font-size: 14px; color: var(--muted); line-height: 1.6; }
  .marketingLanding .verb .v-items { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
  .marketingLanding .verb .v-item {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px;
    background: var(--secondary); border-radius: 8px; font-size: 13px;
  }
  .marketingLanding .verb .v-item svg { width: 14px; height: 14px; color: var(--accent-color, var(--primary)); }
  .marketingLanding .verb.add { --accent-color: var(--primary); }
  .marketingLanding .verb.ask { --accent-color: var(--warning); }
  .marketingLanding .verb.act { --accent-color: var(--success); }
  @media (max-width: 1000px) {
    .marketingLanding .verbs { grid-template-columns: 1fr; gap: 12px; }
    .marketingLanding .verb-slot { display: block; }
    .marketingLanding .arrow-cell { display: none; }
  }

  .marketingLanding .demo-card {
    border: 1px solid var(--border-strong); border-radius: 24px;
    background:
      radial-gradient(60% 50% at 0% 0%, color-mix(in oklch, var(--primary) 14%, transparent), transparent 60%),
      radial-gradient(60% 50% at 100% 100%, color-mix(in oklch, var(--success) 10%, transparent), transparent 60%),
      var(--card);
    padding: 40px;
    display: grid; grid-template-columns: 1fr 1.1fr; gap: 40px; align-items: center;
  }
  .marketingLanding .demo-card .stamp { display: inline-flex; align-items: center; gap: 8px; padding: 5px 11px; border: 1px solid color-mix(in oklch, var(--primary) 40%, var(--border)); border-radius: 999px; font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.2em; text-transform: uppercase; color: color-mix(in oklch, var(--primary) 85%, white); }
  .marketingLanding .demo-card .stamp svg { width: 13px; height: 13px; }
  .marketingLanding .demo-card h2 { font-size: 36px; line-height: 1.1; letter-spacing: -0.02em; margin: 14px 0 12px; max-width: 460px; }
  .marketingLanding .demo-card .sub { font-size: 15px; color: var(--muted); line-height: 1.6; max-width: 460px; margin: 0 0 22px; }
  .marketingLanding .demo-bullets { display: flex; flex-direction: column; gap: 10px; margin-bottom: 24px; }
  .marketingLanding .demo-bullets .b { display: flex; align-items: center; gap: 10px; font-size: 14px; }
  .marketingLanding .demo-bullets .b svg { width: 14px; height: 14px; color: color-mix(in oklch, var(--success) 75%, white); }
  .marketingLanding .demo-shot {
    border: 1px solid var(--border); border-radius: 16px; overflow: hidden; background: var(--bg);
    box-shadow: 0 30px 80px var(--shadow-strong);
    max-width: 100%;
  }
  .marketingLanding .demo-shot .topbar { padding: 10px 14px; display: flex; gap: 6px; border-bottom: 1px solid var(--border); background: var(--chrome-bg); }
  .marketingLanding .demo-shot .topbar span { width: 9px; height: 9px; border-radius: 999px; background: var(--border-strong); }
  .marketingLanding .demo-shot .demo-app { padding: 18px; display: flex; flex-direction: column; gap: 14px; }
  .marketingLanding .demo-app-label { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.18em; text-transform: uppercase; color: color-mix(in oklch, var(--primary) 80%, white); }
  .marketingLanding .demo-app-title { font-size: 19px; font-weight: 700; letter-spacing: -0.01em; margin-top: -4px; }
  .marketingLanding .demo-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .marketingLanding .demo-kpi { padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--card); }
  .marketingLanding .demo-kpi .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--muted); }
  .marketingLanding .demo-kpi .v { font-family: var(--font-mono); font-size: 18px; font-weight: 700; margin-top: 2px; }
  .marketingLanding .demo-kpi .d { font-size: 10px; color: color-mix(in oklch, var(--success) 75%, white); font-family: var(--font-mono); }
  .marketingLanding .demo-kpi .d.warning { color: color-mix(in oklch, var(--warning) 80%, white); }
  .marketingLanding .suggest-label { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); margin-top: 4px; }
  .marketingLanding .demo-suggest { display: flex; flex-wrap: wrap; gap: 6px; }
  .marketingLanding .demo-suggest .ch {
    padding: 6px 10px; border-radius: 999px; border: 1px solid var(--border);
    font-size: 11.5px; color: var(--fg); background: var(--card);
    display: inline-flex; align-items: center; gap: 5px;
  }
  .marketingLanding .demo-suggest .ch svg { width: 11px; height: 11px; color: color-mix(in oklch, var(--primary) 80%, white); }
  @media (max-width: 1000px) {
    .marketingLanding .demo-card { grid-template-columns: 1fr; padding: 28px; }
  }
  @media (max-width: 620px) {
    .marketingLanding .demo-kpis { grid-template-columns: 1fr; }
  }

  .marketingLanding .stats-section { padding: 0 32px; }
  .marketingLanding .stats-bar {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px;
    background: var(--border); border: 1px solid var(--border); border-radius: 16px; overflow: hidden;
  }
  .marketingLanding .stats-bar .cell {
    background: var(--card); padding: 28px 24px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .marketingLanding .stats-bar .v { font-family: var(--font-mono); font-size: 36px; font-weight: 700; letter-spacing: -0.02em; }
  .marketingLanding .stats-bar .v .small { font-size: 18px; color: var(--muted); margin-left: 4px; }
  .marketingLanding .stats-bar .k { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.16em; }
  @media (max-width: 820px) { .marketingLanding .stats-bar { grid-template-columns: repeat(2, 1fr); } }

  .marketingLanding .prov-wrap { display: grid; grid-template-columns: 1.05fr 1fr; gap: 56px; align-items: center; }
  .marketingLanding .prov-title { font-size: 40px; line-height: 1.08; letter-spacing: -0.025em; margin: 16px 0 14px; max-width: 540px; font-weight: 700; }
  .marketingLanding .prov-title span { color: color-mix(in oklch, var(--primary) 80%, white); }
  .marketingLanding .prov-copy { font-size: 16px; color: var(--muted); line-height: 1.6; margin: 0 0 20px; max-width: 520px; }
  .marketingLanding .check-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
  .marketingLanding .check-list li { display: flex; gap: 10px; font-size: 14px; color: var(--fg); }
  .marketingLanding .check-list svg { width: 14px; height: 14px; color: color-mix(in oklch, var(--success) 75%, white); margin-top: 5px; }
  .marketingLanding .prov-mock {
    border: 1px solid var(--border-strong); border-radius: 16px; background: var(--card);
    padding: 22px; display: flex; flex-direction: column; gap: 14px;
    box-shadow: 0 24px 60px var(--shadow-medium);
    max-width: 100%;
  }
  .marketingLanding .prov-q { color: var(--muted); font-family: var(--font-mono); font-size: 12.5px; }
  .marketingLanding .prov-a { font-size: 14.5px; line-height: 1.6; }
  .marketingLanding .prov-cites { display: flex; flex-direction: column; gap: 8px; }
  .marketingLanding .prov-cite {
    display: grid; grid-template-columns: 36px 1fr auto; gap: 12px; align-items: center;
    padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg);
  }
  .marketingLanding .prov-cite .ic { width: 36px; height: 36px; border-radius: 8px; background: color-mix(in oklch, var(--primary) 14%, transparent); color: color-mix(in oklch, var(--primary) 85%, white); display: grid; place-items: center; }
  .marketingLanding .prov-cite .ic.success { background: color-mix(in oklch, var(--success) 14%, transparent); color: color-mix(in oklch, var(--success) 85%, white); }
  .marketingLanding .prov-cite .ic.warning { background: color-mix(in oklch, var(--warning) 14%, transparent); color: color-mix(in oklch, var(--warning) 85%, white); }
  .marketingLanding .prov-cite .ic svg { width: 15px; height: 15px; }
  .marketingLanding .prov-cite .name { font-size: 13px; font-weight: 500; }
  .marketingLanding .prov-cite .meta { font-family: var(--font-mono); font-size: 10.5px; color: var(--muted); margin-top: 1px; }
  .marketingLanding .prov-cite .open { font-family: var(--font-mono); font-size: 10.5px; color: color-mix(in oklch, var(--primary) 85%, white); }
  @media (max-width: 1000px) { .marketingLanding .prov-wrap { grid-template-columns: 1fr; } }
  @media (max-width: 580px) {
    .marketingLanding .prov-cite { grid-template-columns: 36px 1fr; }
    .marketingLanding .prov-cite .open { grid-column: 2; }
  }

  .marketingLanding .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .marketingLanding .feat {
    border: 1px solid var(--border); border-radius: 14px; padding: 22px;
    background: var(--card); display: flex; flex-direction: column; gap: 8px;
    transition: border-color 150ms, transform 150ms;
  }
  .marketingLanding .feat:hover { border-color: color-mix(in oklch, var(--primary) 40%, var(--border)); transform: translateY(-2px); }
  .marketingLanding .feat .ic {
    width: 36px; height: 36px; border-radius: 9px;
    background: color-mix(in oklch, var(--primary) 14%, transparent);
    color: color-mix(in oklch, var(--primary) 88%, white);
    display: grid; place-items: center; margin-bottom: 6px;
  }
  .marketingLanding .feat .ic svg { width: 16px; height: 16px; }
  .marketingLanding .feat h3 { font-size: 15px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
  .marketingLanding .feat p { font-size: 13px; color: var(--muted); margin: 0; line-height: 1.55; }
  .marketingLanding .feat.wide { grid-column: span 2; }
  @media (max-width: 1000px) { .marketingLanding .features { grid-template-columns: repeat(2, 1fr); } .marketingLanding .feat.wide { grid-column: span 1; } }
  @media (max-width: 720px) { .marketingLanding .features { grid-template-columns: 1fr; } }

  .marketingLanding .testimonial-section { padding-top: 72px; padding-bottom: 72px; }
  .marketingLanding .testimonial {
    border: 1px solid var(--border); border-radius: 18px; padding: 36px;
    background: var(--card);
    display: grid; grid-template-columns: 1fr 1fr; gap: 32px;
  }
  .marketingLanding .stars { display: flex; gap: 2px; margin-bottom: 14px; color: color-mix(in oklch, var(--warning) 85%, white); }
  .marketingLanding .stars svg { width: 16px; height: 16px; }
  .marketingLanding .t-quote { font-size: 22px; line-height: 1.45; letter-spacing: -0.01em; font-weight: 500; }
  .marketingLanding .t-quote .accent { color: color-mix(in oklch, var(--primary) 80%, white); }
  .marketingLanding .t-author { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
  .marketingLanding .t-author .av { width: 40px; height: 40px; border-radius: 999px; background: color-mix(in oklch, var(--primary) 25%, transparent); color: color-mix(in oklch, var(--primary) 90%, white); display: grid; place-items: center; font-weight: 600; font-size: 13px; }
  .marketingLanding .t-author .nm { font-size: 13px; font-weight: 500; }
  .marketingLanding .t-author .rl { font-size: 11.5px; color: var(--muted); font-family: var(--font-mono); margin-top: 2px; }
  .marketingLanding .t-meta { padding: 18px; border: 1px solid var(--border); border-radius: 12px; background: var(--secondary); font-family: var(--font-mono); font-size: 12px; color: var(--muted); line-height: 1.6; }
  .marketingLanding .t-meta .row { display: flex; justify-content: space-between; gap: 16px; padding: 5px 0; border-bottom: 1px dashed var(--border); }
  .marketingLanding .t-meta .row:last-child { border-bottom: 0; }
  .marketingLanding .t-meta .row .v { color: var(--fg); text-align: right; }
  @media (max-width: 900px) { .marketingLanding .testimonial { grid-template-columns: 1fr; padding: 24px; } }

  .marketingLanding .cases { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
  .marketingLanding .case {
    border: 1px solid var(--border); border-radius: 14px; padding: 22px;
    background: var(--card); display: grid; grid-template-columns: 44px 1fr; gap: 16px;
  }
  .marketingLanding .case .ic-big {
    width: 44px; height: 44px; border-radius: 11px;
    background: color-mix(in oklch, var(--accent-color, var(--primary)) 16%, transparent);
    color: color-mix(in oklch, var(--accent-color, var(--primary)) 90%, white);
    display: grid; place-items: center;
  }
  .marketingLanding .case .ic-big svg { width: 19px; height: 19px; }
  .marketingLanding .case h3 { font-size: 16px; font-weight: 600; margin: 0 0 6px; letter-spacing: -0.01em; }
  .marketingLanding .case .who { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
  .marketingLanding .case p { font-size: 13px; color: var(--muted); margin: 0; line-height: 1.55; }
  .marketingLanding .case .ex {
    margin-top: 10px; font-family: var(--font-mono); font-size: 11.5px;
    padding: 8px 10px; border-radius: 8px; background: var(--secondary);
    color: color-mix(in oklch, var(--fg) 70%, var(--muted)); line-height: 1.5;
  }
  .marketingLanding .case .ex::before { content: "> "; color: color-mix(in oklch, var(--accent-color, var(--primary)) 85%, white); }
  .marketingLanding .case.c-1 { --accent-color: var(--primary); }
  .marketingLanding .case.c-2 { --accent-color: var(--warning); }
  .marketingLanding .case.c-3 { --accent-color: var(--success); }
  .marketingLanding .case.c-4 { --accent-color: var(--magenta); }
  @media (max-width: 820px) { .marketingLanding .cases { grid-template-columns: 1fr; } }

  .marketingLanding .integrations { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
  .marketingLanding .int {
    border: 1px solid var(--border); border-radius: 12px; padding: 16px;
    background: var(--card); text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px;
  }
  .marketingLanding .int .ic { width: 32px; height: 32px; border-radius: 8px; background: var(--secondary); color: var(--fg); display: grid; place-items: center; }
  .marketingLanding .int .ic svg { width: 15px; height: 15px; }
  .marketingLanding .int .nm { font-size: 12px; font-weight: 500; }
  .marketingLanding .int .tg { font-family: var(--font-mono); font-size: 9.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.16em; }
  @media (max-width: 1000px) { .marketingLanding .integrations { grid-template-columns: repeat(3, 1fr); } }
  @media (max-width: 580px) { .marketingLanding .integrations { grid-template-columns: repeat(2, 1fr); } }

  .marketingLanding .pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .marketingLanding .plan {
    border: 1px solid var(--border); border-radius: 18px;
    background: var(--card); padding: 28px;
    display: flex; flex-direction: column; gap: 14px;
    position: relative;
  }
  .marketingLanding .plan.featured {
    border-color: color-mix(in oklch, var(--primary) 45%, var(--border));
    background: linear-gradient(180deg, color-mix(in oklch, var(--primary) 10%, var(--card)), var(--card));
    box-shadow: 0 20px 50px color-mix(in oklch, var(--primary) 14%, transparent);
  }
  .marketingLanding .plan .badge-top {
    position: absolute; top: -10px; left: 24px;
    background: var(--primary); color: white; padding: 4px 10px;
    border-radius: 999px; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; font-family: var(--font-mono); font-weight: 600;
  }
  .marketingLanding .plan h3 { font-size: 18px; font-weight: 600; margin: 0; }
  .marketingLanding .plan .price { font-family: var(--font-mono); font-size: 36px; font-weight: 700; letter-spacing: -0.02em; }
  .marketingLanding .plan .price .per { font-size: 14px; color: var(--muted); margin-left: 4px; font-weight: 500; }
  .marketingLanding .plan .desc { font-size: 13px; color: var(--muted); }
  .marketingLanding .plan ul { list-style: none; padding: 0; margin: 6px 0 12px; display: flex; flex-direction: column; gap: 8px; }
  .marketingLanding .plan ul li { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 1.5; }
  .marketingLanding .plan ul li svg { width: 13px; height: 13px; color: color-mix(in oklch, var(--success) 75%, white); margin-top: 4px; }
  .marketingLanding .plan .ct { margin-top: auto; }
  @media (max-width: 900px) { .marketingLanding .pricing-grid { grid-template-columns: 1fr; } }

  .marketingLanding .faq { display: flex; flex-direction: column; gap: 8px; max-width: 820px; margin: 0 auto; }
  .marketingLanding details.q {
    border: 1px solid var(--border); border-radius: 12px; background: var(--card);
    padding: 0 22px; overflow: hidden;
  }
  .marketingLanding details.q[open] { border-color: color-mix(in oklch, var(--primary) 30%, var(--border)); }
  .marketingLanding details.q summary {
    list-style: none; cursor: pointer; padding: 18px 0;
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    font-size: 15px; font-weight: 500;
  }
  .marketingLanding details.q summary::-webkit-details-marker { display: none; }
  .marketingLanding details.q summary::after {
    content: ""; width: 10px; height: 10px;
    border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted);
    transform: rotate(45deg); transition: transform 150ms;
    flex-shrink: 0;
  }
  .marketingLanding details.q[open] summary::after { transform: rotate(-135deg); }
  .marketingLanding details.q .a { padding: 0 0 18px; font-size: 14px; color: var(--muted); line-height: 1.65; max-width: 720px; }

  .marketingLanding .cta-wrap { max-width: 1100px; }
  .marketingLanding .cta-final {
    border-radius: 24px;
    padding: 72px 48px;
    background:
      radial-gradient(50% 80% at 50% 0%, color-mix(in oklch, var(--primary) 28%, transparent), transparent 70%),
      linear-gradient(180deg, color-mix(in oklch, var(--primary) 10%, var(--card)), var(--card));
    border: 1px solid color-mix(in oklch, var(--primary) 35%, var(--border));
    text-align: center;
    position: relative;
    overflow: hidden;
    box-shadow: 0 30px 80px color-mix(in oklch, var(--primary) 18%, transparent);
  }
  .marketingLanding .cta-final h2 { font-size: 48px; line-height: 1.05; letter-spacing: -0.025em; margin: 0 auto 16px; max-width: 720px; font-weight: 700; }
  .marketingLanding .cta-final p { font-size: 17px; color: var(--muted); max-width: 540px; margin: 0 auto 28px; line-height: 1.55; }
  .marketingLanding .cta-row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .marketingLanding .security-row { margin-top: 22px; display: flex; gap: 18px; justify-content: center; flex-wrap: wrap; font-size: 12px; color: var(--muted); font-family: var(--font-mono); letter-spacing: 0.08em; }
  .marketingLanding .security-row span { display: inline-flex; align-items: center; gap: 6px; }
  .marketingLanding .security-row svg { width: 12px; height: 12px; }
  @media (max-width: 720px) { .marketingLanding .cta-final { padding: 48px 22px; } .marketingLanding .cta-final h2 { font-size: 32px; } }

  .marketingLanding footer { border-top: 1px solid var(--border); padding: 48px 32px 36px; }
  .marketingLanding .foot-inner { max-width: 1280px; margin: 0 auto; display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; gap: 32px; }
  .marketingLanding .foot-col h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; font-family: var(--font-mono); color: var(--muted); margin: 0 0 14px; font-weight: 600; }
  .marketingLanding .foot-col ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
  .marketingLanding .foot-col a { font-size: 13px; color: var(--muted); }
  .marketingLanding .foot-col a:hover { color: var(--fg); }
  .marketingLanding .foot-brand { display: flex; flex-direction: column; gap: 12px; max-width: 280px; }
  .marketingLanding .foot-brand p { font-size: 13px; color: var(--muted); margin: 0; line-height: 1.55; }
  .marketingLanding .foot-bottom {
    max-width: 1280px; margin: 36px auto 0;
    padding-top: 24px; border-top: 1px solid var(--border);
    display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap;
    font-size: 12px; color: var(--muted); font-family: var(--font-mono);
  }
  .marketingLanding .lead-modal {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: 20px;
  }
  .marketingLanding .lead-backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    background: color-mix(in oklch, black 72%, transparent);
    backdrop-filter: blur(8px);
  }
  .marketingLanding .lead-panel {
    position: relative;
    width: min(100%, 460px);
    border: 1px solid color-mix(in oklch, var(--primary) 30%, var(--border));
    border-radius: 16px;
    background: linear-gradient(180deg, color-mix(in oklch, var(--primary) 8%, var(--card)), var(--card));
    box-shadow: 0 30px 90px var(--shadow-strong);
    padding: 28px;
  }
  .marketingLanding .lead-close {
    position: absolute;
    top: 14px;
    right: 14px;
    width: 30px;
    height: 30px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--secondary);
    color: var(--muted);
  }
  .marketingLanding .lead-close:hover { color: var(--fg); border-color: var(--border-strong); }
  .marketingLanding .lead-plan {
    width: fit-content;
    margin-bottom: 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 5px 10px;
    color: color-mix(in oklch, var(--primary) 82%, white);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .marketingLanding .lead-panel h3 { margin: 0 34px 8px 0; font-size: 24px; line-height: 1.18; letter-spacing: -0.02em; }
  .marketingLanding .lead-panel p { margin: 0 0 20px; color: var(--muted); font-size: 14px; line-height: 1.55; }
  .marketingLanding .lead-form { display: flex; flex-direction: column; gap: 12px; }
  .marketingLanding .lead-form label { display: flex; flex-direction: column; gap: 6px; }
  .marketingLanding .lead-form label span {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .marketingLanding .lead-form input,
  .marketingLanding .lead-form textarea {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: color-mix(in oklch, var(--bg) 76%, var(--card));
    color: var(--fg);
    padding: 11px 12px;
    font: inherit;
    font-size: 14px;
    outline: none;
  }
  .marketingLanding .lead-form input:focus,
  .marketingLanding .lead-form textarea:focus { border-color: color-mix(in oklch, var(--primary) 70%, var(--border)); }
  .marketingLanding .lead-form textarea { resize: vertical; min-height: 82px; }
  .marketingLanding .lead-error,
  .marketingLanding .lead-success {
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 13px;
  }
  .marketingLanding .lead-error { color: color-mix(in oklch, var(--destructive) 84%, white); background: color-mix(in oklch, var(--destructive) 12%, transparent); }
  .marketingLanding .lead-success { color: color-mix(in oklch, var(--success) 78%, white); background: color-mix(in oklch, var(--success) 12%, transparent); }
  .marketingLanding .lead-submit { width: 100%; margin-top: 4px; }
  @media (max-width: 900px) { .marketingLanding .foot-inner { grid-template-columns: 1fr 1fr; } }
  @media (max-width: 580px) { .marketingLanding .foot-inner { grid-template-columns: 1fr; } }
`;
