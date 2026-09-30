# Codex chat runtime

The minimum testable execution for Codex chat has four stages:

1. Resolve an authenticated company, user, thread, and ready auth profile.
2. Create an isolated temporary workspace and an ephemeral scoped agent key.
3. Run Codex with the workspace prompt and Corpus tool bridge.
4. Persist the assistant message and artifacts, then revoke the ephemeral key.

A failed stage records a bounded error on the run and thread. Secrets must not
be written to workspace Markdown, logs, or persisted run metadata. Runtime
workspaces are outside the repository by default and require an explicit
retention policy in production.
