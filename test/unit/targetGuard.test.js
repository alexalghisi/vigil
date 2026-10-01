import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTargetGuard, isPublicAddress } from '../../src/checks/targetGuard.js';

const NON_PUBLIC = [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.9',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::7f00:1',
];

const PUBLIC = ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'];

for (const address of NON_PUBLIC) {
    test(`${address} is not a public address`, () => {
        assert.equal(isPublicAddress(address), false);
    });
}

for (const address of PUBLIC) {
    test(`${address} is a public address`, () => {
        assert.equal(isPublicAddress(address), true);
    });
}

test('a value that is not an address is never public', () => {
    assert.equal(isPublicAddress('localhost'), false);
});

function lookup(guard, hostname, options = {}) {
    return new Promise((resolve, reject) => {
        guard.lookup(hostname, options, (error, address, family) => {
            if (error) {
                reject(error);
            } else {
                resolve({ address, family });
            }
        });
    });
}

function resolvingTo(...addresses) {
    return async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

test('lookup hands back the address it validated', async () => {
    const guard = createTargetGuard({ resolve: resolvingTo('93.184.216.34') });
    assert.deepEqual(await lookup(guard, 'example.com'), { address: '93.184.216.34', family: 4 });
});

test('lookup rejects a hostname that resolves to loopback', async () => {
    const guard = createTargetGuard({ resolve: resolvingTo('127.0.0.1') });
    await assert.rejects(lookup(guard, 'internal.example.com'), { code: 'TARGET_BLOCKED' });
});

test('lookup rejects when any of several records is private', async () => {
    const guard = createTargetGuard({ resolve: resolvingTo('93.184.216.34', '10.0.0.5') });
    await assert.rejects(lookup(guard, 'rebind.example.com'), { code: 'TARGET_BLOCKED' });
});

test('lookup returns every record when asked for all', async () => {
    const guard = createTargetGuard({ resolve: resolvingTo('93.184.216.34', '2606:4700:4700::1111') });
    const { address } = await lookup(guard, 'example.com', { all: true });
    assert.deepEqual(address, [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
    ]);
});

test('lookup passes resolver failures through', async () => {
    const guard = createTargetGuard({
        resolve: async () => {
            throw new Error('ENOTFOUND');
        },
    });
    await assert.rejects(lookup(guard, 'nowhere.invalid'), /ENOTFOUND/);
});

test('a literal private address is refused before any request', () => {
    const guard = createTargetGuard();
    assert.throws(() => guard.assertLiteral('169.254.169.254'), { code: 'TARGET_BLOCKED' });
    assert.throws(() => guard.assertLiteral('[::1]'), { code: 'TARGET_BLOCKED' });
});

test('hostnames and public literals pass the literal check', () => {
    const guard = createTargetGuard();
    guard.assertLiteral('example.com');
    guard.assertLiteral('8.8.8.8');
});

test('private targets are permitted when explicitly allowed', async () => {
    const guard = createTargetGuard({ allowPrivate: true, resolve: resolvingTo('127.0.0.1') });
    guard.assertLiteral('127.0.0.1');
    assert.deepEqual(await lookup(guard, 'localhost'), { address: '127.0.0.1', family: 4 });
});
