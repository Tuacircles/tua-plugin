// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { requireAdditionalItems } from './additionalItems.mjs';
import { requirePrefixItems } from './prefixItems.mjs';
import { requireItems } from './items.mjs';
import { requireItems2020 } from './items2020.mjs';
import { requireContains } from './contains.mjs';
import { requireDependencies } from './dependencies.mjs';
import { requirePropertyNames } from './propertyNames.mjs';
import { requireAdditionalProperties } from './additionalProperties.mjs';
import { requireProperties } from './properties.mjs';
import { requirePatternProperties } from './patternProperties.mjs';
import { requireNot } from './not.mjs';
import { requireAnyOf } from './anyOf.mjs';
import { requireOneOf } from './oneOf.mjs';
import { requireAllOf } from './allOf.mjs';
import { require_if } from './if.mjs';
import { requireThenElse } from './thenElse.mjs';

var applicator = {};

var hasRequiredApplicator;

function requireApplicator () {
	if (hasRequiredApplicator) return applicator;
	hasRequiredApplicator = 1;
	Object.defineProperty(applicator, "__esModule", { value: true });
	const additionalItems_1 = /*@__PURE__*/ requireAdditionalItems();
	const prefixItems_1 = /*@__PURE__*/ requirePrefixItems();
	const items_1 = /*@__PURE__*/ requireItems();
	const items2020_1 = /*@__PURE__*/ requireItems2020();
	const contains_1 = /*@__PURE__*/ requireContains();
	const dependencies_1 = /*@__PURE__*/ requireDependencies();
	const propertyNames_1 = /*@__PURE__*/ requirePropertyNames();
	const additionalProperties_1 = /*@__PURE__*/ requireAdditionalProperties();
	const properties_1 = /*@__PURE__*/ requireProperties();
	const patternProperties_1 = /*@__PURE__*/ requirePatternProperties();
	const not_1 = /*@__PURE__*/ requireNot();
	const anyOf_1 = /*@__PURE__*/ requireAnyOf();
	const oneOf_1 = /*@__PURE__*/ requireOneOf();
	const allOf_1 = /*@__PURE__*/ requireAllOf();
	const if_1 = /*@__PURE__*/ require_if();
	const thenElse_1 = /*@__PURE__*/ requireThenElse();
	function getApplicator(draft2020 = false) {
	    const applicator = [
	        // any
	        not_1.default,
	        anyOf_1.default,
	        oneOf_1.default,
	        allOf_1.default,
	        if_1.default,
	        thenElse_1.default,
	        // object
	        propertyNames_1.default,
	        additionalProperties_1.default,
	        dependencies_1.default,
	        properties_1.default,
	        patternProperties_1.default,
	    ];
	    // array
	    if (draft2020)
	        applicator.push(prefixItems_1.default, items2020_1.default);
	    else
	        applicator.push(additionalItems_1.default, items_1.default);
	    applicator.push(contains_1.default);
	    return applicator;
	}
	applicator.default = getApplicator;
	
	return applicator;
}

export { requireApplicator };
