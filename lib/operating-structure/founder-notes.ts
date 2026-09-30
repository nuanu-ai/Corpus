import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { auditLog, founderAdminOperatingNotes } from "@/lib/db/schema";

const ALGORITHM = "aes-256-gcm";
const OBJECT_ID_PATTERN = /^[a-z][a-z0-9_:-]{0,180}$/;

export interface FounderAdminNoteInput {
  objectId: string;
  companyId?: string | null;
  noteKind?: string;
  plaintext: string;
  sourceRefs?: Array<Record<string, unknown>>;
  userId: string;
  auditCompanyId?: string;
}

export interface FounderAdminNoteRecord {
  id: string;
  objectId: string;
  companyId: string | null;
  noteKind: string;
  plaintext: string;
  sourceRefs: Array<Record<string, unknown>>;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FounderAdminNoteMetadata {
  id: string;
  objectId: string;
  companyId: string | null;
  noteKind: string;
  sourceRefs: Array<Record<string, unknown>>;
  keyVersion: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function encryptionKey(): string {
  const key = process.env.FOUNDER_ADMIN_NOTES_ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("FOUNDER_ADMIN_NOTES_ENCRYPTION_KEY or ENCRYPTION_KEY is required");
  }
  return key;
}

function keyVersion(): string {
  return process.env.FOUNDER_ADMIN_NOTES_KEY_VERSION ?? "v1";
}

function validateKey(keyHex: string): Buffer {
  if (keyHex.length !== 64) {
    throw new Error("Founder/admin note encryption key must be exactly 64 hex characters");
  }
  return Buffer.from(keyHex, "hex");
}

export function encryptFounderAdminNote(plaintext: string): {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
} {
  const key = validateKey(encryptionKey());
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: keyVersion(),
  };
}

