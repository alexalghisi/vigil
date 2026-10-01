import http from 'node:http';
import https from 'node:https';

const USER_AGENT = 'vigil-uptime/0.1';

export function createProbe({ guard, timeoutMs, clock = () => performance.now() }) {
    return function probe(monitor) {
        const url = new URL(monitor.url);
        const transport = url.protocol === 'https:' ? https : http;
        const startedAt = clock();
        const elapsed = () => Math.round(clock() - startedAt);
        const failure = (error) => ({ ok: false, statusCode: null, latencyMs: elapsed(), error });

        return new Promise((resolve) => {
            try {
                guard.assertLiteral(url.hostname);
            } catch (error) {
                resolve(failure(error.message));
                return;
            }
            const request = transport.request(
                url,
                {
                    method: 'GET',
                    lookup: guard.lookup,
                    agent: false,
                    timeout: timeoutMs,
                    headers: { 'user-agent': USER_AGENT, accept: '*/*' },
                },
                (response) => {
                    response.resume();
                    const ok = response.statusCode === monitor.expectedStatus;
                    resolve({
                        ok,
                        statusCode: response.statusCode,
                        latencyMs: elapsed(),
                        error: ok ? null : `Expected ${monitor.expectedStatus}, got ${response.statusCode}`,
                    });
                    request.destroy();
                },
            );
            request.on('timeout', () => request.destroy(new Error(`No response within ${timeoutMs} ms`)));
            request.on('error', (error) => resolve(failure(error.message)));
            request.end();
        });
    };
}
