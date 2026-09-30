import { NextResponse } from "next/server";

import { getSessionPersonalProjectContext, handleApiError } from "@/lib/api-auth";
import {
  coerceTelegramConnectionMetadata,
  createTelegramClient,
  createTelegramLoginStateToken,
  exportTelegramSession,
  getTelegramErrorMessage,
  isTelegramPasswordRequired,
  readTelegramLoginStateToken,
  signInTelegramWithCode,
  signInTelegramWithPassword,
} from "@/lib/connectors/telegram";
import {
  createConnection,
  getLatestConnectionCredentialsByProvider,
  updateConnectionCredentials,
} from "@/lib/connections";

function normalizeField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  let client;

  try {
    const auth = await getSessionPersonalProjectContext();
    const body = (await request.json().catch(() => ({}))) as {
      phone?: unknown;
      code?: unknown;
      password?: unknown;
      loginState?: unknown;
    };

    const phone = normalizeField(body.phone);
    const code = normalizeField(body.code);
    const password = normalizeField(body.password);
    const loginStateToken = normalizeField(body.loginState);

    if (!phone) return NextResponse.json({ error: "Phone is required" }, { status: 400 });
    if (!loginStateToken) return NextResponse.json({ error: "loginState is required" }, { status: 400 });

    const loginState = readTelegramLoginStateToken(loginStateToken);
    if (loginState.phone !== phone) {
      return NextResponse.json({ error: "Phone does not match login state" }, { status: 400 });
    }

    client = createTelegramClient(loginState.session);
    await client.connect();

    try {
      if (password) {
        await signInTelegramWithPassword(client, password);
      } else {
        if (!code) return NextResponse.json({ error: "Code is required" }, { status: 400 });
        await signInTelegramWithCode({
          client,
          phone,
          phoneCodeHash: loginState.phoneCodeHash,
          code,
        });
      }
    } catch (error) {
      if (!password && isTelegramPasswordRequired(error)) {
        return NextResponse.json({
          requiresPassword: true,
          loginState: createTelegramLoginStateToken({
            phone,
            phoneCodeHash: loginState.phoneCodeHash,
            session: exportTelegramSession(client),
          }),
        });
      }
      return NextResponse.json({ error: getTelegramErrorMessage(error) }, { status: 400 });
    }

    const existing = await getLatestConnectionCredentialsByProvider(auth.projectId, "telegram");
    const nextMetadata = {
      ...coerceTelegramConnectionMetadata(existing?.metadata, phone),
      phone,
      personal: true,
    };
    const credentials = { session: exportTelegramSession(client) };
    const connection = existing
      ? await updateConnectionCredentials(existing.id, auth.projectId, credentials, {
          metadata: nextMetadata,
          status: "active",
          externalAccountId: phone,
          lastError: null,
        })
      : await createConnection(auth.projectId, "telegram", credentials, {
          externalAccountId: phone,
          metadata: nextMetadata,
        });

    return NextResponse.json({
      success: true,
      connectionId: connection?.id ?? existing?.id ?? null,
    });
  } catch (error) {
    if (error instanceof Error && /Telegram login state/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return handleApiError(error);
  } finally {
    await client?.disconnect().catch(() => {});
  }
}