export function decryptFounderAdminNote(input: {
  ciphertext: string;
  iv: string;
  authTag: string;
}): string {
  const key = validateKey(encryptionKey());
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(input.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(input.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(input.ciphertext, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function normalizedNoteKind(value: string | undefined): string {
  const noteKind = value?.trim() || "operating_context";
  if (!/^[a-z][a-z0-9_:-]{0,80}$/.test(noteKind)) {
    throw new Error("Invalid noteKind");
  }
  return noteKind;
}

export function isValidFounderAdminNoteObjectId(value: string): boolean {
  return OBJECT_ID_PATTERN.test(value.trim());
}

function scopedCompanyNoteFilter(companyIds: string[]): SQL {
  if (companyIds.length === 0) {
    return isNull(founderAdminOperatingNotes.companyId);
  }
  const filter = or(
    isNull(founderAdminOperatingNotes.companyId),
    inArray(founderAdminOperatingNotes.companyId, companyIds),
  );
  if (!filter) throw new Error("Failed to build founder/admin note scope");
  return filter;
}

function noteIdentityWhere(input: {
  objectId: string;
  companyId?: string | null;
  noteKind: string;
}) {
  const base = [
    eq(founderAdminOperatingNotes.objectId, input.objectId),
    eq(founderAdminOperatingNotes.noteKind, input.noteKind),
  ];
  if (input.companyId) {
    base.push(eq(founderAdminOperatingNotes.companyId, input.companyId));
  } else {
    base.push(isNull(founderAdminOperatingNotes.companyId));
  }
  return and(...base);
}

function toMetadata(row: typeof founderAdminOperatingNotes.$inferSelect): FounderAdminNoteMetadata {
  return {
    id: row.id,
    objectId: row.objectId,
    companyId: row.companyId,
    noteKind: row.noteKind,
    sourceRefs: row.sourceRefs ?? [],
    keyVersion: row.keyVersion,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRecord(row: typeof founderAdminOperatingNotes.$inferSelect): FounderAdminNoteRecord {
  return {
    ...toMetadata(row),
    plaintext: decryptFounderAdminNote({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.authTag,
    }),
  };
}

export async function listFounderAdminNoteMetadata(input?: {
  objectId?: string;
  objectIds?: string[];
  companyIds?: string[];
}): Promise<FounderAdminNoteMetadata[]> {
  const filters: SQL[] = [];
  if (input?.objectId) {
    filters.push(eq(founderAdminOperatingNotes.objectId, input.objectId));
  } else if (input?.objectIds) {
    if (input.objectIds.length === 0) return [];
    filters.push(inArray(founderAdminOperatingNotes.objectId, input.objectIds));
  }

  if (input?.companyIds) {
    filters.push(scopedCompanyNoteFilter(input.companyIds));
  }

  const rows = await db
    .select()
    .from(founderAdminOperatingNotes)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(founderAdminOperatingNotes.updatedAt));
  return rows.map(toMetadata);
}

export async function getFounderAdminNotesForObject(
  objectId: string,
  input?: {
    companyIds?: string[];
  },
): Promise<FounderAdminNoteRecord[]> {
  const filters: SQL[] = [eq(founderAdminOperatingNotes.objectId, objectId)];
  if (input?.companyIds) {
    filters.push(scopedCompanyNoteFilter(input.companyIds));
  }

  const rows = await db
    .select()
    .from(founderAdminOperatingNotes)
    .where(and(...filters))
    .orderBy(desc(founderAdminOperatingNotes.updatedAt));
  return rows.map(toRecord);
}

export async function upsertFounderAdminNote(
  input: FounderAdminNoteInput,
): Promise<FounderAdminNoteMetadata> {
  const objectId = input.objectId.trim();
  if (!objectId) throw new Error("objectId is required");
  if (!isValidFounderAdminNoteObjectId(objectId)) throw new Error("Invalid objectId");
  const plaintext = input.plaintext.trim();
  if (!plaintext) throw new Error("plaintext is required");
  const noteKind = normalizedNoteKind(input.noteKind);
  const encrypted = encryptFounderAdminNote(plaintext);
  const now = new Date();
  const companyId = input.companyId ?? null;
  const lockKey = `founder_note:${objectId}:${companyId ?? "global"}:${noteKind}`;

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );

    const [existing] = await tx
      .select({ id: founderAdminOperatingNotes.id })
      .from(founderAdminOperatingNotes)
      .where(noteIdentityWhere({ objectId, companyId, noteKind }))
      .limit(1);

    if (existing) {
      const [updated] = await tx
        .update(founderAdminOperatingNotes)
        .set({
          ...encrypted,
          sourceRefs: input.sourceRefs ?? [],
          updatedByUserId: input.userId,
          updatedAt: now,
        })
        .where(eq(founderAdminOperatingNotes.id, existing.id))
        .returning();
      if (input.auditCompanyId) {
        await tx.insert(auditLog).values({
          companyId: input.auditCompanyId,
          userId: input.userId,
          action: "founder_admin_note_updated",
          entityType: "founder_admin_operating_note",
          entityId: updated.id,
          newValue: toMetadata(updated),
          details: { objectId, companyId, noteKind },
        });
      }
      return toMetadata(updated);
    }

    const [inserted] = await tx
      .insert(founderAdminOperatingNotes)
      .values({
        objectId,
        companyId,
        noteKind,
        ...encrypted,
        sourceRefs: input.sourceRefs ?? [],
        createdByUserId: input.userId,
        updatedByUserId: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (input.auditCompanyId) {
      await tx.insert(auditLog).values({
        companyId: input.auditCompanyId,
        userId: input.userId,
        action: "founder_admin_note_created",
        entityType: "founder_admin_operating_note",
        entityId: inserted.id,
        newValue: toMetadata(inserted),
        details: { objectId, companyId, noteKind },
      });
    }
    return toMetadata(inserted);
  });
}

export async function deleteFounderAdminNote(input: {
  id: string;
  objectIds: string[];
  companyIds?: string[];
  userId: string;
  auditCompanyId: string;
}): Promise<boolean> {
  if (input.objectIds.length === 0) return false;
  const filters: SQL[] = [
    eq(founderAdminOperatingNotes.id, input.id),
    inArray(founderAdminOperatingNotes.objectId, input.objectIds),
  ];
  if (input.companyIds) {
    filters.push(scopedCompanyNoteFilter(input.companyIds));
  }

  const deleted = await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(founderAdminOperatingNotes)
      .where(and(...filters))
      .returning();
    if (row) {
      await tx.insert(auditLog).values({
        companyId: input.auditCompanyId,
        userId: input.userId,
        action: "founder_admin_note_deleted",
        entityType: "founder_admin_operating_note",
        entityId: row.id,
        oldValue: toMetadata(row),
        details: {
          objectId: row.objectId,
          companyId: row.companyId,
          noteKind: row.noteKind,
        },
      });
    }
    return row;
  });

  return Boolean(deleted);
}
