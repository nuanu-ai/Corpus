import { normalizeAppLocale, type AppLocale } from "@/lib/i18n/config";

export type LandingLocale = "en" | "ru";

export type LandingIconName =
  | "alarm-clock"
  | "arrow-right"
  | "atom"
  | "banknote"
  | "bell-ring"
  | "brain"
  | "briefcase"
  | "building-2"
  | "check"
  | "cloud"
  | "code-2"
  | "compass"
  | "droplet"
  | "file-output"
  | "file-search"
  | "file-spreadsheet"
  | "file-text"
  | "folder-x"
  | "ghost"
  | "globe"
  | "hard-drive"
  | "hexagon"
  | "key-round"
  | "landmark"
  | "layers"
  | "leaf"
  | "lock"
  | "mail"
  | "message-circle"
  | "message-square"
  | "messages-square"
  | "notebook"
  | "play"
  | "play-circle"
  | "plus"
  | "rocket"
  | "save"
  | "send"
  | "share-2"
  | "shield"
  | "shield-check"
  | "smartphone"
  | "sparkles"
  | "star"
  | "trending-up"
  | "upload-cloud"
  | "user-plus"
  | "users"
  | "users-round"
  | "zap";

type LinkCopy = {
  label: string;
  href: string;
};

type IconText = {
  icon: LandingIconName;
  text: string;
};

type SectionHead = {
  eyebrow: string;
  title: string;
  subtitle?: string;
};

type CardCopy = {
  icon: LandingIconName;
  title: string;
  body: string;
};

export type LandingCopy = {
  locale: LandingLocale;
  metadata: {
    title: string;
    description: string;
    keywords: string[];
    canonicalPath: string;
    ogTitle: string;
    ogDescription: string;
    ogLocale: string;
    twitterCard: "summary_large_image";
  };
  nav: {
    links: LinkCopy[];
    signIn: string;
    tryIt: string;
    dashboard: string;
  };
  hero: {
    eyebrow: string;
    titleStart: string;
    titleAccent: string;
    titleEnd: string;
    lede: string;
    demoCta: string;
    accountCta: string;
    trust: IconText[];
    mock: {
      sourceBadge: string;
      speedBadge: string;
      url: string;
      question: string;
      typing: string;
      answerStart: string;
      salary: string;
      answerMiddle: string;
      aws: string;
      answerEnd: string;
      stripe: string;
      sources: IconText[];
      input: string;
    };
    trustStrip: {
      label: string;
      countSuffix: string;
    };
  };
  problem: SectionHead & {
    cards: Array<CardCopy & { quote: string }>;
  };
  how: SectionHead & {
    steps: Array<{
      className: "add" | "ask" | "act";
      tag: string;
      title: string;
      description: string;
      items: IconText[];
    }>;
  };
  demo: {
    stamp: string;
    title: string;
    subtitle: string;
    bullets: string[];
    cta: string;
    mock: {
      label: string;
      title: string;
      kpis: Array<{ label: string; value: string; delta: string; tone?: "warning" }>;
      suggestionsLabel: string;
      suggestions: string[];
    };
  };
  stats: Array<{ value: string; unit?: string; label: string }>;
  provenance: {
    eyebrow: string;
    titleStart: string;
    titleAccent: string;
    titleEnd: string;
    body: string;
    bullets: string[];
    question: string;
    answer: string;
    citations: Array<{
      icon: LandingIconName;
      tone?: "success" | "warning";
      name: string;
      meta: string;
      open: string;
    }>;
  };
  features: SectionHead & {
    cards: Array<CardCopy & { wide?: boolean }>;
  };
  testimonial: {
    quoteStart: string;
    quoteAccent: string;
    quoteEnd: string;
    initials: string;
    name: string;
    role: string;
    metrics: Array<{ label: string; value: string }>;
  };
  cases: SectionHead & {
    cards: Array<CardCopy & { who: string; example: string; className: "c-1" | "c-2" | "c-3" | "c-4" }>;
  };
  integrations: SectionHead & {
    items: Array<{ icon: LandingIconName; name: string; tag: string }>;
  };
  pricing: SectionHead & {
    plans: Array<{
      name: string;
      price: string;
      period: string;
      description: string;
      features: string[];
      cta: string;
      featured?: boolean;
      badge?: string;
      contact?: boolean;
      leadIntent?: "team_trial" | "holding_contact";
    }>;
  };
  leadModal: {
    title: string;
    teamTitle: string;
    contactTitle: string;
    subtitle: string;
    nameLabel: string;
    emailLabel: string;
    companyLabel: string;
    messageLabel: string;
    submit: string;
    submitting: string;
    successTeam: string;
    successContact: string;
    error: string;
    close: string;
    continueSignup: string;
  };
  faq: {
    title: string;
    eyebrow: string;
    items: Array<{ question: string; answer: string }>;
  };
  finalCta: {
    eyebrow: string;
    title: string;
    subtitle: string;
    demoCta: string;
    accountCta: string;
    badges: IconText[];
  };
  footer: {
    blurb: string;
    columns: Array<{ title: string; links: LinkCopy[] }>;
    copyright: string;
    tagline: string;
  };
};

