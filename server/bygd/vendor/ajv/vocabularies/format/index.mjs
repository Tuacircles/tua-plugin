// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { requireFormat as requireFormat$1 } from './format.mjs';

var format = {};

var hasRequiredFormat;

function requireFormat () {
	if (hasRequiredFormat) return format;
	hasRequiredFormat = 1;
	Object.defineProperty(format, "__esModule", { value: true });
	const format_1 = /*@__PURE__*/ requireFormat$1();
	const format$1 = [format_1.default];
	format.default = format$1;
	
	return format;
}

export { requireFormat };
