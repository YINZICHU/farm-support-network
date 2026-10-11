import { createHash } from 'node:crypto';

// Independent exact-byte approvals from manual review, not derived from the catalog.
export const approvedResourceBytes = Object.freeze(Object.fromEntries(Object.entries({
  "public/network-tools/healthcare-friction-action-planning-template-zh.xlsx": {
    "bytes": 11378,
    "sha256": "e3cd573ce755829e3a6d8b5b77f215e6a43db6b668c83d7982855ba4bd7ab5f5"
  },
  "public/network-tools/healthcare-friction-framework-zh.pdf": {
    "bytes": 216897,
    "sha256": "e481c1210ccf82b6ddb9f41680a7367d2b26018e8b43638492f6d175a6134e3f"
  },
  "public/network-tools/healthcare-friction-framework-en.pdf": {
    "bytes": 374584,
    "sha256": "0be64a6f5de58a97ebfc135ccc645b765dd3d7e51b7d9af371e0b51f897fbd4e"
  },
  "public/network-tools/farming-health-calendar-zh.png": {
    "bytes": 1925058,
    "sha256": "fb50aad028385bbb172259ef41eadb9bc790b67d35bfed2e33a85703b94256c2"
  },
  "public/network-tools/health-guide-front-zh.png": {
    "bytes": 2098088,
    "sha256": "1ab510cde3ce38d9262cafa75bd2d4526694cc03d87065ada1fc32948031782b"
  },
  "public/network-tools/health-guide-back-zh.png": {
    "bytes": 2031846,
    "sha256": "e7b7e7557012329babf76ce20c37470503bdd866227878fe1704bd00ec94de4e"
  },
  "public/network-tools/navigation-card-front-zh.png": {
    "bytes": 1759811,
    "sha256": "e2bf0006d10203468906a992ebf324b0522b5ac57746ace110ef7f0c81c88b94"
  },
  "public/network-tools/navigation-card-back-zh.png": {
    "bytes": 1889628,
    "sha256": "8c1674a1b0c95024d4eb522290f5bdfca0bcb185a1601263e6d1f9cd103f1fc8"
  },
  "public/network-tools/bus-care-card-zh.png": {
    "bytes": 1729524,
    "sha256": "cb439b6754e48f2fbf71c3b670cdaa2e499c49f6f33d57a03e3885fbee0f8411"
  },
  "public/network-tools/travel-reminder-zh.png": {
    "bytes": 1704764,
    "sha256": "d95bcded4da4923174acbbbc6a9d9760b40d86fb669c455966c7e130b1a8cc73"
  }
}).map(([path, entry]) => [path, Object.freeze(entry)])));
export function assertApprovedResource(path, bytes) {
  const approval = approvedResourceBytes[path];
  if (!approval || bytes.length !== approval.bytes || createHash('sha256').update(bytes).digest('hex') !== approval.sha256) throw Error('RESOURCE_NOT_APPROVED');
}
