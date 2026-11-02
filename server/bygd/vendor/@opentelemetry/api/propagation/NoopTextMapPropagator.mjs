// Tua-plugin 0.5.12 — bygd av bygg.mjs 2026-11-02. IKKE REDIGER: kilden er server/*.js og node_modules.
//#region src/propagation/NoopTextMapPropagator.ts
/**
* No-op implementations of {@link TextMapPropagator}.
*/
var NoopTextMapPropagator = class {
	/** Noop inject function does nothing */
	inject(_context, _carrier) {}
	/** Noop extract function does nothing and returns the input context */
	extract(context, _carrier) {
		return context;
	}
	fields() {
		return [];
	}
};

export { NoopTextMapPropagator };
