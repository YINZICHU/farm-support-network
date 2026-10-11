import { projectConfig } from './project-config.js';
import { villageLabel } from './village-registry.js';
import { formatProjectTime } from './i18n.js';
export const serviceVillages = projectConfig.villages;
export const taskKinds = Object.freeze({ sorting: '轻量分拣', packing: '轻量包装', care: '经核实的短时田间照管' });
export const stateLabels = Object.freeze({ RECEIVED: '待核实', VERIFIED: '已核实', WAITLISTED: '候补', UNMATCHED: '未匹配', OUT_OF_SCOPE: '不合范围', WITHDRAWN: '已退出', MERGED: '已合并', CLOSED: '已结束', DRAFT: '待重新安排', AWAITING_CONFIRMATION: '待各方确认', CONFIRMED: '已正式确认', READY: '已交接', IN_SERVICE: '正在作业', AWAITING_ACCEPTANCE: '待双方验收', COMPLETED: '完整完成', PARTIAL: '部分完成', NOT_PERFORMED: '未执行', CANCELLED: '已取消', PREPARING: '筹备中', OPEN: '受理中', PAUSED: '暂停受理', ACTIVE: '可参与', PENDING: '待核实', EXITED: '已退出' });
export function villageName(id, locale = 'zh', villages = []) { return villageLabel(villages, id, locale); }
export function shanghaiTime(value, locale = 'zh') { return formatProjectTime(value, locale); }
