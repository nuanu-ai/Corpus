export interface ConsultantArtifactReference {
  filePath: string;
  mimeType: string | null;
}

interface ConsultantArtifactRouteOptions {
  routeBase?: string;
}

export function isPreviewableConsultantArtifact(
  artifact: ConsultantArtifactReference,
): boolean {
  const lowerPath = artifact.filePath.toLowerCase();
  const lowerMime = artifact.mimeType?.toLowerCase() ?? "";

  if (
    lowerMime.startsWith("text/") ||
    lowerMime.includes("json") ||
    lowerMime.includes("markdown")
  ) {
    return true;
  }

  return [".md", ".qmd", ".txt", ".json", ".csv", ".tsv"].some((extension) =>
    lowerPath.endsWith(extension),
  );
}

export function getConsultantArtifactApiUrl(
  threadId: string,
  artifactId: string,
  options?: ConsultantArtifactRouteOptions,
): string {
  const routeBase = options?.routeBase ?? "/api/chat/threads";
  return `${routeBase}/${encodeURIComponent(threadId)}/artifacts/${encodeURIComponent(artifactId)}`;
}

export function getConsultantArtifactDownloadUrl(
  threadId: string,
  artifactId: string,
  options?: ConsultantArtifactRouteOptions,
): string {
  return `${getConsultantArtifactApiUrl(threadId, artifactId, options)}?download=1`;
}

export async function downloadConsultantArtifact(
  threadId: string,
  artifactId: string,
  fallbackFileName?: string,
  options?: ConsultantArtifactRouteOptions,
): Promise<void> {
  void fallbackFileName;
  const link = document.createElement("a");
  link.href = getConsultantArtifactDownloadUrl(threadId, artifactId, options);
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function shareConsultantArtifactToCompany(
  threadId: string,
  artifactId: string,
  options?: ConsultantArtifactRouteOptions,
): Promise<{ documentId: string; alreadyShared?: boolean; status: string; fileName?: string }> {
  const response = await fetch(
    `${getConsultantArtifactApiUrl(threadId, artifactId, options)}/share`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }
  );

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    documentId?: string;
    alreadyShared?: boolean;
    status?: string;
    fileName?: string;
  };

  if (!response.ok || typeof payload.documentId !== "string") {
    throw new Error(payload.error ?? `Failed to share artifact (${response.status})`);
  }

  return {
    documentId: payload.documentId,
    alreadyShared: payload.alreadyShared,
    status: payload.status ?? "processing",
    fileName: payload.fileName,
  };
}
