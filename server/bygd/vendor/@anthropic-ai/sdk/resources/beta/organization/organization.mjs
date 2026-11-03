// Tua-plugin 0.5.13 — bygd av bygg.mjs 2026-11-03. IKKE REDIGER: kilden er server/*.js og node_modules.
import { APIResource } from '../../../core/resource.mjs';
import { APIKeys } from './api-keys.mjs';
import { ComplianceSettings } from './compliance-settings.mjs';
import { ExternalKeys } from './external-keys.mjs';
import { Invites } from './invites.mjs';
import { PluginMarketplaces } from './plugin-marketplaces.mjs';
import { RateLimits } from './rate-limits.mjs';
import { Users } from './users.mjs';
import { Webhooks } from './webhooks.mjs';
import { Analytics } from './analytics/analytics.mjs';
import { Federation } from './federation/federation.mjs';
import { Plugins } from './plugins/plugins.mjs';
import { RBACGroups } from './rbac-groups/rbac-groups.mjs';
import { RBACRoles } from './rbac-roles/rbac-roles.mjs';
import { ServiceAccounts } from './service-accounts/service-accounts.mjs';
import { SpendLimits } from './spend-limits/spend-limits.mjs';
import { TelemetryDestinations } from './telemetry-destinations/telemetry-destinations.mjs';
import { Workspaces } from './workspaces/workspaces.mjs';
import { startApiCallSpan } from '../../../internal/tracing.mjs';

var Organization = /* @__PURE__ */ (() => {
    class Organization extends APIResource {
        constructor() {
            super(...arguments);
            this.apiKeys = new APIKeys(this._client);
            this.externalKeys = new ExternalKeys(this._client);
            this.federation = new Federation(this._client);
            this.invites = new Invites(this._client);
            this.serviceAccounts = new ServiceAccounts(this._client);
            this.users = new Users(this._client);
            this.workspaces = new Workspaces(this._client);
            this.rateLimits = new RateLimits(this._client);
            this.complianceSettings = new ComplianceSettings(this._client);
            this.analytics = new Analytics(this._client);
            this.spendLimits = new SpendLimits(this._client);
            this.rbacGroups = new RBACGroups(this._client);
            this.rbacRoles = new RBACRoles(this._client);
            this.plugins = new Plugins(this._client);
            this.pluginMarketplaces = new PluginMarketplaces(this._client);
            this.telemetryDestinations = new TelemetryDestinations(this._client);
            this.webhooks = new Webhooks(this._client);
        }
        /**
         * Retrieve information about the organization associated with the authenticated
         * API key.
         *
         * @example
         * ```ts
         * const betaOrganization =
         *   await client.beta.organization.retrieve();
         * ```
         */
        retrieve(options) {
            return this._client.get('/v1/organizations/me?beta=true', {
                ...options,
                __span: startApiCallSpan(this._client, 'anthropic.organization.retrieve', options, {
                    route: '/v1/organizations/me',
                }),
            });
        }
    }
    Organization.APIKeys = APIKeys;
    Organization.ExternalKeys = ExternalKeys;
    Organization.Federation = Federation;
    Organization.Invites = Invites;
    Organization.ServiceAccounts = ServiceAccounts;
    Organization.Users = Users;
    Organization.Workspaces = Workspaces;
    Organization.RateLimits = RateLimits;
    Organization.ComplianceSettings = ComplianceSettings;
    Organization.Analytics = Analytics;
    Organization.SpendLimits = SpendLimits;
    Organization.RBACGroups = RBACGroups;
    Organization.RBACRoles = RBACRoles;
    Organization.Plugins = Plugins;
    Organization.PluginMarketplaces = PluginMarketplaces;
    Organization.TelemetryDestinations = TelemetryDestinations;
    Organization.Webhooks = Webhooks;
    return Organization;
})();

export { Organization };
