import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { createClient, startApi } from '../support/harness.js';

let api;
let client;

before(async () => {
    api = await startApi();
});

beforeEach(async () => {
    await api.reset();
    client = createClient(api.origin);
});

after(() => api.stop());

const credentials = { email: 'ada@example.com', password: 'correct horse battery' };

test('registering creates an account and signs the user in', async () => {
    const response = await client.post('/api/auth/register', credentials);
    assert.equal(response.status, 201);
    assert.equal(response.body.email, 'ada@example.com');
    assert.match(response.body.statusSlug, /^[A-Za-z0-9_-]{12}$/);
    assert.deepEqual(Object.keys(response.body).sort(), ['email', 'id', 'statusSlug']);

    const me = await client.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.email, 'ada@example.com');
});

test('the session cookie is not readable by scripts and never sent cross-site', async () => {
    const response = await client.post('/api/auth/register', credentials);
    const [cookie] = response.headers.getSetCookie();
    assert.match(cookie, /^vigil_session=[A-Za-z0-9_-]{43};/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
});

test('passwords and session tokens are stored only as hashes', async () => {
    const response = await client.post('/api/auth/register', credentials);
    const token = response.headers.getSetCookie()[0].split(';')[0].split('=')[1];
    const user = await api.db.collection('users').findOne({});
    const session = await api.db.collection('sessions').findOne({});
    assert.ok(!JSON.stringify(user).includes(credentials.password));
    assert.ok(!JSON.stringify(session).includes(token));
});

test('the email address is case-insensitive and unique', async () => {
    await client.post('/api/auth/register', credentials);
    const duplicate = await createClient(api.origin).post('/api/auth/register', {
        ...credentials,
        email: 'Ada@Example.com',
    });
    assert.equal(duplicate.status, 409);
});

test('weak or malformed credentials are rejected with field details', async () => {
    const response = await client.post('/api/auth/register', { email: 'not-an-email', password: 'short' });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.details.map((detail) => detail.field).sort(), ['email', 'password']);
});

test('logging in with the right password opens a session', async () => {
    await client.signUp();
    const other = createClient(api.origin);
    const response = await other.post('/api/auth/login', credentials);
    assert.equal(response.status, 200);
    assert.equal((await other.get('/api/auth/me')).status, 200);
});

test('a wrong password and an unknown email are indistinguishable', async () => {
    await client.signUp();
    const other = createClient(api.origin);
    const wrongPassword = await other.post('/api/auth/login', { ...credentials, password: 'incorrect horse battery' });
    const unknownEmail = await other.post('/api/auth/login', { ...credentials, email: 'nobody@example.com' });
    assert.equal(wrongPassword.status, 401);
    assert.deepEqual(wrongPassword.body, unknownEmail.body);
});

test('query operators in place of credentials never reach the database', async () => {
    await client.signUp();
    const other = createClient(api.origin);
    const response = await other.post('/api/auth/login', { email: { $ne: null }, password: { $ne: null } });
    assert.equal(response.status, 400);
    assert.equal((await other.get('/api/auth/me')).status, 401);
});

test('unexpected fields are refused', async () => {
    const response = await client.post('/api/auth/register', { ...credentials, role: 'admin' });
    assert.equal(response.status, 400);
});

test('logging out revokes the session on the server', async () => {
    const response = await client.post('/api/auth/register', credentials);
    const stolen = response.headers.getSetCookie()[0].split(';')[0];
    assert.equal((await client.post('/api/auth/logout', {})).status, 204);

    const replay = await fetch(`${api.origin}/api/auth/me`, { headers: { cookie: stolen } });
    assert.equal(replay.status, 401);
});

test('a session stops working once it expires', async () => {
    await client.signUp();
    api.time.now = new Date(api.time.now.getTime() + 8 * 24 * 60 * 60 * 1000);
    assert.equal((await client.get('/api/auth/me')).status, 401);
    api.time.now = new Date('2026-03-10T12:30:00Z');
});

test('protected routes require a session', async () => {
    for (const path of ['/api/auth/me', '/api/monitors', '/api/incidents']) {
        assert.equal((await client.get(path)).status, 401, path);
    }
});
