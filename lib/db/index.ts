import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "";

// Singleton guard to prevent connection pool proliferation during HMR
const globalForDb = globalThis as unknown as { dbClient: ReturnType<typeof postgres> };
const client = globalForDb.dbClient ?? postgres(connectionString, { prepare: false });
if (process.env.NODE_ENV !== "production") globalForDb.dbClient = client;

export const db = drizzle(client, { schema });
export const dbClient = client;

export async function closeDbConnection(): Promise<void> {
  await client.end({ timeout: 5 });
}
