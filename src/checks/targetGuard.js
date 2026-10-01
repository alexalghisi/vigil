import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const NON_PUBLIC_V4 = [
    '0.0.0.0/8',
    '10.0.0.0/8',
    '100.64.0.0/10',
    '127.0.0.0/8',
    '169.254.0.0/16',
    '172.16.0.0/12',
    '192.0.0.0/24',
    '192.168.0.0/16',
    '198.18.0.0/15',
    '224.0.0.0/4',
    '240.0.0.0/4',
];
const NON_PUBLIC_V6 = ['::/127', '64:ff9b::/96', 'fc00::/7', 'fe80::/10', 'ff00::/8'];
const MAPPED_V4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

function subnet(cidr) {
    const [network, prefix] = cidr.split('/');
    return { network, prefix: Number(prefix) };
}

const blocked = new BlockList();
for (const { network, prefix } of NON_PUBLIC_V4.map(subnet)) {
    blocked.addSubnet(network, prefix, 'ipv4');
}
for (const { network, prefix } of NON_PUBLIC_V6.map(subnet)) {
    blocked.addSubnet(network, prefix, 'ipv6');
}

export class TargetBlockedError extends Error {
    constructor(address) {
        super(`Target resolves to a non-public address (${address})`);
        this.code = 'TARGET_BLOCKED';
    }
}

export function isPublicAddress(address) {
    const mapped = MAPPED_V4.exec(address);
    if (mapped) {
        return !blocked.check(mapped[1], 'ipv4');
    }
    const family = isIP(address);
    if (family === 0) {
        return false;
    }
    return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function resolveAll(hostname) {
    return dnsLookup(hostname, { all: true });
}

export function createTargetGuard({ allowPrivate = false, resolve = resolveAll } = {}) {
    const permits = (address) => allowPrivate || isPublicAddress(address);

    return {
        assertLiteral(hostname) {
            const host = hostname.replace(/^\[|\]$/g, '');
            if (isIP(host) !== 0 && !permits(host)) {
                throw new TargetBlockedError(host);
            }
        },

        lookup(hostname, options, callback) {
            resolve(hostname)
                .then((addresses) => {
                    const rejected = addresses.find(({ address }) => !permits(address));
                    if (rejected) {
                        throw new TargetBlockedError(rejected.address);
                    }
                    if (options.all) {
                        callback(null, addresses);
                    } else {
                        callback(null, addresses[0].address, addresses[0].family);
                    }
                })
                .catch((error) => callback(error));
        },
    };
}
