// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-24. IKKE REDIGER: kilden er server/*.js og node_modules.
import { ROOT_CONTEXT } from './context.mjs';

//#region src/context/NoopContextManager.ts
var NoopContextManager = class {
	active() {
		return ROOT_CONTEXT;
	}
	with(_context, fn, thisArg, ...args) {
		return fn.call(thisArg, ...args);
	}
	bind(_context, target) {
		return target;
	}
	enable() {
		return this;
	}
	disable() {
		return this;
	}
	/** @experimental This API is experimental and may change in minor releases without prior notice. */
	attach(_context) {
		return { dispose() {} };
	}
};

export { NoopContextManager };
