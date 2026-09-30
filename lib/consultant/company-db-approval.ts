export function normalizeCompanyDbCommitFilePath(filePath: string): {
  filePath: string;
  changed: boolean;
} {
  const trimmed = filePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (/\.qmd$/i.test(trimmed)) {
    return { filePath: trimmed, changed: trimmed !== filePath };
  }
  if (/\.md$/i.test(trimmed)) {
    return {
      filePath: trimmed.replace(/\.md$/i, ".qmd"),
      changed: true,
    };
  }
  return { filePath: trimmed, changed: trimmed !== filePath };
}

export function normalizeCompanyDbCommitApprovalPayload(
  action: string,
  payload: Record<string, unknown> | undefined,
): {
  payload: Record<string, unknown>;
  normalizedFilePath: boolean;
} {
  const nextPayload = { ...(payload ?? {}) };
  if (action !== "commit_company_db") {
    return { payload: nextPayload, normalizedFilePath: false };
  }

  const rawFilePath = nextPayload.filePath;
  if (typeof rawFilePath !== "string") {
    return { payload: nextPayload, normalizedFilePath: false };
  }

  const normalized = normalizeCompanyDbCommitFilePath(rawFilePath);
  if (normalized.changed) {
    nextPayload.filePath = normalized.filePath;
    nextPayload.normalizedFromFilePath = rawFilePath;
  }

  return {
    payload: nextPayload,
    normalizedFilePath: normalized.changed,
  };
}
