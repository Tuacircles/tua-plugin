// Tua-plugin 0.5.14 — bygd av bygg.mjs 2026-11-03. IKKE REDIGER: kilden er server/*.js og node_modules.
import { APIResource } from '../../../../../core/resource.mjs';
import { Chat } from './chat/chat.mjs';

var Apps = /* @__PURE__ */ (() => {
    class Apps extends APIResource {
        constructor() {
            super(...arguments);
            this.chat = new Chat(this._client);
        }
    }
    Apps.Chat = Chat;
    return Apps;
})();

export { Apps };
