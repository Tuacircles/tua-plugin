// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { getDefaultExportFromCjs } from '../_rollup/commonjsHelpers.mjs';
import { requireFormats } from './formats.mjs';
import { requireLimit } from './limit.mjs';
import { requireCodegen } from '../ajv/compile/codegen/index.mjs';

var dist = {exports: {}};

var hasRequiredDist;

function requireDist () {
	if (hasRequiredDist) return dist.exports;
	hasRequiredDist = 1;
	(function (module, exports) {
		Object.defineProperty(exports, "__esModule", { value: true });
		const formats_1 = requireFormats();
		const limit_1 = requireLimit();
		const codegen_1 = /*@__PURE__*/ requireCodegen();
		const fullName = new codegen_1.Name("fullFormats");
		const fastName = new codegen_1.Name("fastFormats");
		const formatsPlugin = (ajv, opts = { keywords: true }) => {
		    if (Array.isArray(opts)) {
		        addFormats(ajv, opts, formats_1.fullFormats, fullName);
		        return ajv;
		    }
		    const [formats, exportName] = opts.mode === "fast" ? [formats_1.fastFormats, fastName] : [formats_1.fullFormats, fullName];
		    const list = opts.formats || formats_1.formatNames;
		    addFormats(ajv, list, formats, exportName);
		    if (opts.keywords)
		        (0, limit_1.default)(ajv);
		    return ajv;
		};
		formatsPlugin.get = (name, mode = "full") => {
		    const formats = mode === "fast" ? formats_1.fastFormats : formats_1.fullFormats;
		    const f = formats[name];
		    if (!f)
		        throw new Error(`Unknown format "${name}"`);
		    return f;
		};
		function addFormats(ajv, list, fs, exportName) {
		    var _a;
		    var _b;
		    (_a = (_b = ajv.opts.code).formats) !== null && _a !== void 0 ? _a : (_b.formats = (0, codegen_1._) `require("ajv-formats/dist/formats").${exportName}`);
		    for (const f of list)
		        ajv.addFormat(f, fs[f]);
		}
		module.exports = exports = formatsPlugin;
		Object.defineProperty(exports, "__esModule", { value: true });
		exports.default = formatsPlugin;
		
	} (dist, dist.exports));
	return dist.exports;
}

var distExports = requireDist();
const _addFormats = /*@__PURE__*/getDefaultExportFromCjs(distExports);

export { _addFormats };
