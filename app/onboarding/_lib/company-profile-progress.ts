export type CompanyProfileFieldId =
  | "companyName"
  | "jurisdiction"
  | "entityType"
  | "businessType"
  | "website"
  | "founderRole"
  | "companyStage"
  | "primaryQuestion"
  | "operatingContext";

export type CompanyProfileFieldStatus = "complete" | "missing";
export type SetupProgressStepStatus = "complete" | "in_progress" | "missing";

export interface CompanyProfileProgressInput {
  companyName?: unknown;
  jurisdiction?: unknown;
  entityType?: unknown;
  businessType?: unknown;
  website?: unknown;
  founderRole?: unknown;
  companyStage?: unknown;
  primaryQuestion?: unknown;
  operatingContext?: unknown;
}

export interface CompanyProfileField {
  id: CompanyProfileFieldId;
  label: string;
  value: string | null;
  required: boolean;
  status: CompanyProfileFieldStatus;
}

export interface CompanyProfileProgress {
  version: 1;
  fields: CompanyProfileField[];
  completedFields: number;
  totalFields: number;
  missingFields: CompanyProfileFieldId[];
  missingRequiredFields: CompanyProfileFieldId[];
  percentComplete: number;
  requiredComplete: boolean;
  complete: boolean;
}

export interface SetupProgressStep {
  id: "company_profile" | "first_question" | "data_path" | "completion_handoff";
  label: string;
  status: SetupProgressStepStatus;
  detail: string;
}

export interface SetupProgress {
  version: 1;
  steps: SetupProgressStep[];
  completedSteps: number;
  totalSteps: number;
  percentComplete: number;
}

export interface SetupProgressInput {
  onboardingPath?: unknown;
  handoffTarget?: unknown;
  complete?: boolean;
}

const PROFILE_FIELD_DEFINITIONS: Array<{
  id: CompanyProfileFieldId;
  label: string;
  required: boolean;
}> = [
  { id: "companyName", label: "Company name", required: true },
  { id: "jurisdiction", label: "Jurisdiction", required: false },
  { id: "entityType", label: "Entity type", required: false },
  { id: "businessType", label: "Business type", required: false },
  { id: "website", label: "Website", required: false },
  { id: "founderRole", label: "Your role", required: false },
  { id: "companyStage", label: "Company stage", required: false },
  { id: "primaryQuestion", label: "First question", required: false },
  { id: "operatingContext", label: "Operating context", required: false },
];

export function readProfileString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function hasValue(value: unknown): boolean {
  return readProfileString(value) !== null;
}

export function deriveCompanyProfileProgress(
  input: CompanyProfileProgressInput,
): CompanyProfileProgress {
  const fields = PROFILE_FIELD_DEFINITIONS.map((definition) => {
    const value = readProfileString(input[definition.id]);
    return {
      ...definition,
      value,
      status: value ? "complete" : "missing",
    } satisfies CompanyProfileField;
  });

  const completedFields = fields.filter((field) => field.status === "complete").length;
  const missingFields = fields
    .filter((field) => field.status === "missing")
    .map((field) => field.id);
  const missingRequiredFields = fields
    .filter((field) => field.required && field.status === "missing")
    .map((field) => field.id);

  return {
    version: 1,
    fields,
    completedFields,
    totalFields: fields.length,
    missingFields,
    missingRequiredFields,
    percentComplete: Math.round((completedFields / fields.length) * 100),
    requiredComplete: missingRequiredFields.length === 0,
    complete: missingFields.length === 0,
  };
}

export function deriveSetupProgress(
  companyProfile: CompanyProfileProgress,
  input: SetupProgressInput = {},
): SetupProgress {
  const profileStatus: SetupProgressStepStatus = companyProfile.complete
    ? "complete"
    : companyProfile.completedFields > 0
      ? "in_progress"
      : "missing";

  const firstQuestionStatus: SetupProgressStepStatus =
    companyProfile.fields.find((field) => field.id === "primaryQuestion")?.status === "complete"
      ? "complete"
      : "missing";
  const dataPathStatus: SetupProgressStepStatus = hasValue(input.onboardingPath)
    ? "complete"
    : "missing";
  const handoffStatus: SetupProgressStepStatus = input.complete ? "complete" : "missing";

  const steps: SetupProgressStep[] = [
    {
      id: "company_profile",
      label: "Company profile",
      status: profileStatus,
      detail: `${companyProfile.completedFields}/${companyProfile.totalFields} fields complete`,
    },
    {
      id: "first_question",
      label: "First question",
      status: firstQuestionStatus,
      detail: firstQuestionStatus === "complete" ? "Ready for Ask" : "Missing",
    },
    {
      id: "data_path",
      label: "Data path",
      status: dataPathStatus,
      detail: dataPathStatus === "complete" ? String(readProfileString(input.onboardingPath)) : "Missing",
    },
    {
      id: "completion_handoff",
      label: "Completion handoff",
      status: handoffStatus,
      detail: handoffStatus === "complete" ? "Saved" : "Not saved yet",
    },
  ];

  const completedSteps = steps.filter((step) => step.status === "complete").length;

  return {
    version: 1,
    steps,
    completedSteps,
    totalSteps: steps.length,
    percentComplete: Math.round((completedSteps / steps.length) * 100),
  };
}

export function getProfileFieldValue(
  companyProfile: CompanyProfileProgress | null | undefined,
  fieldId: CompanyProfileFieldId,
): string {
  return companyProfile?.fields.find((field) => field.id === fieldId)?.value ?? "";
}
