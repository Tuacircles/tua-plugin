// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { requireFastUri } from '../../fast-uri/index.mjs';

var uri = {};

var hasRequiredUri;

function requireUri () {
	if (hasRequiredUri) return uri;
	hasRequiredUri = 1;
	Object.defineProperty(uri, "__esModule", { value: true });
	const uri$1 = requireFastUri();
	uri$1.code = 'require("ajv/dist/runtime/uri").default';
	uri.default = uri$1;
	
	return uri;
}

export { requireUri };
