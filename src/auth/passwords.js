import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password) {
    const salt = randomBytes(16);
    const key = await derive(password, salt, KEY_LENGTH);
    return `${salt.toString('base64url')}.${key.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
    const [salt, key] = stored.split('.').map((part) => Buffer.from(part, 'base64url'));
    const candidate = await derive(password, salt, KEY_LENGTH);
    return timingSafeEqual(candidate, key);
}
