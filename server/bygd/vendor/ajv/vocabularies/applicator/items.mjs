// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { requireCodegen } from '../../compile/codegen/index.mjs';
import { requireUtil } from '../../compile/util.mjs';
import { requireCode } from '../code.mjs';

var items = {};

var hasRequiredItems;

function requireItems () {
	if (hasRequiredItems) return items;
	hasRequiredItems = 1;
	Object.defineProperty(items, "__esModule", { value: true });
	items.validateTuple = void 0;
	const codegen_1 = /*@__PURE__*/ requireCodegen();
	const util_1 = /*@__PURE__*/ requireUtil();
	const code_1 = /*@__PURE__*/ requireCode();
	const def = {
	    keyword: "items",
	    type: "array",
	    schemaType: ["object", "array", "boolean"],
	    before: "uniqueItems",
	    code(cxt) {
	        const { schema, it } = cxt;
	        if (Array.isArray(schema))
	            return validateTuple(cxt, "additionalItems", schema);
	        it.items = true;
	        if ((0, util_1.alwaysValidSchema)(it, schema))
	            return;
	        cxt.ok((0, code_1.validateArray)(cxt));
	    },
	};
	function validateTuple(cxt, extraItems, schArr = cxt.schema) {
	    const { gen, parentSchema, data, keyword, it } = cxt;
	    checkStrictTuple(parentSchema);
	    if (it.opts.unevaluated && schArr.length && it.items !== true) {
	        it.items = util_1.mergeEvaluated.items(gen, schArr.length, it.items);
	    }
	    const valid = gen.name("valid");
	    const len = gen.const("len", (0, codegen_1._) `${data}.length`);
	    schArr.forEach((sch, i) => {
	        if ((0, util_1.alwaysValidSchema)(it, sch))
	            return;
	        gen.if((0, codegen_1._) `${len} > ${i}`, () => cxt.subschema({
	            keyword,
	            schemaProp: i,
	            dataProp: i,
	        }, valid));
	        cxt.ok(valid);
	    });
	    function checkStrictTuple(sch) {
	        const { opts, errSchemaPath } = it;
	        const l = schArr.length;
	        const fullTuple = l === sch.minItems && (l === sch.maxItems || sch[extraItems] === false);
	        if (opts.strictTuples && !fullTuple) {
	            const msg = `"${keyword}" is ${l}-tuple, but minItems or maxItems/${extraItems} are not specified or different at path "${errSchemaPath}"`;
	            (0, util_1.checkStrictMode)(it, msg, opts.strictTuples);
	        }
	    }
	}
	items.validateTuple = validateTuple;
	items.default = def;
	
	return items;
}

export { requireItems };
