// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-24. IKKE REDIGER: kilden er server/*.js og node_modules.
import { __classPrivateFieldSet, __classPrivateFieldGet } from '../tslib.mjs';
import { encodeUTF8, concatBytes, decodeUTF8 } from '../utils/bytes.mjs';

var _LineDecoder_buffer, _LineDecoder_carriageReturnIndex;
/**
 * A re-implementation of httpx's `LineDecoder` in Python that handles incrementally
 * reading lines from text.
 *
 * https://github.com/encode/httpx/blob/920333ea98118e9cf617f246905d7b202510941c/httpx/_decoders.py#L258
 */
var LineDecoder = /* @__PURE__ */ (() => {
    /**
     * A re-implementation of httpx's `LineDecoder` in Python that handles incrementally
     * reading lines from text.
     *
     * https://github.com/encode/httpx/blob/920333ea98118e9cf617f246905d7b202510941c/httpx/_decoders.py#L258
     */
    class LineDecoder {
        constructor() {
            _LineDecoder_buffer.set(this, void 0);
            _LineDecoder_carriageReturnIndex.set(this, void 0);
            __classPrivateFieldSet(this, _LineDecoder_buffer, new Uint8Array());
            __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null);
        }
        decode(chunk) {
            if (chunk == null) {
                return [];
            }
            const binaryChunk = chunk instanceof ArrayBuffer ? new Uint8Array(chunk)
                : typeof chunk === 'string' ? encodeUTF8(chunk)
                    : chunk;
            __classPrivateFieldSet(this, _LineDecoder_buffer, concatBytes([__classPrivateFieldGet(this, _LineDecoder_buffer, "f"), binaryChunk]));
            const lines = [];
            let patternIndex;
            while ((patternIndex = findNewlineIndex(__classPrivateFieldGet(this, _LineDecoder_buffer, "f"), __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f"))) != null) {
                if (patternIndex.carriage && __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") == null) {
                    // skip until we either get a corresponding `\n`, a new `\r` or nothing
                    __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, patternIndex.index);
                    continue;
                }
                // we got double \r or \rtext\n
                if (__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") != null &&
                    (patternIndex.index !== __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") + 1 || patternIndex.carriage)) {
                    lines.push(decodeUTF8(__classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(0, __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") - 1)));
                    __classPrivateFieldSet(this, _LineDecoder_buffer, __classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f")));
                    __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null);
                    continue;
                }
                const endIndex = __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") !== null ? patternIndex.preceding - 1 : patternIndex.preceding;
                const line = decodeUTF8(__classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(0, endIndex));
                lines.push(line);
                __classPrivateFieldSet(this, _LineDecoder_buffer, __classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(patternIndex.index));
                __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null);
            }
            return lines;
        }
        flush() {
            if (!__classPrivateFieldGet(this, _LineDecoder_buffer, "f").length) {
                return [];
            }
            return this.decode('\n');
        }
    }
    _LineDecoder_buffer = new WeakMap(), _LineDecoder_carriageReturnIndex = new WeakMap();
    // prettier-ignore
    LineDecoder.NEWLINE_CHARS = new Set(['\n', '\r']);
    LineDecoder.NEWLINE_REGEXP = /\r\n|[\n\r]/g;
    return LineDecoder;
})();
/**
 * This function searches the buffer for the end patterns, (\r or \n)
 * and returns an object with the index preceding the matched newline and the
 * index after the newline char. `null` is returned if no new line is found.
 *
 * ```ts
 * findNewLineIndex('abc\ndef') -> { preceding: 2, index: 3 }
 * ```
 */
function findNewlineIndex(buffer, startIndex) {
    const newline = 0x0a; // \n
    const carriage = 0x0d; // \r
    for (let i = startIndex ?? 0; i < buffer.length; i++) {
        if (buffer[i] === newline) {
            return { preceding: i, index: i + 1, carriage: false };
        }
        if (buffer[i] === carriage) {
            return { preceding: i, index: i + 1, carriage: true };
        }
    }
    return null;
}

export { LineDecoder };
