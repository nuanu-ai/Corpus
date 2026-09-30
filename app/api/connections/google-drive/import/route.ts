import { NextRequest, NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import {
  coerceGoogleDriveConnectionMetadata,
  getGoogleDriveRootSelection,
  isDriveItemWithinRoot,
} from "@/lib/connectors/google-drive";
import {
  getGoogleDriveAccessTokenForConnection,
  resolveGoogleDriveConnection,
} from "@/lib/connectors/google-drive-auth";
import {
  queueGoogleDriveImportSelection,
  type GoogleDriveImportFileRequest,
  type GoogleDriveImportFolderSelection,
} from "@/lib/connectors/google-drive-import";

const MAX_IMPORT_FILES = 200;

/**
 * POST /api/connections/google-drive/import
 *
 * Body:
 * {
 *   files?: [{ fileId, fileName, mimeType }],
 *   folderIds?: string[],
 *   folderSelections?: [{ folderId, driveId? }],
 *   connectionId?: string
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { companyId } = await getSessionCompanyContext();

    let body: {
      files?: GoogleDriveImportFileRequest[];
      folderIds?: string[];
      folderSelections?: GoogleDriveImportFolderSelection[];
      connectionId?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const explicitFiles = Array.isArray(body.files) ? body.files : [];
    const folderIds = Array.isArray(body.folderIds) ? body.folderIds : [];
    const folderSelections = Array.isArray(body.folderSelections)
      ? body.folderSelections.filter(
          (
            selection
          ): selection is GoogleDriveImportFolderSelection =>
            !!selection?.folderId
        )
      : [];
    const normalizedFolderSelections: GoogleDriveImportFolderSelection[] = [
      ...folderSelections,
      ...folderIds.map((folderId) => ({ folderId })),
    ];

    if (explicitFiles.length === 0 && normalizedFolderSelections.length === 0) {
      return NextResponse.json(
        {
          error:
            "At least one of files, folderIds, or folderSelections must be non-empty",
        },
        { status: 400 }
      );
    }

    const connection = await resolveGoogleDriveConnection(companyId, {
      connectionId: body.connectionId,
    });
    const accessToken = await getGoogleDriveAccessTokenForConnection(connection);
    const metadata = coerceGoogleDriveConnectionMetadata(connection.metadata);
    const root = getGoogleDriveRootSelection(metadata);

    if (!root) {
      return NextResponse.json(
        {
          error:
            "Select a Google Drive company root folder before importing documents.",
        },
        { status: 400 }
      );
    }

    for (const file of explicitFiles) {
      const allowed = await isDriveItemWithinRoot(accessToken, file.fileId, root);
      if (!allowed) {
        return NextResponse.json(
          {
            error:
              "Selected files must stay within the configured Google Drive company root.",
          },
          { status: 400 }
        );
      }
    }

    for (const selection of normalizedFolderSelections) {
      const allowed = await isDriveItemWithinRoot(
        accessToken,
        selection.folderId,
        root
      );
      if (!allowed) {
        return NextResponse.json(
          {
            error:
              "Selected folders must stay within the configured Google Drive company root.",
          },
          { status: 400 }
        );
      }
    }

    const result = await queueGoogleDriveImportSelection({
      companyId,
      accessToken,
      explicitFiles,
      folderSelections: normalizedFolderSelections,
      maxImportFiles: MAX_IMPORT_FILES,
      connectionId: connection.id,
      ingressSource: "google_drive",
      rootPath: metadata.rootPath,
      connectionLabel: metadata.connectionLabel,
    });

    if (result.total === 0) {
      return NextResponse.json(
        { error: "No importable files found in the selected folders" },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("Too many files") || err.message.includes("more than"))
    ) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    return handleApiError(err);
  }
}
