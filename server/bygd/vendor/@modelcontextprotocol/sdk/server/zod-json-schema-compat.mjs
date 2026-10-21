// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { isZ4Schema, getObjectShape, getLiteralValue, safeParse } from './zod-compat.mjs';
import '../../../zod-to-json-schema/parsers/string.mjs';
import { zodToJsonSchema } from '../../../zod-to-json-schema/zodToJsonSchema.mjs';
import { toJSONSchema } from '../../../zod/v4/core/to-json-schema.mjs';

// zod-json-schema-compat.ts
// ----------------------------------------------------
// JSON Schema conversion for both Zod v3 and Zod v4 (Mini)
// v3 uses your vendored converter; v4 uses Mini's toJSONSchema
// ----------------------------------------------------
function mapMiniTarget(t) {
    if (!t)
        return 'draft-7';
    if (t === 'jsonSchema7' || t === 'draft-7')
        return 'draft-7';
    if (t === 'jsonSchema2019-09' || t === 'draft-2020-12')
        return 'draft-2020-12';
    return 'draft-7'; // fallback
}
function toJsonSchemaCompat(schema, opts) {
    if (isZ4Schema(schema)) {
        // v4 branch — use Mini's built-in toJSONSchema
        return toJSONSchema(schema, {
            target: mapMiniTarget(opts?.target),
            io: opts?.pipeStrategy ?? 'input'
        });
    }
    // v3 branch — use vendored converter
    return zodToJsonSchema(schema, {
        strictUnions: opts?.strictUnions ?? true,
        pipeStrategy: opts?.pipeStrategy ?? 'input'
    });
}
function getMethodLiteral(schema) {
    const shape = getObjectShape(schema);
    const methodSchema = shape?.method;
    if (!methodSchema) {
        throw new Error('Schema is missing a method literal');
    }
    const value = getLiteralValue(methodSchema);
    if (typeof value !== 'string') {
        throw new Error('Schema method literal must be a string');
    }
    return value;
}
function parseWithCompat(schema, data) {
    const result = safeParse(schema, data);
    if (!result.success) {
        throw result.error;
    }
    return result.data;
}

export { getMethodLiteral, parseWithCompat, toJsonSchemaCompat };
