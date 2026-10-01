import { Console } from 'node:console';

import { createApp } from './app.js';
import { createProbe } from './checks/probe.js';
import { createScheduler } from './checks/scheduler.js';
import { createTargetGuard } from './checks/targetGuard.js';
import { loadConfig } from './config.js';
import { connect } from './db.js';

const logger = new Console(process.stdout, process.stderr);
const config = loadConfig(process.env);
const { client, db } = await connect(config.mongodbUrl);
const guard = createTargetGuard({ allowPrivate: config.allowPrivateTargets });
const scheduler = createScheduler({
    db,
    logger,
    clock: () => new Date(),
    probe: createProbe({ guard, timeoutMs: config.probeTimeoutMs }),
});

const server = createApp({ db, config, guard, logger }).listen(config.port, () => {
    logger.info(`vigil listening on http://localhost:${config.port}`);
});
scheduler.start(config.schedulerTickMs);

async function shutdown() {
    await scheduler.stop();
    server.close(async () => {
        await client.close();
    });
    server.closeIdleConnections();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
