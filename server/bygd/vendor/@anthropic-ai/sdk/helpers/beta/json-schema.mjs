// Tua-plugin 0.5.10 — bygd av bygg.mjs 2026-11-02. IKKE REDIGER: kilden er server/*.js og node_modules.
/**
 * Creates a Tool with a provided JSON schema that can be passed
 * to the `.toolRunner()` method. The schema is used to automatically validate
 * the input arguments for the tool.
 *
 * Every other field of the tool definition, such as `strict` or `cache_control`,
 * can be passed too and is sent to the API as given.
 */
function betaTool(options) {
    const { name, inputSchema, description, run, ...extraProps } = options;
    if (inputSchema.type !== 'object') {
        throw new Error(`JSON schema for tool "${name}" must be an object, but got ${inputSchema.type}`);
    }
    return {
        ...extraProps,
        type: 'custom',
        name,
        input_schema: inputSchema,
        description,
        run,
        parse: (content) => content,
    };
}

export { betaTool };
