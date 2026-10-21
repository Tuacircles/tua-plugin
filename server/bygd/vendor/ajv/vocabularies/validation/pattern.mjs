// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { requireCode } from '../code.mjs';
import { requireUtil } from '../../compile/util.mjs';
import { requireCodegen } from '../../compile/codegen/index.mjs';

var pattern = {};

var hasRequiredPattern;

function requirePattern () {
	if (hasRequiredPattern) return pattern;
	hasRequiredPattern = 1;
	Object.defineProperty(pattern, "__esModule", { value: true });
	const code_1 = /*@__PURE__*/ requireCode();
	const util_1 = /*@__PURE__*/ requireUtil();
	const codegen_1 = /*@__PURE__*/ requireCodegen();
	const error = {
	    message: ({ schemaCode }) => (0, codegen_1.str) `must match pattern "${schemaCode}"`,
	    params: ({ schemaCode }) => (0, codegen_1._) `{pattern: ${schemaCode}}`,
	};
	const def = {
	    keyword: "pattern",
	    type: "string",
	    schemaType: "string",
	    $data: true,
	    error,
	    code(cxt) {
	        const { gen, data, $data, schema, schemaCode, it } = cxt;
	        const u = it.opts.unicodeRegExp ? "u" : "";
	        if ($data) {
	            const { regExp } = it.opts.code;
	            const regExpCode = regExp.code === "new RegExp" ? (0, codegen_1._) `new RegExp` : (0, util_1.useFunc)(gen, regExp);
	            const valid = gen.let("valid");
	            gen.try(() => gen.assign(valid, (0, codegen_1._) `${regExpCode}(${schemaCode}, ${u}).test(${data})`), () => gen.assign(valid, false));
	            cxt.fail$data((0, codegen_1._) `!${valid}`);
	        }
	        else {
	            const regExp = (0, code_1.usePattern)(cxt, schema);
	            cxt.fail$data((0, codegen_1._) `!${regExp}.test(${data})`);
	        }
	    },
	};
	pattern.default = def;
	
	return pattern;
}

export { requirePattern };
