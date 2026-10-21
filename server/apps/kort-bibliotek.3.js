  /**
   * A description of what this template is for.
   *
   * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
   */
  description: optional(string2()),
  /**
   * The MIME type for all resources that match this template. This should only be included if all resources matching this template have the same type.
   */
  mimeType: optional(string2()),
  /**
   * Optional annotations for the client.
   */
  annotations: AnnotationsSchema.optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: optional(looseObject({}))
});
var ListResourcesRequestSchema = PaginatedRequestSchema.extend({
  method: literal("resources/list")
});
var ListResourcesResultSchema = PaginatedResultSchema.extend({
  resources: array(ResourceSchema)
});
var ListResourceTemplatesRequestSchema = PaginatedRequestSchema.extend({
  method: literal("resources/templates/list")
});
var ListResourceTemplatesResultSchema = PaginatedResultSchema.extend({
  resourceTemplates: array(ResourceTemplateSchema)
});
var ResourceRequestParamsSchema = BaseRequestParamsSchema.extend({
  /**
   * The URI of the resource to read. The URI can use any protocol; it is up to the server how to interpret it.
   *
   * @format uri
   */
  uri: string2()
});
var ReadResourceRequestParamsSchema = ResourceRequestParamsSchema;
var ReadResourceRequestSchema = RequestSchema.extend({
  method: literal("resources/read"),
  params: ReadResourceRequestParamsSchema
});
var ReadResourceResultSchema = ResultSchema.extend({
  contents: array(union([TextResourceContentsSchema, BlobResourceContentsSchema]))
});
var ResourceListChangedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/resources/list_changed"),
  params: NotificationsParamsSchema.optional()
});
var SubscribeRequestParamsSchema = ResourceRequestParamsSchema;
var SubscribeRequestSchema = RequestSchema.extend({
  method: literal("resources/subscribe"),
  params: SubscribeRequestParamsSchema
});
var UnsubscribeRequestParamsSchema = ResourceRequestParamsSchema;
var UnsubscribeRequestSchema = RequestSchema.extend({
  method: literal("resources/unsubscribe"),
  params: UnsubscribeRequestParamsSchema
});
var ResourceUpdatedNotificationParamsSchema = NotificationsParamsSchema.extend({
  /**
   * The URI of the resource that has been updated. This might be a sub-resource of the one that the client actually subscribed to.
   */
  uri: string2()
});
var ResourceUpdatedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/resources/updated"),
  params: ResourceUpdatedNotificationParamsSchema
});
var PromptArgumentSchema = object2({
  /**
   * The name of the argument.
   */
  name: string2(),
  /**
   * A human-readable description of the argument.
   */
  description: optional(string2()),
  /**
   * Whether this argument must be provided.
   */
  required: optional(boolean2())
});
var PromptSchema = object2({
  ...BaseMetadataSchema.shape,
  ...IconsSchema.shape,
  /**
   * An optional description of what this prompt provides
   */
  description: optional(string2()),
  /**
   * A list of arguments to use for templating the prompt.
   */
  arguments: optional(array(PromptArgumentSchema)),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: optional(looseObject({}))
});
var ListPromptsRequestSchema = PaginatedRequestSchema.extend({
  method: literal("prompts/list")
});
var ListPromptsResultSchema = PaginatedResultSchema.extend({
  prompts: array(PromptSchema)
});
var GetPromptRequestParamsSchema = BaseRequestParamsSchema.extend({
  /**
   * The name of the prompt or prompt template.
   */
  name: string2(),
  /**
   * Arguments to use for templating the prompt.
   */
  arguments: record(string2(), string2()).optional()
});
var GetPromptRequestSchema = RequestSchema.extend({
  method: literal("prompts/get"),
  params: GetPromptRequestParamsSchema
});
var TextContentSchema = object2({
  type: literal("text"),
  /**
   * The text content of the message.
   */
  text: string2(),
  /**
   * Optional annotations for the client.
   */
  annotations: AnnotationsSchema.optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var ImageContentSchema = object2({
  type: literal("image"),
  /**
   * The base64-encoded image data.
   */
  data: Base64Schema,
  /**
   * The MIME type of the image. Different providers may support different image types.
   */
  mimeType: string2(),
  /**
   * Optional annotations for the client.
   */
  annotations: AnnotationsSchema.optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var AudioContentSchema = object2({
  type: literal("audio"),
  /**
   * The base64-encoded audio data.
   */
  data: Base64Schema,
  /**
   * The MIME type of the audio. Different providers may support different audio types.
   */
  mimeType: string2(),
  /**
   * Optional annotations for the client.
   */
  annotations: AnnotationsSchema.optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var ToolUseContentSchema = object2({
  type: literal("tool_use"),
  /**
   * The name of the tool to invoke.
   * Must match a tool name from the request's tools array.
   */
  name: string2(),
  /**
   * Unique identifier for this tool call.
   * Used to correlate with ToolResultContent in subsequent messages.
   */
  id: string2(),
  /**
   * Arguments to pass to the tool.
   * Must conform to the tool's inputSchema.
   */
  input: record(string2(), unknown()),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var EmbeddedResourceSchema = object2({
  type: literal("resource"),
  resource: union([TextResourceContentsSchema, BlobResourceContentsSchema]),
  /**
   * Optional annotations for the client.
   */
  annotations: AnnotationsSchema.optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var ResourceLinkSchema = ResourceSchema.extend({
  type: literal("resource_link")
});
var ContentBlockSchema = union([
  TextContentSchema,
  ImageContentSchema,
  AudioContentSchema,
  ResourceLinkSchema,
  EmbeddedResourceSchema
]);
var PromptMessageSchema = object2({
  role: RoleSchema,
  content: ContentBlockSchema
});
var GetPromptResultSchema = ResultSchema.extend({
  /**
   * An optional description for the prompt.
   */
  description: string2().optional(),
  messages: array(PromptMessageSchema)
});
var PromptListChangedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/prompts/list_changed"),
  params: NotificationsParamsSchema.optional()
});
var ToolAnnotationsSchema = object2({
  /**
   * A human-readable title for the tool.
   */
  title: string2().optional(),
  /**
   * If true, the tool does not modify its environment.
   *
   * Default: false
   */
  readOnlyHint: boolean2().optional(),
  /**
   * If true, the tool may perform destructive updates to its environment.
   * If false, the tool performs only additive updates.
   *
   * (This property is meaningful only when `readOnlyHint == false`)
   *
   * Default: true
   */
  destructiveHint: boolean2().optional(),
  /**
   * If true, calling the tool repeatedly with the same arguments
   * will have no additional effect on the its environment.
   *
   * (This property is meaningful only when `readOnlyHint == false`)
   *
   * Default: false
   */
  idempotentHint: boolean2().optional(),
  /**
   * If true, this tool may interact with an "open world" of external
   * entities. If false, the tool's domain of interaction is closed.
   * For example, the world of a web search tool is open, whereas that
   * of a memory tool is not.
   *
   * Default: true
   */
  openWorldHint: boolean2().optional()
});
var ToolExecutionSchema = object2({
  /**
   * Indicates the tool's preference for task-augmented execution.
   * - "required": Clients MUST invoke the tool as a task
   * - "optional": Clients MAY invoke the tool as a task or normal request
   * - "forbidden": Clients MUST NOT attempt to invoke the tool as a task
   *
   * If not present, defaults to "forbidden".
   */
  taskSupport: _enum2(["required", "optional", "forbidden"]).optional()
});
var ToolSchema = object2({
  ...BaseMetadataSchema.shape,
  ...IconsSchema.shape,
  /**
   * A human-readable description of the tool.
   */
  description: string2().optional(),
  /**
   * A JSON Schema 2020-12 object defining the expected parameters for the tool.
   * Must have type: 'object' at the root level per MCP spec.
   */
  inputSchema: object2({
    type: literal("object"),
    properties: record(string2(), AssertObjectSchema).optional(),
    required: array(string2()).optional()
  }).catchall(unknown()),
  /**
   * An optional JSON Schema 2020-12 object defining the structure of the tool's output
   * returned in the structuredContent field of a CallToolResult.
   * Must have type: 'object' at the root level per MCP spec.
   */
  outputSchema: object2({
    type: literal("object"),
    properties: record(string2(), AssertObjectSchema).optional(),
    required: array(string2()).optional()
  }).catchall(unknown()).optional(),
  /**
   * Optional additional tool information.
   */
  annotations: ToolAnnotationsSchema.optional(),
  /**
   * Execution-related properties for this tool.
   */
  execution: ToolExecutionSchema.optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var ListToolsRequestSchema = PaginatedRequestSchema.extend({
  method: literal("tools/list")
});
var ListToolsResultSchema = PaginatedResultSchema.extend({
  tools: array(ToolSchema)
});
var CallToolResultSchema = ResultSchema.extend({
  /**
   * A list of content objects that represent the result of the tool call.
   *
   * If the Tool does not define an outputSchema, this field MUST be present in the result.
   * For backwards compatibility, this field is always present, but it may be empty.
   */
  content: array(ContentBlockSchema).default([]),
  /**
   * An object containing structured tool output.
   *
   * If the Tool defines an outputSchema, this field MUST be present in the result, and contain a JSON object that matches the schema.
   */
  structuredContent: record(string2(), unknown()).optional(),
  /**
   * Whether the tool call ended in an error.
   *
   * If not set, this is assumed to be false (the call was successful).
   *
   * Any errors that originate from the tool SHOULD be reported inside the result
   * object, with `isError` set to true, _not_ as an MCP protocol-level error
   * response. Otherwise, the LLM would not be able to see that an error occurred
   * and self-correct.
   *
   * However, any errors in _finding_ the tool, an error indicating that the
   * server does not support tool calls, or any other exceptional conditions,
   * should be reported as an MCP error response.
   */
  isError: boolean2().optional()
});
var CompatibilityCallToolResultSchema = CallToolResultSchema.or(ResultSchema.extend({
  toolResult: unknown()
}));
var CallToolRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
  /**
   * The name of the tool to call.
   */
  name: string2(),
  /**
   * Arguments to pass to the tool.
   */
  arguments: record(string2(), unknown()).optional()
});
var CallToolRequestSchema = RequestSchema.extend({
  method: literal("tools/call"),
  params: CallToolRequestParamsSchema
});
var ToolListChangedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/tools/list_changed"),
  params: NotificationsParamsSchema.optional()
});
var ListChangedOptionsBaseSchema = object2({
  /**
   * If true, the list will be refreshed automatically when a list changed notification is received.
   * The callback will be called with the updated list.
   *
   * If false, the callback will be called with null items, allowing manual refresh.
   *
   * @default true
   */
  autoRefresh: boolean2().default(true),
  /**
   * Debounce time in milliseconds for list changed notification processing.
   *
   * Multiple notifications received within this timeframe will only trigger one refresh.
   * Set to 0 to disable debouncing.
   *
   * @default 300
   */
  debounceMs: number2().int().nonnegative().default(300)
});
var LoggingLevelSchema = _enum2(["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"]);
var SetLevelRequestParamsSchema = BaseRequestParamsSchema.extend({
  /**
   * The level of logging that the client wants to receive from the server. The server should send all logs at this level and higher (i.e., more severe) to the client as notifications/logging/message.
   */
  level: LoggingLevelSchema
});
var SetLevelRequestSchema = RequestSchema.extend({
  method: literal("logging/setLevel"),
  params: SetLevelRequestParamsSchema
});
var LoggingMessageNotificationParamsSchema = NotificationsParamsSchema.extend({
  /**
   * The severity of this log message.
   */
  level: LoggingLevelSchema,
  /**
   * An optional name of the logger issuing this message.
   */
  logger: string2().optional(),
  /**
   * The data to be logged, such as a string message or an object. Any JSON serializable type is allowed here.
   */
  data: unknown()
});
var LoggingMessageNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/message"),
  params: LoggingMessageNotificationParamsSchema
});
var ModelHintSchema = object2({
  /**
   * A hint for a model name.
   */
  name: string2().optional()
});
var ModelPreferencesSchema = object2({
  /**
   * Optional hints to use for model selection.
   */
  hints: array(ModelHintSchema).optional(),
  /**
   * How much to prioritize cost when selecting a model.
   */
  costPriority: number2().min(0).max(1).optional(),
  /**
   * How much to prioritize sampling speed (latency) when selecting a model.
   */
  speedPriority: number2().min(0).max(1).optional(),
  /**
   * How much to prioritize intelligence and capabilities when selecting a model.
   */
  intelligencePriority: number2().min(0).max(1).optional()
});
var ToolChoiceSchema = object2({
  /**
   * Controls when tools are used:
   * - "auto": Model decides whether to use tools (default)
   * - "required": Model MUST use at least one tool before completing
   * - "none": Model MUST NOT use any tools
   */
  mode: _enum2(["auto", "required", "none"]).optional()
});
var ToolResultContentSchema = object2({
  type: literal("tool_result"),
  toolUseId: string2().describe("The unique identifier for the corresponding tool call."),
  content: array(ContentBlockSchema).default([]),
  structuredContent: object2({}).loose().optional(),
  isError: boolean2().optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var SamplingContentSchema = discriminatedUnion("type", [TextContentSchema, ImageContentSchema, AudioContentSchema]);
var SamplingMessageContentBlockSchema = discriminatedUnion("type", [
  TextContentSchema,
  ImageContentSchema,
  AudioContentSchema,
  ToolUseContentSchema,
  ToolResultContentSchema
]);
var SamplingMessageSchema = object2({
  role: RoleSchema,
  content: union([SamplingMessageContentBlockSchema, array(SamplingMessageContentBlockSchema)]),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var CreateMessageRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
  messages: array(SamplingMessageSchema),
  /**
   * The server's preferences for which model to select. The client MAY modify or omit this request.
   */
  modelPreferences: ModelPreferencesSchema.optional(),
  /**
   * An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt.
   */
  systemPrompt: string2().optional(),
  /**
   * A request to include context from one or more MCP servers (including the caller), to be attached to the prompt.
   * The client MAY ignore this request.
   *
   * Default is "none". Values "thisServer" and "allServers" are soft-deprecated. Servers SHOULD only use these values if the client
   * declares ClientCapabilities.sampling.context. These values may be removed in future spec releases.
   */
  includeContext: _enum2(["none", "thisServer", "allServers"]).optional(),
  temperature: number2().optional(),
  /**
   * The requested maximum number of tokens to sample (to prevent runaway completions).
   *
   * The client MAY choose to sample fewer tokens than the requested maximum.
   */
  maxTokens: number2().int(),
  stopSequences: array(string2()).optional(),
  /**
   * Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific.
   */
  metadata: AssertObjectSchema.optional(),
  /**
   * Tools that the model may use during generation.
   * The client MUST return an error if this field is provided but ClientCapabilities.sampling.tools is not declared.
   */
  tools: array(ToolSchema).optional(),
  /**
   * Controls how the model uses tools.
   * The client MUST return an error if this field is provided but ClientCapabilities.sampling.tools is not declared.
   * Default is `{ mode: "auto" }`.
   */
  toolChoice: ToolChoiceSchema.optional()
});
var CreateMessageRequestSchema = RequestSchema.extend({
  method: literal("sampling/createMessage"),
  params: CreateMessageRequestParamsSchema
});
var CreateMessageResultSchema = ResultSchema.extend({
  /**
   * The name of the model that generated the message.
   */
  model: string2(),
  /**
   * The reason why sampling stopped, if known.
   *
   * Standard values:
   * - "endTurn": Natural end of the assistant's turn
   * - "stopSequence": A stop sequence was encountered
   * - "maxTokens": Maximum token limit was reached
   *
   * This field is an open string to allow for provider-specific stop reasons.
   */
  stopReason: optional(_enum2(["endTurn", "stopSequence", "maxTokens"]).or(string2())),
  role: RoleSchema,
  /**
   * Response content. Single content block (text, image, or audio).
   */
  content: SamplingContentSchema
});
var CreateMessageResultWithToolsSchema = ResultSchema.extend({
  /**
   * The name of the model that generated the message.
   */
  model: string2(),
  /**
   * The reason why sampling stopped, if known.
   *
   * Standard values:
   * - "endTurn": Natural end of the assistant's turn
   * - "stopSequence": A stop sequence was encountered
   * - "maxTokens": Maximum token limit was reached
   * - "toolUse": The model wants to use one or more tools
   *
   * This field is an open string to allow for provider-specific stop reasons.
   */
  stopReason: optional(_enum2(["endTurn", "stopSequence", "maxTokens", "toolUse"]).or(string2())),
  role: RoleSchema,
  /**
   * Response content. May be a single block or array. May include ToolUseContent if stopReason is "toolUse".
   */
  content: union([SamplingMessageContentBlockSchema, array(SamplingMessageContentBlockSchema)])
});
var BooleanSchemaSchema = object2({
  type: literal("boolean"),
  title: string2().optional(),
  description: string2().optional(),
  default: boolean2().optional()
});
var StringSchemaSchema = object2({
  type: literal("string"),
  title: string2().optional(),
  description: string2().optional(),
  minLength: number2().optional(),
  maxLength: number2().optional(),
  format: _enum2(["email", "uri", "date", "date-time"]).optional(),
  default: string2().optional()
});
var NumberSchemaSchema = object2({
  type: _enum2(["number", "integer"]),
  title: string2().optional(),
  description: string2().optional(),
  minimum: number2().optional(),
  maximum: number2().optional(),
  default: number2().optional()
});
var UntitledSingleSelectEnumSchemaSchema = object2({
  type: literal("string"),
  title: string2().optional(),
  description: string2().optional(),
  enum: array(string2()),
  default: string2().optional()
});
var TitledSingleSelectEnumSchemaSchema = object2({
  type: literal("string"),
  title: string2().optional(),
  description: string2().optional(),
  oneOf: array(object2({
    const: string2(),
    title: string2()
  })),
  default: string2().optional()
});
var LegacyTitledEnumSchemaSchema = object2({
  type: literal("string"),
  title: string2().optional(),
  description: string2().optional(),
  enum: array(string2()),
  enumNames: array(string2()).optional(),
  default: string2().optional()
});
var SingleSelectEnumSchemaSchema = union([UntitledSingleSelectEnumSchemaSchema, TitledSingleSelectEnumSchemaSchema]);
var UntitledMultiSelectEnumSchemaSchema = object2({
  type: literal("array"),
  title: string2().optional(),
  description: string2().optional(),
  minItems: number2().optional(),
  maxItems: number2().optional(),
  items: object2({
    type: literal("string"),
    enum: array(string2())
  }),
  default: array(string2()).optional()
});
var TitledMultiSelectEnumSchemaSchema = object2({
  type: literal("array"),
  title: string2().optional(),
  description: string2().optional(),
  minItems: number2().optional(),
  maxItems: number2().optional(),
  items: object2({
    anyOf: array(object2({
      const: string2(),
      title: string2()
    }))
  }),
  default: array(string2()).optional()
});
var MultiSelectEnumSchemaSchema = union([UntitledMultiSelectEnumSchemaSchema, TitledMultiSelectEnumSchemaSchema]);
var EnumSchemaSchema = union([LegacyTitledEnumSchemaSchema, SingleSelectEnumSchemaSchema, MultiSelectEnumSchemaSchema]);
var PrimitiveSchemaDefinitionSchema = union([EnumSchemaSchema, BooleanSchemaSchema, StringSchemaSchema, NumberSchemaSchema]);
var ElicitRequestFormParamsSchema = TaskAugmentedRequestParamsSchema.extend({
  /**
   * The elicitation mode.
   *
   * Optional for backward compatibility. Clients MUST treat missing mode as "form".
   */
  mode: literal("form").optional(),
  /**
   * The message to present to the user describing what information is being requested.
   */
  message: string2(),
  /**
   * A restricted subset of JSON Schema.
   * Only top-level properties are allowed, without nesting.
   */
  requestedSchema: object2({
    type: literal("object"),
    properties: record(string2(), PrimitiveSchemaDefinitionSchema),
    required: array(string2()).optional()
  })
});
var ElicitRequestURLParamsSchema = TaskAugmentedRequestParamsSchema.extend({
  /**
   * The elicitation mode.
   */
  mode: literal("url"),
  /**
   * The message to present to the user explaining why the interaction is needed.
   */
  message: string2(),
  /**
   * The ID of the elicitation, which must be unique within the context of the server.
   * The client MUST treat this ID as an opaque value.
   */
  elicitationId: string2(),
  /**
   * The URL that the user should navigate to.
   */
  url: string2().url()
});
var ElicitRequestParamsSchema = union([ElicitRequestFormParamsSchema, ElicitRequestURLParamsSchema]);
var ElicitRequestSchema = RequestSchema.extend({
  method: literal("elicitation/create"),
  params: ElicitRequestParamsSchema
});
var ElicitationCompleteNotificationParamsSchema = NotificationsParamsSchema.extend({
  /**
   * The ID of the elicitation that completed.
   */
  elicitationId: string2()
});
var ElicitationCompleteNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/elicitation/complete"),
  params: ElicitationCompleteNotificationParamsSchema
});
var ElicitResultSchema = ResultSchema.extend({
  /**
   * The user action in response to the elicitation.
   * - "accept": User submitted the form/confirmed the action
   * - "decline": User explicitly decline the action
   * - "cancel": User dismissed without making an explicit choice
   */
  action: _enum2(["accept", "decline", "cancel"]),
  /**
   * The submitted form data, only present when action is "accept".
   * Contains values matching the requested schema.
   * Per MCP spec, content is "typically omitted" for decline/cancel actions.
   * We normalize null to undefined for leniency while maintaining type compatibility.
   */
  content: preprocess((val) => val === null ? void 0 : val, record(string2(), union([string2(), number2(), boolean2(), array(string2())])).optional())
});
var ResourceTemplateReferenceSchema = object2({
  type: literal("ref/resource"),
  /**
   * The URI or URI template of the resource.
   */
  uri: string2()
});
var PromptReferenceSchema = object2({
  type: literal("ref/prompt"),
  /**
   * The name of the prompt or prompt template
   */
  name: string2()
});
var CompleteRequestParamsSchema = BaseRequestParamsSchema.extend({
  ref: union([PromptReferenceSchema, ResourceTemplateReferenceSchema]),
  /**
   * The argument's information
   */
  argument: object2({
    /**
     * The name of the argument
     */
    name: string2(),
    /**
     * The value of the argument to use for completion matching.
     */
    value: string2()
  }),
  context: object2({
    /**
     * Previously-resolved variables in a URI template or prompt.
     */
    arguments: record(string2(), string2()).optional()
  }).optional()
});
var CompleteRequestSchema = RequestSchema.extend({
  method: literal("completion/complete"),
  params: CompleteRequestParamsSchema
});
var CompleteResultSchema = ResultSchema.extend({
  completion: looseObject({
    /**
     * An array of completion values. Must not exceed 100 items.
     */
    values: array(string2()).max(100),
    /**
     * The total number of completion options available. This can exceed the number of values actually sent in the response.
     */
    total: optional(number2().int()),
    /**
     * Indicates whether there are additional completion options beyond those provided in the current response, even if the exact total is unknown.
     */
    hasMore: optional(boolean2())
  })
});
var RootSchema = object2({
  /**
   * The URI identifying the root. This *must* start with file:// for now.
   */
  uri: string2().startsWith("file://"),
  /**
   * An optional name for the root.
   */
  name: string2().optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var ListRootsRequestSchema = RequestSchema.extend({
  method: literal("roots/list"),
  params: BaseRequestParamsSchema.optional()
});
var ListRootsResultSchema = ResultSchema.extend({
  roots: array(RootSchema)
});
var RootsListChangedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/roots/list_changed"),
  params: NotificationsParamsSchema.optional()
});
var ClientRequestSchema = union([
  PingRequestSchema,
  InitializeRequestSchema,
  CompleteRequestSchema,
  SetLevelRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
  GetTaskRequestSchema,
  GetTaskPayloadRequestSchema,
  ListTasksRequestSchema,
  CancelTaskRequestSchema
]);
var ClientNotificationSchema = union([
  CancelledNotificationSchema,
  ProgressNotificationSchema,
  InitializedNotificationSchema,
  RootsListChangedNotificationSchema,
  TaskStatusNotificationSchema
]);
var ClientResultSchema = union([
  EmptyResultSchema,
  CreateMessageResultSchema,
  CreateMessageResultWithToolsSchema,
  ElicitResultSchema,
  ListRootsResultSchema,
  GetTaskResultSchema,
  ListTasksResultSchema,
  CreateTaskResultSchema
]);
var ServerRequestSchema = union([
  PingRequestSchema,
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema,
  GetTaskRequestSchema,
  GetTaskPayloadRequestSchema,
  ListTasksRequestSchema,
  CancelTaskRequestSchema
]);
var ServerNotificationSchema = union([
  CancelledNotificationSchema,
  ProgressNotificationSchema,
  LoggingMessageNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  TaskStatusNotificationSchema,
  ElicitationCompleteNotificationSchema
]);
var ServerResultSchema = union([
  EmptyResultSchema,
  InitializeResultSchema,
  CompleteResultSchema,
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ReadResourceResultSchema,
  CallToolResultSchema,
  ListToolsResultSchema,
  GetTaskResultSchema,
  ListTasksResultSchema,
  CreateTaskResultSchema
]);
var McpError = class _McpError extends Error {
  constructor(code, message, data) {
    super(`MCP error ${code}: ${message}`);
    this.code = code;
    this.data = data;
    this.name = "McpError";
  }
  /**
   * Factory method to create the appropriate error type based on the error code and data
   */
  static fromError(code, message, data) {
    if (code === ErrorCode.UrlElicitationRequired && data) {
      const errorData = data;
      if (errorData.elicitations) {
        return new UrlElicitationRequiredError(errorData.elicitations, message);
      }
    }
    return new _McpError(code, message, data);
  }
};
var UrlElicitationRequiredError = class extends McpError {
  constructor(elicitations, message = `URL elicitation${elicitations.length > 1 ? "s" : ""} required`) {
    super(ErrorCode.UrlElicitationRequired, message, {
      elicitations
    });
  }
  get elicitations() {
    return this.data?.elicitations ?? [];
  }
};

// ../../../../tua-plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/interfaces.js
function isTerminal(status) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

// ../../../../tua-plugin/node_modules/zod-to-json-schema/dist/esm/Options.js
var ignoreOverride = Symbol("Let zodToJsonSchema decide on which parser to use");

// ../../../../tua-plugin/node_modules/zod-to-json-schema/dist/esm/parsers/string.js
var ALPHA_NUMERIC = new Set("ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxyz0123456789");

// ../../../../tua-plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-json-schema-compat.js
function getMethodLiteral(schema) {
  const shape = getObjectShape(schema);
  const methodSchema = shape?.method;
  if (!methodSchema) {
    throw new Error("Schema is missing a method literal");
  }
  const value = getLiteralValue(methodSchema);
  if (typeof value !== "string") {
    throw new Error("Schema method literal must be a string");
  }
  return value;
}
function parseWithCompat(schema, data) {
  const result = safeParse2(schema, data);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

// ../../../../tua-plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js
var DEFAULT_REQUEST_TIMEOUT_MSEC = 6e4;
var Protocol = class {
  constructor(_options) {
    this._options = _options;
    this._requestMessageId = 0;
    this._requestHandlers = /* @__PURE__ */ new Map();
    this._requestHandlerAbortControllers = /* @__PURE__ */ new Map();
    this._notificationHandlers = /* @__PURE__ */ new Map();
    this._responseHandlers = /* @__PURE__ */ new Map();
    this._progressHandlers = /* @__PURE__ */ new Map();
    this._timeoutInfo = /* @__PURE__ */ new Map();
    this._pendingDebouncedNotifications = /* @__PURE__ */ new Set();
    this._taskProgressTokens = /* @__PURE__ */ new Map();
    this._requestResolvers = /* @__PURE__ */ new Map();
    this.setNotificationHandler(CancelledNotificationSchema, (notification) => {
      this._oncancel(notification);
    });
    this.setNotificationHandler(ProgressNotificationSchema, (notification) => {
      this._onprogress(notification);
    });
    this.setRequestHandler(
      PingRequestSchema,
      // Automatic pong by default.
      (_request) => ({})
    );
    this._taskStore = _options?.taskStore;
    this._taskMessageQueue = _options?.taskMessageQueue;
    if (this._taskStore) {
      this.setRequestHandler(GetTaskRequestSchema, async (request, extra) => {
        const task = await this._taskStore.getTask(request.params.taskId, extra.sessionId);
        if (!task) {
          throw new McpError(ErrorCode.InvalidParams, "Failed to retrieve task: Task not found");
        }
        return {
          ...task
        };
      });
      this.setRequestHandler(GetTaskPayloadRequestSchema, async (request, extra) => {
        const handleTaskResult = async () => {
          const taskId = request.params.taskId;
          if (!await this._taskStore.getTask(taskId, extra.sessionId)) {
            throw new McpError(ErrorCode.InvalidParams, `Task not found: ${taskId}`);
          }
          if (this._taskMessageQueue) {
            let queuedMessage;
            while (queuedMessage = await this._taskMessageQueue.dequeue(taskId, extra.sessionId)) {
              if (queuedMessage.type === "response" || queuedMessage.type === "error") {
                const message = queuedMessage.message;
                const requestId = message.id;
                const resolver = this._requestResolvers.get(requestId);
                if (resolver) {
                  this._requestResolvers.delete(requestId);
                  if (queuedMessage.type === "response") {
                    resolver(message);
                  } else {
                    const errorMessage = message;
                    const error40 = new McpError(errorMessage.error.code, errorMessage.error.message, errorMessage.error.data);
                    resolver(error40);
                  }
                } else {
                  const messageType = queuedMessage.type === "response" ? "Response" : "Error";
                  this._onerror(new Error(`${messageType} handler missing for request ${requestId}`));
                }
                continue;
              }
              await this._transport?.send(queuedMessage.message, { relatedRequestId: extra.requestId });
            }
          }
          const task = await this._taskStore.getTask(taskId, extra.sessionId);
          if (!task) {
            throw new McpError(ErrorCode.InvalidParams, `Task not found: ${taskId}`);
          }
          if (!isTerminal(task.status)) {
            await this._waitForTaskUpdate(taskId, extra.signal, extra.sessionId);
            return await handleTaskResult();
          }
          if (isTerminal(task.status)) {
            const result = await this._taskStore.getTaskResult(taskId, extra.sessionId);
            this._clearTaskQueue(taskId, extra.sessionId);
            return {
              ...result,
              _meta: {
                ...result._meta,
                [RELATED_TASK_META_KEY]: {
                  taskId
                }
              }
            };
          }
          return await handleTaskResult();
        };
        return await handleTaskResult();
      });
      this.setRequestHandler(ListTasksRequestSchema, async (request, extra) => {
        try {
          const { tasks, nextCursor } = await this._taskStore.listTasks(request.params?.cursor, extra.sessionId);
          return {
            tasks,
            nextCursor,
            _meta: {}
          };
        } catch (error40) {
          throw new McpError(ErrorCode.InvalidParams, `Failed to list tasks: ${error40 instanceof Error ? error40.message : String(error40)}`);
        }
      });
      this.setRequestHandler(CancelTaskRequestSchema, async (request, extra) => {
        try {
          const task = await this._taskStore.getTask(request.params.taskId, extra.sessionId);
          if (!task) {
            throw new McpError(ErrorCode.InvalidParams, `Task not found: ${request.params.taskId}`);
          }
          if (isTerminal(task.status)) {
            throw new McpError(ErrorCode.InvalidParams, `Cannot cancel task in terminal status: ${task.status}`);
          }
          await this._taskStore.updateTaskStatus(request.params.taskId, "cancelled", "Client cancelled task execution.", extra.sessionId);
          this._clearTaskQueue(request.params.taskId, extra.sessionId);
          const cancelledTask = await this._taskStore.getTask(request.params.taskId, extra.sessionId);
          if (!cancelledTask) {
            throw new McpError(ErrorCode.InvalidParams, `Task not found after cancellation: ${request.params.taskId}`);
          }
          return {
            _meta: {},
            ...cancelledTask
          };
        } catch (error40) {
          if (error40 instanceof McpError) {
            throw error40;
          }
          throw new McpError(ErrorCode.InvalidRequest, `Failed to cancel task: ${error40 instanceof Error ? error40.message : String(error40)}`);
        }
      });
    }
  }
  async _oncancel(notification) {
    if (!notification.params.requestId) {
      return;
    }
    const controller = this._requestHandlerAbortControllers.get(notification.params.requestId);
    controller?.abort(notification.params.reason);
  }
  _setupTimeout(messageId, timeout, maxTotalTimeout, onTimeout, resetTimeoutOnProgress = false) {
    this._timeoutInfo.set(messageId, {
      timeoutId: setTimeout(onTimeout, timeout),
      startTime: Date.now(),
      timeout,
      maxTotalTimeout,
      resetTimeoutOnProgress,
      onTimeout
    });
  }
  _resetTimeout(messageId) {
    const info = this._timeoutInfo.get(messageId);
    if (!info)
      return false;
    const totalElapsed = Date.now() - info.startTime;
    if (info.maxTotalTimeout && totalElapsed >= info.maxTotalTimeout) {
      this._timeoutInfo.delete(messageId);
      throw McpError.fromError(ErrorCode.RequestTimeout, "Maximum total timeout exceeded", {
        maxTotalTimeout: info.maxTotalTimeout,
        totalElapsed
      });
    }
    clearTimeout(info.timeoutId);
    info.timeoutId = setTimeout(info.onTimeout, info.timeout);
    return true;
  }
  _cleanupTimeout(messageId) {
    const info = this._timeoutInfo.get(messageId);
    if (info) {
      clearTimeout(info.timeoutId);
      this._timeoutInfo.delete(messageId);
    }
  }
  /**
   * Attaches to the given transport, starts it, and starts listening for messages.
   *
   * The Protocol object assumes ownership of the Transport, replacing any callbacks that have already been set, and expects that it is the only user of the Transport instance going forward.
   */
  async connect(transport) {
    if (this._transport) {
      throw new Error("Already connected to a transport. Call close() before connecting to a new transport, or use a separate Protocol instance per connection.");
    }
    this._transport = transport;
    const _onclose = this.transport?.onclose;
    this._transport.onclose = () => {
      _onclose?.();
      this._onclose();
    };
    const _onerror = this.transport?.onerror;
    this._transport.onerror = (error40) => {
      _onerror?.(error40);
      this._onerror(error40);
    };
    const _onmessage = this._transport?.onmessage;
    this._transport.onmessage = (message, extra) => {
      _onmessage?.(message, extra);
      if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
        this._onresponse(message);
      } else if (isJSONRPCRequest(message)) {
        this._onrequest(message, extra);
      } else if (isJSONRPCNotification(message)) {
        this._onnotification(message);
      } else {
        this._onerror(new Error(`Unknown message type: ${JSON.stringify(message)}`));
      }
    };
    await this._transport.start();
  }
  _onclose() {
    const responseHandlers = this._responseHandlers;
    this._responseHandlers = /* @__PURE__ */ new Map();
    this._progressHandlers.clear();
    this._taskProgressTokens.clear();
    this._pendingDebouncedNotifications.clear();
    for (const info of this._timeoutInfo.values()) {
      clearTimeout(info.timeoutId);
    }
    this._timeoutInfo.clear();
    for (const controller of this._requestHandlerAbortControllers.values()) {
      controller.abort();
    }
    this._requestHandlerAbortControllers.clear();
    const error40 = McpError.fromError(ErrorCode.ConnectionClosed, "Connection closed");
    this._transport = void 0;
    this.onclose?.();
    for (const handler of responseHandlers.values()) {
      handler(error40);
    }
  }
  _onerror(error40) {
    this.onerror?.(error40);
  }
  _onnotification(notification) {
    const handler = this._notificationHandlers.get(notification.method) ?? this.fallbackNotificationHandler;
    if (handler === void 0) {
      return;
    }
    Promise.resolve().then(() => handler(notification)).catch((error40) => this._onerror(new Error(`Uncaught error in notification handler: ${error40}`)));
  }
  _onrequest(request, extra) {
    const handler = this._requestHandlers.get(request.method) ?? this.fallbackRequestHandler;
    const capturedTransport = this._transport;
    const relatedTaskId = request.params?._meta?.[RELATED_TASK_META_KEY]?.taskId;
    const sessionId = capturedTransport?.sessionId;
    const store = this._taskStore;
    let relatedTaskFound = true;
    let relatedTaskLookup;
    if (relatedTaskId && store && this._taskMessageQueue && sessionId !== void 0) {
      relatedTaskFound = false;
      relatedTaskLookup = (async () => {
        if (!await store.getTask(relatedTaskId, sessionId)) {
          throw new McpError(ErrorCode.InvalidParams, `Task not found: ${relatedTaskId}`);
        }
        relatedTaskFound = true;
      })();
    }
    if (handler === void 0) {
      const errorResponse = {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: ErrorCode.MethodNotFound,
          message: "Method not found"
        }
      };
      if (relatedTaskId && relatedTaskLookup) {
        const queuedError = { type: "error", message: errorResponse, timestamp: Date.now() };
        relatedTaskLookup.then(() => this._enqueueTaskMessage(relatedTaskId, queuedError, sessionId), () => capturedTransport?.send(errorResponse)).catch((error40) => this._onerror(new Error(`Failed to send an error response: ${error40}`)));
      } else if (relatedTaskId && this._taskMessageQueue) {
        this._enqueueTaskMessage(relatedTaskId, {
          type: "error",
          message: errorResponse,
          timestamp: Date.now()
        }, capturedTransport?.sessionId).catch((error40) => this._onerror(new Error(`Failed to enqueue error response: ${error40}`)));
      } else {
        capturedTransport?.send(errorResponse).catch((error40) => this._onerror(new Error(`Failed to send an error response: ${error40}`)));
      }
      return;
    }
    const abortController = new AbortController();
    this._requestHandlerAbortControllers.set(request.id, abortController);
    const taskCreationParams = isTaskAugmentedRequestParams(request.params) ? request.params.task : void 0;
    const taskStore = this._taskStore ? this.requestTaskStore(request, capturedTransport?.sessionId) : void 0;
    const fullExtra = {
      signal: abortController.signal,
      sessionId: capturedTransport?.sessionId,
      _meta: request.params?._meta,
      sendNotification: async (notification) => {
        if (abortController.signal.aborted)
          return;
        const notificationOptions = { relatedRequestId: request.id };
        if (relatedTaskId) {
          notificationOptions.relatedTask = { taskId: relatedTaskId };
        }
        await this.notification(notification, notificationOptions);
      },
      sendRequest: async (r2, resultSchema, options) => {
        if (abortController.signal.aborted) {
          throw new McpError(ErrorCode.ConnectionClosed, "Request was cancelled");
        }
        const requestOptions = { ...options, relatedRequestId: request.id };
        if (relatedTaskId && !requestOptions.relatedTask) {
          requestOptions.relatedTask = { taskId: relatedTaskId };
        }
        const effectiveTaskId = requestOptions.relatedTask?.taskId ?? relatedTaskId;
        if (effectiveTaskId && taskStore) {
          await taskStore.updateTaskStatus(effectiveTaskId, "input_required");
        }
        return await this.request(r2, resultSchema, requestOptions);
      },
      authInfo: extra?.authInfo,
      requestId: request.id,
      requestInfo: extra?.requestInfo,
      taskId: relatedTaskId,
      taskStore,
      taskRequestedTtl: taskCreationParams?.ttl,
      closeSSEStream: extra?.closeSSEStream,
      closeStandaloneSSEStream: extra?.closeStandaloneSSEStream
    };
    (relatedTaskLookup ?? Promise.resolve()).then(() => {
      if (relatedTaskLookup && abortController.signal.aborted) {
        throw new McpError(ErrorCode.ConnectionClosed, "Request was cancelled");
      }
      if (taskCreationParams) {
        this.assertTaskHandlerCapability(request.method);
      }
    }).then(() => handler(request, fullExtra)).then(async (result) => {
      if (abortController.signal.aborted) {
        return;
      }
      const response = {
        result,
        jsonrpc: "2.0",
        id: request.id
      };
      if (relatedTaskId && this._taskMessageQueue) {
        await this._enqueueTaskMessage(relatedTaskId, {
          type: "response",
          message: response,
          timestamp: Date.now()
        }, capturedTransport?.sessionId);
      } else {
        await capturedTransport?.send(response);
      }
    }, async (error40) => {
      if (abortController.signal.aborted) {
        return;
      }
      const errorResponse = {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: Number.isSafeInteger(error40["code"]) ? error40["code"] : ErrorCode.InternalError,
          message: error40.message ?? "Internal error",
          ...error40["data"] !== void 0 && { data: error40["data"] }
        }
      };
      if (relatedTaskId && this._taskMessageQueue && relatedTaskFound) {
        await this._enqueueTaskMessage(relatedTaskId, {
          type: "error",
          message: errorResponse,
          timestamp: Date.now()
        }, capturedTransport?.sessionId);
      } else {
        await capturedTransport?.send(errorResponse);
      }
    }).catch((error40) => this._onerror(new Error(`Failed to send response: ${error40}`))).finally(() => {
      if (this._requestHandlerAbortControllers.get(request.id) === abortController) {
        this._requestHandlerAbortControllers.delete(request.id);
      }
    });
  }
  _onprogress(notification) {
    const { progressToken, ...params } = notification.params;
    const messageId = Number(progressToken);
    const handler = this._progressHandlers.get(messageId);
    if (!handler) {
      this._onerror(new Error(`Received a progress notification for an unknown token: ${JSON.stringify(notification)}`));
      return;
    }
    const responseHandler = this._responseHandlers.get(messageId);
    const timeoutInfo = this._timeoutInfo.get(messageId);
    if (timeoutInfo && responseHandler && timeoutInfo.resetTimeoutOnProgress) {
      try {
        this._resetTimeout(messageId);
      } catch (error40) {
        this._responseHandlers.delete(messageId);
        this._progressHandlers.delete(messageId);
        this._cleanupTimeout(messageId);
        responseHandler(error40);
        return;
      }
    }
    handler(params);
  }
  _onresponse(response) {
    const messageId = Number(response.id);
    const resolver = this._requestResolvers.get(messageId);
    if (resolver) {
      this._requestResolvers.delete(messageId);
      if (isJSONRPCResultResponse(response)) {
        resolver(response);
      } else {
        const error40 = new McpError(response.error.code, response.error.message, response.error.data);
        resolver(error40);
      }
      return;
    }
    const handler = this._responseHandlers.get(messageId);
    if (handler === void 0) {
      this._onerror(new Error(`Received a response for an unknown message ID: ${JSON.stringify(response)}`));
      return;
    }
    this._responseHandlers.delete(messageId);
    this._cleanupTimeout(messageId);
    let isTaskResponse = false;
    if (isJSONRPCResultResponse(response) && response.result && typeof response.result === "object") {
      const result = response.result;
      if (result.task && typeof result.task === "object") {
        const task = result.task;
        if (typeof task.taskId === "string") {
          isTaskResponse = true;
          this._taskProgressTokens.set(task.taskId, messageId);
        }
      }
    }
    if (!isTaskResponse) {
      this._progressHandlers.delete(messageId);
    }
    if (isJSONRPCResultResponse(response)) {
      handler(response);
    } else {
      const error40 = McpError.fromError(response.error.code, response.error.message, response.error.data);
      handler(error40);
    }
  }
  get transport() {
    return this._transport;
  }
  /**
   * Closes the connection.
   */
  async close() {
    await this._transport?.close();
  }
  /**
   * Sends a request and returns an AsyncGenerator that yields response messages.
   * The generator is guaranteed to end with either a 'result' or 'error' message.
   *
   * @example
   * ```typescript
   * const stream = protocol.requestStream(request, resultSchema, options);
   * for await (const message of stream) {
   *   switch (message.type) {
   *     case 'taskCreated':
   *       console.log('Task created:', message.task.taskId);
   *       break;
   *     case 'taskStatus':
   *       console.log('Task status:', message.task.status);
   *       break;
   *     case 'result':
   *       console.log('Final result:', message.result);
   *       break;
   *     case 'error':
   *       console.error('Error:', message.error);
   *       break;
   *   }
   * }
   * ```
   *
   * @experimental Use `client.experimental.tasks.requestStream()` to access this method.
   */
  async *requestStream(request, resultSchema, options) {
    const { task } = options ?? {};
    if (!task) {
      try {
        const result = await this.request(request, resultSchema, options);
        yield { type: "result", result };
      } catch (error40) {
        yield {
          type: "error",
          error: error40 instanceof McpError ? error40 : new McpError(ErrorCode.InternalError, String(error40))
        };
      }
      return;
    }
    let taskId;
    try {
      const createResult = await this.request(request, CreateTaskResultSchema, options);
      if (createResult.task) {
        taskId = createResult.task.taskId;
        yield { type: "taskCreated", task: createResult.task };
      } else {
        throw new McpError(ErrorCode.InternalError, "Task creation did not return a task");
      }
      while (true) {
        const task2 = await this.getTask({ taskId }, options);
        yield { type: "taskStatus", task: task2 };
        if (isTerminal(task2.status)) {
          if (task2.status === "completed") {
            const result = await this.getTaskResult({ taskId }, resultSchema, options);
            yield { type: "result", result };
          } else if (task2.status === "failed") {
            yield {
              type: "error",
              error: new McpError(ErrorCode.InternalError, `Task ${taskId} failed`)
            };
          } else if (task2.status === "cancelled") {
            yield {
              type: "error",
              error: new McpError(ErrorCode.InternalError, `Task ${taskId} was cancelled`)
            };
          }
          return;
        }
        if (task2.status === "input_required") {
          const result = await this.getTaskResult({ taskId }, resultSchema, options);
          yield { type: "result", result };
          return;
        }
        const pollInterval = task2.pollInterval ?? this._options?.defaultTaskPollInterval ?? 1e3;
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        options?.signal?.throwIfAborted();
      }
    } catch (error40) {
      yield {
        type: "error",
        error: error40 instanceof McpError ? error40 : new McpError(ErrorCode.InternalError, String(error40))
      };
    }
  }
  /**
   * Sends a request and waits for a response.
   *
   * Do not use this method to emit notifications! Use notification() instead.
   */
  request(request, resultSchema, options) {
    const { relatedRequestId, resumptionToken, onresumptiontoken, task, relatedTask } = options ?? {};
    return new Promise((resolve, reject) => {
      const earlyReject = (error40) => {
        reject(error40);
      };
      if (!this._transport) {
        earlyReject(new Error("Not connected"));
        return;
      }
      if (this._options?.enforceStrictCapabilities === true) {
        try {
          this.assertCapabilityForMethod(request.method);
          if (task) {
            this.assertTaskCapability(request.method);
          }
        } catch (e2) {
          earlyReject(e2);
          return;
        }
      }
      options?.signal?.throwIfAborted();
      const messageId = this._requestMessageId++;
      const jsonrpcRequest = {
        ...request,
        jsonrpc: "2.0",
        id: messageId
      };
      if (options?.onprogress) {
        this._progressHandlers.set(messageId, options.onprogress);
        jsonrpcRequest.params = {
          ...request.params,
          _meta: {
            ...request.params?._meta || {},
            progressToken: messageId
          }
        };
      }
      if (task) {
        jsonrpcRequest.params = {
          ...jsonrpcRequest.params,
          task
        };
      }
      if (relatedTask) {
        jsonrpcRequest.params = {
          ...jsonrpcRequest.params,
          _meta: {
            ...jsonrpcRequest.params?._meta || {},
            [RELATED_TASK_META_KEY]: relatedTask
          }
        };
      }
      const cancel = (reason) => {
        this._responseHandlers.delete(messageId);
        this._progressHandlers.delete(messageId);
        this._cleanupTimeout(messageId);
        this._transport?.send({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: {
            requestId: messageId,
            reason: String(reason)
          }
        }, { relatedRequestId, resumptionToken, onresumptiontoken }).catch((error41) => this._onerror(new Error(`Failed to send cancellation: ${error41}`)));
        const error40 = reason instanceof McpError ? reason : new McpError(ErrorCode.RequestTimeout, String(reason));
        reject(error40);
      };
      this._responseHandlers.set(messageId, (response) => {
        if (options?.signal?.aborted) {
          return;
        }
        if (response instanceof Error) {
          return reject(response);
        }
        try {
          const parseResult = safeParse2(resultSchema, response.result);
          if (!parseResult.success) {
            reject(parseResult.error);
          } else {
            resolve(parseResult.data);
          }
        } catch (error40) {
          reject(error40);
        }
      });
      options?.signal?.addEventListener("abort", () => {
        cancel(options?.signal?.reason);
      });
      const timeout = options?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC;
      const timeoutHandler = () => cancel(McpError.fromError(ErrorCode.RequestTimeout, "Request timed out", { timeout }));
      this._setupTimeout(messageId, timeout, options?.maxTotalTimeout, timeoutHandler, options?.resetTimeoutOnProgress ?? false);
      const relatedTaskId = relatedTask?.taskId;
      if (relatedTaskId) {
        const responseResolver = (response) => {
          const handler = this._responseHandlers.get(messageId);
          if (handler) {
            handler(response);
          } else {
            this._onerror(new Error(`Response handler missing for side-channeled request ${messageId}`));
          }
        };
        this._requestResolvers.set(messageId, responseResolver);
        this._enqueueTaskMessage(relatedTaskId, {
          type: "request",
          message: jsonrpcRequest,
          timestamp: Date.now()
        }).catch((error40) => {
          this._cleanupTimeout(messageId);
          reject(error40);
        });
      } else {
        this._transport.send(jsonrpcRequest, { relatedRequestId, resumptionToken, onresumptiontoken }).catch((error40) => {
          this._cleanupTimeout(messageId);
          reject(error40);
        });
      }
    });
  }
  /**
   * Gets the current status of a task.
   *
   * @experimental Use `client.experimental.tasks.getTask()` to access this method.
   */
  async getTask(params, options) {
    return this.request({ method: "tasks/get", params }, GetTaskResultSchema, options);
  }
  /**
   * Retrieves the result of a completed task.
   *
   * @experimental Use `client.experimental.tasks.getTaskResult()` to access this method.
   */
  async getTaskResult(params, resultSchema, options) {
    return this.request({ method: "tasks/result", params }, resultSchema, options);
  }
  /**
   * Lists tasks, optionally starting from a pagination cursor.
   *
   * @experimental Use `client.experimental.tasks.listTasks()` to access this method.
   */
  async listTasks(params, options) {
    return this.request({ method: "tasks/list", params }, ListTasksResultSchema, options);
  }
  /**
   * Cancels a specific task.
   *
   * @experimental Use `client.experimental.tasks.cancelTask()` to access this method.
   */
  async cancelTask(params, options) {
    return this.request({ method: "tasks/cancel", params }, CancelTaskResultSchema, options);
  }
  /**
   * Emits a notification, which is a one-way message that does not expect a response.
   */
  async notification(notification, options) {
    if (!this._transport) {
      throw new Error("Not connected");
    }
    this.assertNotificationCapability(notification.method);
    const relatedTaskId = options?.relatedTask?.taskId;
    if (relatedTaskId) {
      const jsonrpcNotification2 = {
        ...notification,
        jsonrpc: "2.0",
        params: {
          ...notification.params,
          _meta: {
            ...notification.params?._meta || {},
            [RELATED_TASK_META_KEY]: options.relatedTask
          }
        }
      };
      await this._enqueueTaskMessage(relatedTaskId, {
        type: "notification",
        message: jsonrpcNotification2,
        timestamp: Date.now()
      });
      return;
    }
    const debouncedMethods = this._options?.debouncedNotificationMethods ?? [];
    const canDebounce = debouncedMethods.includes(notification.method) && !notification.params && !options?.relatedRequestId && !options?.relatedTask;
    if (canDebounce) {
      if (this._pendingDebouncedNotifications.has(notification.method)) {
        return;
      }
      this._pendingDebouncedNotifications.add(notification.method);
      Promise.resolve().then(() => {
        this._pendingDebouncedNotifications.delete(notification.method);
        if (!this._transport) {
          return;
        }
        let jsonrpcNotification2 = {
          ...notification,
          jsonrpc: "2.0"
        };
        if (options?.relatedTask) {
          jsonrpcNotification2 = {
            ...jsonrpcNotification2,
            params: {
              ...jsonrpcNotification2.params,
              _meta: {
                ...jsonrpcNotification2.params?._meta || {},
                [RELATED_TASK_META_KEY]: options.relatedTask
              }
            }
          };
        }
        this._transport?.send(jsonrpcNotification2, options).catch((error40) => this._onerror(error40));
      });
      return;
    }
    let jsonrpcNotification = {
      ...notification,
      jsonrpc: "2.0"
    };
    if (options?.relatedTask) {
      jsonrpcNotification = {
        ...jsonrpcNotification,
        params: {
          ...jsonrpcNotification.params,
          _meta: {
            ...jsonrpcNotification.params?._meta || {},
            [RELATED_TASK_META_KEY]: options.relatedTask
          }
        }
      };
    }
    await this._transport.send(jsonrpcNotification, options);
  }
  /**
   * Registers a handler to invoke when this protocol object receives a request with the given method.
   *
   * Note that this will replace any previous request handler for the same method.
   */
  setRequestHandler(requestSchema, handler) {
    const method = getMethodLiteral(requestSchema);
    this.assertRequestHandlerCapability(method);
    this._requestHandlers.set(method, (request, extra) => {
      const parsed = parseWithCompat(requestSchema, request);
      return Promise.resolve(handler(parsed, extra));
    });
  }
  /**
   * Removes the request handler for the given method.
   */
  removeRequestHandler(method) {
    this._requestHandlers.delete(method);
  }
  /**
   * Asserts that a request handler has not already been set for the given method, in preparation for a new one being automatically installed.
   */
  assertCanSetRequestHandler(method) {
    if (this._requestHandlers.has(method)) {
      throw new Error(`A request handler for ${method} already exists, which would be overridden`);
    }
  }
  /**
   * Registers a handler to invoke when this protocol object receives a notification with the given method.
   *
   * Note that this will replace any previous notification handler for the same method.
   */
  setNotificationHandler(notificationSchema, handler) {
    const method = getMethodLiteral(notificationSchema);
    this._notificationHandlers.set(method, (notification) => {
      const parsed = parseWithCompat(notificationSchema, notification);
      return Promise.resolve(handler(parsed));
    });
  }
  /**
   * Removes the notification handler for the given method.
   */
  removeNotificationHandler(method) {
    this._notificationHandlers.delete(method);
  }
  /**
   * Cleans up the progress handler associated with a task.
   * This should be called when a task reaches a terminal status.
   */
  _cleanupTaskProgressHandler(taskId) {
    const progressToken = this._taskProgressTokens.get(taskId);
    if (progressToken !== void 0) {
      this._progressHandlers.delete(progressToken);
      this._taskProgressTokens.delete(taskId);
    }
  }
  /**
   * Enqueues a task-related message for side-channel delivery via tasks/result.
   * @param taskId The task ID to associate the message with
   * @param message The message to enqueue
   * @param sessionId Optional session ID for binding the operation to a specific session
   * @throws Error if taskStore is not configured or if enqueue fails (e.g., queue overflow)
   *
   * Note: If enqueue fails, it's the TaskMessageQueue implementation's responsibility to handle
   * the error appropriately (e.g., by failing the task, logging, etc.). The Protocol layer
   * simply propagates the error.
   */
  async _enqueueTaskMessage(taskId, message, sessionId) {
    if (!this._taskStore || !this._taskMessageQueue) {
      throw new Error("Cannot enqueue task message: taskStore and taskMessageQueue are not configured");
    }
    const maxQueueSize = this._options?.maxTaskQueueSize;
    await this._taskMessageQueue.enqueue(taskId, message, sessionId ?? this._transport?.sessionId, maxQueueSize);
  }
  /**
   * Clears the message queue for a task and rejects any pending request resolvers.
   * @param taskId The task ID whose queue should be cleared
   * @param sessionId Optional session ID for binding the operation to a specific session
   */
  async _clearTaskQueue(taskId, sessionId) {
    if (this._taskMessageQueue) {
      const messages = await this._taskMessageQueue.dequeueAll(taskId, sessionId);
      for (const message of messages) {
        if (message.type === "request" && isJSONRPCRequest(message.message)) {
          const requestId = message.message.id;
          const resolver = this._requestResolvers.get(requestId);
          if (resolver) {
            resolver(new McpError(ErrorCode.InternalError, "Task cancelled or completed"));
            this._requestResolvers.delete(requestId);
          } else {
            this._onerror(new Error(`Resolver missing for request ${requestId} during task ${taskId} cleanup`));
          }
        }
      }
    }
  }
  /**
   * Waits for a task update (new messages or status change) with abort signal support.
   * Uses polling to check for updates at the task's configured poll interval.
   * @param taskId The task ID to wait for
   * @param signal Abort signal to cancel the wait
   * @param sessionId Session of the request that waits, passed to the task store
   * @returns Promise that resolves when an update occurs or rejects if aborted
   */
  async _waitForTaskUpdate(taskId, signal, sessionId) {
    let interval = this._options?.defaultTaskPollInterval ?? 1e3;
    try {
      const task = await this._taskStore?.getTask(taskId, sessionId);
      if (task?.pollInterval) {
        interval = task.pollInterval;
      }
    } catch {
    }
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new McpError(ErrorCode.InvalidRequest, "Request cancelled"));
        return;
      }
      const timeoutId = setTimeout(resolve, interval);
      signal.addEventListener("abort", () => {
        clearTimeout(timeoutId);
        reject(new McpError(ErrorCode.InvalidRequest, "Request cancelled"));
      }, { once: true });
    });
  }
  requestTaskStore(request, sessionId) {
    const taskStore = this._taskStore;
    if (!taskStore) {
      throw new Error("No task store configured");
    }
    return {
      createTask: async (taskParams) => {
        if (!request) {
          throw new Error("No request provided");
        }
        return await taskStore.createTask(taskParams, request.id, {
          method: request.method,
          params: request.params
        }, sessionId);
      },
      getTask: async (taskId) => {
        const task = await taskStore.getTask(taskId, sessionId);
        if (!task) {
          throw new McpError(ErrorCode.InvalidParams, "Failed to retrieve task: Task not found");
        }
        return task;
      },
      storeTaskResult: async (taskId, status, result) => {
        await taskStore.storeTaskResult(taskId, status, result, sessionId);
        const task = await taskStore.getTask(taskId, sessionId);
        if (task) {
          const notification = TaskStatusNotificationSchema.parse({
            method: "notifications/tasks/status",
            params: task
          });
          await this.notification(notification);
          if (isTerminal(task.status)) {
            this._cleanupTaskProgressHandler(taskId);
          }
        }
      },
      getTaskResult: (taskId) => {
        return taskStore.getTaskResult(taskId, sessionId);
      },
      updateTaskStatus: async (taskId, status, statusMessage) => {
        const task = await taskStore.getTask(taskId, sessionId);
        if (!task) {
          throw new McpError(ErrorCode.InvalidParams, `Task "${taskId}" not found - it may have been cleaned up`);
        }
        if (isTerminal(task.status)) {
          throw new McpError(ErrorCode.InvalidParams, `Cannot update task "${taskId}" from terminal status "${task.status}" to "${status}". Terminal states (completed, failed, cancelled) cannot transition to other states.`);
        }
        await taskStore.updateTaskStatus(taskId, status, statusMessage, sessionId);
        const updatedTask = await taskStore.getTask(taskId, sessionId);
        if (updatedTask) {
          const notification = TaskStatusNotificationSchema.parse({
            method: "notifications/tasks/status",
            params: updatedTask
          });
          await this.notification(notification);
          if (isTerminal(updatedTask.status)) {
            this._cleanupTaskProgressHandler(taskId);
          }
        }
      },
      listTasks: (cursor) => {
        return taskStore.listTasks(cursor, sessionId);
      }
    };
  }
};
function isPlainObject2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function mergeCapabilities(base, additional) {
  const result = { ...base };
  for (const key in additional) {
    const k2 = key;
    const addValue = additional[k2];
    if (addValue === void 0)
      continue;
    const baseValue = result[k2];
    if (isPlainObject2(baseValue) && isPlainObject2(addValue)) {
      result[k2] = { ...baseValue, ...addValue };
    } else {
      result[k2] = addValue;
    }
  }
  return result;
}

