// Tua-plugin 0.5.14 — bygd av bygg.mjs 2026-11-03. IKKE REDIGER: kilden er server/*.js og node_modules.
var timing_safe_equal = {};

var hasRequiredTiming_safe_equal;

function requireTiming_safe_equal () {
	if (hasRequiredTiming_safe_equal) return timing_safe_equal;
	hasRequiredTiming_safe_equal = 1;
	Object.defineProperty(timing_safe_equal, "__esModule", { value: true });
	timing_safe_equal.timingSafeEqual = timingSafeEqual;
	function assert(expr, msg = "") {
	    if (!expr) {
	        throw new Error(msg);
	    }
	}
	function timingSafeEqual(a, b) {
	    if (a.byteLength !== b.byteLength) {
	        return false;
	    }
	    if (!(a instanceof DataView)) {
	        a = new DataView(ArrayBuffer.isView(a) ? a.buffer : a);
	    }
	    if (!(b instanceof DataView)) {
	        b = new DataView(ArrayBuffer.isView(b) ? b.buffer : b);
	    }
	    assert(a instanceof DataView);
	    assert(b instanceof DataView);
	    const length = a.byteLength;
	    let out = 0;
	    let i = -1;
	    while (++i < length) {
	        out |= a.getUint8(i) ^ b.getUint8(i);
	    }
	    return out === 0;
	}
	
	return timing_safe_equal;
}

export { requireTiming_safe_equal };
