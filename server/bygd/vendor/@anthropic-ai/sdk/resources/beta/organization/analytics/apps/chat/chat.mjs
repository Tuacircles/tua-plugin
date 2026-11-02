// Tua-plugin 0.5.11 — bygd av bygg.mjs 2026-11-02. IKKE REDIGER: kilden er server/*.js og node_modules.
import { APIResource } from '../../../../../../core/resource.mjs';
import { Projects } from './projects.mjs';

var Chat = /* @__PURE__ */ (() => {
    class Chat extends APIResource {
        constructor() {
            super(...arguments);
            this.projects = new Projects(this._client);
        }
    }
    Chat.Projects = Projects;
    return Chat;
})();

export { Chat };
