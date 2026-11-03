// Tua-plugin 0.5.13 — bygd av bygg.mjs 2026-11-03. IKKE REDIGER: kilden er server/*.js og node_modules.
import { NOOP_METER } from './NoopMeter.mjs';

//#region src/metrics/NoopMeterProvider.ts
/**
* An implementation of the {@link MeterProvider} which returns an impotent Meter
* for all calls to `getMeter`
*/
var NoopMeterProvider = class {
	getMeter(_name, _version, _options) {
		return NOOP_METER;
	}
};
const NOOP_METER_PROVIDER = new NoopMeterProvider();

export { NOOP_METER_PROVIDER };
