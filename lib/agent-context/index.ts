export {
  compileAgentContextPack,
  type AgentContextAuthSurface,
  type AgentContextCompanyInput,
  type AgentContextConnectorSnapshot,
  type CompileAgentContextPackInput,
} from "./compile";

export {
  buildAgentContextPackForApiKey,
  buildAgentContextPackForMembership,
  parseAgentContextIntent,
  resolveAgentContextPackMembership,
} from "./runtime";

export {
  AGENT_CONTEXT_PACK_VERSION,
  agentContextIntentSchema,
  agentContextPackSchema,
  type AgentContextIntent,
  type AgentContextOmittedSection,
  type AgentContextPack,
  type AgentContextProvenance,
  type AgentContextSection,
  type AgentContextSections,
} from "./schema";

export {
  AGENT_CONTEXT_FRESHNESS_PATH,
  AGENT_CONTEXT_PROFILE_SOURCE_PATH,
  AGENT_CONTEXT_SOURCE_MAP_PATH,
  AGENT_CONTEXT_SOURCE_ROOT,
  agentContextSourceFileFrontmatterSchema,
  buildAgentContextProfileSourceFile,
  isAgentContextSourceFileForCompany,
  isAgentContextSourceFileStale,
  normalizeAgentContextSourcePath,
  parseAgentContextSourceFile,
  readAgentContextSourceFilesFromDirectory,
  type AgentContextSourceFile,
  type AgentContextSourceFileFrontmatter,
  type MaterializedAgentContextSourceFile,
} from "./source-files";
