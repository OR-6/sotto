// Side-effect module: installs the egress guard. Import it FIRST in every page entry,
// before anything that can reach the AI Logic SDK.
import { installEgressGuard } from './egress-guard';

export const egressGuard = installEgressGuard();