const LANDING_COPY: Record<LandingLocale, LandingCopy> = {
  en: {
    locale: "en",
    metadata: {
      title: "Corpus - the financial & operational AI assistant for founders",
      description:
        "Corpus is your company's memory. Upload statements, contracts and spreadsheets - get answers with links to the exact source in seconds. No jargon. Try the demo.",
      keywords: [
        "AI assistant for founders",
        "Corpus",
        "Corpus",
        "financial AI",
        "startup assistant",
        "contract analysis",
        "runway calculator",
        "solo founder",
        "AI bookkeeper",
      ],
      canonicalPath: "/",
      ogTitle: "Corpus - your company's memory, built for solo founders",
      ogDescription:
        "Upload files. Ask. Get answers with a link to the source. 30-second demo.",
      ogLocale: "en_US",
      twitterCard: "summary_large_image",
    },
    nav: {
      links: [
        { label: "How it works", href: "#how" },
        { label: "Features", href: "#features" },
        { label: "Use cases", href: "#cases" },
        { label: "Pricing", href: "#pricing" },
        { label: "FAQ", href: "#faq" },
      ],
      signIn: "Sign in",
      tryIt: "Try it",
      dashboard: "Dashboard",
    },
    hero: {
      eyebrow: "For founders and small teams",
      titleStart: "The AI that",
      titleAccent: "knows your company",
      titleEnd: "better than you remember it.",
      lede:
        "Upload statements, contracts and spreadsheets - Corpus reads them and answers any question with links to the exact rows and pages. No hallucinations, no jargon.",
      demoCta: "Try the demo · 30 sec",
      accountCta: "Create account",
      trust: [
        { icon: "check", text: "No card" },
        { icon: "check", text: "No install" },
        { icon: "check", text: "7-day free trial" },
        { icon: "check", text: "Bring your own key - free" },
      ],
      mock: {
        sourceBadge: "Answer linked to its source",
        speedBadge: "Done in 2.4 sec",
        url: "corpus.example/demo",
        question: "Where is most of our money going in Q3?",
        typing: "AI is reading 3 sources...",
        answerStart: "In Q3 26 the largest expense line is",
        salary: "salaries",
        answerMiddle: ": $1.82M (36% of opex). Next is AWS infrastructure",
        aws: "$420K",
        answerEnd: "and Stripe fees",
        stripe: "$94K",
        sources: [
          { icon: "file-spreadsheet", text: "q3-ledger.xlsx · rows 14-22" },
          { icon: "landmark", text: "Revolut Nov · 218 transactions" },
          { icon: "users", text: "Payroll Oct.csv" },
        ],
        input: "Show runway at the current burn rate...",
      },
      trustStrip: {
        label: "Trusted by",
        countSuffix: "company workspaces in Corpus",
      },
    },
    problem: {
      eyebrow: "Sound familiar?",
      title: "Founders spend 20 hours a week on questions an AI answers in a minute.",
      subtitle:
        "Finances, contracts, numbers, metrics, documents - the data exists, but it's scattered and doesn't answer on its own. Corpus pulls it into one memory you can simply ask.",
      cards: [
        {
          icon: "folder-x",
          title: "Data in 12 different places",
          body:
            "Excel with the accountant, PDFs in Drive, statements in the bank, contracts in email. No Q4 report comes together without 3 hours of assembly.",
          quote: '"How much did we spend on marketing in August?" - three minutes in Excel.',
        },
        {
          icon: "ghost",
          title: "AI makes up the numbers",
          body:
            "A regular chatbot answers confidently - but with no source you can't verify it. One wrong runway calc can cost the company a couple of months of life.",
          quote: '"Where\'s that number from?" - AI: "I may have been wrong."',
        },
        {
          icon: "alarm-clock",
          title: "Every report from scratch",
          body:
            "An investor asks for MRR. The CFO assembles the ledger. The accountant fills in VAT. The same numbers get recomputed by hand every time.",
          quote: '"Can you send the P&L by Monday?" - Friday, 9:40 PM.',
        },
      ],
    },
    how: {
      eyebrow: "How it works",
      title: "Three verbs instead of twelve menus",
      subtitle:
        'Add data. Ask. Act. No "tenant", "workspace", "promote-to-DB" or "retrieval mode" - that all stays in the code.',
      steps: [
        {
          className: "add",
          tag: "01 · ADD",
          title: "Add",
          description: "Bring data into your company's memory. Three ways to choose from.",
          items: [
            { icon: "upload-cloud", text: "Drag in PDF, Excel, CSV, OFX statement" },
            { icon: "landmark", text: "Connect your bank via Plaid · 90 days of history" },
            { icon: "mail", text: "Forward to your personal Corpus email" },
          ],
        },
        {
          className: "ask",
          tag: "02 · ASK",
          title: "Ask",
          description: "Ask anything you need. In chat or as a quick question on the dashboard.",
          items: [
            { icon: "messages-square", text: "Chat with an AI advisor on your company" },
            { icon: "sparkles", text: "Ready-made questions on the dashboard" },
            { icon: "bell-ring", text: "Alerts on triggers: budget, runway" },
          ],
        },
        {
          className: "act",
          tag: "03 · ACT",
          title: "Act",
          description: "Turn answers into action. The human decides, the AI assists.",
          items: [
            { icon: "save", text: "Save the fact into company memory" },
            { icon: "file-output", text: "Export to Excel, PDF, investor report" },
            { icon: "share-2", text: "Share with the team by link" },
          ],
        },
      ],
    },
    demo: {
      stamp: "Sandbox · guided start",
      title: "Try it on a ready-made company. 30 seconds to your first answer.",
      subtitle:
        "Open the Example Demo - we've already loaded the ledger, contracts and bank statements. Ask a question and watch the AI read the data and cite its sources.",
      bullets: [
        "4 files already ingested - start asking right away",
        "No card or OpenAI key required",
        "Save the session to an account in one click",
      ],
      cta: "Open the demo",
      mock: {
        label: "Example Demo · sandbox",
        title: "Overview · Q3 2026",
        kpis: [
          { label: "Revenue", value: "$9.61M", delta: "+12.4%" },
          { label: "Expenses", value: "$5.04M", delta: "+4.1%", tone: "warning" },
          { label: "Profit", value: "$4.57M", delta: "+21.7%" },
        ],
        suggestionsLabel: "Suggested questions",
        suggestions: [
          "Top expense in Q3?",
          "Runway at current burn",
          "Compare Q3 vs last year",
          "Anything unusual in the Mercato contract?",
        ],
      },
    },
    stats: [
      { value: "90", unit: "sec", label: "To your first answer" },
      { value: "14×", label: "Faster than by hand" },
      { value: "100", unit: "%", label: "Answers cite a source" },
      { value: "$0", label: "To start, with your own key" },
    ],
    provenance: {
      eyebrow: "Provenance",
      titleStart: "Every answer is",
      titleAccent: "signed by its source",
      titleEnd: ". No blind promises.",
      body:
        "Corpus doesn't invent numbers. Every figure, every fact, every conclusion comes with a chip linking to the exact file and row. Click it - see the original.",
      bullets: [
        "Clickable sources right inside the answer",
        "Row highlighting in Excel and page anchors in PDF",
        'If the data isn\'t there, the AI says "not found" instead of guessing',
        "Git-backed memory - see the history of every fact",
      ],
      question: "What's the margin on the Pro product in Q3?",
      answer:
        "The margin on the Pro plan in Q3 is 68.4%. Up from 62.1% in Q2 thanks to lower AWS costs and a renegotiated Stripe rate.",
      citations: [
        { icon: "file-spreadsheet", name: "q3-ledger.xlsx", meta: 'sheet "Pro" · rows 14-22', open: "open ->" },
        { icon: "landmark", tone: "success", name: "stripe-q3.csv", meta: "8,942 transactions · 2.7% fee", open: "open ->" },
        { icon: "file-text", tone: "warning", name: "aws-invoice-sept.pdf", meta: "p. 2 · total $138,420", open: "open ->" },
      ],
    },
    features: {
      eyebrow: "Features",
      title: "Everything a founder needs in one place",
      subtitle: "Memory, chat, documents, banks, export, team - without juggling tabs and Notion pages.",
      cards: [
        {
          icon: "brain",
          title: "Company memory",
          body:
            "The AI remembers everything you upload: contracts, statements, numbers, agreements. No re-reading the same file 12 times - ask once, the answer is saved to memory and available to the team.",
          wide: true,
        },
        { icon: "shield-check", title: "Provenance in every answer", body: 'Not "the AI said so" but "row 17 in q3-ledger.xlsx". Verifiable, linkable, audit-ready.' },
        { icon: "file-search", title: "Contract analysis", body: "Upload a PDF - the AI finds key terms, risks and non-standard clauses. Compare revisions in one click." },
        { icon: "trending-up", title: "Financial dashboard", body: "Revenue, expenses, runway, burn rate - automatically from your ledger and bank statements. No Excel." },
        { icon: "building-2", title: "Holding structure", body: "Multiple companies under one roof: parent, subsidiaries, cross-links between documents and accounts." },
        { icon: "smartphone", title: "Mobile app", body: "Ask about runway from a cab, forward a statement on the go, approve an expense from anywhere." },
        { icon: "users", title: "Team roles", body: "The accountant sees the ledger, the investor sees the report without deal-flow, the founder sees everything. Granular permissions." },
        { icon: "key-round", title: "Bring your own OpenAI / Anthropic key", body: "BYOK mode: use your own key. Data never passes through our billing infrastructure. Free." },
        { icon: "code-2", title: "API + Webhooks", body: "Plug Corpus into your ETL, BI tool or internal services. SDKs for Python and Node." },
      ],
    },
    testimonial: {
      quoteStart: "I used to spend",
      quoteAccent: "Friday nights",
      quoteEnd:
        "assembling the investor report. Now I ask Corpus at 10:00 and by 10:04 I have a finished PDF with a link behind every number.",
      initials: "EX",
      name: "Illustrative example",
      role: "Synthetic product scenario",
      metrics: [
        { label: "Before Corpus", value: "8 hrs / week" },
        { label: "After", value: "35 min / week" },
        { label: "Files in memory", value: "214" },
        { label: "Questions / month", value: "320+" },
        { label: "Dataset", value: "Synthetic" },
      ],
    },
    cases: {
      eyebrow: "Use cases",
      title: "What founders do with Corpus every day",
      subtitle: 'This isn\'t "AI for everything." It\'s four scenarios that save 15+ hours a week.',
      cards: [
        {
          className: "c-1",
          icon: "trending-up",
          who: "Founder · SaaS",
          title: "Monthly financial report in 5 minutes",
          body:
            "The AI reads your ledger + bank statements, computes MRR, churn and runway, and generates an investor PDF with links behind every figure.",
          example: '"Prepare the monthly board update for tomorrow"',
        },
        {
          className: "c-2",
          icon: "file-search",
          who: "Operations · Legal",
          title: "Review a contract before signing",
          body:
            "Upload the agreement - the AI flags non-standard clauses, risks and deviations from your standard template. With citations.",
          example: '"What\'s non-standard in this MSA from Example Vendor?"',
        },
        {
          className: "c-3",
          icon: "banknote",
          who: "Founder · E-commerce",
          title: "Where the money goes - without an accountant",
          body:
            "Connect your bank - the AI categorizes spend, finds recurring subscriptions, anomalies and budget overruns.",
          example: '"Show all subscription spend for the last 6 months"',
        },
        {
          className: "c-4",
          icon: "users",
          who: "Team lead · Startup",
          title: "Onboarding a new hire",
          body:
            "A new CFO asks the AI about the company and gets answers with links to documents - instead of pinging the founder.",
          example: '"What\'s the company\'s cap table today?"',
        },
      ],
    },
    integrations: {
      eyebrow: "Integrations",
      title: "Connect what you already use",
      subtitle: "3 recommended connectors to start. The rest as you grow. No overwhelm in the first minute.",
      items: [
        { icon: "landmark", name: "Plaid", tag: "bank" },
        { icon: "hard-drive", name: "Google Drive", tag: "files" },
        { icon: "mail", name: "Email forward", tag: "inbound" },
        { icon: "message-circle", name: "Slack", tag: "alerts" },
        { icon: "briefcase", name: "Odoo", tag: "ERP" },
        { icon: "layers", name: "Stripe", tag: "payments" },
        { icon: "users-round", name: "BambooHR", tag: "HR" },
        { icon: "send", name: "Telegram bot", tag: "alerts" },
        { icon: "cloud", name: "Dropbox", tag: "files" },
        { icon: "notebook", name: "Notion", tag: "docs" },
        { icon: "file-text", name: "QuickBooks", tag: "accounting" },
        { icon: "plus", name: "API", tag: "custom" },
      ],
    },
    pricing: {
      eyebrow: "Pricing",
      title: "A simple choice. No enterprise theatrics.",
      subtitle: "7-day free trial on every plan. Bring your own OpenAI key - free forever.",
      plans: [
        {
          name: "Solo",
          price: "$0",
          period: "/ forever with BYOK",
          description: "For a single founder. Your own OpenAI / Anthropic key.",
          features: ["1 company, 1 user", "Up to 500 files in memory", "Chat with sources", "Mobile app", "Your own API key"],
          cta: "Start free",
        },
        {
          name: "Team",
          price: "$49",
          period: "/ mo",
          description: "For teams up to 10 people. No BYOK - we pay for the model.",
          features: ["Up to 10 users", "Unlimited files", "Holding structure (up to 3 companies)", "All integrations", "Team roles + permissions", "API + Webhooks", "Priority support"],
          cta: "Start 7-day trial",
          featured: true,
          badge: "Popular",
          leadIntent: "team_trial",
        },
        {
          name: "Holding",
          price: "$299",
          period: "/ mo",
          description: "For company groups and funds with multiple portfolio entities.",
          features: ["Unlimited companies and users", "Cross-company queries", "Audit log + compliance", "SSO / SAML", "Dedicated CSM", "SLA 99.9%"],
          cta: "Contact us",
          contact: true,
          leadIntent: "holding_contact",
        },
      ],
    },
    leadModal: {
      title: "Tell us where to send the next step",
      teamTitle: "Start the Team trial",
      contactTitle: "Talk to us about Holding",
      subtitle: "We will follow up with the right next step.",
      nameLabel: "Your name",
      emailLabel: "Work email",
      companyLabel: "Company",
      messageLabel: "What should we know?",
      submit: "Send",
      submitting: "Sending...",
      successTeam: "Saved. Opening signup...",
      successContact: "Saved. We will follow up.",
      error: "Could not save the lead. Try again.",
      close: "Close",
      continueSignup: "Continue to signup",
    },
    faq: {
      eyebrow: "FAQ",
      title: "Frequently asked questions",
      items: [
        {
          question: "How does the demo start?",
          answer:
            'The guided demo opens through onboarding with a ready-made "Example Demo" path. You can see the workflow quickly, then save your own data in an account when you are ready.',
        },
        {
          question: "What happens to my files and data?",
          answer:
            "Files are encrypted and stored in your company's isolated space. No one but you and your invited team can access them. Every AI answer includes a link to the source - you can always verify where a number came from. Your data is never used to train models.",
        },
        {
          question: "Can I use my own OpenAI or Anthropic key?",
          answer:
            "Yes. On the Solo plan, BYOK (your own key) is free forever. On Team and Holding we pay for the model ourselves, no key needed. When you use your own key, your data never passes through our billing infrastructure - a plus for compliance.",
        },
        {
          question: "What data can I upload?",
          answer:
            "Excel (XLSX), CSV, PDF, DOCX, OFX statements. Contracts, ledgers, payroll, transactions, AWS invoices, Stripe reports. Plus direct connections to banks (Plaid), Google Drive, Stripe, QuickBooks, Odoo. Up to 50 MB per file, unlimited files on Team and Holding plans.",
        },
        {
          question: "Does the AI really not make up numbers?",
          answer:
            'Every numeric answer is tied to a source chip linking to the exact row or page. If the data isn\'t there, the AI says "not found in your uploaded files" rather than guessing. That\'s Corpus\'s core architectural choice: provenance-first, no "maybe."',
        },
        {
          question: "Does it work for non-financial data?",
          answer:
            "Yes. Corpus works equally well with contracts, meeting notes, product docs and customer interviews. If the data fits in a file, we'll read it and make it available to ask about.",
        },
        {
          question: "How fast does the AI answer?",
          answer:
            "On average 2-4 seconds for a typical question. For complex analytical queries (multi-source, multi-step) up to 15 seconds. The AI shows in real time which sources it's reading.",
        },
        {
          question: "Can I cancel my subscription?",
          answer:
            "Any time from settings, no phone calls. All data stays in your account for 90 days after cancellation - you can come back. Full memory export to JSON / CSV is available on every plan.",
        },
      ],
    },
    finalCta: {
      eyebrow: "30 seconds to your first answer",
      title: "Open your company's memory. Right now.",
      subtitle:
        "No card, no install, no long forms. Try the demo or upload your own file - see the difference in a minute.",
      demoCta: "Try the demo",
      accountCta: "Create account",
      badges: [
        { icon: "shield", text: "AES-256 encryption" },
        { icon: "globe", text: "EU hosting" },
        { icon: "lock", text: "SOC 2 in progress" },
      ],
    },
    footer: {
      blurb:
        "Your company's memory, ready to be asked. For founders and teams who want to spend less time assembling numbers and more time making decisions.",
      columns: [
        {
          title: "Product",
          links: [
            { label: "How it works", href: "#how" },
            { label: "Features", href: "#features" },
            { label: "Use cases", href: "#cases" },
            { label: "Pricing", href: "#pricing" },
            { label: "API / Webhooks", href: "#" },
          ],
        },
        {
          title: "Company",
          links: [
            { label: "About", href: "#" },
            { label: "Blog", href: "#" },
            { label: "Careers", href: "#" },
            { label: "Contact", href: "#" },
            { label: "Press kit", href: "#" },
          ],
        },
        {
          title: "Legal",
          links: [
            { label: "Security", href: "#" },
            { label: "Privacy", href: "#" },
            { label: "Terms", href: "#" },
            { label: "DPA", href: "#" },
            { label: "Status", href: "#" },
          ],
        },
      ],
      copyright: "© 2026 Corpus contributors · v0.1",
      tagline: "built for founders",
    },
  },
  ru: {
    locale: "ru",
    metadata: {
      title: "Corpus - финансовый и операционный AI-ассистент для основателей",
      description:
        "Corpus - память вашей компании. Загрузите выписки, контракты, таблицы - и получайте ответы со ссылками на источники за секунды. Без жаргона. Демо.",
      keywords: [
        "AI ассистент для основателей",
        "Corpus",
        "Corpus",
        "финансовый AI",
        "ассистент для стартапа",
        "анализ контрактов",
        "runway calculator",
        "solo founder",
        "AI бухгалтер",
      ],
      canonicalPath: "/",
      ogTitle: "Corpus - память компании для solo founder'а",
      ogDescription:
        "Загрузите файлы. Спросите. Получите ответ со ссылкой на источник. Демо за 30 секунд.",
      ogLocale: "ru_RU",
      twitterCard: "summary_large_image",
    },
    nav: {
      links: [
        { label: "Как это работает", href: "#how" },
        { label: "Возможности", href: "#features" },
        { label: "Кейсы", href: "#cases" },
        { label: "Цены", href: "#pricing" },
        { label: "FAQ", href: "#faq" },
      ],
      signIn: "Войти",
      tryIt: "Попробовать",
      dashboard: "Дашборд",
    },
    hero: {
      eyebrow: "Для основателей и небольших команд",
      titleStart: "AI, который",
      titleAccent: "знает вашу компанию",
      titleEnd: "лучше, чем вы помните.",
      lede:
        "Загрузите выписки, контракты и таблицы - Corpus их прочитает и будет отвечать на любые вопросы со ссылками на конкретные строки и страницы. Никаких галлюцинаций, никакого жаргона.",
      demoCta: "Попробовать демо · 30 сек",
      accountCta: "Создать аккаунт",
      trust: [
        { icon: "check", text: "Без карты" },
        { icon: "check", text: "Без установки" },
        { icon: "check", text: "7 дней пробного периода" },
        { icon: "check", text: "Свой OpenAI ключ - бесплатно" },
      ],
      mock: {
        sourceBadge: "Ответ со ссылкой на источник",
        speedBadge: "Готово за 2.4 сек",
        url: "corpus.example/demo",
        question: "Куда уходит больше всего денег в Q3?",
        typing: "AI читает 3 источника...",
        answerStart: "В Q3 26 крупнейшая статья расходов -",
        salary: "зарплаты",
        answerMiddle: ": $1.82M (36% opex). Далее - инфраструктура AWS",
        aws: "$420K",
        answerEnd: "и комиссия Stripe",
        stripe: "$94K",
        sources: [
          { icon: "file-spreadsheet", text: "q3-ledger.xlsx · строки 14-22" },
          { icon: "landmark", text: "Revolut Nov · 218 транзакций" },
          { icon: "users", text: "Payroll Oct.csv" },
        ],
        input: "Покажи runway по текущему burn rate...",
      },
      trustStrip: {
        label: "Уже используется в",
        countSuffix: "рабочих пространствах компаний Corpus",
      },
    },
    problem: {
      eyebrow: "Знакомо?",
      title: "Основатель проводит 20 часов в неделю на вопросы, которые AI ответит за минуту.",
      subtitle:
        "Финансы, контракты, цифры, метрики, документы - данные есть, но они разбросаны и не отвечают сами. Corpus собирает их в одну память, к которой можно обращаться вопросами.",
      cards: [
        {
          icon: "folder-x",
          title: "Данные в 12 разных местах",
          body:
            "Excel у бухгалтера, PDF в Drive, выписки в банке, контракты в почте. Никакой Q4-отчёт не собирается без 3 часов сборки.",
          quote: "«А сколько мы потратили на маркетинг в августе?» - три минуты в Excel.",
        },
        {
          icon: "ghost",
          title: "AI выдумывает цифры",
          body:
            "Обычный чатбот отвечает уверенно - но без источника проверить нельзя. Один неправильный runway-расчёт стоит компании пары месяцев жизни.",
          quote: "«Откуда эта цифра?» - AI: «Возможно, я ошибся».",
        },
        {
          icon: "alarm-clock",
          title: "Каждый отчёт - с нуля",
          body:
            "Инвестор спрашивает MRR. CFO собирает ledger. Бухгалтер заполняет VAT. Одни и те же цифры пересчитываются вручную каждый раз.",
          quote: "«Можешь прислать P&L к понедельнику?» - пятница, 21:40.",
        },
      ],
    },
    how: {
      eyebrow: "Как это работает",
      title: "Три глагола вместо двенадцати разделов",
      subtitle:
        "Добавил данные. Спросил. Сделал. Никаких «tenant», «workspace», «promote-to-DB», «retrieval mode» - это всё остаётся в коде.",
      steps: [
        {
          className: "add",
          tag: "01 · ADD",
          title: "Добавить",
          description: "Принесите данные в память компании. Тремя способами на выбор.",
          items: [
            { icon: "upload-cloud", text: "Перетащить PDF, Excel, CSV, OFX-выписку" },
            { icon: "landmark", text: "Подключить банк через Plaid · 90 дней истории" },
            { icon: "mail", text: "Переслать на персональный email Corpus" },
          ],
        },
        {
          className: "ask",
          tag: "02 · ASK",
          title: "Спросить",
          description: "Спросите всё, что нужно. В чате или быстрым вопросом на дашборде.",
          items: [
            { icon: "messages-square", text: "Чат с AI-консультантом по компании" },
            { icon: "sparkles", text: "Готовые вопросы на дашборде" },
            { icon: "bell-ring", text: "Алерты по триггерам: бюджет, runway" },
          ],
        },
        {
          className: "act",
          tag: "03 · ACT",
          title: "Сделать",
          description: "Превратить ответ в действие. Человек принимает решение, AI помогает.",
          items: [
            { icon: "save", text: "Сохранить факт в память компании" },
            { icon: "file-output", text: "Экспорт в Excel, PDF, отчёт инвесторам" },
            { icon: "share-2", text: "Поделиться с командой по ссылке" },
          ],
        },
      ],
    },
    demo: {
      stamp: "Sandbox · быстрый старт",
      title: "Попробуйте на готовой компании. 30 секунд до первого ответа.",
      subtitle:
        "Откройте Example Demo - мы уже загрузили ledger, контракты и банковские выписки. Задайте вопрос и увидите, как AI читает данные и ссылается на источники.",
      bullets: [
        "4 файла уже прочитаны - задавайте вопросы сразу",
        "Не нужно карты или OpenAI ключа",
        "Сессия сохранится в аккаунт одним кликом",
      ],
      cta: "Открыть демо",
      mock: {
        label: "Example Demo · sandbox",
        title: "Обзор · Q3 2026",
        kpis: [
          { label: "Revenue", value: "$9.61M", delta: "+12.4%" },
          { label: "Расходы", value: "$5.04M", delta: "+4.1%", tone: "warning" },
          { label: "Прибыль", value: "$4.57M", delta: "+21.7%" },
        ],
        suggestionsLabel: "Готовые вопросы",
        suggestions: [
          "Главный расход в Q3?",
          "Runway по текущему burn",
          "Сравни Q3 с прошлым годом",
          "Что нестандартного в контракте Mercato?",
        ],
      },
    },
    stats: [
      { value: "90", unit: "сек", label: "До первого ответа" },
      { value: "14×", label: "Быстрее, чем вручную" },
      { value: "100", unit: "%", label: "Ответов со ссылкой на источник" },
      { value: "0", unit: "₽", label: "На старте, со своим ключом" },
    ],
    provenance: {
      eyebrow: "Provenance",
      titleStart: "Каждый ответ",
      titleAccent: "подписан источником",
      titleEnd: ". Никаких слепых обещаний.",
      body:
        "Corpus не выдумывает цифры. Каждое число, каждый факт, каждый вывод сопровождается chip'ом со ссылкой на конкретный файл и строку. Кликнул - увидел оригинал.",
      bullets: [
        "Кликабельные источники прямо в ответе",
        "Подсветка строк в Excel и страниц в PDF",
        "Если данных нет - AI говорит «не нашёл», а не выдумывает",
        "Git-backed память - видно историю каждого факта",
      ],
      question: "Какая маржа по продукту Pro в Q3?",
      answer:
        "Маржа по плану Pro в Q3 - 68.4%. Выросла с 62.1% во втором квартале благодаря снижению AWS-затрат и пересмотру тарифа Stripe.",
      citations: [
        { icon: "file-spreadsheet", name: "q3-ledger.xlsx", meta: "лист «Pro» · строки 14-22", open: "открыть ->" },
        { icon: "landmark", tone: "success", name: "stripe-q3.csv", meta: "8 942 транзакции · комиссия 2.7%", open: "открыть ->" },
        { icon: "file-text", tone: "warning", name: "aws-invoice-sept.pdf", meta: "стр. 2 · итог $138 420", open: "открыть ->" },
      ],
    },
    features: {
      eyebrow: "Возможности",
      title: "Всё для основателя в одном месте",
      subtitle: "Память, чат, документы, банки, экспорт, команда - без жонглирования вкладками и Notion-страницами.",
      cards: [
        {
          icon: "brain",
          title: "Память компании",
          body:
            "AI помнит всё, что вы загрузили: контракты, выписки, числа, договорённости. Не нужно перечитывать тот же файл 12 раз - спросите один раз, ответ сохранится в память и будет доступен команде.",
          wide: true,
        },
        { icon: "shield-check", title: "Provenance в каждом ответе", body: "Не «AI сказал», а «строка 17 в q3-ledger.xlsx». Проверяемо, ссылаемо, готово для аудита." },
        { icon: "file-search", title: "Анализ контрактов", body: "Загрузите PDF - AI найдёт ключевые условия, риски, нестандартные пункты. Сравнение редакций в один клик." },
        { icon: "trending-up", title: "Финансовый дашборд", body: "Revenue, расходы, runway, burn rate - автоматически из ledger и банковских выписок. Без Excel." },
        { icon: "building-2", title: "Holding-структура", body: "Несколько компаний под одной крышей: материнская, дочерние, cross-links между документами и счетами." },
        { icon: "smartphone", title: "Mobile-приложение", body: "Спросить про runway из такси, прислать выписку из почты в дороге, утвердить расход на ходу." },
        { icon: "users", title: "Командные роли", body: "Бухгалтер видит ledger, инвестор - отчёт без deal-flow, founder - всё. Granular permissions." },
        { icon: "key-round", title: "Свой OpenAI / Anthropic ключ", body: "BYOK режим: используйте свой ключ. Данные не проходят через нашу инфраструктуру оплаты. Бесплатно." },
        { icon: "code-2", title: "API + Webhooks", body: "Интегрируйте Corpus в свой ETL, BI-инструмент или внутренние сервисы. SDK для Python и Node." },
      ],
    },
    testimonial: {
      quoteStart: "Раньше я тратил",
      quoteAccent: "пятницу вечером",
      quoteEnd:
        "на сборку отчёта для инвестора. Сейчас спрашиваю у Corpus в 10:00, в 10:04 у меня готовый PDF со ссылками на каждую цифру.",
      initials: "ПР",
      name: "Иллюстративный пример",
      role: "Синтетический продуктовый сценарий",
      metrics: [
        { label: "До Corpus", value: "8 ч / неделя" },
        { label: "После", value: "35 мин / неделя" },
        { label: "Файлов в памяти", value: "214" },
        { label: "Вопросов к AI / мес", value: "320+" },
        { label: "Данные", value: "Синтетические" },
      ],
    },
    cases: {
      eyebrow: "Кейсы",
      title: "Что основатели делают с Corpus каждый день",
      subtitle: "Это не «AI для всего». Это четыре сценария, которые экономят 15+ часов в неделю.",
      cards: [
        {
          className: "c-1",
          icon: "trending-up",
          who: "Founder · SaaS",
          title: "Месячный финансовый отчёт за 5 минут",
          body:
            "AI читает ledger + банковские выписки, считает MRR, churn и runway, а затем генерирует investor PDF со ссылками за каждой цифрой.",
          example: "«Подготовь monthly board update к завтрашнему дню»",
        },
        {
          className: "c-2",
          icon: "file-search",
          who: "Operations · Legal",
          title: "Проверить договор перед подписью",
          body:
            "Загрузите agreement - AI подсветит нестандартные clauses, риски и отличия от вашего шаблона. С цитатами.",
          example: "«Что нестандартного в этом MSA от Example Vendor?»",
        },
        {
          className: "c-3",
          icon: "banknote",
          who: "Founder · E-commerce",
          title: "Куда уходят деньги - без бухгалтера",
          body:
            "Подключите банк - AI категоризирует расходы, находит регулярные подписки, аномалии и превышение бюджета.",
          example: "«Покажи все расходы на подписки за последние 6 месяцев»",
        },
        {
          className: "c-4",
          icon: "users",
          who: "Team lead · Startup",
          title: "Онбординг нового сотрудника",
          body:
            "Новый CFO спрашивает AI о компании и получает ответы со ссылками на документы - вместо того чтобы дёргать основателя.",
          example: "«Какой у компании cap table сегодня?»",
        },
      ],
    },
    integrations: {
      eyebrow: "Интеграции",
      title: "Подключите то, чем уже пользуетесь",
      subtitle: "3 рекомендованных коннектора для старта. Остальное - по мере роста. Без перегруза в первую минуту.",
      items: [
        { icon: "landmark", name: "Plaid", tag: "bank" },
        { icon: "hard-drive", name: "Google Drive", tag: "files" },
        { icon: "mail", name: "Email forward", tag: "inbound" },
        { icon: "message-circle", name: "Slack", tag: "alerts" },
        { icon: "briefcase", name: "Odoo", tag: "ERP" },
        { icon: "layers", name: "Stripe", tag: "payments" },
        { icon: "users-round", name: "BambooHR", tag: "HR" },
        { icon: "send", name: "Telegram bot", tag: "alerts" },
        { icon: "cloud", name: "Dropbox", tag: "files" },
        { icon: "notebook", name: "Notion", tag: "docs" },
        { icon: "file-text", name: "QuickBooks", tag: "accounting" },
        { icon: "plus", name: "API", tag: "custom" },
      ],
    },
    pricing: {
      eyebrow: "Цены",
      title: "Простой выбор. Без enterprise-театра.",
      subtitle: "7 дней пробного периода на каждом тарифе. Свой OpenAI ключ - бесплатно навсегда.",
      plans: [
        {
          name: "Solo",
          price: "$0",
          period: "/ навсегда с BYOK",
          description: "Для одного основателя. Ваш OpenAI / Anthropic ключ.",
          features: ["1 компания, 1 пользователь", "До 500 файлов в памяти", "Чат с источниками", "Mobile app", "Свой API-ключ"],
          cta: "Начать бесплатно",
        },
        {
          name: "Team",
          price: "$49",
          period: "/ мес",
          description: "Для команд до 10 человек. Без BYOK - модель оплачиваем мы.",
          features: ["До 10 пользователей", "Безлимитные файлы", "Holding structure (до 3 компаний)", "Все интеграции", "Командные роли + permissions", "API + Webhooks", "Priority support"],
          cta: "Начать 7-дневный trial",
          featured: true,
          badge: "Popular",
          leadIntent: "team_trial",
        },
        {
          name: "Holding",
          price: "$299",
          period: "/ мес",
          description: "Для групп компаний и фондов с несколькими portfolio entities.",
          features: ["Безлимитные компании и пользователи", "Cross-company queries", "Audit log + compliance", "SSO / SAML", "Dedicated CSM", "SLA 99.9%"],
          cta: "Связаться",
          contact: true,
          leadIntent: "holding_contact",
        },
      ],
    },
    leadModal: {
      title: "Куда отправить следующий шаг",
      teamTitle: "Запустить Team trial",
      contactTitle: "Обсудить Holding",
      subtitle: "Мы вернёмся к вам с правильным следующим шагом.",
      nameLabel: "Ваше имя",
      emailLabel: "Рабочий email",
      companyLabel: "Компания",
      messageLabel: "Что важно знать?",
      submit: "Отправить",
      submitting: "Отправляем...",
      successTeam: "Сохранили. Открываем signup...",
      successContact: "Сохранили. Мы вернёмся к вам.",
      error: "Не удалось сохранить lead. Попробуйте ещё раз.",
      close: "Закрыть",
      continueSignup: "Перейти к signup",
    },
    faq: {
      eyebrow: "FAQ",
      title: "Частые вопросы",
      items: [
        {
          question: "Как запустить демо?",
          answer:
            "Guided demo открывается через onboarding с готовым сценарием Example Demo. Можно быстро посмотреть workflow, а свои данные сохранить в аккаунт, когда будете готовы.",
        },
        {
          question: "Что происходит с моими файлами и данными?",
          answer:
            "Файлы шифруются и хранятся в изолированном пространстве вашей компании. Доступ есть только у вас и приглашённой команды. Каждый ответ AI содержит ссылку на источник - вы всегда можете проверить, откуда взялась цифра. Ваши данные не используются для обучения моделей.",
        },
        {
          question: "Можно ли использовать свой OpenAI или Anthropic ключ?",
          answer:
            "Да. На тарифе Solo BYOK (ваш ключ) бесплатен навсегда. На Team и Holding модель оплачиваем мы, ключ не нужен. При использовании своего ключа данные не проходят через нашу billing-инфраструктуру - это плюс для compliance.",
        },
        {
          question: "Какие данные можно загружать?",
          answer:
            "Excel (XLSX), CSV, PDF, DOCX, OFX-выписки. Контракты, ledgers, payroll, transactions, AWS invoices, Stripe reports. Плюс прямые подключения к банкам (Plaid), Google Drive, Stripe, QuickBooks, Odoo. До 50 MB на файл, безлимитные файлы на Team и Holding.",
        },
        {
          question: "AI действительно не выдумывает цифры?",
          answer:
            "Каждый числовой ответ привязан к source chip со ссылкой на конкретную строку или страницу. Если данных нет, AI говорит «не найдено в загруженных файлах», а не угадывает. Это ключевое архитектурное решение Corpus: provenance-first, без «возможно».",
        },
        {
          question: "Работает ли это с нефинансовыми данными?",
          answer:
            "Да. Corpus так же работает с договорами, meeting notes, product docs и customer interviews. Если данные помещаются в файл, мы прочитаем их и сделаем доступными для вопросов.",
        },
        {
          question: "Как быстро отвечает AI?",
          answer:
            "В среднем 2-4 секунды на типичный вопрос. Для сложных аналитических запросов (multi-source, multi-step) до 15 секунд. AI показывает в реальном времени, какие источники он читает.",
        },
        {
          question: "Можно ли отменить подписку?",
          answer:
            "В любой момент из настроек, без звонков. Все данные остаются в аккаунте 90 дней после отмены - можно вернуться. Полный экспорт памяти в JSON / CSV доступен на каждом тарифе.",
        },
      ],
    },
    finalCta: {
      eyebrow: "30 секунд до первого ответа",
      title: "Откройте память вашей компании. Прямо сейчас.",
      subtitle:
        "Без карты, без установки, без длинных форм. Попробуйте демо или загрузите свой файл - увидите разницу за минуту.",
      demoCta: "Попробовать демо",
      accountCta: "Создать аккаунт",
      badges: [
        { icon: "shield", text: "AES-256 encryption" },
        { icon: "globe", text: "EU hosting" },
        { icon: "lock", text: "SOC 2 in progress" },
      ],
    },
    footer: {
      blurb:
        "Память вашей компании, готовая отвечать. Для основателей и команд, которые хотят меньше собирать цифры и больше принимать решения.",
      columns: [
        {
          title: "Product",
          links: [
            { label: "Как это работает", href: "#how" },
            { label: "Возможности", href: "#features" },
            { label: "Кейсы", href: "#cases" },
            { label: "Цены", href: "#pricing" },
            { label: "API / Webhooks", href: "#" },
          ],
        },
        {
          title: "Company",
          links: [
            { label: "About", href: "#" },
            { label: "Blog", href: "#" },
            { label: "Careers", href: "#" },
            { label: "Contact", href: "#" },
            { label: "Press kit", href: "#" },
          ],
        },
        {
          title: "Legal",
          links: [
            { label: "Security", href: "#" },
            { label: "Privacy", href: "#" },
            { label: "Terms", href: "#" },
            { label: "DPA", href: "#" },
            { label: "Status", href: "#" },
          ],
        },
      ],
      copyright: "© 2026 Участники Corpus · v0.1",
      tagline: "built for founders",
    },
  },
};

export function getLandingLocale(locale: AppLocale | string | null | undefined): LandingLocale {
  const normalized = normalizeAppLocale(locale);
  return normalized === "ru" ? "ru" : "en";
}

export function getLandingCopy(locale: AppLocale | string | null | undefined): LandingCopy {
  return LANDING_COPY[getLandingLocale(locale)];
}
