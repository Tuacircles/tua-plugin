// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { getDefaultExportFromCjs } from '../_rollup/commonjsHelpers.mjs';
import { requireCore } from './core.mjs';
import { requireDraft7 } from './vocabularies/draft7.mjs';
import { requireDiscriminator } from './vocabularies/discriminator/index.mjs';
import { require$$3 } from './refs/json-schema-draft-07.json.mjs';
import { requireValidate } from './compile/validate/index.mjs';
import { requireCodegen } from './compile/codegen/index.mjs';
import { requireValidation_error } from './runtime/validation_error.mjs';
import { requireRef_error } from './compile/ref_error.mjs';

var ajv = {exports: {}};

var hasRequiredAjv;

function requireAjv () {
	if (hasRequiredAjv) return ajv.exports;
	hasRequiredAjv = 1;
	(function (module, exports) {
		Object.defineProperty(exports, "__esModule", { value: true });
		exports.MissingRefError = exports.ValidationError = exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = exports.Ajv = void 0;
		const core_1 = /*@__PURE__*/ requireCore();
		const draft7_1 = /*@__PURE__*/ requireDraft7();
		const discriminator_1 = /*@__PURE__*/ requireDiscriminator();
		const draft7MetaSchema = require$$3;
		const META_SUPPORT_DATA = ["/properties"];
		const META_SCHEMA_ID = "http://json-schema.org/draft-07/schema";
		class Ajv extends core_1.default {
		    _addVocabularies() {
		        super._addVocabularies();
		        draft7_1.default.forEach((v) => this.addVocabulary(v));
		        if (this.opts.discriminator)
		            this.addKeyword(discriminator_1.default);
		    }
		    _addDefaultMetaSchema() {
		        super._addDefaultMetaSchema();
		        if (!this.opts.meta)
		            return;
		        const metaSchema = this.opts.$data
		            ? this.$dataMetaSchema(draft7MetaSchema, META_SUPPORT_DATA)
		            : draft7MetaSchema;
		        this.addMetaSchema(metaSchema, META_SCHEMA_ID, false);
		        this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
		    }
		    defaultMeta() {
		        return (this.opts.defaultMeta =
		            super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : undefined));
		    }
		}
		exports.Ajv = Ajv;
		module.exports = exports = Ajv;
		module.exports.Ajv = Ajv;
		Object.defineProperty(exports, "__esModule", { value: true });
		exports.default = Ajv;
		var validate_1 = /*@__PURE__*/ requireValidate();
		Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function () { return validate_1.KeywordCxt; } });
		var codegen_1 = /*@__PURE__*/ requireCodegen();
		Object.defineProperty(exports, "_", { enumerable: true, get: function () { return codegen_1._; } });
		Object.defineProperty(exports, "str", { enumerable: true, get: function () { return codegen_1.str; } });
		Object.defineProperty(exports, "stringify", { enumerable: true, get: function () { return codegen_1.stringify; } });
		Object.defineProperty(exports, "nil", { enumerable: true, get: function () { return codegen_1.nil; } });
		Object.defineProperty(exports, "Name", { enumerable: true, get: function () { return codegen_1.Name; } });
		Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function () { return codegen_1.CodeGen; } });
		var validation_error_1 = /*@__PURE__*/ requireValidation_error();
		Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function () { return validation_error_1.default; } });
		var ref_error_1 = /*@__PURE__*/ requireRef_error();
		Object.defineProperty(exports, "MissingRefError", { enumerable: true, get: function () { return ref_error_1.default; } });
		
	} (ajv, ajv.exports));
	return ajv.exports;
}

var ajvExports = /*@__PURE__*/ requireAjv();
const Ajv = /*@__PURE__*/getDefaultExportFromCjs(ajvExports);

export { Ajv, requireAjv };
