import { DEFAULT_LOCALE, normalizeAppLocale, type AppLocale } from "@/lib/i18n/config";

const APP_COPY = {
  en: {
    language: {
      label: "Language",
      shortLabel: "EN",
      options: {
        en: "English",
        ru: "Русский",
        id: "Bahasa Indonesia",
      },
      updating: "Updating language...",
    },
    site: {
      appName: "Corpus",
      appDescription:
        "Agent-first operating system for company data, documents, connectors, Company-DB, and approval-gated workflows.",
    },
    header: {
      nav: {
        home: "Home",
        memory: "Memory",
        chat: "Chat",
        automations: "Automations",
        structure: "Structure",
        history: "History",
        dashboard: "Dashboard",
        documents: "Documents",
        corpusChat: "Corpus Chat",
        integrations: "Integrations",
        companyMap: "Company Map",
        admin: "Admin",
      },
      company: {
        select: "Select company",
        none: "No companies",
        active: "active",
        manage: "My companies",
      },
      actions: {
        settings: "Settings",
        logout: "Log out",
        menu: "Menu",
        toggleTheme: "Toggle theme",
        documentQuestions: "Document questions",
        openQueue: "Open queue",
        openAgentPlatform: "Open agent platform",
        backToAgentPlatform: "Back to agent platform",
      },
      documentQuestions: {
        title: "Document questions",
        empty: "No open document questions right now.",
        loading: "Loading document questions...",
        pending:
          "Parsing questions and review requests will appear here as soon as a document needs your input.",
      },
    },
    settings: {
      title: "Settings",
      subtitle: "Manage your profile, language, and API access.",
      tabs: {
        profile: "Profile",
        companies: "Companies",
        apiKeys: "API Keys",
      },
      profile: {
        title: "Profile",
        description: "Your account information.",
        name: "Name",
        email: "Email",
        passwordTitle: "Password",
        passwordDescription: "Change the password used for direct Corpus sign-in.",
        currentPassword: "Current password",
        newPassword: "New password",
        confirmPassword: "Confirm new password",
        updatePassword: "Update password",
        updatingPassword: "Updating...",
        passwordUpdated: "Password updated.",
        passwordTooShort: "New password must be at least 8 characters.",
        passwordMismatch: "New password confirmation does not match.",
        passwordUpdateFailed: "Failed to update password.",
        languageTitle: "Interface language",
        languageDescription:
          "Language is stored per user session first. Documents, Company-DB summaries, and chat history stay in their original language.",
        logout: "Log out",
      },
    },
    dashboard: {
      tabs: {
        pnl: "P&L",
        balanceSheet: "Balance Sheet",
        cashFlow: "Cash Flow",
        planVsActual: "Plan vs Actual",
        expenses: "Expenses",
        accounts: "Accounts",
        bankBalances: "Bank Balances",
        commitments: "Commitments",
        people: "People",
        documents: "Documents",
        agentFiles: "My AI Files",
      },
      welcome: {
        title: "Welcome to Corpus",
        badge: "Getting started",
        description:
          "Connect your financial accounts to unlock real-time insights, automated tax tracking, and AI-powered analysis.",
        dismiss: "Dismiss welcome card",
        connect: {
          title: "Connect Stripe",
          subtitle: "or other providers",
        },
        upload: {
          title: "Upload CSV",
          subtitle: "bank statement",
          seedPrompt: "I have a CSV bank statement to upload",
        },
        chat: {
          title: "Talk to Corpus",
          subtitle: "ask anything",
        },
        companyMap: {
          title: "Company Map",
          subtitle: "see your data structure",
        },
      },
      documentQuestions: {
        title: "Document questions need your input",
        subtitle:
          "Answering these questions unblocks parsing and makes uploaded documents more reliable for Corpus and Company-DB.",
        scanning: "Scanning documents for clarification requests...",
        open: "Open document questions",
      },
      agentPlatform: {
        title: "Agent workflow platform",
        badge: "Agent platform",
        subtitle:
          "Use the agent platform for company-scoped issues, approvals, routines, and longer-running agent coordination without leaving the current Corpus context behind.",
        open: "Open agent platform",
        back: "Back to agent platform",
        openIssues: "Open issues",
        pendingApprovals: "Pending approvals",
        activeRoutines: "Active routines",
        activity: "Activity",
        recentActivityPrefix: "Recent activity",
        recentActivityDetected: "Recent activity detected",
        noRecentActivity: "No recent activity signal",
        unknown: "Unknown",
        partial:
          "Some agent-platform status endpoints were unavailable, so the counts above may be partial.",
        unavailableNotConfigured:
          "Live agent-platform counts are disabled until the control-plane read client is configured on this deployment.",
        unavailableTemporary:
          "Live agent-platform counts are temporarily unavailable. Navigation into the control plane still works.",
        resolving: "Resolving agent-platform entry points...",
        returnMessage:
          "You entered Corpus from the agent platform. Use the button above to return to the exact control-plane context you came from.",
        destinations: {
          issues:
            "Track company-specific work, blockers, and follow-ups in the agent control plane.",
          approvals:
            "Review actions that still require a human decision before execution or publishing.",
          routines:
            "Review recurring agent workflows and operational automations linked to the company.",
          projects:
            "Open longer-running project work without leaving the current company context behind.",
        },
      },
      balance: {
        title: "Total Balance",
        noData: "Connect an account to see your balances",
        across: "Across",
        accountOne: "account",
        accountOther: "accounts",
      },
      commitments: {
        title: "Chat commitments",
        subtitle:
          "Open promises and deadlines extracted from connected Telegram chats inside the current communications pipeline.",
        open: "Open",
        overdue: "Overdue",
        dueToday: "Due today",
        upcoming: "Upcoming",
        upcomingWindow: "Next 7 days",
        undated: "No date",
        noChatsTitle: "No Telegram chats selected",
        noChatsDescription:
          "Connect Telegram and enable the chats you want to track. Promise tracking starts from the chats already synced into communications.",
        noSignalsTitle: "No open commitments yet",
        noSignalsDescription:
          "Telegram chats are connected, but no promise or deadline signals are materialized yet.",
        unavailableTitle: "Commitment feed unavailable",
        unavailableDescription:
          "The dashboard could not read the current communications signal feed.",
        connectAction: "Open integrations",
        promiseBadge: "Promise",
        deadlineBadge: "Deadline",
        sourceChat: "Chat",
        due: "Due",
        noDueDate: "No explicit date",
        lastUpdated: "Updated",
        evidenceRefs: "Evidence refs",
        participants: "Participants",
        counterparties: "Counterparties",
      },
      chat: {
        suggestions: [
          "What changed this month?",
          "What risks should I know?",
          "What can you see in Jira?",
          "What data do you have?",
        ],
        newThread: "New chat",
      },
    },
    documents: {
      page: {
        title: "Documents",
        subtitle:
          "Document queue, clarification requests, people records, and consultant files live here.",
        tabs: {
          documents: "Documents",
          people: "People",
          agentFiles: "My AI Files",
        },
      },
    },
    integrations: {
      page: {
        title: "Integrations",
        subtitle:
          "Connect financial sources, upload documents, and manage data flows feeding the platform.",
        sections: {
          connected: "Connected sources",
          connectedEmpty: "No data sources connected yet — add one below to get started.",
          uploadTitle: "Upload documents",
          uploadDragHint: "Drag and drop files here",
          uploadAcceptedHint: "Accepts {formats}",
          uploadBrowse: "Browse files",
          uploadProgress: "Uploading…",
          uploadEmail: "Or forward documents via email to:",
          addMore: "Add more sources",
          inactive: "Inactive integrations",
          inactiveSelectPlaceholder: "Show inactive integrations ({count})",
        },
      },
    },
    landing: {
      navTagline: "Agent-first company operating system",
      navOpenDashboard: "Open Dashboard",
      navLogin: "Login",
      navCreateAccount: "Create Account",
      heroBadge: "Documents, connectors, Company-DB, and agents in one stack",
      heroTitleLead: "The operating system for",
      heroTitleAccent: "company data and agent work",
      heroDescription:
        "Corpus ingests financial, legal, tax, governance, operational, asset, and general business data, promotes verified outputs into Company-DB, and gives agents and operators a compact way to search, reason, approve, export, and act without losing evidence or control.",
      heroLogin: "Login",
      heroPrimaryLoggedIn: "Go To Dashboard",
      heroPrimaryLoggedOut: "Start Free",
      heroHighlights: [
        "Multi-company tenancy",
        "Approval-gated agent actions",
        "Git-backed Company-DB history",
      ],
      heroCards: {
        companyDbTitle: "Company-DB source of truth",
        companyDbDescription:
          "Verified records, compact summaries, write queues, semantic sidecars, and drill-down paths all stay behind one contract surface.",
        runtimeTitle: "Agent-first runtime",
        runtimeDescription:
          "Chat, MCP, connector actions, documents, artifacts, and approvals are designed for agents first, not bolted on later.",
      },
      sections: {
        platformTitle: "What the platform actually includes",
        platformDescription:
          "This is not just a chat UI. It is the full stack around company data: ingress, routing, verification, storage, retrieval, operator workflows, and production controls.",
        domainsTitle: "One platform across every domain",
        domainsDescription:
          "Corpus is built for cross-domain company work. Finance does not live apart from legal, operations, knowledge, or communications.",
        retrievalTitle: "Retrieval that matches the data",
        retrievalDescription:
          "The platform does not force every question through one generic search path. Finance, documents, and narrative material each keep the retrieval mode that preserves quality.",
        workflowTitle: "How information moves through the system",
        workflowDescription:
          "From upload or connector event to verified answer, each step is explicit and auditable.",
        connectorsTitle: "Connectors, imports, and live agent actions",
        connectorsDescription:
          "Some systems sync into Company-DB, some are used live in bounded reads, and both paths are first-class parts of the product.",
        agentTitle: "Built for agent delivery, not just operator clicks",
        agentDescription:
          "The system includes the machine-facing layer too: scoped API access, MCP, thread workspaces, artifacts, exports, approvals, and explicit publish paths into shared company knowledge.",
        guardrailsTitle: "Built to stay controlled under real operations",
        guardrailsDescription:
          "The product is designed for production teams that need agents, but also need boundaries, review paths, and clean auditability.",
        ctaBadge: "Full product surface, not just a chatbot",
        ctaTitle: "Use one system for company data, operators, and agents",
        ctaDescription:
          "Bring in documents and connected systems, normalize them safely, store verified outcomes in Company-DB, and let agents work on compact, decision-grade context with approvals, exports, and drill-downs when needed.",
        footerTagline: "Agent-first operating system for company data",
      },
      platformSurface: [
        {
          title: "Document ingestion",
          description:
            "Upload PDFs, spreadsheets, statements, contracts, policies, and operational files. Keep raw evidence, clarification loops, and processing history together.",
        },
        {
          title: "Connectors and live systems",
          description:
            "Work with Google Drive, Slack, Jira, BambooHR, Dynamics BC, Payhawk, Zendesk, Telegram, Microsoft, and other bounded connector surfaces.",
        },
        {
          title: "Company-DB",
          description:
            "Promote decision-grade outputs into a git-backed Company-DB with write queues, summaries, RBAC, and a stable retrieval contract for agents and operators.",
        },
        {
          title: "Agent workflows",
          description:
            "Run internal agents and consultant chat on compact, auditable context instead of giant raw payloads. Keep actions approval-gated when the outcome matters.",
        },
        {
          title: "Ops and observability",
          description:
            "Track queues, review flags, clarification requests, promotions, semantic canaries, and admin drill-downs without losing tenant boundaries.",
        },
      ],
      domains: [
        "Finance",
        "Banking",
        "Revenue",
        "Expenses",
        "Legal",
        "Tax",
        "Governance",
        "Operations",
        "Assets",
        "Communications",
        "Knowledge",
        "People",
        "Documents",
      ],
      retrievalModes: [
        {
          title: "Structured finance retrieval",
          description:
            "Financial statements, ledgers, bank imports, and snapshots stay structured-first. Finance is not flattened into generic semantic search.",
        },
        {
          title: "Summary-first Company-DB reads",
          description:
            "Agents and users hit compact summaries first, then drill into verified files, records, or raw evidence only when the question really needs it.",
        },
        {
          title: "Semantic narrative search",
          description:
            "Narrative domains like legal and knowledge can use semantic sidecars behind Company-DB policy enforcement without replacing the source of truth.",
        },
      ],
      workflow: [
        {
          step: "01",
          title: "Ingest from every entrypoint",
          description:
            "Uploads, connectors, imports, webhooks, and background jobs all enter through bounded ingestion paths.",
        },
        {
          step: "02",
          title: "Normalize by document class",
          description:
            "Narrative documents become markdown-like artifacts, table-heavy or financial data stays structured, and OCR-heavy files stay on hard paths.",
        },
        {
          step: "03",
          title: "Promote through write queues",
          description:
            "Nothing becomes authoritative by accident. Company-DB writes stay auditable, replay-safe, and tied back to source evidence.",
        },
        {
          step: "04",
          title: "Retrieve the right way",
          description:
            "Finance uses exact and structured access, narrative documents use compact search and semantic fallback, and raw material stays drill-down only.",
        },
        {
          step: "05",
          title: "Act with approvals and exports",
          description:
            "Agents can draft artifacts, create exports, ask clarifying questions, and request approval before consequential actions.",
        },
      ],
      connectorGroups: [
        {
          title: "Connect and sync",
          items: [
            "Google Drive document import and watched folders",
            "Email and external file ingress",
            "Financial document parsing and promotion",
            "Background jobs for retries, reviews, and queue repair",
          ],
        },
        {
          title: "Use live systems in-place",
          items: [
            "Slack and Jira hub actions for operational reads",
            "BambooHR, Dynamics BC, Payhawk, Zendesk, Microsoft, Telegram, and Odoo connector actions",
            "Bounded pagination, explicit counts, and compact results so agents do not hallucinate system-wide truth from one page",
          ],
        },
      ],
      agentPlatform: [
        {
          title: "Scoped external agent access",
          description:
            "Use bearer API keys with company-scoped access policies and granular scopes for connectors, Company-DB, documents, people, settings, and dashboard summaries.",
        },
        {
          title: "Personal threads on company context",
          description:
            "Each operator gets personal chat threads that can reason over the current company while keeping thread state, attachments, artifacts, and approvals isolated.",
        },
        {
          title: "App-level MCP and control plane",
          description:
            "Expose one machine-friendly surface for connector actions, Company-DB reads, document actions, people records, and company control operations.",
        },
        {
          title: "Artifact and export pipeline",
          description:
            "Agents can draft memos, create real spreadsheet exports, store them in thread workspaces, and publish them to the shared document layer only when the user decides to.",
        },
      ],
      deliveryWorkflow: [
        "Personal thread artifacts stay private until explicitly shared to company documents",
        "Approval requests gate consequential writes and publish actions",
        "External machine clients can use REST and MCP without browser-only setup flows",
        "Company-level context, connectors, and Company-DB remain available behind one contract",
      ],
      guardrails: [
        {
          title: "Tenant-scoped access",
          description:
            "Every company stays isolated. Roles, memberships, and company slugs define what can be read or changed.",
        },
        {
          title: "Audit trails and history",
          description:
            "Document reviews, promotions, Company-DB commits, and background jobs leave a trace that operators can inspect.",
        },
        {
          title: "Clarifications before bad data",
          description:
            "When a document is incomplete or ambiguous, the system asks questions instead of silently guessing.",
        },
        {
          title: "Approval-gated actions",
          description:
            "Exports, consequential writes, and consultant actions can stop for approval instead of executing optimistically.",
        },
      ],
      mockups: {
        overview: {
          eyebrow: "Dashboard",
          title: "Executive Overview",
          subtitle: "Finance, document pipeline, and company signals in one view",
          revenue: "Revenue",
          expenses: "Expenses",
          netProfit: "Net Profit",
          financialTrend: "Financial trend",
          latestPeriod: "Latest verified period: 2025-12",
          verified: "Verified",
          grossMargin: "Gross margin",
          opexRatio: "Opex ratio",
          cashDelta: "Cash delta",
          documentQuestions: "Document questions",
          questionItems: [
            ["Bank statement", "Need currency + account owner", "Pending"],
            ["Lease transfer", "Manual legal review", "Review"],
            ["Payroll export", "Mapped and promoted", "Done"],
          ],
        },
        retrieval: {
          eyebrow: "Retrieval",
          title: "Search without flattening everything",
          subtitle:
            "Structured finance, summary-first Company-DB, and narrative search can coexist",
          searchLabel: "Search",
          searchQuery: "lease transfer payment obligations",
          pills: ["Finance", "Company-DB", "Semantic canary"],
          results: [
            ["legal/imports/lease-transfer.qmd", "Summary-first hit", "Clause, payment obligations, renewal terms"],
            ["legal/_summary.qmd", "Semantic fallback", "Red flag register, unresolved obligations"],
            ["finance/_summary.qmd", "Structured finance read", "Verified latest period and expense estimate"],
          ],
        },
        connectors: {
          eyebrow: "Connectors",
          title: "Sync where it matters, read live where it helps",
          subtitle: "Operational systems do not all need the same ingestion mode",
          connectors: [
            ["Google Drive", "Syncing", "154 docs"],
            ["Slack", "Live read", "182 channels"],
            ["Jira", "Live read", "Projects"],
            ["Payhawk", "Live read", "Fund accounts"],
            ["Dynamics BC", "Live read", "Invoices + GL"],
            ["Zendesk", "Live read", "Tickets"],
          ],
          recentTitle: "Recent connector activity",
          recent: [
            ["Drive import", "5 files promoted", "2m ago"],
            ["Slack read", "engineering, random, design", "live"],
            ["Payhawk", "3 fund accounts returned", "live"],
            ["Dynamics BC", "14 companies discovered", "live"],
          ],
        },
        agent: {
          eyebrow: "Agent",
          title: "Thread, artifact, approval, publish",
          subtitle:
            "Personal workspaces and shared company knowledge stay separate until you decide otherwise",
          userMessage:
            "Review the uploaded lease and draft a negotiation memo. If it looks usable, prepare a company document draft.",
          assistantMessage:
            "I found the lease import, highlighted payment obligations, and created a draft memo artifact. Publishing it to company documents still needs approval.",
          artifactTitle: "Artifact draft",
          artifactStatus: "Pending approval",
          artifactName: "lease-negotiation-memo.qmd",
          artifactDescription:
            "Personal thread artifact with draft summary, obligations, renewal clauses, and open legal questions.",
          approvalTitle: "Approval path",
          approvalSteps: [
            ["Draft created", "Done"],
            ["Approval requested", "Pending"],
            ["Publish to company docs", "Blocked"],
          ],
          deliveryTitle: "How agent work gets delivered safely",
          deliveryDescription:
            "Use the same platform for internal operators, embedded chat, external machine clients, and company-scoped agent workflows without splitting storage, approvals, or retrieval logic across separate products.",
        },
      },
      ctaLogin: "Login",
      ctaPrimaryLoggedIn: "Open Dashboard",
      ctaPrimaryLoggedOut: "Create Account",
    },
    chat: {
      v2: {
        persona: {
          company: { name: "CEO", description: "General company chat" },
          cfo: { name: "CFO", description: "Finance, runway, plan vs actual" },
          legal: { name: "Legal", description: "Contracts, compliance, risk" },
          marketing: {
            name: "Marketing",
            description: "Growth, brand, campaigns",
          },
        },
        emptyState: {
          title: "Corpus",
          subtitle: "Ask a question or upload a document",
          suggestions: [
            "What changed this month?",
            "Show P&L for the quarter",
            "What risks should I know?",
            "What data do you have?",
          ],
          personas: {
            cfo: {
              title: "AI Finance",
              subtitle: "Ask about P&L, runway, or cash flow",
              suggestions: [
                "What's our runway?",
                "Show P&L for the month",
                "Where are costs growing?",
                "Plan vs actual?",
              ],
            },
            legal: {
              title: "AI Legal",
              subtitle: "Ask about contracts, risk, or compliance",
              suggestions: [
                "What are the risks in this contract?",
                "Which compliance obligations are open?",
                "Draft an NDA review checklist",
                "What deadlines are coming up?",
              ],
            },
            marketing: {
              title: "AI Marketing",
              subtitle: "Ask about channels, campaigns, or ROAS",
              suggestions: [
                "What's ROAS by channel?",
                "How is conversion trending?",
                "Compare campaigns this month",
                "Where is budget leaking?",
              ],
            },
          },
        },
        composer: {
          placeholder: "Message Corpus",
          addAttachment: "Attach file",
          send: "Send",
          stop: "Stop",
          removeAttachment: "Remove attachment",
          uploading: "Uploading…",
          uploaded: "Uploaded",
          uploadFailed: "Upload failed",
          voiceStart: "Start voice input",
          voiceStop: "Stop recording",
          voiceTranscribing: "Transcribing…",
          voiceFailed: "Voice input failed",
          voicePermissionDenied: "Microphone access denied",
          voiceUnsupported: "Voice input not supported in this browser",
          personas: {
            cfo: { placeholder: "Message AI Finance" },
            legal: { placeholder: "Message AI Legal" },
            marketing: { placeholder: "Message AI Marketing" },
          },
        },
        sidebar: {
          title: "Conversations",
          description: "Browse, rename, or delete past conversations.",
          newChat: "New chat",
          rename: "Rename",
          delete: "Delete",
          deleteConfirm: "Tap again to confirm",
          renameConversation: "Rename conversation",
          threadActions: "Thread actions",
          openConversations: "Open conversations",
          openConversation: "Open conversation",
          closeConversations: "Close",
          collapse: "Collapse sidebar",
          expand: "Expand sidebar",
          empty: "No conversations yet",
        },
        artifact: {
          preview: "Preview",
          download: "Download",
          shareToCompany: "Share to Company",
          sharedToCompany: "Shared to Company",
          threadNotPersisted: "Thread is not yet persisted. Send a message first.",
          previewLoading: "Loading preview…",
          previewEmpty: "Empty file.",
          previewError: "Failed to load preview",
          previewErrorStatus: "Failed to load preview ({status})",
          previewNotPreviewable: "This file type is not previewable. Use Download instead.",
          previewClose: "Close preview",
          artifactCreationFailed: "Artifact creation failed",
          downloadFailed: "Failed to download artifact.",
          shareFailed: "Failed to share artifact to company documents.",
          shareSuccess: "Shared to company documents.",
          statusDraft: "Draft",
          statusCommitted: "Committed",
          statusRejected: "Rejected",
        },
        approval: {
          title: "Approval requested",
          approve: "Approve",
          reject: "Reject",
          approved: "Approved",
          approvedCommitted: "Approved (committed)",
          rejected: "Rejected",
          committed: "Committed",
          threadNotPersisted: "Send a message first to persist the thread.",
          artifactLabel: "artifact",
          approvalConfirmed: "Approval confirmed.",
          approvalRejected: "Approval rejected.",
          approvalUpdateFailed: "Failed to update approval.",
          approvalRequestFailed: "Approval request failed",
        },
        tool: {
          runningFormat: "Running {tool}…",
          failedFormat: "Tool {tool} failed",
          fallbackFormat: "Tool {tool}",
          companyDbResult: {
            searchTitleFormat: "Company-DB search: {query}",
            queryTitleFormat: "Company-DB query: {domain}{type}",
            defaultQuery: "query",
            defaultDomain: "all",
            statusError: "error",
            statusCountFormat: "{count} result{plural}",
            pluralSuffix: "s",
            empty: "No matching records.",
            truncatedFormat: "Showing {shown} of {total} results.",
            hitFallbackFormat: "Result {index}",
            riskFormat: "Risk: {risk}",
          },
          currencyConversion: {
            title: "Currency conversion",
            statusError: "error",
            statusVerified: "verified",
            statusUnavailable: "unavailable",
            sourceAmount: "Source amount",
            convertedAmount: "Converted amount",
            unavailable: "Unavailable",
            noRate: "No verified FX rate available.",
            rateDateFormat: "Rate date: {date}",
            verifiedNote: "Verified rate applied.",
            unavailableNote:
              "Conversion unavailable. The assistant should keep the original currency unless a verified rate is provided.",
          },
          navigation: {
            openPrefix: "Open",
            viewLabels: {
              pnl: "P&L",
              "balance-sheet": "Balance Sheet",
              "cash-flow": "Cash Flow",
              "plan-vs-actual": "Plan vs Actual",
              expenses: "Expenses",
              accounts: "Accounts",
              "bank-balances": "Bank Balances",
              commitments: "Commitments",
              documents: "Documents",
              people: "People",
              "agent-files": "Agent Files",
            },
          },
        },
        onboarding: {
          starterDefault: "What do you want me to answer first?",
          profileDefault: "Tell me about your company.",
          profileSaved: "✓ Saved.",
          profileLabels: {
            companyName: "Company name",
            founderRole: "Your role",
            primaryQuestion: "First question you want answered",
          },
          submit: "Submit",
          submitting: "Saving…",
          skip: "Skip",
          saveFailed: "Failed to save",
          dropzoneDefault: "Drop financial documents I should look at.",
          dropzoneBrowse: "Drop files or click to browse",
          dropzoneUploadedSoFar: "{count} uploaded so far",
          dropzoneUploading: "Uploading…",
          dropzoneTooLarge: "{name}: file is larger than 25 MB",
          dropzoneUploadFailed: "Upload failed for {name}",
          dropzoneSkip: "Skip for now",
          connectorDefault: "Connect this source?",
          connect: "Connect",
          connectComingSoon: "Coming soon",
          connectorWhatConnects: "What does this connect?",
          connectorHide: "Hide",
          companyTypeDefault: "What kind of operation is this?",
          firstWorkflowDefault: "What should I deliver first?",
          startSetup: "Start setup",
        },
      },
    },
  },
  ru: {
    language: {
      label: "Язык",
      shortLabel: "RU",
      options: {
        en: "English",
        ru: "Русский",
        id: "Bahasa Indonesia",
      },
      updating: "Обновляем язык...",
    },
    site: {
      appName: "Corpus",
      appDescription:
        "Agent-first платформа для данных компании, документов, коннекторов, Company-DB и approval-gated процессов.",
    },
    header: {
      nav: {
        home: "Главная",
        memory: "Память",
        chat: "Чат",
        automations: "Автоматизации",
        structure: "Структура",
        history: "История",
        dashboard: "Дашборд",
        documents: "Документы",
        corpusChat: "Corpus Chat",
        integrations: "Интеграции",
        companyMap: "Карта компании",
        admin: "Админ",
      },
      company: {
        select: "Выберите компанию",
        none: "Нет компаний",
        active: "активна",
        manage: "Мои компании",
      },
      actions: {
        settings: "Настройки",
        logout: "Выйти",
        menu: "Меню",
        toggleTheme: "Сменить тему",
        documentQuestions: "Вопросы по документам",
        openQueue: "Открыть очередь",
        openAgentPlatform: "Открыть платформу агентов",
        backToAgentPlatform: "Вернуться в платформу агентов",
      },
      documentQuestions: {
        title: "Вопросы по документам",
        empty: "Сейчас нет открытых вопросов по документам.",
        loading: "Загружаем вопросы по документам...",
        pending:
          "Вопросы на уточнение и запросы на review появятся здесь, как только документу понадобится ваш ответ.",
      },
    },
    settings: {
      title: "Настройки",
      subtitle: "Управляйте профилем, языком и API-доступом.",
      tabs: {
        profile: "Профиль",
        companies: "Компании",
        apiKeys: "API-ключи",
      },
      profile: {
        title: "Профиль",
        description: "Информация о вашей учётной записи.",
        name: "Имя",
        email: "Email",
        passwordTitle: "Пароль",
        passwordDescription: "Измените пароль для прямого входа в Corpus.",
        currentPassword: "Текущий пароль",
        newPassword: "Новый пароль",
        confirmPassword: "Подтвердите новый пароль",
        updatePassword: "Обновить пароль",
        updatingPassword: "Обновление...",
        passwordUpdated: "Пароль обновлён.",
        passwordTooShort: "Новый пароль должен содержать минимум 8 символов.",
        passwordMismatch: "Подтверждение нового пароля не совпадает.",
        passwordUpdateFailed: "Не удалось обновить пароль.",
        languageTitle: "Язык интерфейса",
        languageDescription:
          "Язык сначала хранится на уровне пользовательской сессии. Документы, summaries Company-DB и история чата остаются в исходном языке.",
        logout: "Выйти",
      },
    },
    dashboard: {
      tabs: {
        pnl: "P&L",
        balanceSheet: "Баланс",
        cashFlow: "Денежный поток",
        planVsActual: "План / Факт",
        expenses: "Расходы",
        accounts: "Счета",
        bankBalances: "Банк-балансы",
        commitments: "Обещания",
        people: "Люди",
        documents: "Документы",
        agentFiles: "Мои AI-файлы",
      },
      welcome: {
        title: "Добро пожаловать в Corpus",
        badge: "Быстрый старт",
        description:
          "Подключите финансовые аккаунты, чтобы открыть real-time insights, автоматический tax tracking и AI-анализ.",
        dismiss: "Скрыть приветственную карточку",
        connect: {
          title: "Подключить Stripe",
          subtitle: "или другие провайдеры",
        },
        upload: {
          title: "Загрузить CSV",
          subtitle: "банковская выписка",
          seedPrompt: "У меня есть CSV с банковской выпиской для загрузки",
        },
        chat: {
          title: "Поговорить с Corpus",
          subtitle: "спросите что угодно",
        },
        companyMap: {
          title: "Карта компании",
          subtitle: "посмотреть структуру данных",
        },
      },
      documentQuestions: {
        title: "Есть вопросы по документам",
        subtitle:
          "Ответы на эти вопросы разблокируют parsing и делают загруженные документы надёжнее для Corpus и Company-DB.",
        scanning: "Ищем запросы на уточнение по документам...",
        open: "Открыть вопросы по документам",
      },
      agentPlatform: {
        title: "Платформа агентских workflow",
        badge: "Платформа агентов",
        subtitle:
          "Используйте платформу агентов для company-scoped issues, approvals, routines и более длинных agent workflows, не теряя текущий Corpus context.",
        open: "Открыть платформу агентов",
        back: "Вернуться в платформу агентов",
        openIssues: "Открытые issues",
        pendingApprovals: "Ожидают approvals",
        activeRoutines: "Активные routines",
        activity: "Активность",
        recentActivityPrefix: "Недавняя активность",
        recentActivityDetected: "Обнаружена недавняя активность",
        noRecentActivity: "Нет сигнала недавней активности",
        unknown: "Неизвестно",
        partial:
          "Часть status endpoints платформы агентов была недоступна, поэтому counts выше могут быть неполными.",
        unavailableNotConfigured:
          "Live counts платформы агентов отключены, пока на этом деплое не настроен control-plane read client.",
        unavailableTemporary:
          "Live counts платформы агентов временно недоступны. Навигация в control plane всё равно работает.",
        resolving: "Определяем точки входа в платформу агентов...",
        returnMessage:
          "Вы вошли в Corpus из платформы агентов. Используйте кнопку выше, чтобы вернуться ровно в тот control-plane context, откуда пришли.",
        destinations: {
          issues:
            "Отслеживайте company-specific work, blockers и follow-ups в agent control plane.",
          approvals:
            "Проверяйте действия, которым всё ещё нужно человеческое решение перед выполнением или публикацией.",
          routines:
            "Просматривайте recurring agent workflows и operational automations, привязанные к компании.",
          projects:
            "Открывайте более длинные project workflows, не теряя текущий company context.",
        },
      },
      balance: {
        title: "Общий баланс",
        noData: "Подключите счёт, чтобы видеть балансы",
        across: "Всего",
        accountOne: "счёт",
        accountOther: "счёта",
      },
      commitments: {
        title: "Обещания из чатов",
        subtitle:
          "Открытые обещания и дедлайны, извлечённые из подключённых Telegram чатов внутри текущего communications pipeline.",
        open: "Открыто",
        overdue: "Просрочено",
        dueToday: "На сегодня",
        upcoming: "Дальше",
        upcomingWindow: "Ближайшие 7 дней",
        undated: "Без даты",
        noChatsTitle: "Чаты Telegram не выбраны",
        noChatsDescription:
          "Подключите Telegram и включите чаты, которые нужно отслеживать. Трекинг обещаний стартует по чатам, уже синкнутым в communications.",
        noSignalsTitle: "Открытых обещаний пока нет",
        noSignalsDescription:
          "Telegram чаты подключены, но promise/deadline signals ещё не материализованы.",
        unavailableTitle: "Лента обещаний недоступна",
        unavailableDescription:
          "Дашборд не смог прочитать текущий communications signal feed.",
        connectAction: "Открыть integrations",
        promiseBadge: "Обещание",
        deadlineBadge: "Дедлайн",
        sourceChat: "Чат",
        due: "Срок",
        noDueDate: "Явной даты нет",
        lastUpdated: "Обновлено",
        evidenceRefs: "Evidence refs",
        participants: "Участники",
        counterparties: "Контрагенты",
      },
      chat: {
        suggestions: [
          "Что изменилось в этом месяце?",
          "Какие риски мне нужно знать?",
          "Что ты видишь в Jira?",
          "Какие данные у тебя есть?",
        ],
        newThread: "Новый чат",
      },
    },
    documents: {
      page: {
        title: "Документы",
        subtitle:
          "Очередь документов, вопросы на уточнение, записи о людях и файлы консультанта находятся здесь.",
        tabs: {
          documents: "Документы",
          people: "Люди",
          agentFiles: "Мои AI-файлы",
        },
      },
    },
    integrations: {
      page: {
        title: "Интеграции",
        subtitle:
          "Подключайте источники данных, загружайте документы и управляйте потоками, питающими платформу.",
        sections: {
          connected: "Подключённые источники",
          connectedEmpty: "Источники данных пока не подключены — добавьте один ниже, чтобы начать.",
          uploadTitle: "Загрузка документов",
          uploadDragHint: "Перетащите файлы сюда",
          uploadAcceptedHint: "Принимаются {formats}",
          uploadBrowse: "Выбрать файлы",
          uploadProgress: "Загружаем…",
          uploadEmail: "Или перешлите документы на e-mail:",
          addMore: "Добавить источники",
          inactive: "Неактивные интеграции",
          inactiveSelectPlaceholder: "Показать неактивные ({count})",
        },
      },
    },
    landing: {
      navTagline: "Agent-first операционная система для компании",
      navOpenDashboard: "Открыть дашборд",
      navLogin: "Войти",
      navCreateAccount: "Создать аккаунт",
      heroBadge: "Документы, коннекторы, Company-DB и агенты в одной системе",
      heroTitleLead: "Операционная система для",
      heroTitleAccent: "данных компании и работы агентов",
      heroDescription:
        "Corpus ingest'ит финансовые, юридические, налоговые, governance, operational, asset и общие бизнес-данные, продвигает verified outputs в Company-DB и даёт агентам и операторам компактный способ искать, анализировать, согласовывать, экспортировать и действовать, не теряя evidence и контроль.",
      heroLogin: "Войти",
      heroPrimaryLoggedIn: "Перейти в дашборд",
      heroPrimaryLoggedOut: "Начать бесплатно",
      heroHighlights: [
        "Мультикомпанейский tenancy",
        "Agent actions с approval gate",
        "Git-backed история Company-DB",
      ],
      heroCards: {
        companyDbTitle: "Company-DB как source of truth",
        companyDbDescription:
          "Verified records, compact summaries, write queues, semantic sidecars и drill-down paths остаются за одним contract surface.",
        runtimeTitle: "Agent-first runtime",
        runtimeDescription:
          "Чат, MCP, connector actions, документы, артефакты и approvals спроектированы прежде всего для агентов, а не добавлены потом.",
      },
      sections: {
        platformTitle: "Что реально входит в платформу",
        platformDescription:
          "Это не просто чат-интерфейс. Это весь стек вокруг данных компании: ingress, routing, verification, storage, retrieval, operator workflows и production controls.",
        domainsTitle: "Одна платформа для всех доменов",
        domainsDescription:
          "Corpus строится для кросс-доменной работы компании. Finance не живёт отдельно от legal, operations, knowledge или communications.",
        retrievalTitle: "Retrieval, который соответствует данным",
        retrievalDescription:
          "Платформа не пытается прогонять каждый вопрос через один generic search path. Finance, документы и narrative-материал сохраняют тот retrieval mode, который удерживает качество.",
        workflowTitle: "Как информация проходит через систему",
        workflowDescription:
          "От загрузки или connector event до verified answer каждый шаг явный и аудируемый.",
        connectorsTitle: "Коннекторы, импорты и live agent actions",
        connectorsDescription:
          "Часть систем синкается в Company-DB, часть используется live через bounded reads, и оба пути являются first-class частью продукта.",
        agentTitle: "Система для доставки агентской работы, а не только для операторских кликов",
        agentDescription:
          "Здесь есть и machine-facing слой: scoped API access, MCP, thread workspaces, артефакты, экспорты, approvals и явные publish paths в общие знания компании.",
        guardrailsTitle: "Сделано так, чтобы оставаться под контролем в реальных операциях",
        guardrailsDescription:
          "Продукт предназначен для production-команд, которым нужны агенты, но также нужны границы, review paths и чистая аудируемость.",
        ctaBadge: "Полный продукт, а не просто чат-бот",
        ctaTitle: "Используйте одну систему для данных компании, операторов и агентов",
        ctaDescription:
          "Подтягивайте документы и connected systems, безопасно нормализуйте их, храните verified outcomes в Company-DB и давайте агентам работать на compact, decision-grade context с approvals, exports и drill-down, когда это нужно.",
        footerTagline: "Agent-first операционная система для данных компании",
      },
      platformSurface: [
        {
          title: "Ingestion документов",
          description:
            "Загружайте PDF, таблицы, выписки, контракты, policy и operational files. Храните raw evidence, clarification loops и processing history вместе.",
        },
        {
          title: "Коннекторы и live-системы",
          description:
            "Работайте с Google Drive, Slack, Jira, BambooHR, Dynamics BC, Payhawk, Zendesk, Telegram, Microsoft и другими bounded connector surfaces.",
        },
        {
          title: "Company-DB",
          description:
            "Продвигайте decision-grade outputs в git-backed Company-DB с write queues, summaries, RBAC и стабильным retrieval contract для агентов и операторов.",
        },
        {
          title: "Agent workflows",
          description:
            "Запускайте внутренних агентов и consultant chat на compact, auditable context вместо гигантских raw payloads. Важные действия остаются approval-gated.",
        },
        {
          title: "Ops и observability",
          description:
            "Отслеживайте очереди, review flags, clarification requests, promotions, semantic canaries и admin drill-downs без потери tenant boundaries.",
        },
      ],
      domains: [
        "Финансы",
        "Банкинг",
        "Выручка",
        "Расходы",
        "Юридическое",
        "Налоги",
        "Governance",
        "Операции",
        "Активы",
        "Коммуникации",
        "Знания",
        "Люди",
        "Документы",
      ],
      retrievalModes: [
        {
          title: "Structured finance retrieval",
          description:
            "Финансовые отчёты, ledgers, банковские импорты и snapshots остаются structured-first. Finance не сплющивается в generic semantic search.",
        },
        {
          title: "Summary-first чтение Company-DB",
          description:
            "Агенты и пользователи сначала бьют в compact summaries, а потом drill down в verified files, records или raw evidence только когда это действительно нужно вопросу.",
        },
        {
          title: "Semantic search для narrative",
          description:
            "Narrative domains вроде legal и knowledge могут использовать semantic sidecars за policy enforcement Company-DB, не заменяя source of truth.",
        },
      ],
      workflow: [
        {
          step: "01",
          title: "Ingest из любого входа",
          description:
            "Uploads, connectors, imports, webhooks и background jobs входят через bounded ingestion paths.",
        },
        {
          step: "02",
          title: "Нормализация по классу документа",
          description:
            "Narrative документы становятся markdown-like артефактами, table-heavy или financial data остаются structured, а OCR-heavy файлы остаются на hard paths.",
        },
        {
          step: "03",
          title: "Promotion через write queues",
          description:
            "Ничто не становится authoritative случайно. Записи в Company-DB остаются auditable, replay-safe и связаны с source evidence.",
        },
        {
          step: "04",
          title: "Правильный retrieval",
          description:
            "Finance использует exact и structured access, narrative документы используют compact search и semantic fallback, а raw material остаётся только для drill-down.",
        },
        {
          step: "05",
          title: "Действия через approvals и exports",
          description:
            "Агенты могут draft'ить артефакты, создавать экспорты, задавать уточняющие вопросы и запрашивать approval перед consequential actions.",
        },
      ],
      connectorGroups: [
        {
          title: "Подключать и синкать",
          items: [
            "Импорт документов из Google Drive и watched folders",
            "Email и внешний file ingress",
            "Parsing и promotion финансовых документов",
            "Background jobs для retries, reviews и repair очередей",
          ],
        },
        {
          title: "Использовать live-системы на месте",
          items: [
            "Slack и Jira hub actions для operational reads",
            "Connector actions для BambooHR, Dynamics BC, Payhawk, Zendesk, Microsoft, Telegram и Odoo",
            "Bounded pagination, explicit counts и compact results, чтобы агенты не галлюцинировали system-wide truth по одной странице",
          ],
        },
      ],
      agentPlatform: [
        {
          title: "Scoped external agent access",
          description:
            "Используйте bearer API keys с company-scoped access policies и granular scopes для connectors, Company-DB, документов, людей, настроек и dashboard summaries.",
        },
        {
          title: "Личные треды на company context",
          description:
            "У каждого оператора есть личные чат-треды, которые могут рассуждать о текущей компании, сохраняя thread state, attachments, артефакты и approvals изолированными.",
        },
        {
          title: "App-level MCP и control plane",
          description:
            "Открывайте одну machine-friendly surface для connector actions, чтения Company-DB, document actions, people records и company control operations.",
        },
        {
          title: "Пайплайн артефактов и экспортов",
          description:
            "Агенты могут draft'ить memo, создавать реальные spreadsheet exports, хранить их в thread workspaces и публиковать в shared document layer только когда пользователь это решил.",
        },
      ],
      deliveryWorkflow: [
        "Личные thread artifacts остаются приватными, пока их явно не поделят в company documents",
        "Approval requests ставят gate на consequential writes и publish actions",
        "Внешние machine clients могут использовать REST и MCP без browser-only setup flow",
        "Company-level context, connectors и Company-DB доступны через один contract",
      ],
      guardrails: [
        {
          title: "Tenant-scoped доступ",
          description:
            "Каждая компания остаётся изолированной. Roles, memberships и company slugs определяют, что можно читать или менять.",
        },
        {
          title: "Audit trails и история",
          description:
            "Document reviews, promotions, коммиты Company-DB и background jobs оставляют след, который операторы могут проверить.",
        },
        {
          title: "Clarifications вместо плохих данных",
          description:
            "Когда документ неполный или неоднозначный, система задаёт вопросы, а не молча угадывает.",
        },
        {
          title: "Approval-gated actions",
          description:
            "Экспорты, consequential writes и consultant actions могут останавливаться на approval вместо оптимистичного исполнения.",
        },
      ],
      mockups: {
        overview: {
          eyebrow: "Дашборд",
          title: "Executive Overview",
          subtitle: "Финансы, document pipeline и company signals в одном окне",
          revenue: "Выручка",
          expenses: "Расходы",
          netProfit: "Чистая прибыль",
          financialTrend: "Финансовый тренд",
          latestPeriod: "Последний подтверждённый период: 2025-12",
          verified: "Подтверждено",
          grossMargin: "Валовая маржа",
          opexRatio: "Доля Opex",
          cashDelta: "Изменение cash",
          documentQuestions: "Вопросы по документам",
          questionItems: [
            ["Банковская выписка", "Нужны валюта и владелец счёта", "Ожидает"],
            ["Передача аренды", "Требуется ручной legal review", "Review"],
            ["Экспорт payroll", "Сопоставлено и продвинуто", "Готово"],
          ],
        },
        retrieval: {
          eyebrow: "Retrieval",
          title: "Поиск без сплющивания всего подряд",
          subtitle:
            "Structured finance, summary-first Company-DB и narrative search могут сосуществовать",
          searchLabel: "Поиск",
          searchQuery: "обязательства по оплате в договоре передачи аренды",
          pills: ["Финансы", "Company-DB", "Semantic canary"],
          results: [
            ["legal/imports/lease-transfer.qmd", "Summary-first hit", "Пункт, платёжные обязательства, условия продления"],
            ["legal/_summary.qmd", "Semantic fallback", "Реестр red flags, unresolved obligations"],
            ["finance/_summary.qmd", "Structured finance read", "Подтверждённый последний период и оценка расходов"],
          ],
        },
        connectors: {
          eyebrow: "Коннекторы",
          title: "Синхронизируйте там, где нужно, читайте live там, где полезно",
          subtitle: "Operational systems не обязаны иметь одинаковый ingestion mode",
          connectors: [
            ["Google Drive", "Синхронизируется", "154 документа"],
            ["Slack", "Live read", "182 канала"],
            ["Jira", "Live read", "Проекты"],
            ["Payhawk", "Live read", "Fund accounts"],
            ["Dynamics BC", "Live read", "Инвойсы + GL"],
            ["Zendesk", "Live read", "Тикеты"],
          ],
          recentTitle: "Недавняя активность коннекторов",
          recent: [
            ["Импорт из Drive", "Продвинуто 5 файлов", "2м назад"],
            ["Slack read", "engineering, random, design", "live"],
            ["Payhawk", "Возвращено 3 fund accounts", "live"],
            ["Dynamics BC", "Обнаружено 14 компаний", "live"],
          ],
        },
        agent: {
          eyebrow: "Агент",
          title: "Тред, артефакт, approval, publish",
          subtitle:
            "Личные workspaces и общие знания компании остаются разделёнными, пока вы не решите иначе",
          userMessage:
            "Проверь загруженный договор аренды и подготовь memo для переговоров. Если материал пригоден, создай черновик company document.",
          assistantMessage:
            "Я нашёл импорт договора аренды, подсветил платёжные обязательства и создал draft memo artifact. Публикация в документы компании всё ещё требует approval.",
          artifactTitle: "Черновик артефакта",
          artifactStatus: "Ожидает approval",
          artifactName: "lease-negotiation-memo.qmd",
          artifactDescription:
            "Личный thread artifact с draft summary, obligations, clauses продления и открытыми legal questions.",
          approvalTitle: "Путь approval",
          approvalSteps: [
            ["Черновик создан", "Готово"],
            ["Approval запрошен", "Ожидает"],
            ["Публикация в документы компании", "Заблокировано"],
          ],
          deliveryTitle: "Как агентская работа безопасно доходит до результата",
          deliveryDescription:
            "Используйте одну платформу для внутренних операторов, embed-чата, внешних machine clients и company-scoped agent workflows без разделения storage, approvals или retrieval logic по разным продуктам.",
        },
      },
      ctaLogin: "Войти",
      ctaPrimaryLoggedIn: "Открыть дашборд",
      ctaPrimaryLoggedOut: "Создать аккаунт",
    },
    chat: {
      v2: {
        persona: {
          company: { name: "CEO", description: "Общий чат по компании" },
          cfo: {
            name: "Финансы",
            description: "P&L, runway, план vs факт",
          },
          legal: {
            name: "Юрист",
            description: "Договоры, compliance, риски",
          },
          marketing: {
            name: "Маркетинг",
            description: "Рост, бренд, кампании",
          },
        },
        emptyState: {
          title: "Corpus",
          subtitle: "Задайте вопрос или загрузите документ",
          suggestions: [
            "Что изменилось в этом месяце?",
            "Покажи P&L за квартал",
            "Какие риски знать?",
            "Какие данные есть?",
          ],
          personas: {
            cfo: {
              title: "AI Финансы",
              subtitle: "Спросите про P&L, runway или денежный поток",
              suggestions: [
                "Какой у нас runway?",
                "Покажи P&L за месяц",
                "Где растут расходы?",
                "Какой план vs факт?",
              ],
            },
            legal: {
              title: "AI Юрист",
              subtitle: "Спросите про договор, риск или комплаенс",
              suggestions: [
                "Какие риски в этом договоре?",
                "Какие комплаенс-обязательства открыты?",
                "Сделай чек-лист проверки NDA",
                "Какие сроки приближаются?",
              ],
            },
            marketing: {
              title: "AI Маркетинг",
              subtitle: "Спросите про каналы, кампании или ROAS",
              suggestions: [
                "Какой ROAS по каналам?",
                "Что с конверсией?",
                "Сравни кампании за месяц",
                "Где утекает бюджет?",
              ],
            },
          },
        },
        composer: {
          placeholder: "Сообщение Corpus",
          addAttachment: "Прикрепить файл",
          send: "Отправить",
          stop: "Остановить",
          removeAttachment: "Удалить вложение",
          uploading: "Загружаем…",
          uploaded: "Загружено",
          uploadFailed: "Ошибка загрузки",
          voiceStart: "Начать голосовой ввод",
          voiceStop: "Остановить запись",
          voiceTranscribing: "Распознаём…",
          voiceFailed: "Не удалось распознать голос",
          voicePermissionDenied: "Нет доступа к микрофону",
          voiceUnsupported: "Голосовой ввод не поддерживается в этом браузере",
          personas: {
            cfo: { placeholder: "Сообщение AI Финансы" },
            legal: { placeholder: "Сообщение AI Юрист" },
            marketing: { placeholder: "Сообщение AI Маркетинг" },
          },
        },
        sidebar: {
          title: "Диалоги",
          description: "Просматривайте, переименовывайте или удаляйте прошлые диалоги.",
          newChat: "Новый чат",
          rename: "Переименовать",
          delete: "Удалить",
          deleteConfirm: "Нажмите ещё раз для подтверждения",
          renameConversation: "Переименовать диалог",
          threadActions: "Действия с диалогом",
          openConversations: "Открыть диалоги",
          openConversation: "Открыть диалог",
          closeConversations: "Закрыть",
          collapse: "Свернуть сайдбар",
          expand: "Развернуть сайдбар",
          empty: "Пока нет диалогов",
        },
        artifact: {
          preview: "Просмотр",
          download: "Скачать",
          shareToCompany: "Поделиться с компанией",
          sharedToCompany: "В документах компании",
          threadNotPersisted: "Диалог ещё не сохранён. Сначала отправьте сообщение.",
          previewLoading: "Загружаем превью…",
          previewEmpty: "Пустой файл.",
          previewError: "Не удалось загрузить превью",
          previewErrorStatus: "Не удалось загрузить превью ({status})",
          previewNotPreviewable: "Этот тип файла нельзя предварительно просмотреть. Используйте «Скачать».",
          previewClose: "Закрыть превью",
          artifactCreationFailed: "Не удалось создать артефакт",
          downloadFailed: "Не удалось скачать артефакт.",
          shareFailed: "Не удалось поделиться артефактом с документами компании.",
          shareSuccess: "Отправлено в документы компании.",
          statusDraft: "Черновик",
          statusCommitted: "Зафиксировано",
          statusRejected: "Отклонено",
        },
        approval: {
          title: "Запрошено approval",
          approve: "Подтвердить",
          reject: "Отклонить",
          approved: "Подтверждено",
          approvedCommitted: "Подтверждено (зафиксировано)",
          rejected: "Отклонено",
          committed: "Зафиксировано",
          threadNotPersisted: "Сначала отправьте сообщение, чтобы сохранить диалог.",
          artifactLabel: "артефакт",
          approvalConfirmed: "Approval подтверждён.",
          approvalRejected: "Approval отклонён.",
          approvalUpdateFailed: "Не удалось обновить approval.",
          approvalRequestFailed: "Не удалось запросить approval",
        },
        tool: {
          runningFormat: "Выполняем {tool}…",
          failedFormat: "Tool {tool} завершился с ошибкой",
          fallbackFormat: "Tool {tool}",
          companyDbResult: {
            searchTitleFormat: "Поиск Company-DB: {query}",
            queryTitleFormat: "Запрос Company-DB: {domain}{type}",
            defaultQuery: "запрос",
            defaultDomain: "все",
            statusError: "ошибка",
            statusCountFormat: "{count} результат{plural}",
            pluralSuffix: "ов",
            empty: "Совпадающих записей нет.",
            truncatedFormat: "Показано {shown} из {total} результатов.",
            hitFallbackFormat: "Результат {index}",
            riskFormat: "Риск: {risk}",
          },
          currencyConversion: {
            title: "Конвертация валют",
            statusError: "ошибка",
            statusVerified: "проверено",
            statusUnavailable: "недоступно",
            sourceAmount: "Исходная сумма",
            convertedAmount: "Конвертированная сумма",
            unavailable: "Недоступно",
            noRate: "Проверенный курс FX недоступен.",
            rateDateFormat: "Дата курса: {date}",
            verifiedNote: "Применён проверенный курс.",
            unavailableNote:
              "Конвертация недоступна. Сохраните исходную валюту, пока не будет предоставлен проверенный курс.",
          },
          navigation: {
            openPrefix: "Открыть",
            viewLabels: {
              pnl: "P&L",
              "balance-sheet": "Баланс",
              "cash-flow": "Денежный поток",
              "plan-vs-actual": "План / Факт",
              expenses: "Расходы",
              accounts: "Счета",
              "bank-balances": "Банк-балансы",
              commitments: "Обещания",
              documents: "Документы",
              people: "Люди",
              "agent-files": "Мои AI-файлы",
            },
          },
        },
        onboarding: {
          starterDefault: "На что мне ответить первым делом?",
          profileDefault: "Расскажите о вашей компании.",
          profileSaved: "✓ Сохранено.",
          profileLabels: {
            companyName: "Название компании",
            founderRole: "Ваша роль",
            primaryQuestion: "Первый вопрос, на который хотите ответ",
          },
          submit: "Отправить",
          submitting: "Сохраняем…",
          skip: "Пропустить",
          saveFailed: "Не удалось сохранить",
          dropzoneDefault: "Загрузите финансовые документы для анализа.",
          dropzoneBrowse: "Перетащите файлы или нажмите для выбора",
          dropzoneUploadedSoFar: "загружено: {count}",
          dropzoneUploading: "Загрузка…",
          dropzoneTooLarge: "{name}: файл больше 25 МБ",
          dropzoneUploadFailed: "Не удалось загрузить {name}",
          dropzoneSkip: "Пока пропустить",
          connectorDefault: "Подключить этот источник?",
          connect: "Подключить",
          connectComingSoon: "Скоро",
          connectorWhatConnects: "Что это подключает?",
          connectorHide: "Скрыть",
          companyTypeDefault: "Что это за деятельность?",
          firstWorkflowDefault: "Что подготовить первым?",
          startSetup: "Начать настройку",
        },
      },
    },
  },
  id: {
    language: {
      label: "Bahasa",
      shortLabel: "ID",
      options: {
        en: "English",
        ru: "Русский",
        id: "Bahasa Indonesia",
      },
      updating: "Memperbarui bahasa...",
    },
    site: {
      appName: "Corpus",
      appDescription:
        "Sistem operasi agent-first untuk data perusahaan, dokumen, konektor, Company-DB, dan workflow dengan approval gate.",
    },
    header: {
      nav: {
        home: "Home",
        memory: "Memori",
        chat: "Chat",
        automations: "Automasi",
        structure: "Struktur",
        history: "Riwayat",
        dashboard: "Dashboard",
        documents: "Dokumen",
        corpusChat: "Corpus Chat",
        integrations: "Integrasi",
        companyMap: "Peta Perusahaan",
        admin: "Admin",
      },
      company: {
        select: "Pilih perusahaan",
        none: "Tidak ada perusahaan",
        active: "aktif",
        manage: "Perusahaan saya",
      },
      actions: {
        settings: "Pengaturan",
        logout: "Keluar",
        menu: "Menu",
        toggleTheme: "Ganti tema",
        documentQuestions: "Pertanyaan dokumen",
        openQueue: "Buka antrean",
        openAgentPlatform: "Buka platform agen",
        backToAgentPlatform: "Kembali ke platform agen",
      },
      documentQuestions: {
        title: "Pertanyaan dokumen",
        empty: "Tidak ada pertanyaan dokumen yang terbuka saat ini.",
        loading: "Memuat pertanyaan dokumen...",
        pending:
          "Pertanyaan klarifikasi dan permintaan review akan muncul di sini segera setelah dokumen membutuhkan input Anda.",
      },
    },
    settings: {
      title: "Pengaturan",
      subtitle: "Kelola profil, bahasa, dan akses API Anda.",
      tabs: {
        profile: "Profil",
        companies: "Perusahaan",
        apiKeys: "API Keys",
      },
      profile: {
        title: "Profil",
        description: "Informasi akun Anda.",
        name: "Nama",
        email: "Email",
        passwordTitle: "Kata sandi",
        passwordDescription: "Ubah kata sandi untuk login langsung ke Corpus.",
        currentPassword: "Kata sandi saat ini",
        newPassword: "Kata sandi baru",
        confirmPassword: "Konfirmasi kata sandi baru",
        updatePassword: "Perbarui kata sandi",
        updatingPassword: "Memperbarui...",
        passwordUpdated: "Kata sandi diperbarui.",
        passwordTooShort: "Kata sandi baru harus minimal 8 karakter.",
        passwordMismatch: "Konfirmasi kata sandi baru tidak cocok.",
        passwordUpdateFailed: "Gagal memperbarui kata sandi.",
        languageTitle: "Bahasa antarmuka",
        languageDescription:
          "Bahasa disimpan di level sesi pengguna terlebih dahulu. Dokumen, summary Company-DB, dan riwayat chat tetap dalam bahasa aslinya.",
        logout: "Keluar",
      },
    },
    dashboard: {
      tabs: {
        pnl: "Laba Rugi",
        balanceSheet: "Neraca",
        cashFlow: "Arus Kas",
        planVsActual: "Rencana vs Aktual",
        expenses: "Biaya",
        accounts: "Akun",
        bankBalances: "Saldo Bank",
        commitments: "Komitmen",
        people: "People",
        documents: "Dokumen",
        agentFiles: "File AI Saya",
      },
      welcome: {
        title: "Selamat datang di Corpus",
        badge: "Memulai",
        description:
          "Hubungkan akun finansial Anda untuk membuka insight real-time, pelacakan pajak otomatis, dan analisis berbasis AI.",
        dismiss: "Tutup kartu sambutan",
        connect: {
          title: "Hubungkan Stripe",
          subtitle: "atau provider lain",
        },
        upload: {
          title: "Unggah CSV",
          subtitle: "rekening koran",
          seedPrompt: "Saya punya CSV rekening koran untuk diunggah",
        },
        chat: {
          title: "Bicara dengan Corpus",
          subtitle: "tanyakan apa saja",
        },
        companyMap: {
          title: "Peta Perusahaan",
          subtitle: "lihat struktur data Anda",
        },
      },
      documentQuestions: {
        title: "Pertanyaan dokumen butuh input Anda",
        subtitle:
          "Menjawab pertanyaan ini membuka parsing dan membuat dokumen yang diunggah lebih andal untuk Corpus dan Company-DB.",
        scanning: "Memindai dokumen untuk permintaan klarifikasi...",
        open: "Buka pertanyaan dokumen",
      },
      agentPlatform: {
        title: "Platform workflow agen",
        badge: "Platform agen",
        subtitle:
          "Gunakan platform agen untuk issue, approval, routine, dan koordinasi agen yang lebih panjang dengan konteks perusahaan yang tetap terjaga.",
        open: "Buka platform agen",
        back: "Kembali ke platform agen",
        openIssues: "Issue terbuka",
        pendingApprovals: "Approval tertunda",
        activeRoutines: "Routine aktif",
        activity: "Aktivitas",
        recentActivityPrefix: "Aktivitas terbaru",
        recentActivityDetected: "Aktivitas terbaru terdeteksi",
        noRecentActivity: "Tidak ada sinyal aktivitas terbaru",
        unknown: "Tidak diketahui",
        partial:
          "Beberapa endpoint status platform agen tidak tersedia, jadi jumlah di atas mungkin parsial.",
        unavailableNotConfigured:
          "Jumlah live platform agen dinonaktifkan sampai control-plane read client dikonfigurasi di deployment ini.",
        unavailableTemporary:
          "Jumlah live platform agen sementara tidak tersedia. Navigasi ke control plane tetap bekerja.",
        resolving: "Menentukan titik masuk platform agen...",
        returnMessage:
          "Anda masuk ke Corpus dari platform agen. Gunakan tombol di atas untuk kembali ke konteks control plane yang sama persis.",
        destinations: {
          issues:
            "Lacak pekerjaan, blocker, dan follow-up khusus perusahaan di agent control plane.",
          approvals:
            "Tinjau tindakan yang masih membutuhkan keputusan manusia sebelum dieksekusi atau dipublikasikan.",
          routines:
            "Tinjau workflow agen berulang dan automasi operasional yang terhubung ke perusahaan.",
          projects:
            "Buka pekerjaan proyek yang lebih panjang tanpa kehilangan konteks perusahaan saat ini.",
        },
      },
      balance: {
        title: "Total Saldo",
        noData: "Hubungkan akun untuk melihat saldo",
        across: "Di",
        accountOne: "akun",
        accountOther: "akun",
      },
      commitments: {
        title: "Komitmen dari chat",
        subtitle:
          "Janji terbuka dan deadline yang diekstrak dari chat Telegram terhubung di dalam communications pipeline yang sudah ada.",
        open: "Terbuka",
        overdue: "Terlambat",
        dueToday: "Hari ini",
        upcoming: "Berikutnya",
        upcomingWindow: "7 hari ke depan",
        undated: "Tanpa tanggal",
        noChatsTitle: "Belum ada chat Telegram yang dipilih",
        noChatsDescription:
          "Hubungkan Telegram lalu aktifkan chat yang ingin dipantau. Pelacakan janji dimulai dari chat yang sudah tersinkron ke communications.",
        noSignalsTitle: "Belum ada komitmen terbuka",
        noSignalsDescription:
          "Chat Telegram sudah terhubung, tetapi signal promise/deadline belum termaterialisasi.",
        unavailableTitle: "Feed komitmen tidak tersedia",
        unavailableDescription:
          "Dashboard tidak bisa membaca feed communications signal saat ini.",
        connectAction: "Buka integrations",
        promiseBadge: "Janji",
        deadlineBadge: "Deadline",
        sourceChat: "Chat",
        due: "Jatuh tempo",
        noDueDate: "Tidak ada tanggal eksplisit",
        lastUpdated: "Diperbarui",
        evidenceRefs: "Referensi bukti",
        participants: "Peserta",
        counterparties: "Pihak lawan",
      },
      chat: {
        suggestions: [
          "Apa yang berubah bulan ini?",
          "Risiko apa yang harus saya tahu?",
          "Apa yang bisa kamu lihat di Jira?",
          "Data apa yang kamu punya?",
        ],
        newThread: "Chat baru",
      },
    },
    documents: {
      page: {
        title: "Dokumen",
        subtitle:
          "Antrian dokumen, pertanyaan klarifikasi, catatan orang, dan file konsultan ada di sini.",
        tabs: {
          documents: "Dokumen",
          people: "Orang",
          agentFiles: "File AI saya",
        },
      },
    },
    integrations: {
      page: {
        title: "Integrasi",
        subtitle:
          "Hubungkan sumber data finansial, unggah dokumen, dan kelola alur data ke platform.",
        sections: {
          connected: "Sumber terhubung",
          connectedEmpty: "Belum ada sumber data terhubung — tambahkan satu di bawah untuk mulai.",
          uploadTitle: "Unggah dokumen",
          uploadDragHint: "Tarik dan letakkan berkas di sini",
          uploadAcceptedHint: "Menerima {formats}",
          uploadBrowse: "Pilih berkas",
          uploadProgress: "Mengunggah…",
          uploadEmail: "Atau teruskan dokumen via email ke:",
          addMore: "Tambah sumber",
          inactive: "Integrasi nonaktif",
          inactiveSelectPlaceholder: "Tampilkan integrasi nonaktif ({count})",
        },
      },
    },
    landing: {
      navTagline: "Sistem operasi perusahaan agent-first",
      navOpenDashboard: "Buka Dashboard",
      navLogin: "Masuk",
      navCreateAccount: "Buat Akun",
      heroBadge: "Dokumen, konektor, Company-DB, dan agen dalam satu stack",
      heroTitleLead: "Sistem operasi untuk",
      heroTitleAccent: "data perusahaan dan kerja agen",
      heroDescription:
        "Corpus mengingest data keuangan, legal, pajak, governance, operasional, aset, dan data bisnis umum, mempromosikan output terverifikasi ke Company-DB, lalu memberi agen dan operator cara yang ringkas untuk mencari, bernalar, menyetujui, mengekspor, dan bertindak tanpa kehilangan evidence atau kontrol.",
      heroLogin: "Masuk",
      heroPrimaryLoggedIn: "Ke Dashboard",
      heroPrimaryLoggedOut: "Mulai Gratis",
      heroHighlights: [
        "Tenancy multi-perusahaan",
        "Aksi agen dengan approval gate",
        "Riwayat Company-DB berbasis Git",
      ],
      heroCards: {
        companyDbTitle: "Company-DB sebagai source of truth",
        companyDbDescription:
          "Verified records, compact summary, write queue, semantic sidecar, dan drill-down path tetap berada di balik satu contract surface.",
        runtimeTitle: "Runtime agent-first",
        runtimeDescription:
          "Chat, MCP, aksi connector, dokumen, artefak, dan approval dirancang untuk agen sejak awal, bukan ditempel belakangan.",
      },
      sections: {
        platformTitle: "Apa saja yang benar-benar ada di platform ini",
        platformDescription:
          "Ini bukan hanya UI chat. Ini adalah full stack di sekitar data perusahaan: ingress, routing, verification, storage, retrieval, workflow operator, dan kontrol produksi.",
        domainsTitle: "Satu platform di seluruh domain",
        domainsDescription:
          "Corpus dibangun untuk kerja lintas domain. Finance tidak hidup terpisah dari legal, operations, knowledge, atau communications.",
        retrievalTitle: "Retrieval yang sesuai dengan jenis data",
        retrievalDescription:
          "Platform ini tidak memaksa setiap pertanyaan lewat satu generic search path. Finance, dokumen, dan material naratif masing-masing mempertahankan mode retrieval yang menjaga kualitas.",
        workflowTitle: "Bagaimana informasi bergerak di dalam sistem",
        workflowDescription:
          "Dari upload atau connector event sampai jawaban terverifikasi, setiap langkah eksplisit dan dapat diaudit.",
        connectorsTitle: "Connector, import, dan live agent actions",
        connectorsDescription:
          "Sebagian sistem disinkronkan ke Company-DB, sebagian digunakan secara live melalui bounded reads, dan kedua jalur itu menjadi bagian first-class dari produk.",
        agentTitle: "Dibangun untuk delivery agen, bukan hanya klik operator",
        agentDescription:
          "Sistem ini juga memiliki lapisan machine-facing: scoped API access, MCP, workspace thread, artefak, export, approval, dan jalur publish yang eksplisit ke pengetahuan perusahaan bersama.",
        guardrailsTitle: "Dibangun agar tetap terkendali dalam operasi nyata",
        guardrailsDescription:
          "Produk ini dirancang untuk tim production yang membutuhkan agen, tetapi juga membutuhkan batasan, jalur review, dan auditability yang rapi.",
        ctaBadge: "Surface produk penuh, bukan cuma chatbot",
        ctaTitle: "Gunakan satu sistem untuk data perusahaan, operator, dan agen",
        ctaDescription:
          "Masukkan dokumen dan connected systems, normalisasi dengan aman, simpan hasil terverifikasi ke Company-DB, dan biarkan agen bekerja di konteks compact yang decision-grade dengan approval, export, dan drill-down saat dibutuhkan.",
        footerTagline: "Sistem operasi agent-first untuk data perusahaan",
      },
      platformSurface: [
        {
          title: "Ingestion dokumen",
          description:
            "Unggah PDF, spreadsheet, statement, kontrak, kebijakan, dan file operasional. Simpan raw evidence, clarification loop, dan processing history bersama-sama.",
        },
        {
          title: "Connector dan sistem live",
          description:
            "Bekerja dengan Google Drive, Slack, Jira, BambooHR, Dynamics BC, Payhawk, Zendesk, Telegram, Microsoft, dan bounded connector surface lainnya.",
        },
        {
          title: "Company-DB",
          description:
            "Promosikan output decision-grade ke Company-DB berbasis Git dengan write queue, summary, RBAC, dan retrieval contract yang stabil untuk agen dan operator.",
        },
        {
          title: "Workflow agen",
          description:
            "Jalankan agen internal dan consultant chat di compact, auditable context alih-alih giant raw payload. Aksi penting tetap approval-gated.",
        },
        {
          title: "Ops dan observability",
          description:
            "Lacak queue, review flag, clarification request, promotion, semantic canary, dan admin drill-down tanpa kehilangan tenant boundary.",
        },
      ],
      domains: [
        "Finance",
        "Banking",
        "Revenue",
        "Expenses",
        "Legal",
        "Pajak",
        "Governance",
        "Operations",
        "Assets",
        "Communications",
        "Knowledge",
        "People",
        "Documents",
      ],
      retrievalModes: [
        {
          title: "Structured finance retrieval",
          description:
            "Laporan keuangan, ledger, import bank, dan snapshot tetap structured-first. Finance tidak diratakan menjadi semantic search generik.",
        },
        {
          title: "Pembacaan Company-DB yang summary-first",
          description:
            "Agen dan pengguna masuk ke compact summary terlebih dulu, lalu drill down ke file terverifikasi, record, atau raw evidence hanya jika benar-benar dibutuhkan.",
        },
        {
          title: "Pencarian semantik naratif",
          description:
            "Domain naratif seperti legal dan knowledge dapat menggunakan semantic sidecar di balik kebijakan Company-DB tanpa mengganti source of truth.",
        },
      ],
      workflow: [
        {
          step: "01",
          title: "Ingest dari setiap entrypoint",
          description:
            "Upload, connector, import, webhook, dan background job semuanya masuk melalui bounded ingestion path.",
        },
        {
          step: "02",
          title: "Normalisasi berdasarkan kelas dokumen",
          description:
            "Dokumen naratif menjadi artefak mirip markdown, data table-heavy atau finansial tetap structured, dan file OCR-heavy tetap di hard path.",
        },
        {
          step: "03",
          title: "Promosi lewat write queue",
          description:
            "Tidak ada yang menjadi authoritative secara kebetulan. Write ke Company-DB tetap dapat diaudit, replay-safe, dan terhubung ke source evidence.",
        },
        {
          step: "04",
          title: "Retrieval dengan cara yang tepat",
          description:
            "Finance menggunakan exact dan structured access, dokumen naratif menggunakan compact search dan semantic fallback, sementara raw material hanya untuk drill-down.",
        },
        {
          step: "05",
          title: "Bertindak dengan approval dan export",
          description:
            "Agen dapat membuat draft artefak, membuat export, mengajukan pertanyaan klarifikasi, dan meminta approval sebelum tindakan yang consequential.",
        },
      ],
      connectorGroups: [
        {
          title: "Connect dan sync",
          items: [
            "Import dokumen Google Drive dan watched folder",
            "Email dan external file ingress",
            "Parsing dan promotion dokumen finansial",
            "Background job untuk retry, review, dan queue repair",
          ],
        },
        {
          title: "Gunakan sistem live di tempat",
          items: [
            "Aksi hub Slack dan Jira untuk operational read",
            "Aksi connector BambooHR, Dynamics BC, Payhawk, Zendesk, Microsoft, Telegram, dan Odoo",
            "Bounded pagination, explicit counts, dan compact results agar agen tidak berhalusinasi tentang whole-system truth dari satu halaman",
          ],
        },
      ],
      agentPlatform: [
        {
          title: "Akses agen eksternal yang scoped",
          description:
            "Gunakan bearer API key dengan company-scoped access policy dan granular scope untuk connector, Company-DB, dokumen, people, settings, dan dashboard summary.",
        },
        {
          title: "Thread pribadi di konteks perusahaan",
          description:
            "Setiap operator memiliki thread chat pribadi yang bisa bernalar tentang perusahaan saat ini sambil menjaga state thread, attachment, artefak, dan approval tetap terisolasi.",
        },
        {
          title: "MCP dan control plane tingkat aplikasi",
          description:
            "Ekspos satu machine-friendly surface untuk aksi connector, pembacaan Company-DB, aksi dokumen, people record, dan company control operation.",
        },
        {
          title: "Pipeline artefak dan export",
          description:
            "Agen dapat membuat draft memo, membuat export spreadsheet sungguhan, menyimpannya di workspace thread, dan mempublikasikannya ke layer dokumen bersama hanya ketika pengguna memutuskan.",
        },
      ],
      deliveryWorkflow: [
        "Artefak thread pribadi tetap private sampai dibagikan secara eksplisit ke dokumen perusahaan",
        "Permintaan approval menjadi gate untuk write dan publish yang consequential",
        "Machine client eksternal bisa memakai REST dan MCP tanpa browser-only setup flow",
        "Konteks tingkat perusahaan, connector, dan Company-DB tetap tersedia di balik satu contract",
      ],
      guardrails: [
        {
          title: "Akses tenant-scoped",
          description:
            "Setiap perusahaan tetap terisolasi. Role, membership, dan slug perusahaan menentukan apa yang bisa dibaca atau diubah.",
        },
        {
          title: "Audit trail dan histori",
          description:
            "Review dokumen, promotion, commit Company-DB, dan background job meninggalkan jejak yang bisa diperiksa operator.",
        },
        {
          title: "Klarifikasi sebelum data buruk",
          description:
            "Saat dokumen tidak lengkap atau ambigu, sistem akan bertanya alih-alih menebak diam-diam.",
        },
        {
          title: "Aksi dengan approval gate",
          description:
            "Export, write yang consequential, dan consultant action dapat berhenti menunggu approval, bukan langsung dieksekusi secara optimistis.",
        },
      ],
      mockups: {
        overview: {
          eyebrow: "Dashboard",
          title: "Executive Overview",
          subtitle: "Keuangan, pipeline dokumen, dan sinyal perusahaan dalam satu tampilan",
          revenue: "Revenue",
          expenses: "Biaya",
          netProfit: "Laba Bersih",
          financialTrend: "Tren finansial",
          latestPeriod: "Periode terverifikasi terbaru: 2025-12",
          verified: "Terverifikasi",
          grossMargin: "Margin kotor",
          opexRatio: "Rasio opex",
          cashDelta: "Delta kas",
          documentQuestions: "Pertanyaan dokumen",
          questionItems: [
            ["Rekening koran", "Butuh mata uang + pemilik akun", "Pending"],
            ["Transfer sewa", "Perlu legal review manual", "Review"],
            ["Ekspor payroll", "Sudah dipetakan dan dipromosikan", "Done"],
          ],
        },
        retrieval: {
          eyebrow: "Retrieval",
          title: "Cari tanpa meratakan semuanya",
          subtitle:
            "Structured finance, Company-DB summary-first, dan narrative search bisa berjalan berdampingan",
          searchLabel: "Pencarian",
          searchQuery: "kewajiban pembayaran lease transfer",
          pills: ["Finance", "Company-DB", "Semantic canary"],
          results: [
            ["legal/imports/lease-transfer.qmd", "Summary-first hit", "Clause, kewajiban pembayaran, syarat perpanjangan"],
            ["legal/_summary.qmd", "Semantic fallback", "Red flag register, unresolved obligations"],
            ["finance/_summary.qmd", "Structured finance read", "Periode terbaru terverifikasi dan estimasi biaya"],
          ],
        },
        connectors: {
          eyebrow: "Connector",
          title: "Sinkronkan saat perlu, baca live saat membantu",
          subtitle: "Sistem operasional tidak semuanya membutuhkan mode ingestion yang sama",
          connectors: [
            ["Google Drive", "Syncing", "154 dokumen"],
            ["Slack", "Live read", "182 channel"],
            ["Jira", "Live read", "Proyek"],
            ["Payhawk", "Live read", "Fund accounts"],
            ["Dynamics BC", "Live read", "Invoice + GL"],
            ["Zendesk", "Live read", "Tiket"],
          ],
          recentTitle: "Aktivitas connector terbaru",
          recent: [
            ["Import Drive", "5 file dipromosikan", "2m lalu"],
            ["Slack read", "engineering, random, design", "live"],
            ["Payhawk", "3 fund account dikembalikan", "live"],
            ["Dynamics BC", "14 perusahaan ditemukan", "live"],
          ],
        },
        agent: {
          eyebrow: "Agen",
          title: "Thread, artefak, approval, publish",
          subtitle:
            "Workspace pribadi dan pengetahuan perusahaan bersama tetap terpisah sampai Anda memutuskan sebaliknya",
          userMessage:
            "Tinjau lease yang diunggah dan buat memo negosiasi. Jika sudah usable, siapkan draft dokumen perusahaan.",
          assistantMessage:
            "Saya menemukan import lease, menyorot kewajiban pembayaran, dan membuat artefak memo draft. Publikasi ke dokumen perusahaan masih membutuhkan approval.",
          artifactTitle: "Draft artefak",
          artifactStatus: "Menunggu approval",
          artifactName: "lease-negotiation-memo.qmd",
          artifactDescription:
            "Artefak thread pribadi dengan draft summary, obligations, renewal clause, dan legal question terbuka.",
          approvalTitle: "Jalur approval",
          approvalSteps: [
            ["Draft dibuat", "Done"],
            ["Approval diminta", "Pending"],
            ["Publish ke dokumen perusahaan", "Blocked"],
          ],
          deliveryTitle: "Bagaimana kerja agen dikirim dengan aman",
          deliveryDescription:
            "Gunakan platform yang sama untuk operator internal, embedded chat, machine client eksternal, dan workflow agen scoped per perusahaan tanpa memisahkan storage, approval, atau retrieval logic ke produk terpisah.",
        },
      },
      ctaLogin: "Masuk",
      ctaPrimaryLoggedIn: "Buka Dashboard",
      ctaPrimaryLoggedOut: "Buat Akun",
    },
    chat: {
      v2: {
        persona: {
          company: { name: "CEO", description: "Obrolan umum perusahaan" },
          cfo: {
            name: "CFO",
            description: "Keuangan, runway, rencana vs aktual",
          },
          legal: {
            name: "Legal",
            description: "Kontrak, kepatuhan, risiko",
          },
          marketing: {
            name: "Marketing",
            description: "Pertumbuhan, merek, kampanye",
          },
        },
        emptyState: {
          title: "Corpus",
          subtitle: "Ajukan pertanyaan atau unggah dokumen",
          suggestions: [
            "Apa yang berubah bulan ini?",
            "Tampilkan P&L untuk kuartal ini",
            "Risiko apa yang harus saya tahu?",
            "Data apa yang kamu punya?",
          ],
          personas: {
            cfo: {
              title: "AI Finance",
              subtitle: "Tanya soal P&L, runway, atau cash flow",
              suggestions: [
                "Berapa runway kita?",
                "Tampilkan P&L bulan ini",
                "Di mana biaya tumbuh?",
                "Rencana vs aktual?",
              ],
            },
            legal: {
              title: "AI Legal",
              subtitle: "Tanya soal kontrak, risiko, atau kepatuhan",
              suggestions: [
                "Apa risiko di kontrak ini?",
                "Kewajiban kepatuhan apa yang terbuka?",
                "Buat checklist tinjauan NDA",
                "Tenggat waktu apa yang segera?",
              ],
            },
            marketing: {
              title: "AI Marketing",
              subtitle: "Tanya soal kanal, kampanye, atau ROAS",
              suggestions: [
                "Berapa ROAS per kanal?",
                "Bagaimana tren konversi?",
                "Bandingkan kampanye bulan ini",
                "Di mana anggaran bocor?",
              ],
            },
          },
        },
        composer: {
          placeholder: "Pesan ke Corpus",
          addAttachment: "Lampirkan berkas",
          send: "Kirim",
          stop: "Hentikan",
          removeAttachment: "Hapus lampiran",
          uploading: "Mengunggah…",
          uploaded: "Terunggah",
          uploadFailed: "Unggahan gagal",
          voiceStart: "Mulai input suara",
          voiceStop: "Hentikan rekaman",
          voiceTranscribing: "Menyalin…",
          voiceFailed: "Input suara gagal",
          voicePermissionDenied: "Akses mikrofon ditolak",
          voiceUnsupported: "Input suara tidak didukung di browser ini",
          personas: {
            cfo: { placeholder: "Pesan ke AI Finance" },
            legal: { placeholder: "Pesan ke AI Legal" },
            marketing: { placeholder: "Pesan ke AI Marketing" },
          },
        },
        sidebar: {
          title: "Percakapan",
          description: "Telusuri, ganti nama, atau hapus percakapan sebelumnya.",
          newChat: "Chat baru",
          rename: "Ganti nama",
          delete: "Hapus",
          deleteConfirm: "Ketuk lagi untuk konfirmasi",
          renameConversation: "Ganti nama percakapan",
          threadActions: "Aksi thread",
          openConversations: "Buka percakapan",
          openConversation: "Buka percakapan",
          closeConversations: "Tutup",
          collapse: "Ciutkan sidebar",
          expand: "Bentangkan sidebar",
          empty: "Belum ada percakapan",
        },
        artifact: {
          preview: "Pratinjau",
          download: "Unduh",
          shareToCompany: "Bagikan ke Perusahaan",
          sharedToCompany: "Dibagikan ke Perusahaan",
          threadNotPersisted: "Thread belum tersimpan. Kirim pesan terlebih dahulu.",
          previewLoading: "Memuat pratinjau…",
          previewEmpty: "Berkas kosong.",
          previewError: "Gagal memuat pratinjau",
          previewErrorStatus: "Gagal memuat pratinjau ({status})",
          previewNotPreviewable: "Tipe berkas ini tidak dapat dipratinjau. Gunakan Unduh.",
          previewClose: "Tutup pratinjau",
          artifactCreationFailed: "Pembuatan artefak gagal",
          downloadFailed: "Gagal mengunduh artefak.",
          shareFailed: "Gagal membagikan artefak ke dokumen perusahaan.",
          shareSuccess: "Dibagikan ke dokumen perusahaan.",
          statusDraft: "Draft",
          statusCommitted: "Dikomit",
          statusRejected: "Ditolak",
        },
        approval: {
          title: "Approval diminta",
          approve: "Setujui",
          reject: "Tolak",
          approved: "Disetujui",
          approvedCommitted: "Disetujui (dikomit)",
          rejected: "Ditolak",
          committed: "Dikomit",
          threadNotPersisted: "Kirim pesan terlebih dahulu untuk menyimpan thread.",
          artifactLabel: "artefak",
          approvalConfirmed: "Approval dikonfirmasi.",
          approvalRejected: "Approval ditolak.",
          approvalUpdateFailed: "Gagal memperbarui approval.",
          approvalRequestFailed: "Permintaan approval gagal",
        },
        tool: {
          runningFormat: "Menjalankan {tool}…",
          failedFormat: "Tool {tool} gagal",
          fallbackFormat: "Tool {tool}",
          companyDbResult: {
            searchTitleFormat: "Pencarian Company-DB: {query}",
            queryTitleFormat: "Kueri Company-DB: {domain}{type}",
            defaultQuery: "kueri",
            defaultDomain: "semua",
            statusError: "kesalahan",
            statusCountFormat: "{count} hasil{plural}",
            pluralSuffix: "",
            empty: "Tidak ada catatan yang cocok.",
            truncatedFormat: "Menampilkan {shown} dari {total} hasil.",
            hitFallbackFormat: "Hasil {index}",
            riskFormat: "Risiko: {risk}",
          },
          currencyConversion: {
            title: "Konversi mata uang",
            statusError: "kesalahan",
            statusVerified: "terverifikasi",
            statusUnavailable: "tidak tersedia",
            sourceAmount: "Jumlah sumber",
            convertedAmount: "Jumlah terkonversi",
            unavailable: "Tidak tersedia",
            noRate: "Tidak ada kurs FX terverifikasi.",
            rateDateFormat: "Tanggal kurs: {date}",
            verifiedNote: "Kurs terverifikasi diterapkan.",
            unavailableNote:
              "Konversi tidak tersedia. Pertahankan mata uang asli kecuali kurs terverifikasi diberikan.",
          },
          navigation: {
            openPrefix: "Buka",
            viewLabels: {
              pnl: "P&L",
              "balance-sheet": "Neraca",
              "cash-flow": "Arus Kas",
              "plan-vs-actual": "Rencana vs Aktual",
              expenses: "Pengeluaran",
              accounts: "Akun",
              "bank-balances": "Saldo Bank",
              commitments: "Komitmen",
              documents: "Dokumen",
              people: "Orang",
              "agent-files": "Berkas Agen",
            },
          },
        },
        onboarding: {
          starterDefault: "Apa yang ingin Anda saya jawab lebih dulu?",
          profileDefault: "Ceritakan tentang perusahaan Anda.",
          profileSaved: "✓ Tersimpan.",
          profileLabels: {
            companyName: "Nama perusahaan",
            founderRole: "Peran Anda",
            primaryQuestion: "Pertanyaan pertama yang ingin dijawab",
          },
          submit: "Kirim",
          submitting: "Menyimpan…",
          skip: "Lewati",
          saveFailed: "Gagal menyimpan",
          dropzoneDefault: "Unggah dokumen keuangan yang perlu saya lihat.",
          dropzoneBrowse: "Jatuhkan berkas atau klik untuk memilih",
          dropzoneUploadedSoFar: "{count} terunggah sejauh ini",
          dropzoneUploading: "Mengunggah…",
          dropzoneTooLarge: "{name}: berkas lebih besar dari 25 MB",
          dropzoneUploadFailed: "Gagal mengunggah {name}",
          dropzoneSkip: "Lewati dulu",
          connectorDefault: "Hubungkan sumber ini?",
          connect: "Hubungkan",
          connectComingSoon: "Segera hadir",
          connectorWhatConnects: "Apa yang dihubungkan ini?",
          connectorHide: "Sembunyikan",
          companyTypeDefault: "Ini jenis operasi apa?",
          firstWorkflowDefault: "Apa yang harus saya kerjakan dulu?",
          startSetup: "Mulai penyiapan",
        },
      },
    },
  },
} as const;

export type AppCopy = (typeof APP_COPY)[AppLocale];

export function getAppCopy(locale: AppLocale | string | null | undefined): AppCopy {
  return APP_COPY[normalizeAppLocale(locale)];
}
