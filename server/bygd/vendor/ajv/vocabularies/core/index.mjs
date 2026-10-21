// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { requireId } from './id.mjs';
import { requireRef } from './ref.mjs';

var core = {};

var hasRequiredCore;

function requireCore () {
	if (hasRequiredCore) return core;
	hasRequiredCore = 1;
	Object.defineProperty(core, "__esModule", { value: true });
	const id_1 = /*@__PURE__*/ requireId();
	const ref_1 = /*@__PURE__*/ requireRef();
	const core$1 = [
	    "$schema",
	    "$id",
	    "$defs",
	    "$vocabulary",
	    { keyword: "$comment" },
	    "definitions",
	    id_1.default,
	    ref_1.default,
	];
	core.default = core$1;
	
	return core;
}

export { requireCore };
