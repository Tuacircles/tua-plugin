// Tua-plugin 0.5.13 — bygd av bygg.mjs 2026-11-03. IKKE REDIGER: kilden er server/*.js og node_modules.
//#region src/propagation/TextMapPropagator.ts
/**
* @since 1.0.0
*/
const defaultTextMapGetter = {
	get(carrier, key) {
		if (carrier == null) return;
		return carrier[key];
	},
	keys(carrier) {
		if (carrier == null) return [];
		return Object.keys(carrier);
	}
};
/**
* @since 1.0.0
*/
const defaultTextMapSetter = { set(carrier, key, value) {
	if (carrier == null) return;
	carrier[key] = value;
} };

export { defaultTextMapGetter, defaultTextMapSetter };
