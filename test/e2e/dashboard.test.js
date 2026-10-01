import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { chromium } from 'playwright';

import { createProbe } from '../../src/checks/probe.js';
import { createScheduler } from '../../src/checks/scheduler.js';
import { silentLogger, startApi, startTarget } from '../support/harness.js';

let api;
let target;
let scheduler;
let browser;
let page;
const targetState = { status: 200 };
const consoleErrors = [];

before(async () => {
    api = await startApi({ allowPrivate: true });
    target = await startTarget((_req, res) => res.writeHead(targetState.status).end());
    scheduler = createScheduler({
        db: api.db,
        logger: silentLogger,
        clock: () => api.time.now,
        probe: createProbe({ guard: api.guard, timeoutMs: 500 }),
    });
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
});

beforeEach(async () => {
    await api.reset();
    api.time.now = new Date();
    targetState.status = 200;
    consoleErrors.length = 0;
    await page?.context().close();
    const context = await browser.newContext();
    page = await context.newPage();
    page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().includes('401')) {
            consoleErrors.push(message.text());
        }
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    await page.goto(api.origin);
});

after(async () => {
    await browser.close();
    await target.stop();
    await api.stop();
});

async function register() {
    await page.getByLabel('Email').fill('ada@example.com');
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByText('No monitors yet').waitFor();
}

async function addMonitor(name, url) {
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('URL').fill(url);
    await page.getByRole('button', { name: 'Add monitor' }).click();
    await page.locator(`[data-monitor="${name}"]`).waitFor();
}

async function runChecks(times) {
    for (let n = 0; n < times; n += 1) {
        await scheduler.runDue();
        api.time.now = new Date(api.time.now.getTime() + 60_000);
    }
}

test('a visitor registers, adds a monitor and watches it come up', async () => {
    await register();
    await addMonitor('Website', `${target.origin}/health`);
    const card = page.locator('[data-monitor="Website"]');
    assert.equal(await card.locator('.pill').textContent(), 'pending');

    await runChecks(1);
    await page.reload();
    await card.locator('.pill--up').waitFor();
    assert.match(await card.textContent(), /100\.00%/);
    assert.deepEqual(consoleErrors, []);
});

test('an outage shows on the dashboard and on the public status page', async () => {
    await register();
    await addMonitor('Website', `${target.origin}/health`);
    await runChecks(1);
    targetState.status = 500;
    await runChecks(2);

    await page.reload();
    await page.locator('[data-monitor="Website"] .pill--down').waitFor();
    await page.getByText('Expected 200, got 500').waitFor();

    const statusUrl = await page.getByRole('link', { name: 'Public status page' }).getAttribute('href');
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(api.origin + statusUrl);
    await visitor.getByText('1 of 1 services are down').waitFor();
    assert.ok(!(await visitor.content()).includes(target.origin));
    await visitor.context().close();
});

test('validation errors from the API are shown next to the form', async () => {
    await register();
    await page.getByLabel('Name').fill('Mirror');
    await page.getByLabel('URL').fill('ftp://example.com/pub');
    await page.getByRole('button', { name: 'Add monitor' }).click();
    await page.getByText('url: Only http and https targets can be monitored').waitFor();
});

test('monitor names are rendered as text, never as markup', async () => {
    await register();
    await addMonitor('<img src=x onerror=alert(1)>', 'https://example.com');
    assert.equal(await page.locator('.monitor__name img').count(), 0);
    assert.equal(await page.locator('.monitor__name').textContent(), '<img src=x onerror=alert(1)>');
});

test('pausing and deleting a monitor update the list', async () => {
    await register();
    await addMonitor('Website', 'https://example.com');
    const card = page.locator('[data-monitor="Website"]');
    await card.getByRole('button', { name: 'Pause' }).click();
    await card.locator('.pill--paused').waitFor();
    await card.getByRole('button', { name: 'Delete Website' }).click();
    await page.getByText('No monitors yet').waitFor();
});

test('signing out returns to the sign-in form and a reload stays signed out', async () => {
    await register();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('button', { name: 'Sign in' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Sign in' }).waitFor();

    await page.getByLabel('Email').fill('ada@example.com');
    await page.getByLabel('Password').fill('wrong password here');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText('Invalid email or password').waitFor();
});
