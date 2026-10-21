// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { requireCodegen } from '../../compile/codegen/index.mjs';
import { requireUtil } from '../../compile/util.mjs';
import { requireCode } from '../code.mjs';
import { requireAdditionalItems } from './additionalItems.mjs';

var items2020 = {};

var hasRequiredItems2020;

function requireItems2020 () {
	if (hasRequiredItems2020) return items2020;
	hasRequiredItems2020 = 1;
	Object.defineProperty(items2020, "__esModule", { value: true });
	const codegen_1 = /*@__PURE__*/ requireCodegen();
	const util_1 = /*@__PURE__*/ requireUtil();
	const code_1 = /*@__PURE__*/ requireCode();
	const additionalItems_1 = /*@__PURE__*/ requireAdditionalItems();
	const error = {
	    message: ({ params: { len } }) => (0, codegen_1.str) `must NOT have more than ${len} items`,
	    params: ({ params: { len } }) => (0, codegen_1._) `{limit: ${len}}`,
	};
	const def = {
	    keyword: "items",
	    type: "array",
	    schemaType: ["object", "boolean"],
	    before: "uniqueItems",
	    error,
	    code(cxt) {
	        const { schema, parentSchema, it } = cxt;
	        const { prefixItems } = parentSchema;
	        it.items = true;
	        if ((0, util_1.alwaysValidSchema)(it, schema))
	            return;
	        if (prefixItems)
	            (0, additionalItems_1.validateAdditionalItems)(cxt, prefixItems);
	        else
	            cxt.ok((0, code_1.validateArray)(cxt));
	    },
	};
	items2020.default = def;
	
	return items2020;
}

export { requireItems2020 };
