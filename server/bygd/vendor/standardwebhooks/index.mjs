// Tua-plugin 0.5.13 — bygd av bygg.mjs 2026-11-03. IKKE REDIGER: kilden er server/*.js og node_modules.
import { requireBase64 } from '../@stablelib/base64/lib/base64.mjs';
import { requireSha256 } from '../fast-sha256/sha256.mjs';
import { requireTiming_safe_equal } from './timing_safe_equal.mjs';

var dist = {};

var hasRequiredDist;

function requireDist () {
	if (hasRequiredDist) return dist;
	hasRequiredDist = 1;
	Object.defineProperty(dist, "__esModule", { value: true });
	dist.Webhook = dist.WebhookVerificationError = void 0;
	const base64 = requireBase64();
	const sha256 = requireSha256();
	const timing_safe_equal_1 = requireTiming_safe_equal();
	const WEBHOOK_TOLERANCE_IN_SECONDS = 5 * 60;
	class ExtendableError extends Error {
	    constructor(message) {
	        super(message);
	        Object.setPrototypeOf(this, ExtendableError.prototype);
	        this.name = "ExtendableError";
	        this.stack = new Error(message).stack;
	    }
	}
	class WebhookVerificationError extends ExtendableError {
	    constructor(message) {
	        super(message);
	        Object.setPrototypeOf(this, WebhookVerificationError.prototype);
	        this.name = "WebhookVerificationError";
	    }
	}
	dist.WebhookVerificationError = WebhookVerificationError;
	class Webhook {
	    constructor(secret, options) {
	        if ((options === null || options === void 0 ? void 0 : options.format) === "raw") {
	            if (secret instanceof Uint8Array) {
	                this.key = secret;
	            }
	            else {
	                this.key = Uint8Array.from(secret, (c) => c.charCodeAt(0));
	            }
	        }
	        else {
	            if (typeof secret !== "string") {
	                throw new Error("Expected secret to be of type string");
	            }
	            if (secret.startsWith(Webhook.prefix)) {
	                secret = secret.substring(Webhook.prefix.length);
	            }
	            this.key = base64.decode(secret);
	        }
	        if (this.key.length === 0) {
	            throw new Error("Secret can't be empty.");
	        }
	    }
	    verify(payload, headers, options) {
	        var _a;
	        const jsonParse = (_a = options === null || options === void 0 ? void 0 : options.jsonParse) !== null && _a !== void 0 ? _a : true;
	        const normalizedHeaders = {};
	        for (const key of Object.keys(headers)) {
	            normalizedHeaders[key.toLowerCase()] = headers[key];
	        }
	        const msgId = normalizedHeaders["webhook-id"];
	        const msgSignature = normalizedHeaders["webhook-signature"];
	        const msgTimestamp = normalizedHeaders["webhook-timestamp"];
	        if (!msgSignature || !msgId || !msgTimestamp) {
	            throw new WebhookVerificationError("Missing required headers");
	        }
	        const timestamp = this.verifyTimestamp(msgTimestamp);
	        const computedSignature = this.sign(msgId, timestamp, payload);
	        const expectedSignature = computedSignature.split(",")[1];
	        const passedSignatures = msgSignature.split(" ");
	        const encoder = new globalThis.TextEncoder();
	        for (const versionedSignature of passedSignatures) {
	            const [version, signature] = versionedSignature.split(",");
	            if (version !== "v1") {
	                continue;
	            }
	            if ((0, timing_safe_equal_1.timingSafeEqual)(encoder.encode(signature), encoder.encode(expectedSignature))) {
	                const payloadString = payload.toString();
	                if (payloadString === "") {
	                    return undefined;
	                }
	                if (jsonParse) {
	                    return JSON.parse(payloadString);
	                }
	                else {
	                    return undefined;
	                }
	            }
	        }
	        throw new WebhookVerificationError("No matching signature found");
	    }
	    sign(msgId, timestamp, payload) {
	        if (typeof payload === "string") ;
	        else if (payload.constructor.name === "Buffer") {
	            payload = payload.toString();
	        }
	        else {
	            throw new Error("Expected payload to be of type string or Buffer.");
	        }
	        const encoder = new TextEncoder();
	        const timestampNumber = Math.floor(timestamp.getTime() / 1000);
	        const toSign = encoder.encode(`${msgId}.${timestampNumber}.${payload}`);
	        const expectedSignature = base64.encode(sha256.hmac(this.key, toSign));
	        return `v1,${expectedSignature}`;
	    }
	    verifyTimestamp(timestampHeader) {
	        const now = Math.floor(Date.now() / 1000);
	        const timestamp = parseInt(timestampHeader, 10);
	        if (Number.isNaN(timestamp)) {
	            throw new WebhookVerificationError("Invalid Signature Headers");
	        }
	        if (now - timestamp > WEBHOOK_TOLERANCE_IN_SECONDS) {
	            throw new WebhookVerificationError("Message timestamp too old");
	        }
	        if (timestamp > now + WEBHOOK_TOLERANCE_IN_SECONDS) {
	            throw new WebhookVerificationError("Message timestamp too new");
	        }
	        return new Date(timestamp * 1000);
	    }
	}
	dist.Webhook = Webhook;
	Webhook.prefix = "whsec_";
	
	return dist;
}

var distExports = requireDist();

export { distExports };
