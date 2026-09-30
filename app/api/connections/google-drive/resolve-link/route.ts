import { NextRequest, NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import {
  coerceGoogleDriveConnectionMetadata,
  getDriveItemMetadata,
  getGoogleDriveRootSelection,
  isDriveItemWithinRoot,
  isGoogleDriveFolderMimeType,
  isImportableDriveMimeType,
  parseGoogleDriveLink,
} from "@/lib/connectors/google-drive";
import {
  getGoogleDriveAccessTokenForConnection,
  resolveGoogleDriveConnection,
} from "@/lib/connectors/google-drive-auth";
import type {
  DriveItemMetadata,
  GoogleDriveRootSelection,
} from "@/lib/connectors/google-drive";

async function buildDriveLinkSourcePath(input: {
  accessToken: string;
  item: DriveItemMetadata;
  root: GoogleDriveRootSelection | null;
  withinRoot: boolean | null;
}): Promise<string> {
  const { accessToken, item, root, withinRoot } = input;
  if (!root || withinRoot === false) {
    return item.name;
  }

  const names = [item.name];
  let cursor = item;

  for (let depth = 0; depth < 25; depth += 1) {
    if (cursor.id === root.folderId) {
      break;
    }

    const parentId = cursor.parents[0];
    if (!parentId || parentId === root.folderId) {
      break;
    }

    const parent = await getDriveItemMetadata(accessToken, parentId);
    names.unshift(parent.name);
    cursor = parent;
  }

  return root.path ? `${root.path} / ${names.join(" / ")}` : names.join(" / ");
}

export async function POST(req: NextRequest) {
  try {
    const { companyId } = await getSessionCompanyContext();

    let body: { link?: unknown; connectionId?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const link = typeof body.link === "string" ? body.link.trim() : "";
    if (!link) {
      return NextResponse.json(
        { error: "Google Drive link is required" },
        { status: 400 },
      );
    }

    const parsed = parseGoogleDriveLink(link);
    if (!parsed) {
      return NextResponse.json(
        { error: "Paste a Google Drive file, Google Docs, Sheets, or folder link." },
        { status: 400 },
      );
    }

    const connectionId =
      typeof body.connectionId === "string" && body.connectionId.trim().length > 0
        ? body.connectionId.trim()
        : undefined;
    const connection = await resolveGoogleDriveConnection(companyId, {
      connectionId,
    });
    const accessToken = await getGoogleDriveAccessTokenForConnection(connection);
    const connectionMetadata = coerceGoogleDriveConnectionMetadata(connection.metadata);
    const root = getGoogleDriveRootSelection(connectionMetadata);
    const item = await getDriveItemMetadata(accessToken, parsed.fileId);
    const isFolder = isGoogleDriveFolderMimeType(item.mimeType);
    const isImportable = isImportableDriveMimeType(item.mimeType);
    const withinRoot = root
      ? await isDriveItemWithinRoot(accessToken, item.id, root)
      : null;
    const sourcePath = await buildDriveLinkSourcePath({
      accessToken,
      item,
      root,
      withinRoot,
    });

    return NextResponse.json({
      connectionId: connection.id,
      connectionLabel: connectionMetadata.connectionLabel ?? null,
      parsed,
      root,
      item: {
        id: item.id,
        name: item.name,
        mimeType: item.mimeType,
        size: item.size ?? null,
        modifiedTime: item.modifiedTime ?? null,
        version: item.version ?? null,
        webViewLink: item.webViewLink ?? null,
        driveId: item.driveId ?? null,
        parents: item.parents,
        sourcePath,
        isFolder,
        isImportable,
      },
      actions: {
        canImport: Boolean(root && withinRoot && (isFolder || isImportable)),
        canWatch: Boolean(root && withinRoot && isFolder),
        canSetAsRoot: isFolder,
        withinRoot,
        rootConfigured: Boolean(root),
        unsupportedReason:
          !isFolder && !isImportable
            ? "This Drive item type is not supported by the document ingestion pipeline."
            : null,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
