// The mock deployer: it shifts no traffic and touches nothing outside NooblyJS. It applies the release through
// Infrastructure (I10), which checks the release's deploy approval and keeps what was there for a rollback; the
// percentage is recorded, not enforced. A real deployer (or the feature-flag tool [PLACEHOLDER]) does the shifting.
import { HttpError } from '../util/errors.js';

export function createMockDeployer({ host }) {
  const infra = () => {
    const s = host.service?.('infrastructure');
    if (typeof s?.deployRelease !== 'function') throw new HttpError(503, 'infrastructure_unavailable', 'Infrastructure is not running here, so nothing can be deployed.');
    return s;
  };
  return {
    name: 'mock',
    real: false,
    async deploy(release, { percent, by }) {
      return infra().deployRelease({ product: release.product, releaseId: release.id, approvalId: release.approvalId, version: release.version, deployed: release.deploys ?? [], percent, by });
    },
    async rollback(release, { reason, by }) {
      return infra().rollbackRelease({ product: release.product, releaseId: release.id, reason, by });
    },
  };
}
