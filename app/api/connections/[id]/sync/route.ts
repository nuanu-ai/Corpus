import { NextResponse } from "next/server";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { getConnectionById } from "@/lib/connections";
import { inngest } from "@/lib/inngest";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { companyId } = await getSessionCompanyContext();
    const { id: connectionId } = await params;

    const conn = await getConnectionById(connectionId, companyId);
    if (!conn) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 },
      );
    }
    if (conn.provider === "odoo") {
      await inngest.send({
        name: "odoo/sync.requested",
        data: { connectionId, companyId },
      });
      return NextResponse.json({ triggered: true });
    }

    if (conn.provider === "telegram") {
      await inngest.send({
        name: "telegram/sync.requested",
        data: { connectionId, companyId },
      });
      return NextResponse.json({ triggered: true });
    }

    if (conn.provider === "google_drive") {
      await inngest.send({
        name: "gdrive/sync.requested",
        data: { connectionId, companyId },
      });
      return NextResponse.json({ triggered: true });
    }

    return NextResponse.json(
      { error: "Provider does not support manual sync" },
      { status: 400 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
