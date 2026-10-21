// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
var id = {};

var hasRequiredId;

function requireId () {
	if (hasRequiredId) return id;
	hasRequiredId = 1;
	Object.defineProperty(id, "__esModule", { value: true });
	const def = {
	    keyword: "id",
	    code() {
	        throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
	    },
	};
	id.default = def;
	
	return id;
}

export { requireId };