// ../../../../tua-plugin/node_modules/@modelcontextprotocol/ext-apps/dist/src/app.js
init_v4();
init_v4();
var p = ((X) => typeof __require < "u" ? __require : typeof Proxy < "u" ? new Proxy(X, { get: (Y, Z) => (typeof __require < "u" ? __require : Y)[Z] }) : X)(function(X) {
  if (typeof __require < "u") return __require.apply(this, arguments);
  throw Error('Dynamic require of "' + X + '" is not supported');
});
var _ = class extends Protocol {
  _registeredMethods = /* @__PURE__ */ new Set();
  _eventSlots = /* @__PURE__ */ new Map();
  onEventDispatch(X, Y) {
  }
  _ensureEventSlot(X) {
    let Y = this._eventSlots.get(X);
    if (!Y) {
      let Z = this.eventSchemas[X];
      if (!Z) throw Error(`Unknown event: ${String(X)}`);
      Y = { listeners: [] }, this._eventSlots.set(X, Y);
      let $ = Z.shape.method.value;
      this._registeredMethods.add($);
      let D = Y;
      super.setNotificationHandler(Z, (J) => {
        let K = J.params;
        this.onEventDispatch(X, K), D.onHandler?.(K);
        for (let G of [...D.listeners]) G(K);
      });
    }
    return Y;
  }
  setEventHandler(X, Y) {
    let Z = this._ensureEventSlot(X);
    if (Z.onHandler && Y) console.warn(`[MCP Apps] on${String(X)} handler replaced. Use addEventListener("${String(X)}", \u2026) to add multiple listeners without replacing.`);
    Z.onHandler = Y;
  }
  getEventHandler(X) {
    return this._eventSlots.get(X)?.onHandler;
  }
  addEventListener(X, Y) {
    this._ensureEventSlot(X).listeners.push(Y);
  }
  removeEventListener(X, Y) {
    let Z = this._eventSlots.get(X);
    if (!Z) return;
    let $ = Z.listeners.indexOf(Y);
    if ($ !== -1) Z.listeners.splice($, 1);
  }
  setRequestHandler = (X, Y) => {
    this._assertMethodNotRegistered(X, "setRequestHandler"), super.setRequestHandler(X, Y);
  };
  setNotificationHandler = (X, Y) => {
    this._assertMethodNotRegistered(X, "setNotificationHandler"), super.setNotificationHandler(X, Y);
  };
  warnIfRequestHandlerReplaced(X, Y, Z) {
    if (Y && Z) console.warn(`[MCP Apps] ${X} handler replaced. Previous handler will no longer be called.`);
  }
  replaceRequestHandler = (X, Y) => {
    let Z = X.shape.method.value;
    this._registeredMethods.add(Z), super.setRequestHandler(X, Y);
  };
  _assertMethodNotRegistered(X, Y) {
    let Z = X.shape.method.value;
    if (this._registeredMethods.has(Z)) throw Error(`Handler for "${Z}" already registered (via ${Y}). Use addEventListener() to attach multiple listeners, or the on* setter for replace semantics.`);
    this._registeredMethods.add(Z);
  }
};
var E = "2026-01-26";
var l = "ui/open-link";
var r = "ui/download-file";
var n = "ui/message";
var a = "ui/notifications/sandbox-proxy-ready";
var o = "ui/notifications/sandbox-resource-ready";
var s = "ui/notifications/size-changed";
var t = "ui/notifications/tool-input";
var O = "ui/notifications/tool-input-partial";
var e = "ui/notifications/tool-result";
var QQ = "ui/notifications/tool-cancelled";
var XQ = "ui/notifications/host-context-changed";
var YQ = "ui/notifications/request-teardown";
var ZQ = "ui/resource-teardown";
var $Q = "ui/initialize";
var DQ = "ui/notifications/initialized";
var JQ = "ui/request-display-mode";
var j = class {
  eventTarget;
  eventSource;
  messageListener;
  constructor(X = window.parent, Y) {
    this.eventTarget = X;
    this.eventSource = Y;
    this.messageListener = (Z) => {
      if (Y && Z.source !== this.eventSource) {
        console.debug("Ignoring message from unknown source", Z);
        return;
      }
      let $ = JSONRPCMessageSchema.safeParse(Z.data);
      if ($.success) console.debug("Parsed message", $.data), this.onmessage?.($.data);
      else if (Z.data?.jsonrpc !== "2.0") console.debug("Ignoring non-JSON-RPC message", $.error.message, Z);
      else console.error("Failed to parse message", $.error.message, Z), this.onerror?.(Error("Invalid JSON-RPC message received: " + $.error.message));
    };
  }
  async start() {
    window.addEventListener("message", this.messageListener);
  }
  async send(X, Y) {
    if (X.method !== O) console.debug("Sending message", X);
    this.eventTarget.postMessage(X, "*");
  }
  async close() {
    window.removeEventListener("message", this.messageListener), this.onclose?.();
  }
  onclose;
  onerror;
  onmessage;
  sessionId;
  setProtocolVersion;
};
var g = external_exports.union([external_exports.literal("light"), external_exports.literal("dark")]).describe("Color theme preference for the host environment.");
var W = external_exports.union([external_exports.literal("inline"), external_exports.literal("fullscreen"), external_exports.literal("pip")]).describe("Display mode for UI presentation.");
var LQ = external_exports.union([external_exports.literal("--color-background-primary"), external_exports.literal("--color-background-secondary"), external_exports.literal("--color-background-tertiary"), external_exports.literal("--color-background-inverse"), external_exports.literal("--color-background-ghost"), external_exports.literal("--color-background-info"), external_exports.literal("--color-background-danger"), external_exports.literal("--color-background-success"), external_exports.literal("--color-background-warning"), external_exports.literal("--color-background-disabled"), external_exports.literal("--color-text-primary"), external_exports.literal("--color-text-secondary"), external_exports.literal("--color-text-tertiary"), external_exports.literal("--color-text-inverse"), external_exports.literal("--color-text-ghost"), external_exports.literal("--color-text-info"), external_exports.literal("--color-text-danger"), external_exports.literal("--color-text-success"), external_exports.literal("--color-text-warning"), external_exports.literal("--color-text-disabled"), external_exports.literal("--color-border-primary"), external_exports.literal("--color-border-secondary"), external_exports.literal("--color-border-tertiary"), external_exports.literal("--color-border-inverse"), external_exports.literal("--color-border-ghost"), external_exports.literal("--color-border-info"), external_exports.literal("--color-border-danger"), external_exports.literal("--color-border-success"), external_exports.literal("--color-border-warning"), external_exports.literal("--color-border-disabled"), external_exports.literal("--color-ring-primary"), external_exports.literal("--color-ring-secondary"), external_exports.literal("--color-ring-inverse"), external_exports.literal("--color-ring-info"), external_exports.literal("--color-ring-danger"), external_exports.literal("--color-ring-success"), external_exports.literal("--color-ring-warning"), external_exports.literal("--font-sans"), external_exports.literal("--font-mono"), external_exports.literal("--font-weight-normal"), external_exports.literal("--font-weight-medium"), external_exports.literal("--font-weight-semibold"), external_exports.literal("--font-weight-bold"), external_exports.literal("--font-text-xs-size"), external_exports.literal("--font-text-sm-size"), external_exports.literal("--font-text-md-size"), external_exports.literal("--font-text-lg-size"), external_exports.literal("--font-heading-xs-size"), external_exports.literal("--font-heading-sm-size"), external_exports.literal("--font-heading-md-size"), external_exports.literal("--font-heading-lg-size"), external_exports.literal("--font-heading-xl-size"), external_exports.literal("--font-heading-2xl-size"), external_exports.literal("--font-heading-3xl-size"), external_exports.literal("--font-text-xs-line-height"), external_exports.literal("--font-text-sm-line-height"), external_exports.literal("--font-text-md-line-height"), external_exports.literal("--font-text-lg-line-height"), external_exports.literal("--font-heading-xs-line-height"), external_exports.literal("--font-heading-sm-line-height"), external_exports.literal("--font-heading-md-line-height"), external_exports.literal("--font-heading-lg-line-height"), external_exports.literal("--font-heading-xl-line-height"), external_exports.literal("--font-heading-2xl-line-height"), external_exports.literal("--font-heading-3xl-line-height"), external_exports.literal("--border-radius-xs"), external_exports.literal("--border-radius-sm"), external_exports.literal("--border-radius-md"), external_exports.literal("--border-radius-lg"), external_exports.literal("--border-radius-xl"), external_exports.literal("--border-radius-full"), external_exports.literal("--border-width-regular"), external_exports.literal("--shadow-hairline"), external_exports.literal("--shadow-sm"), external_exports.literal("--shadow-md"), external_exports.literal("--shadow-lg")]).describe("CSS variable keys available to MCP apps for theming.");
var BQ = external_exports.record(LQ.describe(`Style variables for theming MCP apps.

Individual style keys are optional - hosts may provide any subset of these values.
Values are strings containing CSS values (colors, sizes, font stacks, etc.).

Note: This type uses \`Record<K, string | undefined>\` rather than \`Partial<Record<K, string>>\`
for compatibility with Zod schema generation. Both are functionally equivalent for validation.`), external_exports.union([external_exports.string(), external_exports.undefined()]).describe(`Style variables for theming MCP apps.

Individual style keys are optional - hosts may provide any subset of these values.
Values are strings containing CSS values (colors, sizes, font stacks, etc.).

Note: This type uses \`Record<K, string | undefined>\` rather than \`Partial<Record<K, string>>\`
for compatibility with Zod schema generation. Both are functionally equivalent for validation.`)).describe(`Style variables for theming MCP apps.

Individual style keys are optional - hosts may provide any subset of these values.
Values are strings containing CSS values (colors, sizes, font stacks, etc.).

Note: This type uses \`Record<K, string | undefined>\` rather than \`Partial<Record<K, string>>\`
for compatibility with Zod schema generation. Both are functionally equivalent for validation.`);
var _Q = external_exports.object({ method: external_exports.literal("ui/open-link"), params: external_exports.object({ url: external_exports.string().describe("URL to open in the host's browser") }) });
var I = external_exports.object({ isError: external_exports.boolean().optional().describe("True if the host failed to open the URL (e.g., due to security policy).") }).passthrough();
var F = external_exports.object({ isError: external_exports.boolean().optional().describe("True if the download failed (e.g., user cancelled or host denied).") }).passthrough();
var q = external_exports.object({ isError: external_exports.boolean().optional().describe("True if the host rejected or failed to deliver the message.") }).passthrough();
var EQ = external_exports.object({ method: external_exports.literal("ui/notifications/sandbox-proxy-ready"), params: external_exports.object({}) });
var L = external_exports.object({ connectDomains: external_exports.array(external_exports.string()).optional().describe(`Origins for network requests (fetch/XHR/WebSocket).

- Maps to CSP \`connect-src\` directive
- Empty or omitted \u2192 no network connections (secure default)`), resourceDomains: external_exports.array(external_exports.string()).optional().describe("Origins for static resources (images, scripts, stylesheets, fonts, media).\n\n- Maps to CSP `img-src`, `script-src`, `style-src`, `font-src`, `media-src` directives\n- Wildcard subdomains supported: `https://*.example.com`\n- Empty or omitted \u2192 no network resources (secure default)"), frameDomains: external_exports.array(external_exports.string()).optional().describe("Origins for nested iframes.\n\n- Maps to CSP `frame-src` directive\n- Empty or omitted \u2192 no nested iframes allowed (`frame-src 'none'`)"), baseUriDomains: external_exports.array(external_exports.string()).optional().describe("Allowed base URIs for the document.\n\n- Maps to CSP `base-uri` directive\n- Empty or omitted \u2192 only same origin allowed (`base-uri 'self'`)") });
var B = external_exports.object({ camera: external_exports.object({}).optional().describe("Request camera access.\n\nMaps to Permission Policy `camera` feature."), microphone: external_exports.object({}).optional().describe("Request microphone access.\n\nMaps to Permission Policy `microphone` feature."), geolocation: external_exports.object({}).optional().describe("Request geolocation access.\n\nMaps to Permission Policy `geolocation` feature."), clipboardWrite: external_exports.object({}).optional().describe("Request clipboard write access.\n\nMaps to Permission Policy `clipboard-write` feature.") });
var OQ = external_exports.object({ method: external_exports.literal("ui/notifications/size-changed"), params: external_exports.object({ width: external_exports.number().optional().describe("New width in pixels."), height: external_exports.number().optional().describe("New height in pixels.") }) });
var P = external_exports.object({ method: external_exports.literal("ui/notifications/tool-input"), params: external_exports.object({ arguments: external_exports.record(external_exports.string(), external_exports.unknown().describe("Complete tool call arguments as key-value pairs.")).optional().describe("Complete tool call arguments as key-value pairs.") }) });
var w = external_exports.object({ method: external_exports.literal("ui/notifications/tool-input-partial"), params: external_exports.object({ arguments: external_exports.record(external_exports.string(), external_exports.unknown().describe("Partial tool call arguments (incomplete, may change).")).optional().describe("Partial tool call arguments (incomplete, may change).") }) });
var A = external_exports.object({ method: external_exports.literal("ui/notifications/tool-cancelled"), params: external_exports.object({ reason: external_exports.string().optional().describe('Optional reason for the cancellation (e.g., "user action", "timeout").') }) });
var v = external_exports.object({ fonts: external_exports.string().optional() });
var f = external_exports.object({ variables: BQ.optional().describe("CSS variables for theming the app."), css: v.optional().describe("CSS blocks that apps can inject.") });
var R = external_exports.object({ method: external_exports.literal("ui/resource-teardown"), params: external_exports.object({}) });
var zQ = external_exports.record(external_exports.string(), external_exports.unknown());
var z = external_exports.object({ text: external_exports.object({}).optional().describe("Host supports text content blocks."), image: external_exports.object({}).optional().describe("Host supports image content blocks."), audio: external_exports.object({}).optional().describe("Host supports audio content blocks."), resource: external_exports.object({}).optional().describe("Host supports resource content blocks."), resourceLink: external_exports.object({}).optional().describe("Host supports resource link content blocks."), structuredContent: external_exports.object({}).optional().describe("Host supports structured content.") });
var IQ = external_exports.object({ method: external_exports.literal("ui/notifications/request-teardown"), params: external_exports.object({}).optional() });
var u = external_exports.object({ experimental: external_exports.record(external_exports.string(), external_exports.record(external_exports.string(), external_exports.any()).describe("Experimental features keyed by identifier.")).optional().describe("Experimental features keyed by identifier."), openLinks: external_exports.object({}).optional().describe("Host supports opening external URLs."), downloadFile: external_exports.object({}).optional().describe("Host supports file downloads via ui/download-file."), serverTools: external_exports.object({ listChanged: external_exports.boolean().optional().describe("Host supports tools/list_changed notifications.") }).optional().describe("Host can proxy tool calls to the MCP server."), serverResources: external_exports.object({ listChanged: external_exports.boolean().optional().describe("Host supports resources/list_changed notifications.") }).optional().describe("Host can proxy resource reads to the MCP server."), logging: external_exports.object({}).optional().describe("Host accepts log messages."), sandbox: external_exports.object({ permissions: B.optional().describe("Permissions granted by the host (camera, microphone, geolocation)."), csp: L.optional().describe("CSP domains approved by the host.") }).optional().describe("Sandbox configuration applied by the host."), updateModelContext: z.optional().describe("Host accepts context updates (ui/update-model-context) to be included in the model's context for future turns."), message: z.optional().describe("Host supports receiving content messages (ui/message) from the view."), sampling: external_exports.object({ tools: external_exports.object({}).optional().describe("Host supports tool use via `tools` and `toolChoice` parameters.") }).optional().describe("Host supports LLM sampling (sampling/createMessage) from the view.\nMirrors the MCP `ClientCapabilities.sampling` shape so hosts can pass it through.") });
var d = external_exports.object({ experimental: external_exports.record(external_exports.string(), external_exports.record(external_exports.string(), external_exports.any()).describe("Experimental features keyed by identifier.")).optional().describe("Experimental features keyed by identifier."), tools: external_exports.object({ listChanged: external_exports.boolean().optional().describe("App supports tools/list_changed notifications.") }).optional().describe("App exposes MCP-style tools that the host can call."), availableDisplayModes: external_exports.array(W).optional().describe("Display modes the app supports.") });
var FQ = external_exports.object({ method: external_exports.literal("ui/notifications/initialized"), params: external_exports.object({}).optional() });
var qQ = external_exports.object({ csp: L.optional().describe("Content Security Policy configuration for UI resources."), permissions: B.optional().describe("Sandbox permissions requested by the UI resource."), domain: external_exports.string().optional().describe(`Dedicated origin for view sandbox.

Useful when views need stable, dedicated origins for OAuth callbacks, CORS policies, or API key allowlists.

**Host-dependent:** The format and validation rules for this field are determined by each host. Servers MUST consult host-specific documentation for the expected domain format. Common patterns include:
- Hash-based subdomains (e.g., \`{hash}.claudemcpcontent.com\`)
- URL-derived subdomains (e.g., \`www-example-com.oaiusercontent.com\`)

If omitted, host uses default sandbox origin (typically per-conversation).`), prefersBorder: external_exports.boolean().optional().describe(`Visual boundary preference - true if view prefers a visible border.

Boolean requesting whether a visible border and background is provided by the host. Specifying an explicit value for this is recommended because hosts' defaults may vary.

- \`true\`: request visible border + background
- \`false\`: request no visible border + background
- omitted: host decides border`) });
var PQ = external_exports.object({ method: external_exports.literal("ui/request-display-mode"), params: external_exports.object({ mode: W.describe("The display mode being requested.") }) });
var U = external_exports.object({ mode: W.describe("The display mode that was actually set. May differ from requested if not supported.") }).passthrough();
var h = external_exports.union([external_exports.literal("model"), external_exports.literal("app")]).describe("Tool visibility scope - who can access the tool.");
var wQ = external_exports.object({ resourceUri: external_exports.string().optional(), visibility: external_exports.array(h).optional().describe(`Who can access this tool. Default: ["model", "app"]
- "model": Tool visible to and callable by the agent
- "app": Tool callable by the app from this server only`), csp: external_exports.never().optional(), permissions: external_exports.never().optional() });
var YX = external_exports.object({ mimeTypes: external_exports.array(external_exports.string()).optional().describe('Array of supported MIME types for UI resources.\nMust include `"text/html;profile=mcp-app"` for MCP Apps support.') });
var AQ = external_exports.object({ method: external_exports.literal("ui/download-file"), params: external_exports.object({ contents: external_exports.array(external_exports.union([EmbeddedResourceSchema, ResourceLinkSchema])).describe("Resource contents to download \u2014 embedded (inline data) or linked (host fetches). Uses standard MCP resource types.") }) });
var RQ = external_exports.object({ method: external_exports.literal("ui/message"), params: external_exports.object({ role: external_exports.literal("user").describe('Message role, currently only "user" is supported.'), content: external_exports.array(ContentBlockSchema).describe("Message content blocks (text, image, etc.).") }) });
var UQ = external_exports.object({ method: external_exports.literal("ui/notifications/sandbox-resource-ready"), params: external_exports.object({ html: external_exports.string().describe("HTML content to load into the inner iframe."), sandbox: external_exports.string().optional().describe("Optional override for the inner iframe's sandbox attribute."), csp: L.optional().describe("CSP configuration from resource metadata."), permissions: B.optional().describe("Sandbox permissions from resource metadata.") }) });
var H = external_exports.object({ method: external_exports.literal("ui/notifications/tool-result"), params: CallToolResultSchema.describe("Standard MCP tool execution result.") });
var T = external_exports.object({ toolInfo: external_exports.object({ id: RequestIdSchema.optional().describe("JSON-RPC id of the tools/call request."), tool: ToolSchema.describe("Tool definition including name, inputSchema, etc.") }).optional().describe("Metadata of the tool call that instantiated this App."), theme: g.optional().describe("Current color theme preference."), styles: f.optional().describe("Style configuration for theming the app."), displayMode: W.optional().describe("How the UI is currently displayed."), availableDisplayModes: external_exports.array(W).optional().describe("Display modes the host supports."), containerDimensions: external_exports.union([external_exports.object({ height: external_exports.number().describe("Fixed container height in pixels.") }), external_exports.object({ maxHeight: external_exports.union([external_exports.number(), external_exports.undefined()]).optional().describe("Maximum container height in pixels.") })]).and(external_exports.union([external_exports.object({ width: external_exports.number().describe("Fixed container width in pixels.") }), external_exports.object({ maxWidth: external_exports.union([external_exports.number(), external_exports.undefined()]).optional().describe("Maximum container width in pixels.") })])).optional().describe(`Container dimensions. Represents the dimensions of the iframe or other
container holding the app. Specify either width or maxWidth, and either height or maxHeight.`), locale: external_exports.string().optional().describe("User's language and region preference in BCP 47 format."), timeZone: external_exports.string().optional().describe("User's timezone in IANA format."), userAgent: external_exports.string().optional().describe("Host application identifier."), platform: external_exports.union([external_exports.literal("web"), external_exports.literal("desktop"), external_exports.literal("mobile")]).optional().describe("Platform type for responsive design decisions."), deviceCapabilities: external_exports.object({ touch: external_exports.boolean().optional().describe("Whether the device supports touch input."), hover: external_exports.boolean().optional().describe("Whether the device supports hover interactions.") }).optional().describe("Device input capabilities."), safeAreaInsets: external_exports.object({ top: external_exports.number().describe("Top safe area inset in pixels."), right: external_exports.number().describe("Right safe area inset in pixels."), bottom: external_exports.number().describe("Bottom safe area inset in pixels."), left: external_exports.number().describe("Left safe area inset in pixels.") }).optional().describe("Mobile safe area boundaries in pixels.") }).passthrough();
var M = external_exports.object({ method: external_exports.literal("ui/notifications/host-context-changed"), params: T.describe("Partial context update containing only changed fields.") });
var HQ = external_exports.object({ method: external_exports.literal("ui/update-model-context"), params: external_exports.object({ content: external_exports.array(ContentBlockSchema).optional().describe("Context content blocks (text, image, etc.)."), structuredContent: external_exports.record(external_exports.string(), external_exports.unknown().describe("Structured content for machine-readable context data.")).optional().describe("Structured content for machine-readable context data.") }) });
var TQ = external_exports.object({ method: external_exports.literal("ui/initialize"), params: external_exports.object({ appInfo: ImplementationSchema.describe("App identification (name and version)."), appCapabilities: d.describe("Features and capabilities this app provides."), protocolVersion: external_exports.string().describe("Protocol version this app supports.") }) });
var C = external_exports.object({ protocolVersion: external_exports.string().describe('Negotiated protocol version string (e.g., "2025-11-21").'), hostInfo: ImplementationSchema.describe("Host application identification and version."), hostCapabilities: u.describe("Features and capabilities provided by the host."), hostContext: T.describe("Rich context about the host environment.") }).passthrough();
var MQ = { target: "draft-2020-12" };
async function k(X, Y) {
  let Z = X["~standard"];
  if (Z.jsonSchema) return Z.jsonSchema[Y](MQ);
  if (Z.vendor === "zod") {
    let { z: $ } = await Promise.resolve().then(() => (init_v4(), v4_exports));
    return $.toJSONSchema(X, { io: Y });
  }
  throw Error(`Schema (vendor: ${Z.vendor}) does not implement Standard JSON Schema (~standard.jsonSchema). Use a library that does (zod v4, ArkType, Valibot) or wrap your schema accordingly.`);
}
async function b(X, Y, Z = "") {
  let $ = await X["~standard"].validate(Y);
  if ($.issues) {
    let D = $.issues.map((J) => {
      let K = J.path?.map((G) => typeof G === "object" ? G.key : G).join(".");
      return K ? `${K}: ${J.message}` : J.message;
    }).join("; ");
    throw Error(Z + D);
  }
  return $.value;
}
function CQ() {
  let X = document.documentElement.getAttribute("data-theme");
  if (X === "dark" || X === "light") return X;
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
function kQ(X) {
  let Y = document.documentElement;
  Y.setAttribute("data-theme", X), Y.style.colorScheme = X;
}
function bQ(X, Y = document.documentElement) {
  for (let [Z, $] of Object.entries(X)) if ($ !== void 0) Y.style.setProperty(Z, $);
}
function SQ(X) {
  if (document.getElementById("__mcp-host-fonts")) return;
  let Z = document.createElement("style");
  Z.id = "__mcp-host-fonts", Z.textContent = X, document.head.appendChild(Z);
}
var eX = "ui/resourceUri";
var QY = "text/html;profile=mcp-app";
var i = class _i extends _ {
  _appInfo;
  _capabilities;
  options;
  _hostCapabilities;
  _hostInfo;
  _hostContext;
  _registeredTools = {};
  _initializedSent = false;
  _assertInitialized(X) {
    if (this._initializedSent) return;
    let Y = `[ext-apps] App.${X}() called before connect() completed the ui/initialize handshake. Await app.connect() before calling this method, or move data loading to an ontoolresult handler.`;
    if (this.options?.strict) throw Error(Y);
    console.warn(`${Y}. This will throw in a future release.`);
  }
  eventSchemas = { toolinput: P, toolinputpartial: w, toolresult: H, toolcancelled: A, hostcontextchanged: M };
  static ONE_SHOT_EVENTS = /* @__PURE__ */ new Set(["toolinput", "toolinputpartial", "toolresult", "toolcancelled"]);
  _everHadListener = /* @__PURE__ */ new Set();
  _assertHandlerTiming(X) {
    if (!_i.ONE_SHOT_EVENTS.has(X) || this._everHadListener.has(X)) return;
    if (this._everHadListener.add(X), !this._initializedSent) return;
    let Y = `[ext-apps] "${String(X)}" handler registered after connect() completed the ui/initialize handshake. The host may have already sent this notification. Register handlers before calling app.connect().`;
    if (this.options?.strict) throw Error(Y);
    console.warn(Y);
  }
  setEventHandler(X, Y) {
    if (Y) this._assertHandlerTiming(X);
    super.setEventHandler(X, Y);
  }
  addEventListener(X, Y) {
    this._assertHandlerTiming(X), super.addEventListener(X, Y);
  }
  onEventDispatch(X, Y) {
    if (X === "hostcontextchanged") this._hostContext = { ...this._hostContext, ...Y };
  }
  constructor(X, Y = {}, Z = { autoResize: true }) {
    super(Z);
    this._appInfo = X;
    this._capabilities = Y;
    this.options = Z;
    if (!Z.allowUnsafeEval) external_exports.config({ jitless: true });
    this.setRequestHandler(PingRequestSchema, ($) => {
      return console.log("Received ping:", $.params), {};
    }), this.setEventHandler("hostcontextchanged", void 0);
  }
  registerCapabilities(X) {
    if (this.transport) throw Error("Cannot register capabilities after transport is established");
    this._capabilities = mergeCapabilities(this._capabilities, X);
  }
  registerTool(X, Y, Z) {
    if (this._registeredTools[X]) throw Error(`Tool ${X} is already registered`);
    let $ = this, D = () => {
      if ($._initializedSent && $._capabilities.tools?.listChanged) $.sendToolListChanged();
    }, J = Y.inputSchema !== void 0, K = { title: Y.title, description: Y.description, inputSchema: Y.inputSchema, outputSchema: Y.outputSchema, annotations: Y.annotations, _meta: Y._meta, enabled: true, enable() {
      this.enabled = true, D();
    }, disable() {
      this.enabled = false, D();
    }, update(G) {
      Object.assign(this, G), D();
    }, remove() {
      if ($._registeredTools[X] !== K) return;
      delete $._registeredTools[X], D();
    }, handler: async (G, N) => {
      if (!K.enabled) throw Error(`Tool ${X} is disabled`);
      let V;
      if (J) {
        let S = K.inputSchema, m = S ? await b(S, G ?? {}, `Invalid input for tool ${X}: `) : G ?? {};
        V = await Z(m, N);
      } else V = await Z(N);
      if (K.outputSchema && !V.isError) V.structuredContent = await b(K.outputSchema, V.structuredContent, `Invalid output for tool ${X}: `);
      return V;
    } };
    if (this._registeredTools[X] = K, !this._capabilities.tools && !this.transport) this.registerCapabilities({ tools: { listChanged: true } });
    return this.ensureToolHandlersInitialized(), D(), K;
  }
  _toolHandlersInitialized = false;
  ensureToolHandlersInitialized() {
    if (this._toolHandlersInitialized) return;
    this._toolHandlersInitialized = true, this.oncalltool = async (X, Y) => {
      let Z = this._registeredTools[X.name];
      if (!Z) throw Error(`Tool ${X.name} not found`);
      return Z.handler(X.arguments, Y);
    }, this.onlisttools = async (X, Y) => {
      return { tools: await Promise.all(Object.entries(this._registeredTools).filter(([$, D]) => D.enabled).map(async ([$, D]) => {
        let J = { name: $, title: D.title, description: D.description, inputSchema: D.inputSchema ? await k(D.inputSchema, "input") : { type: "object", properties: {} } };
        if (D.outputSchema) J.outputSchema = await k(D.outputSchema, "output");
        if (D.annotations) J.annotations = D.annotations;
        if (D._meta) J._meta = D._meta;
        return J;
      })) };
    };
  }
  async sendToolListChanged(X = {}) {
    this._assertInitialized("sendToolListChanged"), await this.notification({ method: "notifications/tools/list_changed", params: X });
  }
  getHostCapabilities() {
    return this._hostCapabilities;
  }
  getHostVersion() {
    return this._hostInfo;
  }
  getHostContext() {
    return this._hostContext;
  }
  get ontoolinput() {
    return this.getEventHandler("toolinput");
  }
  set ontoolinput(X) {
    this.setEventHandler("toolinput", X);
  }
  get ontoolinputpartial() {
    return this.getEventHandler("toolinputpartial");
  }
  set ontoolinputpartial(X) {
    this.setEventHandler("toolinputpartial", X);
  }
  get ontoolresult() {
    return this.getEventHandler("toolresult");
  }
  set ontoolresult(X) {
    this.setEventHandler("toolresult", X);
  }
  get ontoolcancelled() {
    return this.getEventHandler("toolcancelled");
  }
  set ontoolcancelled(X) {
    this.setEventHandler("toolcancelled", X);
  }
  get onhostcontextchanged() {
    return this.getEventHandler("hostcontextchanged");
  }
  set onhostcontextchanged(X) {
    this.setEventHandler("hostcontextchanged", X);
  }
  _onteardown;
  get onteardown() {
    return this._onteardown;
  }
  set onteardown(X) {
    this.warnIfRequestHandlerReplaced("onteardown", this._onteardown, X), this._onteardown = X, this.replaceRequestHandler(R, (Y, Z) => {
      if (!this._onteardown) throw Error("No onteardown handler set");
      return this._onteardown(Y.params, Z);
    });
  }
  _oncalltool;
  get oncalltool() {
    return this._oncalltool;
  }
  set oncalltool(X) {
    this.warnIfRequestHandlerReplaced("oncalltool", this._oncalltool, X), this._oncalltool = X, this.replaceRequestHandler(CallToolRequestSchema, (Y, Z) => {
      if (!this._oncalltool) throw Error("No oncalltool handler set");
      return this._oncalltool(Y.params, Z);
    });
  }
  _onlisttools;
  get onlisttools() {
    return this._onlisttools;
  }
  set onlisttools(X) {
    this.warnIfRequestHandlerReplaced("onlisttools", this._onlisttools, X), this._onlisttools = X, this.replaceRequestHandler(ListToolsRequestSchema, (Y, Z) => {
      if (!this._onlisttools) throw Error("No onlisttools handler set");
      return this._onlisttools(Y.params, Z);
    });
  }
  assertCapabilityForMethod(X) {
    switch (X) {
      case "sampling/createMessage":
        if (!this._hostCapabilities?.sampling) throw Error(`Host does not support sampling (required for ${X})`);
        break;
    }
  }
  assertRequestHandlerCapability(X) {
    switch (X) {
      case "tools/call":
      case "tools/list":
        if (!this._capabilities.tools) throw Error(`Client does not support tool capability (required for ${X})`);
        return;
      case "ping":
      case "ui/resource-teardown":
        return;
      default:
        throw Error(`No handler for method ${X} registered`);
    }
  }
  assertNotificationCapability(X) {
  }
  assertTaskCapability(X) {
    throw Error("Tasks are not supported in MCP Apps");
  }
  assertTaskHandlerCapability(X) {
    throw Error("Task handlers are not supported in MCP Apps");
  }
  async callServerTool(X, Y) {
    if (this._assertInitialized("callServerTool"), typeof X === "string") throw Error(`callServerTool() expects an object as its first argument, but received a string ("${X}"). Did you mean: callServerTool({ name: "${X}", arguments: { ... } })?`);
    return await this.request({ method: "tools/call", params: X }, CallToolResultSchema, { onprogress: () => {
    }, resetTimeoutOnProgress: true, ...Y });
  }
  async readServerResource(X, Y) {
    return this._assertInitialized("readServerResource"), await this.request({ method: "resources/read", params: X }, ReadResourceResultSchema, Y);
  }
  async listServerResources(X, Y) {
    return this._assertInitialized("listServerResources"), await this.request({ method: "resources/list", params: X }, ListResourcesResultSchema, Y);
  }
  async createSamplingMessage(X, Y) {
    this._assertInitialized("createSamplingMessage");
    let Z = X.tools ? CreateMessageResultWithToolsSchema : CreateMessageResultSchema;
    return await this.request({ method: "sampling/createMessage", params: X }, Z, Y);
  }
  sendMessage(X, Y) {
    return this._assertInitialized("sendMessage"), this.request({ method: "ui/message", params: X }, q, Y);
  }
  sendLog(X) {
    return this.notification({ method: "notifications/message", params: X });
  }
  updateModelContext(X, Y) {
    return this._assertInitialized("updateModelContext"), this.request({ method: "ui/update-model-context", params: X }, EmptyResultSchema, Y);
  }
  openLink(X, Y) {
    return this._assertInitialized("openLink"), this.request({ method: "ui/open-link", params: X }, I, Y);
  }
  sendOpenLink = this.openLink;
  downloadFile(X, Y) {
    return this._assertInitialized("downloadFile"), this.request({ method: "ui/download-file", params: X }, F, Y);
  }
  requestTeardown(X = {}) {
    return this.notification({ method: "ui/notifications/request-teardown", params: X });
  }
  requestDisplayMode(X, Y) {
    return this._assertInitialized("requestDisplayMode"), this.request({ method: "ui/request-display-mode", params: X }, U, Y);
  }
  sendSizeChanged(X) {
    return this.notification({ method: "ui/notifications/size-changed", params: X });
  }
  setupSizeChangedNotifications() {
    let X = false, Y = 0, Z = 0, $ = () => {
      if (X) return;
      X = true, requestAnimationFrame(() => {
        X = false;
        let J = document.documentElement, K = J.style.height;
        J.style.height = "max-content";
        let G = Math.ceil(J.getBoundingClientRect().height);
        J.style.height = K;
        let N = Math.ceil(window.innerWidth);
        if (N !== Y || G !== Z) Y = N, Z = G, this.sendSizeChanged({ width: N, height: G });
      });
    };
    $();
    let D = new ResizeObserver($);
    return D.observe(document.documentElement), D.observe(document.body), () => D.disconnect();
  }
  async connect(X = new j(window.parent, window.parent), Y) {
    if (this.transport) throw Error("App is already connected. Call close() before connecting again.");
    this._initializedSent = false, await super.connect(X);
    try {
      let Z = await this.request({ method: "ui/initialize", params: { appCapabilities: this._capabilities, appInfo: this._appInfo, protocolVersion: E } }, C, Y);
      if (Z === void 0) throw Error(`Server sent invalid initialize result: ${Z}`);
      if (this._hostCapabilities = Z.hostCapabilities, this._hostInfo = Z.hostInfo, this._hostContext = Z.hostContext, await this.notification({ method: "ui/notifications/initialized" }), this._initializedSent = true, this.options?.autoResize) this.setupSizeChangedNotifications();
    } catch (Z) {
      throw this.close(), Z;
    }
  }
};
export {
  i as App,
  r as DOWNLOAD_FILE_METHOD,
  XQ as HOST_CONTEXT_CHANGED_METHOD,
  DQ as INITIALIZED_METHOD,
  $Q as INITIALIZE_METHOD,
  E as LATEST_PROTOCOL_VERSION,
  n as MESSAGE_METHOD,
  d as McpUiAppCapabilitiesSchema,
  W as McpUiDisplayModeSchema,
  AQ as McpUiDownloadFileRequestSchema,
  F as McpUiDownloadFileResultSchema,
  u as McpUiHostCapabilitiesSchema,
  M as McpUiHostContextChangedNotificationSchema,
  T as McpUiHostContextSchema,
  v as McpUiHostCssSchema,
  f as McpUiHostStylesSchema,
  TQ as McpUiInitializeRequestSchema,
  C as McpUiInitializeResultSchema,
  FQ as McpUiInitializedNotificationSchema,
  RQ as McpUiMessageRequestSchema,
  q as McpUiMessageResultSchema,
  _Q as McpUiOpenLinkRequestSchema,
  I as McpUiOpenLinkResultSchema,
  PQ as McpUiRequestDisplayModeRequestSchema,
  U as McpUiRequestDisplayModeResultSchema,
  IQ as McpUiRequestTeardownNotificationSchema,
  L as McpUiResourceCspSchema,
  qQ as McpUiResourceMetaSchema,
  B as McpUiResourcePermissionsSchema,
  R as McpUiResourceTeardownRequestSchema,
  zQ as McpUiResourceTeardownResultSchema,
  EQ as McpUiSandboxProxyReadyNotificationSchema,
  UQ as McpUiSandboxResourceReadyNotificationSchema,
  OQ as McpUiSizeChangedNotificationSchema,
  z as McpUiSupportedContentBlockModalitiesSchema,
  g as McpUiThemeSchema,
  A as McpUiToolCancelledNotificationSchema,
  P as McpUiToolInputNotificationSchema,
  w as McpUiToolInputPartialNotificationSchema,
  wQ as McpUiToolMetaSchema,
  H as McpUiToolResultNotificationSchema,
  h as McpUiToolVisibilitySchema,
  HQ as McpUiUpdateModelContextRequestSchema,
  l as OPEN_LINK_METHOD,
  j as PostMessageTransport,
  _ as ProtocolWithEvents,
  JQ as REQUEST_DISPLAY_MODE_METHOD,
  YQ as REQUEST_TEARDOWN_METHOD,
  QY as RESOURCE_MIME_TYPE,
  ZQ as RESOURCE_TEARDOWN_METHOD,
  eX as RESOURCE_URI_META_KEY,
  a as SANDBOX_PROXY_READY_METHOD,
  o as SANDBOX_RESOURCE_READY_METHOD,
  s as SIZE_CHANGED_METHOD,
  QQ as TOOL_CANCELLED_METHOD,
  t as TOOL_INPUT_METHOD,
  O as TOOL_INPUT_PARTIAL_METHOD,
  e as TOOL_RESULT_METHOD,
  kQ as applyDocumentTheme,
  SQ as applyHostFonts,
  bQ as applyHostStyleVariables,
  CQ as getDocumentTheme
};
