import type { BaseEntity, MoneyAmount } from "./common.js";

export interface BankAccount extends BaseEntity {
  type: "bank_account";
  bank_name: string;
  account_name: string;
  account_number_ref?: string;
  currency: string;
  account_type: "checking" | "savings" | "credit" | "crypto" | "ewallet";
  is_active: boolean;
  provider?: string;
}

export interface BankTransaction extends BaseEntity {
  type: "bank_transaction";
  account_id: string;
  date: string;
  description: string;
  normalized_description?: string;
  amount: number;
  currency: string;
  balance_after?: number;
  bank_reference?: string;
  category?: string;
  counterparty?: string;
  reconciled: boolean;
  journal_entry_ref?: string;
  dedup_hash?: string;
}

export interface Reconciliation extends BaseEntity {
  type: "reconciliation";
  account_id: string;
  period: string;
  bank_ending_balance: MoneyAmount;
  book_ending_balance: MoneyAmount;
  difference: MoneyAmount;
  status: "pending" | "matched" | "adjusted" | "completed";
  unmatched_items?: string[];
}

export interface FxRate extends BaseEntity {
  type: "fx_rate";
  date: string;
  base_currency: string;
  rates: Record<string, number>;
  source?: string;
}

export interface PaymentProcessor extends BaseEntity {
  type: "payment_processor";
  name: string;
  processor_type: string;
  currencies: string[];
  is_active: boolean;
}
