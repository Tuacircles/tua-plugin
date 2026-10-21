// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { requireUtil } from '../../compile/util.mjs';

var allOf = {};

var hasRequiredAllOf;

function requireAllOf () {
	if (hasRequiredAllOf) return allOf;
	hasRequiredAllOf = 1;
	Object.defineProperty(allOf, "__esModule", { value: true });
	const util_1 = /*@__PURE__*/ requireUtil();
	const def = {
	    keyword: "allOf",
	    schemaType: "array",
	    code(cxt) {
	        const { gen, schema, it } = cxt;
	        /* istanbul ignore if */
	        if (!Array.isArray(schema))
	            throw new Error("ajv implementation error");
	        const valid = gen.name("valid");
	        schema.forEach((sch, i) => {
	            if ((0, util_1.alwaysValidSchema)(it, sch))
	                return;
	            const schCxt = cxt.subschema({ keyword: "allOf", schemaProp: i }, valid);
	            cxt.ok(valid);
	            cxt.mergeEvaluated(schCxt);
	        });
	    },
	};
	allOf.default = def;
	
	return allOf;
}

export { requireAllOf };
