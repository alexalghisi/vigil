import { MongoClient } from 'mongodb';

const CHECK_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const NAMESPACE_EXISTS = 48;

async function createChecksCollection(db) {
    try {
        await db.createCollection('checks', {
            timeseries: { timeField: 'at', metaField: 'monitorId', granularity: 'minutes' },
            expireAfterSeconds: CHECK_RETENTION_SECONDS,
        });
    } catch (error) {
        if (error.code !== NAMESPACE_EXISTS) {
            throw error;
        }
    }
}

export async function connect(url) {
    const client = await MongoClient.connect(url);
    const db = client.db();
    await createChecksCollection(db);
    await Promise.all([
        db.collection('users').createIndex({ email: 1 }, { unique: true }),
        db.collection('users').createIndex({ statusSlug: 1 }, { unique: true }),
        db.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true }),
        db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        db.collection('monitors').createIndex({ ownerId: 1, createdAt: 1 }),
        db.collection('monitors').createIndex({ paused: 1, nextCheckAt: 1 }),
        db.collection('incidents').createIndex({ ownerId: 1, startedAt: -1 }),
        db.collection('incidents').createIndex({ monitorId: 1, resolvedAt: 1 }),
    ]);
    return { client, db };
}
