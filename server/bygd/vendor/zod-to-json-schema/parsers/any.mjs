// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-24. IKKE REDIGER: kilden er server/*.js og node_modules.
import { getRelativePath } from '../getRelativePath.mjs';

function parseAnyDef(refs) {
    if (refs.target !== "openAi") {
        return {};
    }
    const anyDefinitionPath = [
        ...refs.basePath,
        refs.definitionPath,
        refs.openAiAnyTypeName,
    ];
    refs.flags.hasReferencedOpenAiAnyType = true;
    return {
        $ref: refs.$refStrategy === "relative"
            ? getRelativePath(anyDefinitionPath, refs.currentPath)
            : anyDefinitionPath.join("/"),
    };
}

export { parseAnyDef };
