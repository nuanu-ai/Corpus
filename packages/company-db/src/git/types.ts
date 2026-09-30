export interface RepoHandle {
  path: string;
  slug: string;
}

export interface FileChange {
  path: string;
  content: string;
}

export interface FileDeletion {
  path: string;
}

export interface AuthorInfo {
  name: string;
  email: string;
}

export interface CommitResult {
  sha: string;
  message: string;
  filesChanged: number;
}
