import type { FileChange, FileDeletion } from "../git/types.js";

export type WriteOperation =
  | { type: "commit"; files: FileChange[]; commitMessage: string }
  | { type: "delete_files"; files: FileDeletion[]; commitMessage: string }
  | { type: "create_branch"; branchName: string; fromRef?: string }
  | {
      type: "merge_branch";
      sourceBranch: string;
      targetBranch: string;
      commitMessage: string;
      conflictPolicy: "abort" | "ours";
    }
  | {
      type: "commit_to_branch";
      branchName: string;
      files: FileChange[];
      commitMessage: string;
    };

export interface WriteIntent {
  id?: string;
  agentId: string;
  agentToken: string;
  domain: string;
  operation: WriteOperation;
  metadata?: Record<string, unknown>;
}

export interface WriteResult {
  success: boolean;
  commitSha?: string;
  error?: WriteError;
  intentId?: string;
}

export interface WriteError {
  code: WriteErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type WriteErrorCode =
  | "validation"
  | "permission"
  | "queue_full"
  | "timeout"
  | "conflict"
  | "merge_conflict"
  | "unknown";

export type IntentStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "dead_letter";

export interface StoredIntent {
  id: string;
  intent: WriteIntent;
  status: IntentStatus;
  commitSha?: string;
  error?: string;
  retries: number;
  createdAt: string;
  updatedAt: string;
}
