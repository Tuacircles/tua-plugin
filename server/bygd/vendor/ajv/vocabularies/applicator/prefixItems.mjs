// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { requireItems } from './items.mjs';

var prefixItems = {};

var hasRequiredPrefixItems;

function requirePrefixItems () {
	if (hasRequiredPrefixItems) return prefixItems;
	hasRequiredPrefixItems = 1;
	Object.defineProperty(prefixItems, "__esModule", { value: true });
	const items_1 = /*@__PURE__*/ requireItems();
	const def = {
	    keyword: "prefixItems",
	    type: "array",
	    schemaType: ["array"],
	    before: "uniqueItems",
	    code: (cxt) => (0, items_1.validateTuple)(cxt, "items"),
	};
	prefixItems.default = def;
	
	return prefixItems;
}

export { requirePrefixItems };
