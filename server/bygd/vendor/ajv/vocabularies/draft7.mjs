// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { requireCore } from './core/index.mjs';
import { requireValidation } from './validation/index.mjs';
import { requireApplicator } from './applicator/index.mjs';
import { requireFormat } from './format/index.mjs';
import { requireMetadata } from './metadata.mjs';

var draft7 = {};

var hasRequiredDraft7;

function requireDraft7 () {
	if (hasRequiredDraft7) return draft7;
	hasRequiredDraft7 = 1;
	Object.defineProperty(draft7, "__esModule", { value: true });
	const core_1 = /*@__PURE__*/ requireCore();
	const validation_1 = /*@__PURE__*/ requireValidation();
	const applicator_1 = /*@__PURE__*/ requireApplicator();
	const format_1 = /*@__PURE__*/ requireFormat();
	const metadata_1 = /*@__PURE__*/ requireMetadata();
	const draft7Vocabularies = [
	    core_1.default,
	    validation_1.default,
	    (0, applicator_1.default)(),
	    format_1.default,
	    metadata_1.metadataVocabulary,
	    metadata_1.contentVocabulary,
	];
	draft7.default = draft7Vocabularies;
	
	return draft7;
}

export { requireDraft7 };
