import { NextRequest, NextResponse } from "next/server";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import {
  getGoogleDriveAccessTokenForConnection,
  resolveGoogleDriveConnection,
} from "@/lib/connectors/google-drive-auth";
import {
  coerceGoogleDriveConnectionMetadata,
  getDriveItemMetadata,
  getGoogleDriveRootSelection,
  isDriveItemWithinRoot,
  listDriveFiles,
  listDriveFilesComplete,
  listDriveFolder,
  listDriveFolderComplete,
  listFolderFilesRecursive,
  listDriveRoot,
  listDriveRootComplete,
  listSharedWithMe,
  listSharedWithMeComplete,
} from "@/lib/connectors/google-drive";

async function resolveRequestedDriveId(
  accessToken: string,
  folderId?: string,
  driveId?: string
): Promise<string | undefined> {
  if (driveId || !folderId || folderId === "root") {
    return driveId;
  }

  const metadata = await getDriveItemMetadata(accessToken, folderId);
  return metadata.driveId ?? undefined;
}

/**
 * GET /api/connections/google-drive/files?folderId=...&driveId=...&view=sharedWithMe&query=...&pageToken=...
 *
 * When `query` is present → global search across Drive (ignores folderId).
 * When `query` is absent  → browse folder contents (folders + importable files).
 *   - `folderId` absent and `driveId` absent → root of Drive + Shared Drives
 *   - `folderId` absent and `driveId` present → root of that Shared Drive
 *   - `folderId` present → contents of that specific folder
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId } = await getSessionCompanyContext();
    const url = new URL(req.url);
    const connectionId = url.searchParams.get("connectionId") ?? undefined;
    const resolvedConnection = await resolveGoogleDriveConnection(companyId, {
      connectionId,
    });
    const accessToken =
      await getGoogleDriveAccessTokenForConnection(resolvedConnection);
    const metadata = coerceGoogleDriveConnectionMetadata(
      resolvedConnection.metadata
    );
    const root = getGoogleDriveRootSelection(metadata);

    const pageToken = url.searchParams.get("pageToken") ?? undefined;
    const fetchAll = ["1", "true", "yes"].includes(
      (url.searchParams.get("fetchAll") ?? "").trim().toLowerCase()
    );
    const query = url.searchParams.get("query") ?? undefined;
    const folderId = url.searchParams.get("folderId") ?? undefined;
    const driveId = url.searchParams.get("driveId") ?? undefined;
    const view = url.searchParams.get("view") ?? undefined;
    const effectiveDriveId =
      view === "sharedWithMe"
        ? undefined
        : await resolveRequestedDriveId(accessToken, folderId, driveId);

    const result = root
      ? await (async () => {
          if (view === "sharedWithMe") {
            return NextResponse.json(
              {
                error:
                  "Shared with me view is unavailable after a company root folder is configured.",
              },
              { status: 400 }
            );
          }

          const requestedFolderId = folderId ?? root.folderId;
          const requestedDriveId = effectiveDriveId ?? root.driveId;

          if (requestedFolderId !== root.folderId) {
            const allowed = await isDriveItemWithinRoot(
              accessToken,
              requestedFolderId,
              root
            );
            if (!allowed) {
              return NextResponse.json(
                {
                  error:
                    "Requested folder is outside the configured Google Drive root for this company.",
                },
                { status: 400 }
              );
            }
          }

          if (query) {
            const scopedFiles = await listFolderFilesRecursive(
              accessToken,
              requestedFolderId,
              {
                driveId: root.isSharedDriveRoot
                  ? root.driveId
                  : requestedDriveId ?? undefined,
                maxFiles: 500,
                rootPath: root.path ?? undefined,
              }
            );

            return NextResponse.json({
              files: scopedFiles
                .filter((file) =>
                  file.name.toLowerCase().includes(query.toLowerCase())
                )
                .sort((a, b) =>
                  (a.path ?? a.name).localeCompare(b.path ?? b.name, undefined, {
                    numeric: true,
                    sensitivity: "base",
                  })
                )
                .slice(0, fetchAll ? scopedFiles.length : 50),
              nextPageToken: undefined,
              connectionId: resolvedConnection.id,
              root,
            });
          }

          const effectiveFolderId =
            root.isSharedDriveRoot && requestedFolderId === root.folderId
              ? "root"
              : requestedFolderId;
          const listing = fetchAll
            ? await listDriveFolderComplete(accessToken, effectiveFolderId, {
                driveId: root.isSharedDriveRoot
                  ? root.driveId
                  : requestedDriveId ?? undefined,
              })
            : await listDriveFolder(
                accessToken,
                effectiveFolderId,
                {
                  pageToken,
                  pageSize: 20,
                  driveId: root.isSharedDriveRoot
                    ? root.driveId
                    : requestedDriveId ?? undefined,
                }
              );

          return NextResponse.json({
            ...listing,
            connectionId: resolvedConnection.id,
            root,
          });
        })()
      : query
        ? NextResponse.json({
            ...(fetchAll
              ? await listDriveFilesComplete(accessToken, {
                  query,
                  driveId: effectiveDriveId,
                })
              : await listDriveFiles(accessToken, {
                  query,
                  pageToken,
                  pageSize: 20,
                  driveId: effectiveDriveId,
                })),
            connectionId: resolvedConnection.id,
            root: null,
          })
        : view === "sharedWithMe"
          ? NextResponse.json({
              ...(fetchAll
                ? await listSharedWithMeComplete(accessToken)
                : await listSharedWithMe(accessToken, {
                    pageToken,
                    pageSize: 20,
                  })),
              connectionId: resolvedConnection.id,
              root: null,
            })
          : folderId || driveId
            ? NextResponse.json({
                ...(fetchAll
                  ? await listDriveFolderComplete(accessToken, folderId ?? "root", {
                      driveId: effectiveDriveId,
                    })
                  : await listDriveFolder(accessToken, folderId ?? "root", {
                      pageToken,
                      pageSize: 20,
                      driveId: effectiveDriveId,
                    })),
                connectionId: resolvedConnection.id,
                root: null,
              })
            : NextResponse.json({
                ...(fetchAll
                  ? await listDriveRootComplete(accessToken)
                  : await listDriveRoot(accessToken, {
                      pageToken,
                      pageSize: 20,
                    })),
                connectionId: resolvedConnection.id,
                root: null,
              });

    return result;
  } catch (err) {
    return handleApiError(err);
  }
}
