// Tua-plugin 0.5.12 — bygd av bygg.mjs 2026-11-02. IKKE REDIGER: kilden er server/*.js og node_modules.
import { NoopLogger } from './NoopLogger.mjs';

//#region src/logs/NoopLoggerProvider.ts
var NoopLoggerProvider = class {
	getLogger(_name, _version, _options) {
		return new NoopLogger();
	}
};
const NOOP_LOGGER_PROVIDER = new NoopLoggerProvider();

export { NOOP_LOGGER_PROVIDER };
