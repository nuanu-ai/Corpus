export interface BaseEntity {
  type: string;
  id: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  [key: string]: unknown;
}

export interface MoneyAmount {
  amount: number;
  currency: string;
}

export interface Ref {
  target: string;
  type?: string;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postal_code?: string;
  country: string;
}

export interface DateRange {
  start: string;
  end: string;
}

export type PostingStatus = "draft" | "pending_review" | "posted" | "reconciled" | "rejected";
export type PeriodStatus = "open" | "soft_closed" | "hard_closed";
