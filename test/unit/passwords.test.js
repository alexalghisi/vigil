import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hashPassword, verifyPassword } from '../../src/auth/passwords.js';

test('a password verifies against its own hash', async () => {
    const hash = await hashPassword('correct horse battery');
    assert.equal(await verifyPassword('correct horse battery', hash), true);
});

test('a different password does not verify', async () => {
    const hash = await hashPassword('correct horse battery');
    assert.equal(await verifyPassword('correct horse batterz', hash), false);
});

test('the same password hashes differently every time', async () => {
    const [first, second] = await Promise.all([hashPassword('same password'), hashPassword('same password')]);
    assert.notEqual(first, second);
    assert.ok(!first.includes('same password'));
});
