// Tua-plugin 0.5.10 — bygd av bygg.mjs 2026-11-02. IKKE REDIGER: kilden er server/*.js og node_modules.
import { AnthropicError } from '../../core/error.mjs';

// https://url.spec.whatwg.org/#url-scheme-string
const startsWithSchemeRegexp = /^[a-z][a-z0-9+.-]*:/i;
const isAbsoluteURL = (url) => {
    return startsWithSchemeRegexp.test(url);
};
let isArray = (val) => ((isArray = Array.isArray), isArray(val));
let isReadonlyArray = isArray;
/** Returns an object if the given value isn't an object, otherwise returns as-is */
function maybeObj(x) {
    if (typeof x !== 'object') {
        return {};
    }
    return x ?? {};
}
// https://stackoverflow.com/a/34491287
function isEmptyObj(obj) {
    if (!obj)
        return true;
    for (const _k in obj)
        return false;
    return true;
}
// https://eslint.org/docs/latest/rules/no-prototype-builtins
function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}
function isObj(obj) {
    return obj != null && typeof obj === 'object' && !Array.isArray(obj);
}
const validatePositiveInteger = (name, n) => {
    if (typeof n !== 'number' || !Number.isInteger(n)) {
        throw new AnthropicError(`${name} must be an integer`);
    }
    if (n < 0) {
        throw new AnthropicError(`${name} must be a positive integer`);
    }
    return n;
};
const CREDENTIAL_OPTIONS = ['apiKey', 'authToken', 'credentials', 'config', 'profile'];
const safeJSON = (text) => {
    try {
        return JSON.parse(text);
    }
    catch (err) {
        return undefined;
    }
};
/**
 * Compile-time exhaustiveness check: passing a value here only type-checks once every
 * member of its union has been handled. Does nothing at runtime, so unknown values from a
 * newer API version fall through instead of throwing.
 */
function checkNever(_value) { }

export { CREDENTIAL_OPTIONS, checkNever, hasOwn, isAbsoluteURL, isArray, isEmptyObj, isObj, isReadonlyArray, maybeObj, safeJSON, validatePositiveInteger };
