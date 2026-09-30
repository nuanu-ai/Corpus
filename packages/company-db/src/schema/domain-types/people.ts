import type { BaseEntity, MoneyAmount, DateRange } from "./common.js";

export interface Employee extends BaseEntity {
  type: "employee";
  resource_type: "human";
  name: string;
  email?: string;
  role: string;
  department?: string;
  start_date: string;
  end_date?: string;
  status: "active" | "on_leave" | "terminated";
  reports_to?: string;
}

export interface Agent extends BaseEntity {
  type: "agent";
  resource_type: "agent";
  name: string;
  model?: string;
  capabilities: string[];
  domains: string[];
  status: "active" | "suspended" | "retired";
  token_ref?: string;
}

export interface Team extends BaseEntity {
  type: "team";
  name: string;
  lead?: string;
  members: string[];
  purpose?: string;
}

export interface Compensation extends BaseEntity {
  type: "compensation";
  employee_id: string;
  salary: MoneyAmount;
  effective_date: string;
  pay_frequency: "monthly" | "biweekly" | "weekly";
  currency: string;
}

export interface PayrollRun extends BaseEntity {
  type: "payroll_run";
  date: string;
  period: DateRange;
  total_gross: MoneyAmount;
  total_net: MoneyAmount;
  total_tax: MoneyAmount;
  employee_count: number;
  status: "draft" | "approved" | "processed";
}

export interface JobPosting extends BaseEntity {
  type: "job_posting";
  title: string;
  department?: string;
  status: "open" | "closed" | "filled";
  location?: string;
  salary_range?: { min: number; max: number; currency: string };
}

export interface Schedule extends BaseEntity {
  type: "schedule";
  week: string;
  shifts: Shift[];
}

export interface Shift {
  employee_id: string;
  date: string;
  start_time: string;
  end_time: string;
  role?: string;
}
