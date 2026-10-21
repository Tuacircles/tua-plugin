// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { requireLimitNumber } from './limitNumber.mjs';
import { requireMultipleOf } from './multipleOf.mjs';
import { requireLimitLength } from './limitLength.mjs';
import { requirePattern } from './pattern.mjs';
import { requireLimitProperties } from './limitProperties.mjs';
import { requireRequired } from './required.mjs';
import { requireLimitItems } from './limitItems.mjs';
import { requireUniqueItems } from './uniqueItems.mjs';
import { require_const } from './const.mjs';
import { require_enum } from './enum.mjs';

var validation = {};

var hasRequiredValidation;

function requireValidation () {
	if (hasRequiredValidation) return validation;
	hasRequiredValidation = 1;
	Object.defineProperty(validation, "__esModule", { value: true });
	const limitNumber_1 = /*@__PURE__*/ requireLimitNumber();
	const multipleOf_1 = /*@__PURE__*/ requireMultipleOf();
	const limitLength_1 = /*@__PURE__*/ requireLimitLength();
	const pattern_1 = /*@__PURE__*/ requirePattern();
	const limitProperties_1 = /*@__PURE__*/ requireLimitProperties();
	const required_1 = /*@__PURE__*/ requireRequired();
	const limitItems_1 = /*@__PURE__*/ requireLimitItems();
	const uniqueItems_1 = /*@__PURE__*/ requireUniqueItems();
	const const_1 = /*@__PURE__*/ require_const();
	const enum_1 = /*@__PURE__*/ require_enum();
	const validation$1 = [
	    // number
	    limitNumber_1.default,
	    multipleOf_1.default,
	    // string
	    limitLength_1.default,
	    pattern_1.default,
	    // object
	    limitProperties_1.default,
	    required_1.default,
	    // array
	    limitItems_1.default,
	    uniqueItems_1.default,
	    // any
	    { keyword: "type", schemaType: ["string", "array"] },
	    { keyword: "nullable", schemaType: "boolean" },
	    const_1.default,
	    enum_1.default,
	];
	validation.default = validation$1;
	
	return validation;
}

export { requireValidation };
