import { projectConfig } from '../src/farm-support/project-config.js';
export const villageIds = projectConfig.villages.map(v => v.id);
export const [villageA, villageB] = villageIds;
