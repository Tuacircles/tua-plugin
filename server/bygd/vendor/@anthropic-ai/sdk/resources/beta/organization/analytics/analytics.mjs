// Tua-plugin 0.5.12 — bygd av bygg.mjs 2026-11-02. IKKE REDIGER: kilden er server/*.js og node_modules.
import { APIResource } from '../../../../core/resource.mjs';
import { Artifacts } from './artifacts.mjs';
import { Connectors } from './connectors.mjs';
import { Cost } from './cost.mjs';
import { CostReport } from './cost-report.mjs';
import { Plugins } from './plugins.mjs';
import { Skills } from './skills.mjs';
import { Summaries } from './summaries.mjs';
import { Usage } from './usage.mjs';
import { UsageReport } from './usage-report.mjs';
import { UserCostReport } from './user-cost-report.mjs';
import { UserUsageReport } from './user-usage-report.mjs';
import { Users } from './users.mjs';
import { Apps } from './apps/apps.mjs';

var Analytics = /* @__PURE__ */ (() => {
    class Analytics extends APIResource {
        constructor() {
            super(...arguments);
            this.summaries = new Summaries(this._client);
            this.users = new Users(this._client);
            this.apps = new Apps(this._client);
            this.connectors = new Connectors(this._client);
            this.plugins = new Plugins(this._client);
            this.skills = new Skills(this._client);
            this.artifacts = new Artifacts(this._client);
            this.usage = new Usage(this._client);
            this.cost = new Cost(this._client);
            this.usageReport = new UsageReport(this._client);
            this.userUsageReport = new UserUsageReport(this._client);
            this.costReport = new CostReport(this._client);
            this.userCostReport = new UserCostReport(this._client);
        }
    }
    Analytics.Summaries = Summaries;
    Analytics.Users = Users;
    Analytics.Apps = Apps;
    Analytics.Connectors = Connectors;
    Analytics.Plugins = Plugins;
    Analytics.Skills = Skills;
    Analytics.Artifacts = Artifacts;
    Analytics.Usage = Usage;
    Analytics.Cost = Cost;
    Analytics.UsageReport = UsageReport;
    Analytics.UserUsageReport = UserUsageReport;
    Analytics.CostReport = CostReport;
    Analytics.UserCostReport = UserCostReport;
    return Analytics;
})();

export { Analytics };
