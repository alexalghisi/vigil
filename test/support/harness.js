import { createServer } from 'node:http';

import { createApp } from '../../src/app.js';
import { createTargetGuard } from '../../src/checks/targetGuard.js';
import { loadConfig } from '../../src/config.js';
import { connect } from '../../src/db.js';

const MONGODB_URL = process.env.MONGODB_URL ?? 'mongodb://127.0.0.1:27017/vigil_test';
const COLLECTIONS = ['users', 'sessions', 'monitors', 'checks', 'incidents'];

export const silentLogger = { info() {}, error() {} };

function listen(handler) {
    return new Promise((resolve) => {
        const server = createServer(handler).listen(0, '127.0.0.1', () => {
            resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

function close(server) {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
}

export async function startApi({ env = {}, allowPrivate = false } = {}) {
    const { client, db } = await connect(MONGODB_URL);
    const time = { now: new Date('2026-03-10T12:30:00Z') };
    const guard = createTargetGuard({ allowPrivate });
    const config = loadConfig({ AUTH_RATE_LIMIT: '1000', ...env });
    const app = createApp({ db, config, guard, logger: silentLogger, clock: () => time.now });
    const { server, origin } = await listen(app);

    return {
        db,
        guard,
        origin,
        time,
        async reset() {
            await Promise.all(COLLECTIONS.map((name) => db.collection(name).deleteMany({})));
        },
        async stop() {
            await close(server);
            await client.close();
        },
    };
}

export async function startTarget(respond) {
    const { server, origin } = await listen(respond);
    return { origin, stop: () => close(server) };
}

export function createClient(origin) {
    let cookie = '';

    async function request(method, path, body, headers = {}) {
        const response = await fetch(origin + path, {
            method,
            headers: {
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
                ...(cookie ? { cookie } : {}),
                ...headers,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const [setCookie] = response.headers.getSetCookie();
        if (setCookie) {
            cookie = setCookie.split(';')[0];
        }
        const text = await response.text();
        return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
    }

    return {
        get: (path) => request('GET', path),
        post: (path, body, headers) => request('POST', path, body, headers),
        patch: (path, body) => request('PATCH', path, body),
        delete: (path) => request('DELETE', path),
        async signUp(email = 'ada@example.com', password = 'correct horse battery') {
            const response = await request('POST', '/api/auth/register', { email, password });
            return response.body;
        },
    };
}
