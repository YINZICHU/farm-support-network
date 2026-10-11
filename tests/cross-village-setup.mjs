// Cross-village boundary regressions require two distinct scopes. For a
// one-village adopter, add a second fictional scope only in this test process.
// Never edit the config file. custom-config-scenario.mjs separately verifies
// actual one-village initialization, invitations and revocation without this.
import input from '../config/project.json' with { type: 'json' };
if (Array.isArray(input.villages) && input.villages.length === 1) input.villages.push({ id: input.villages[0].id === 'isolated-second' ? 'isolated-other' : 'isolated-second', zh: '隔离测试第二村', en: 'Isolated second test village' });
