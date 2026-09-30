import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────

export interface EncryptedField {
  iv: string;   // base64
  tag: string;  // base64
  data: string; // base64
}

export type VaultFile = Record<string, EncryptedField>;

export interface PiiVault {
  storeSecret(entityId: string, field: string, value: string): Promise<string>;
  resolveRef(ref: string): Promise<string | null>;
  deleteEntity(entityId: string): Promise<number>;
  rotateKey(newKey: Buffer): Promise<number>;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12; // 96-bit IV recommended for GCM

function encrypt(plaintext: string, key: Buffer): EncryptedField {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  };
}

function decrypt(field: EncryptedField, key: Buffer): string {
  const iv = Buffer.from(field.iv, "base64");
  const tag = Buffer.from(field.tag, "base64");
  const data = Buffer.from(field.data, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

/** Reject entity IDs that could escape the vault directory. */
function isSafeId(id: string): boolean {
  return /^[\w.-]+$/.test(id) && !id.includes("..");
}

function entityPath(vaultDir: string, entityId: string): string {
  return join(vaultDir, `${entityId}.json`);
}

async function readVaultFile(path: string): Promise<VaultFile | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as VaultFile;
  } catch {
    return null;
  }
}

async function writeVaultFile(path: string, data: VaultFile): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createPiiVault(vaultDir: string, encryptionKey: Buffer): PiiVault {
  if (encryptionKey.length !== 32) {
    throw new Error("Encryption key must be exactly 32 bytes (AES-256)");
  }

  let key = encryptionKey;

  return {
    async storeSecret(entityId, field, value) {
      if (!isSafeId(entityId)) throw new Error(`Invalid entity ID: ${entityId}`);

      await mkdir(vaultDir, { recursive: true });

      const filePath = entityPath(vaultDir, entityId);
      const existing = (await readVaultFile(filePath)) ?? {};

      existing[field] = encrypt(value, key);
      await writeVaultFile(filePath, existing);

      return `vault:${entityId}:${field}`;
    },

    async resolveRef(ref) {
      const parts = ref.split(":");
      if (parts.length !== 3 || parts[0] !== "vault") return null;

      const [, entityId, field] = parts;
      if (!isSafeId(entityId)) return null;

      const data = await readVaultFile(entityPath(vaultDir, entityId));
      if (!data || !data[field]) return null;

      try {
        return decrypt(data[field], key);
      } catch {
        return null;
      }
    },

    async deleteEntity(entityId) {
      if (!isSafeId(entityId)) return 0;

      const filePath = entityPath(vaultDir, entityId);
      const data = await readVaultFile(filePath);
      if (!data) return 0;

      const count = Object.keys(data).length;
      await rm(filePath);
      return count;
    },

    async rotateKey(newKey) {
      if (newKey.length !== 32) {
        throw new Error("New encryption key must be exactly 32 bytes (AES-256)");
      }

      let files: string[];
      try {
        files = await readdir(vaultDir);
      } catch {
        return 0;
      }

      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      let total = 0;

      for (const file of jsonFiles) {
        const filePath = join(vaultDir, file);
        const data = await readVaultFile(filePath);
        if (!data) continue;

        const rotated: VaultFile = {};
        for (const [field, encrypted] of Object.entries(data)) {
          const plaintext = decrypt(encrypted, key);
          rotated[field] = encrypt(plaintext, newKey);
          total++;
        }

        await writeVaultFile(filePath, rotated);
      }

      key = newKey;
      return total;
    },
  };
}
