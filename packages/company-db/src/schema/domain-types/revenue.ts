import type { BaseEntity, MoneyAmount, Address, Ref } from "./common.js";

export interface Customer extends BaseEntity {
  type: "customer";
  name: string;
  email?: string;
  phone?: string;
  address?: Address;
  segment?: string;
  status: "active" | "churned" | "prospect";
  tags?: string[];
}

export interface Contact extends BaseEntity {
  type: "contact";
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  role?: string;
  customer_ref?: string;
}

export interface Subscription extends BaseEntity {
  type: "subscription";
  customer_id: string;
  plan_id: string;
  status: "active" | "canceled" | "past_due" | "trialing";
  mrr: MoneyAmount;
  start_date: string;
  end_date?: string;
  billing_cycle: "monthly" | "annual" | "quarterly";
}

export interface Invoice extends BaseEntity {
  type: "invoice";
  customer_id: string;
  invoice_number: string;
  date: string;
  due_date: string;
  status: "draft" | "sent" | "paid" | "overdue" | "void";
  line_items: InvoiceLineItem[];
  total: MoneyAmount;
  tax_amount?: MoneyAmount;
  currency: string;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export interface Deal extends BaseEntity {
  type: "deal";
  name: string;
  customer_id?: string;
  stage: string;
  value: MoneyAmount;
  probability?: number;
  expected_close_date?: string;
  owner?: string;
}

export interface DailySales extends BaseEntity {
  type: "daily_sales";
  date: string;
  total_revenue: MoneyAmount;
  transaction_count: number;
  average_ticket?: MoneyAmount;
  breakdown?: Record<string, number>;
}

export interface RevenueMetrics extends BaseEntity {
  type: "revenue_metrics";
  period: string;
  industry_tag?: "saas" | "hospitality" | "retail" | "general";
  mrr?: MoneyAmount;
  arr?: MoneyAmount;
  churn_rate?: number;
  nrr?: number;
  cac?: MoneyAmount;
  ltv?: MoneyAmount;
  revpar?: MoneyAmount;
  adr?: MoneyAmount;
  occupancy_rate?: number;
  same_store_growth?: number;
  revenue_growth?: number;
  gross_margin?: number;
}

export interface Pipeline extends BaseEntity {
  type: "pipeline";
  name: string;
  stages: string[];
}
