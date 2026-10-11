// Deterministic recommendations only: no private text sent to an AI service,
// no reservation, no inferred skills, consent or availability.
const overlap = (a, b) => a.start < b.end && b.start < a.end;
const dayMs = 86400000;
const shanghaiOffset = 28800000;

export function normalizePattern(input, reject) {
  if (input == null) return null;
  const minute = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
  const start = minute(input.start), end = minute(input.end), days = input.days;
  if (!Array.isArray(days) || !days.length || days.length > 7 || new Set(days).size !== days.length
    || !days.every(d => Number.isInteger(d) && d >= 1 && d <= 7)
    || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) reject('INVALID_PATTERN', 400);
  return { days: [...days].sort((a, b) => a - b), start: input.start, end: input.end };
}

function coversPattern(pattern, range) {
  const start = range.start + shanghaiOffset, end = range.end + shanghaiOffset;
  if (Math.floor(start / dayMs) !== Math.floor((end - 1) / dayMs)) return false;
  const weekday = new Date(start).getUTCDay() || 7;
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  return pattern.days.includes(weekday) && start % dayMs >= minutes(pattern.start) * 60000
    && end % dayMs >= start % dayMs && end % dayMs <= minutes(pattern.end) * 60000;
}

export function personIsBusy(state, person, range, now, excluded = null) {
  return state.bookings.some(b => b.order !== excluded && b.person === person
    && (b.kind === 'confirmed' || b.expires > now) && overlap(b, range))
    || state.orders.some(o => o.id !== excluded && o.status === 'IN_SERVICE'
      && [o.activeProvider, o.terms.backup].includes(person));
}

export function recommendPeople(state, request, range, now) {
  const candidates = [];
  for (const p of state.people) {
    if (p.status !== 'ACTIVE' || !p.consent || !p.skills.includes(request.task) || !p.villages.includes(request.village)
      || personIsBusy(state, p.id, range, now)) continue;
    const confirmed = p.availability.some(a => a.start <= range.start && a.end >= range.end);
    if (!confirmed && p.pattern && !coversPattern(p.pattern, range)) continue;
    const availabilityStatus = confirmed ? 'confirmed' : p.pattern ? 'usual' : 'needs-confirmation';
    candidates.push({ id: p.id, code: p.code, availabilityStatus, reasons: [
      '已核实相应技能', '本人登记愿意服务该村', '未发现排班占用冲突（含往返与交接）',
      confirmed ? '已记录覆盖该时段的本人确认；接单仍需联系'
        : p.pattern ? '通常可用星期和时段相符；本次日期仍需本人确认' : '尚无该时段资料；先联系核实是否有空',
    ] });
  }
  const rank = { confirmed: 0, usual: 1, 'needs-confirmation': 2 };
  candidates.sort((a, b) => rank[a.availabilityStatus] - rank[b.availabilityStatus]
    || a.code.localeCompare(b.code, 'en', { numeric: true }) || a.id.localeCompare(b.id));
  return candidates;
}
