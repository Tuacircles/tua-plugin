// Tua-plugin 0.5.10 — bygd av bygg.mjs 2026-11-02. IKKE REDIGER: kilden er server/*.js og node_modules.
import { DiagAPI } from '../api/diag.mjs';
import { BaggageImpl } from './internal/baggage-impl.mjs';

//#region src/baggage/utils.ts
DiagAPI.instance();
/**
* Create a new Baggage with optional entries
*
* @param entries An array of baggage entries the new baggage should contain
*/
function createBaggage(entries = {}) {
	return new BaggageImpl(new Map(Object.entries(entries)));
}

export { createBaggage };
