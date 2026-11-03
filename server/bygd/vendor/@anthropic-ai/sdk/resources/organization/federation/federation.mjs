// Tua-plugin 0.5.13 — bygd av bygg.mjs 2026-11-03. IKKE REDIGER: kilden er server/*.js og node_modules.
import { APIResource } from '../../../core/resource.mjs';
import { Issuers } from './issuers.mjs';
import { Rules } from './rules/rules.mjs';

var Federation = /* @__PURE__ */ (() => {
    class Federation extends APIResource {
        constructor() {
            super(...arguments);
            this.issuers = new Issuers(this._client);
            this.rules = new Rules(this._client);
        }
    }
    Federation.Issuers = Issuers;
    Federation.Rules = Rules;
    return Federation;
})();

export { Federation };
