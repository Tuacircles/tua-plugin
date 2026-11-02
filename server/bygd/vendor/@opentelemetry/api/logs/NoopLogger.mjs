// Tua-plugin 0.5.12 — bygd av bygg.mjs 2026-11-02. IKKE REDIGER: kilden er server/*.js og node_modules.
//#region src/logs/NoopLogger.ts
var NoopLogger = class {
	emit(_logRecord) {}
	enabled() {
		return false;
	}
};
const NOOP_LOGGER = new NoopLogger();

export { NOOP_LOGGER, NoopLogger };
