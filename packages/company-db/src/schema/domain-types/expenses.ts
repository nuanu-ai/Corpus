import type { BaseEntity, MoneyAmount, Address } from "./common.js";

export interface Vendor extends BaseEntity {
  type: "vendor";
  name: string;
  email?: string;
  phone?: string;
  address?: Address;
  category?: string;
  payment_terms?: string;
  tax_id?: string;
  is_active: boolean;
}

export interface Bill extends BaseEntity {
  type: "bill";
  vendor_id: string;
  bill_number?: string;
  date: string;
  due_date: string;
  status: "draft" | "pending" | "approved" | "paid" | "void";
  line_items: BillLineItem[];
  total: MoneyAmount;
  currency: string;
}

export interface BillLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  account_id?: string;
}

export interface PurchaseOrder extends BaseEntity {
  type: "purchase_order";
  vendor_id: string;
  po_number: string;
  date: string;
  status: "draft" | "submitted" | "approved" | "received" | "closed";
  line_items: BillLineItem[];
  total: MoneyAmount;
  currency: string;
}

export interface ExpenseReport extends BaseEntity {
  type: "expense_report";
  employee_id: string;
  period: string;
  status: "draft" | "submitted" | "approved" | "reimbursed" | "rejected";
  items: ExpenseItem[];
  total: MoneyAmount;
  currency: string;
}

export interface ExpenseItem {
  date: string;
  description: string;
  category: string;
  amount: number;
  receipt_ref?: string;
}
