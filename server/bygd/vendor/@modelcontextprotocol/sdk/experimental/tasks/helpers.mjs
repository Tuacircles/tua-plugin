// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
/**
 * Experimental task capability assertion helpers.
 * WARNING: These APIs are experimental and may change without notice.
 *
 * @experimental
 */
/**
 * Asserts that task creation is supported for tools/call.
 * Used by Client.assertTaskCapability and Server.assertTaskHandlerCapability.
 *
 * @param requests - The task requests capability object
 * @param method - The method being checked
 * @param entityName - 'Server' or 'Client' for error messages
 * @throws Error if the capability is not supported
 *
 * @experimental
 */
function assertToolsCallTaskCapability(requests, method, entityName) {
    if (!requests) {
        throw new Error(`${entityName} does not support task creation (required for ${method})`);
    }
    switch (method) {
        case 'tools/call':
            if (!requests.tools?.call) {
                throw new Error(`${entityName} does not support task creation for tools/call (required for ${method})`);
            }
            break;
    }
}
/**
 * Asserts that task creation is supported for sampling/createMessage or elicitation/create.
 * Used by Server.assertTaskCapability and Client.assertTaskHandlerCapability.
 *
 * @param requests - The task requests capability object
 * @param method - The method being checked
 * @param entityName - 'Server' or 'Client' for error messages
 * @throws Error if the capability is not supported
 *
 * @experimental
 */
function assertClientRequestTaskCapability(requests, method, entityName) {
    if (!requests) {
        throw new Error(`${entityName} does not support task creation (required for ${method})`);
    }
    switch (method) {
        case 'sampling/createMessage':
            if (!requests.sampling?.createMessage) {
                throw new Error(`${entityName} does not support task creation for sampling/createMessage (required for ${method})`);
            }
            break;
        case 'elicitation/create':
            if (!requests.elicitation?.create) {
                throw new Error(`${entityName} does not support task creation for elicitation/create (required for ${method})`);
            }
            break;
    }
}

export { assertClientRequestTaskCapability, assertToolsCallTaskCapability };
