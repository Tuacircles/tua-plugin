// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-27. IKKE REDIGER: kilden er server/*.js og node_modules.
// Named as `@opentelemetry/semantic-conventions` names them, and copied: that package exports the
// `gen_ai.*` names only from its unstable `incubating` entry point, which says to copy them.
const ATTR_GEN_AI_AGENT_NAME = 'gen_ai.agent.name';
const ATTR_GEN_AI_INPUT_MESSAGES = 'gen_ai.input.messages';
const ATTR_GEN_AI_OPERATION_NAME = 'gen_ai.operation.name';
const ATTR_GEN_AI_OUTPUT_MESSAGES = 'gen_ai.output.messages';
const ATTR_GEN_AI_OUTPUT_TYPE = 'gen_ai.output.type';
const ATTR_GEN_AI_REQUEST_MAX_TOKENS = 'gen_ai.request.max_tokens';
const ATTR_GEN_AI_REQUEST_MODEL = 'gen_ai.request.model';
const ATTR_GEN_AI_REQUEST_REASONING_LEVEL = 'gen_ai.request.reasoning.level';
const ATTR_GEN_AI_REQUEST_STOP_SEQUENCES = 'gen_ai.request.stop_sequences';
const ATTR_GEN_AI_REQUEST_STREAM = 'gen_ai.request.stream';
const ATTR_GEN_AI_RESPONSE_ID = 'gen_ai.response.id';
const ATTR_GEN_AI_RESPONSE_MODEL = 'gen_ai.response.model';
const ATTR_GEN_AI_RESPONSE_TIME_TO_FIRST_CHUNK = 'gen_ai.response.time_to_first_chunk';
const ATTR_GEN_AI_SYSTEM_INSTRUCTIONS = 'gen_ai.system_instructions';
const ATTR_GEN_AI_TOOL_CALL_ARGUMENTS = 'gen_ai.tool.call.arguments';
const ATTR_GEN_AI_TOOL_CALL_ID = 'gen_ai.tool.call.id';
const ATTR_GEN_AI_TOOL_DESCRIPTION = 'gen_ai.tool.description';
const ATTR_GEN_AI_TOOL_NAME = 'gen_ai.tool.name';
const ATTR_GEN_AI_TOOL_TYPE = 'gen_ai.tool.type';
const ATTR_GEN_AI_USAGE_CACHE_WRITE_INPUT_TOKENS = 'gen_ai.usage.cache_write.input_tokens';
const ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS = 'gen_ai.usage.cache_read.input_tokens';
const ATTR_GEN_AI_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
const ATTR_GEN_AI_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
const ATTR_GEN_AI_USAGE_REASONING_OUTPUT_TOKENS = 'gen_ai.usage.reasoning.output_tokens';
const GEN_AI_OPERATION_NAME_VALUE_CHAT = 'chat';
const GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL = 'execute_tool';
const GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT = 'invoke_agent';
const GEN_AI_OUTPUT_TYPE_VALUE_JSON = 'json';
const GEN_AI_TOOL_TYPE_VALUE_FUNCTION = 'function';
// This API's own attribute names, in the same style.
const ATTR_ANTHROPIC_REQUEST_ID = 'anthropic.request.id';
const ATTR_ANTHROPIC_ORGANIZATION_ID = 'anthropic.organization.id';
const ATTR_ANTHROPIC_WORKSPACE_ID = 'anthropic.workspace.id';
const ATTR_ANTHROPIC_BETA = 'anthropic.beta';
const ATTR_ANTHROPIC_CONTENT_TRUNCATED = 'anthropic.content.truncated';
const ATTR_ANTHROPIC_MESSAGE_STOP_REASON = 'anthropic.message.stop_reason';
const ATTR_ANTHROPIC_MESSAGE_COUNT_TOKENS_INPUT_TOKENS = 'anthropic.message.count_tokens.input_tokens';
const ATTR_ANTHROPIC_REQUEST_SERVICE_TIER = 'anthropic.request.service_tier';
const ATTR_ANTHROPIC_RESPONSE_SERVICE_TIER = 'anthropic.response.service_tier';
const ATTR_ANTHROPIC_THINKING_BUDGET_TOKENS = 'anthropic.thinking.budget_tokens';
const ATTR_ANTHROPIC_THINKING_TYPE = 'anthropic.thinking.type';
const ATTR_ANTHROPIC_TOOL_RESULT_CONTENT = 'anthropic.tool_result.content';
const ATTR_ANTHROPIC_TOOLSET_NAME = 'anthropic.toolset.name';
const ATTR_ANTHROPIC_USAGE_CACHE_CREATION_EPHEMERAL_1H_INPUT_TOKENS = 'anthropic.usage.cache_creation.ephemeral_1h_input_tokens';
const ATTR_ANTHROPIC_USAGE_CACHE_CREATION_EPHEMERAL_5M_INPUT_TOKENS = 'anthropic.usage.cache_creation.ephemeral_5m_input_tokens';
const ATTR_ANTHROPIC_USAGE_COMPACTION_INPUT_TOKENS = 'anthropic.usage.compaction.input_tokens';
const ATTR_ANTHROPIC_USAGE_COMPACTION_OUTPUT_TOKENS = 'anthropic.usage.compaction.output_tokens';
const RESPONSE_HEADER_ATTRIBUTES = [
    [ATTR_ANTHROPIC_REQUEST_ID, 'request-id'],
    [ATTR_ANTHROPIC_ORGANIZATION_ID, 'anthropic-organization-id'],
    [ATTR_ANTHROPIC_WORKSPACE_ID, 'anthropic-workspace-id'],
];

