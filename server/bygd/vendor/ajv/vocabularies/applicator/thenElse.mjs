// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { requireUtil } from '../../compile/util.mjs';

var thenElse = {};

var hasRequiredThenElse;

function requireThenElse () {
	if (hasRequiredThenElse) return thenElse;
	hasRequiredThenElse = 1;
	Object.defineProperty(thenElse, "__esModule", { value: true });
	const util_1 = /*@__PURE__*/ requireUtil();
	const def = {
	    keyword: ["then", "else"],
	    schemaType: ["object", "boolean"],
	    code({ keyword, parentSchema, it }) {
	        if (parentSchema.if === undefined)
	            (0, util_1.checkStrictMode)(it, `"${keyword}" without "if" is ignored`);
	    },
	};
	thenElse.default = def;
	
	return thenElse;
}

export { requireThenElse };
