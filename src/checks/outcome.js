export const FAILURE_THRESHOLD = 2;

export function applyResult(monitor, result, now) {
    const consecutiveFailures = result.ok ? 0 : monitor.consecutiveFailures + 1;
    let status = monitor.status;
    if (result.ok) {
        status = 'up';
    } else if (consecutiveFailures >= FAILURE_THRESHOLD) {
        status = 'down';
    }

    let incident = null;
    if (status === 'down' && monitor.status !== 'down') {
        incident = 'open';
    } else if (status === 'up' && monitor.status === 'down') {
        incident = 'resolve';
    }

    return {
        patch: { status, consecutiveFailures, lastCheckedAt: now, lastLatencyMs: result.latencyMs },
        incident,
    };
}
