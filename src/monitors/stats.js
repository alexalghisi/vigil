const HOUR_MS = 60 * 60 * 1000;
export const WINDOW_HOURS = 24;

function startOfHour(date) {
    return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

export function summarise(rows, now) {
    const byHour = new Map(rows.map((row) => [row.hour.getTime(), row]));
    const lastHour = startOfHour(now).getTime();
    const buckets = [];
    let total = 0;
    let up = 0;
    for (let offset = WINDOW_HOURS - 1; offset >= 0; offset -= 1) {
        const hour = lastHour - offset * HOUR_MS;
        const row = byHour.get(hour);
        total += row?.total ?? 0;
        up += row?.up ?? 0;
        buckets.push({
            hour: new Date(hour).toISOString(),
            total: row?.total ?? 0,
            up: row?.up ?? 0,
            avgLatencyMs: row ? Math.round(row.avgLatencyMs) : null,
        });
    }
    return {
        uptime: total === 0 ? null : Math.round((up / total) * 10_000) / 100,
        buckets,
    };
}

export async function loadStats(db, monitorIds, now) {
    const since = new Date(startOfHour(now).getTime() - (WINDOW_HOURS - 1) * HOUR_MS);
    const rows = await db
        .collection('checks')
        .aggregate([
            { $match: { monitorId: { $in: monitorIds }, at: { $gte: since, $lte: now } } },
            {
                $group: {
                    _id: { monitorId: '$monitorId', hour: { $dateTrunc: { date: '$at', unit: 'hour' } } },
                    total: { $sum: 1 },
                    up: { $sum: { $cond: ['$ok', 1, 0] } },
                    avgLatencyMs: { $avg: '$latencyMs' },
                },
            },
        ])
        .toArray();

    const grouped = new Map(monitorIds.map((id) => [id.toString(), []]));
    for (const { _id, ...row } of rows) {
        grouped.get(_id.monitorId.toString()).push({ hour: _id.hour, ...row });
    }
    return new Map([...grouped].map(([id, monitorRows]) => [id, summarise(monitorRows, now)]));
}