export { ATTR_ANTHROPIC_BETA, ATTR_ANTHROPIC_CONTENT_TRUNCATED, ATTR_ANTHROPIC_MESSAGE_COUNT_TOKENS_INPUT_TOKENS, ATTR_ANTHROPIC_MESSAGE_STOP_REASON, ATTR_ANTHROPIC_REQUEST_SERVICE_TIER, ATTR_ANTHROPIC_RESPONSE_SERVICE_TIER, ATTR_ANTHROPIC_THINKING_BUDGET_TOKENS, ATTR_ANTHROPIC_THINKING_TYPE, ATTR_ANTHROPIC_TOOLSET_NAME, ATTR_ANTHROPIC_TOOL_RESULT_CONTENT, ATTR_ANTHROPIC_USAGE_CACHE_CREATION_EPHEMERAL_1H_INPUT_TOKENS, ATTR_ANTHROPIC_USAGE_CACHE_CREATION_EPHEMERAL_5M_INPUT_TOKENS, ATTR_ANTHROPIC_USAGE_COMPACTION_INPUT_TOKENS, ATTR_ANTHROPIC_USAGE_COMPACTION_OUTPUT_TOKENS, ATTR_GEN_AI_AGENT_NAME, ATTR_GEN_AI_INPUT_MESSAGES, ATTR_GEN_AI_OPERATION_NAME, ATTR_GEN_AI_OUTPUT_MESSAGES, ATTR_GEN_AI_OUTPUT_TYPE, ATTR_GEN_AI_REQUEST_MAX_TOKENS, ATTR_GEN_AI_REQUEST_MODEL, ATTR_GEN_AI_REQUEST_REASONING_LEVEL, ATTR_GEN_AI_REQUEST_STOP_SEQUENCES, ATTR_GEN_AI_REQUEST_STREAM, ATTR_GEN_AI_RESPONSE_ID, ATTR_GEN_AI_RESPONSE_MODEL, ATTR_GEN_AI_RESPONSE_TIME_TO_FIRST_CHUNK, ATTR_GEN_AI_SYSTEM_INSTRUCTIONS, ATTR_GEN_AI_TOOL_CALL_ARGUMENTS, ATTR_GEN_AI_TOOL_CALL_ID, ATTR_GEN_AI_TOOL_DESCRIPTION, ATTR_GEN_AI_TOOL_NAME, ATTR_GEN_AI_TOOL_TYPE, ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, ATTR_GEN_AI_USAGE_CACHE_WRITE_INPUT_TOKENS, ATTR_GEN_AI_USAGE_INPUT_TOKENS, ATTR_GEN_AI_USAGE_OUTPUT_TOKENS, ATTR_GEN_AI_USAGE_REASONING_OUTPUT_TOKENS, GEN_AI_OPERATION_NAME_VALUE_CHAT, GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL, GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT, GEN_AI_OUTPUT_TYPE_VALUE_JSON, GEN_AI_TOOL_TYPE_VALUE_FUNCTION, RESPONSE_HEADER_ATTRIBUTES };
