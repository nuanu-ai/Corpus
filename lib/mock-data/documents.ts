export interface ProcessingDocument {
  id: string;
  fileName: string;
  fileType: "pdf" | "csv" | "image" | "xlsx";
  source: string;
  uploadedAt: string;
  progress: number;
  stage: "Uploading" | "OCR" | "Extracting" | "Categorizing";
}

export interface ReviewTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  currentCategory: string;
  categoryConfidence: number;
  suggestedCategories: { category: string; confidence: number }[];
}

export interface DocumentHistoryItem {
  id: string;
  fileName: string;
  fileType: "pdf" | "csv" | "image" | "xlsx";
  source: string;
  uploadedAt: string;
  extractedTxnCount: number;
  status: "completed" | "failed" | "processing";
  confidenceScore: number;
}

export const processingDocuments: ProcessingDocument[] = [
  {
    id: "proc-1",
    fileName: "February_2026_Bank_Statement.pdf",
    fileType: "pdf",
    source: "Mercury Bank",
    uploadedAt: "2026-03-01T09:15:00Z",
    progress: 72,
    stage: "Extracting",
  },
  {
    id: "proc-2",
    fileName: "stripe_payouts_feb.csv",
    fileType: "csv",
    source: "Stripe",
    uploadedAt: "2026-03-01T09:22:00Z",
    progress: 35,
    stage: "OCR",
  },
  {
    id: "proc-3",
    fileName: "receipt_coworking_feb.jpg",
    fileType: "image",
    source: "Manual Upload",
    uploadedAt: "2026-03-01T09:30:00Z",
    progress: 91,
    stage: "Categorizing",
  },
];

export const reviewQueue: ReviewTransaction[] = [
  {
    id: "rev-1",
    date: "2026-02-28",
    description: "AMZN Mktp US*2K7X9",
    amount: -89.99,
    currentCategory: "Office Supplies",
    categoryConfidence: 0.62,
    suggestedCategories: [
      { category: "Office Supplies", confidence: 0.62 },
      { category: "Software & Tools", confidence: 0.25 },
      { category: "Equipment", confidence: 0.13 },
    ],
  },
  {
    id: "rev-2",
    date: "2026-02-26",
    description: "DIGITAL OCEAN *DROPLETS",
    amount: -48.0,
    currentCategory: "Hosting",
    categoryConfidence: 0.78,
    suggestedCategories: [
      { category: "Hosting", confidence: 0.78 },
      { category: "Infrastructure", confidence: 0.18 },
      { category: "Software & Tools", confidence: 0.04 },
    ],
  },
  {
    id: "rev-3",
    date: "2026-02-24",
    description: "UBER *TRIP HELP.UBER.COM",
    amount: -34.5,
    currentCategory: "Travel",
    categoryConfidence: 0.55,
    suggestedCategories: [
      { category: "Travel", confidence: 0.55 },
      { category: "Transport", confidence: 0.38 },
      { category: "Personal", confidence: 0.07 },
    ],
  },
  {
    id: "rev-4",
    date: "2026-02-20",
    description: "NOTION LABS INC",
    amount: -16.0,
    currentCategory: "Productivity",
    categoryConfidence: 0.71,
    suggestedCategories: [
      { category: "Productivity", confidence: 0.71 },
      { category: "Software & Tools", confidence: 0.22 },
      { category: "Office Supplies", confidence: 0.07 },
    ],
  },
  {
    id: "rev-5",
    date: "2026-02-18",
    description: "WIX.COM 500748562",
    amount: -27.0,
    currentCategory: "Marketing",
    categoryConfidence: 0.48,
    suggestedCategories: [
      { category: "Marketing", confidence: 0.48 },
      { category: "Hosting", confidence: 0.35 },
      { category: "Software & Tools", confidence: 0.17 },
    ],
  },
];

export const documentHistory: DocumentHistoryItem[] = [
  {
    id: "doc-1",
    fileName: "January_2026_Bank_Statement.pdf",
    fileType: "pdf",
    source: "Mercury Bank",
    uploadedAt: "2026-02-02T10:00:00Z",
    extractedTxnCount: 47,
    status: "completed",
    confidenceScore: 0.96,
  },
  {
    id: "doc-2",
    fileName: "stripe_payouts_jan.csv",
    fileType: "csv",
    source: "Stripe",
    uploadedAt: "2026-02-01T14:30:00Z",
    extractedTxnCount: 123,
    status: "completed",
    confidenceScore: 0.99,
  },
  {
    id: "doc-3",
    fileName: "receipts_batch_jan.pdf",
    fileType: "pdf",
    source: "Manual Upload",
    uploadedAt: "2026-01-28T09:15:00Z",
    extractedTxnCount: 12,
    status: "completed",
    confidenceScore: 0.91,
  },
  {
    id: "doc-4",
    fileName: "wise_statement_dec.pdf",
    fileType: "pdf",
    source: "Wise",
    uploadedAt: "2026-01-05T11:00:00Z",
    extractedTxnCount: 31,
    status: "completed",
    confidenceScore: 0.94,
  },
  {
    id: "doc-5",
    fileName: "crypto_trades_dec.xlsx",
    fileType: "xlsx",
    source: "Crypto wallet",
    uploadedAt: "2026-01-04T16:45:00Z",
    extractedTxnCount: 8,
    status: "completed",
    confidenceScore: 0.88,
  },
  {
    id: "doc-6",
    fileName: "corrupted_scan.pdf",
    fileType: "pdf",
    source: "Manual Upload",
    uploadedAt: "2026-01-03T08:20:00Z",
    extractedTxnCount: 0,
    status: "failed",
    confidenceScore: 0,
  },
  {
    id: "doc-7",
    fileName: "paypal_activity_dec.csv",
    fileType: "csv",
    source: "PayPal",
    uploadedAt: "2025-12-31T12:00:00Z",
    extractedTxnCount: 19,
    status: "completed",
    confidenceScore: 0.97,
  },
  {
    id: "doc-8",
    fileName: "November_2025_Bank_Statement.pdf",
    fileType: "pdf",
    source: "Mercury Bank",
    uploadedAt: "2025-12-02T10:30:00Z",
    extractedTxnCount: 42,
    status: "completed",
    confidenceScore: 0.95,
  },
  {
    id: "doc-9",
    fileName: "stripe_payouts_nov.csv",
    fileType: "csv",
    source: "Stripe",
    uploadedAt: "2025-12-01T09:00:00Z",
    extractedTxnCount: 98,
    status: "completed",
    confidenceScore: 0.99,
  },
  {
    id: "doc-10",
    fileName: "expense_receipts_q4.pdf",
    fileType: "pdf",
    source: "Manual Upload",
    uploadedAt: "2025-11-30T15:20:00Z",
    extractedTxnCount: 24,
    status: "completed",
    confidenceScore: 0.89,
  },
];

export function buildDocumentsSummary(): string {
  const completed = documentHistory.filter((d) => d.status === "completed");
  const failed = documentHistory.filter((d) => d.status === "failed");
  const avgConfidence =
    completed.length > 0
      ? ((completed.reduce((sum, d) => sum + d.confidenceScore, 0) / completed.length) * 100).toFixed(1)
      : "0.0";
  const totalTxns = completed.reduce((sum, d) => sum + d.extractedTxnCount, 0);

  return `\n## Document Processing:
- ${processingDocuments.length} documents currently processing
- ${reviewQueue.length} transactions need category review
- ${completed.length} documents successfully processed
- ${failed.length} documents failed processing
- Average confidence score: ${avgConfidence}%
- Total extracted transactions: ${totalTxns}`;
}
