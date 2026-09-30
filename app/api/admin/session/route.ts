import { NextResponse } from "next/server";

import { getPlatformAdminSession } from "@/lib/platform-admin";

export async function GET() {
  const session = await getPlatformAdminSession();
  return NextResponse.json({
    isPlatformAdmin: !!session?.user,
  });
}
