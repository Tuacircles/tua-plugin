// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { requireCode } from '../code.mjs';
import { requireCodegen } from '../../compile/codegen/index.mjs';
import { requireUtil } from '../../compile/util.mjs';

var patternProperties = {};

var hasRequiredPatternProperties;

function requirePatternProperties () {
	if (hasRequiredPatternProperties) return patternProperties;
	hasRequiredPatternProperties = 1;
	Object.defineProperty(patternProperties, "__esModule", { value: true });
	const code_1 = /*@__PURE__*/ requireCode();
	const codegen_1 = /*@__PURE__*/ requireCodegen();
	const util_1 = /*@__PURE__*/ requireUtil();
	const util_2 = /*@__PURE__*/ requireUtil();
	const def = {
	    keyword: "patternProperties",
	    type: "object",
	    schemaType: "object",
	    code(cxt) {
	        const { gen, schema, data, parentSchema, it } = cxt;
	        const { opts } = it;
	        const patterns = (0, code_1.allSchemaProperties)(schema);
	        const alwaysValidPatterns = patterns.filter((p) => (0, util_1.alwaysValidSchema)(it, schema[p]));
	        if (patterns.length === 0 ||
	            (alwaysValidPatterns.length === patterns.length &&
	                (!it.opts.unevaluated || it.props === true))) {
	            return;
	        }
	        const checkProperties = opts.strictSchema && !opts.allowMatchingProperties && parentSchema.properties;
	        const valid = gen.name("valid");
	        if (it.props !== true && !(it.props instanceof codegen_1.Name)) {
	            it.props = (0, util_2.evaluatedPropsToName)(gen, it.props);
	        }
	        const { props } = it;
	        validatePatternProperties();
	        function validatePatternProperties() {
	            for (const pat of patterns) {
	                if (checkProperties)
	                    checkMatchingProperties(pat);
	                if (it.allErrors) {
	                    validateProperties(pat);
	                }
	                else {
	                    gen.var(valid, true); // TODO var
	                    validateProperties(pat);
	                    gen.if(valid);
	                }
	            }
	        }
	        function checkMatchingProperties(pat) {
	            for (const prop in checkProperties) {
	                if (new RegExp(pat).test(prop)) {
	                    (0, util_1.checkStrictMode)(it, `property ${prop} matches pattern ${pat} (use allowMatchingProperties)`);
	                }
	            }
	        }
	        function validateProperties(pat) {
	            gen.forIn("key", data, (key) => {
	                gen.if((0, codegen_1._) `${(0, code_1.usePattern)(cxt, pat)}.test(${key})`, () => {
	                    const alwaysValid = alwaysValidPatterns.includes(pat);
	                    if (!alwaysValid) {
	                        cxt.subschema({
	                            keyword: "patternProperties",
	                            schemaProp: pat,
	                            dataProp: key,
	                            dataPropType: util_2.Type.Str,
	                        }, valid);
	                    }
	                    if (it.opts.unevaluated && props !== true) {
	                        gen.assign((0, codegen_1._) `${props}[${key}]`, true);
	                    }
	                    else if (!alwaysValid && !it.allErrors) {
	                        // can short-circuit if `unevaluatedProperties` is not supported (opts.next === false)
	                        // or if all properties were evaluated (props === true)
	                        gen.if((0, codegen_1.not)(valid), () => gen.break());
	                    }
	                });
	            });
	        }
	    },
	};
	patternProperties.default = def;
	
	return patternProperties;
}

export { requirePatternProperties };
