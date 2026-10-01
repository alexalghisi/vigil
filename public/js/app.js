import { api } from './api.js';
import { byId, h, show } from './dom.js';
import { formatUptime, incidentRow, monitorCard, renderList } from './views.js';

const REFRESH_MS = 10_000;
let refreshTimer = null;

function report(target, error) {
    target.textContent = error.message;
    show(target, true);
}

function summaryTile(label, value, modifier = '') {
    return h(
        'div',
        { class: 'card stat' },
        h('span', { class: 'muted' }, label),
        h('span', { class: `stat__value ${modifier}`.trim() }, String(value)),
    );
}

function renderSummary(monitors) {
    const active = monitors.filter((monitor) => !monitor.paused);
    const up = active.filter((monitor) => monitor.status === 'up').length;
    const down = active.filter((monitor) => monitor.status === 'down').length;
    const measured = active.filter((monitor) => monitor.uptime !== null);
    const average = measured.length
        ? measured.reduce((sum, monitor) => sum + monitor.uptime, 0) / measured.length
        : null;
    byId('summary').replaceChildren(
        summaryTile('Monitors', monitors.length),
        summaryTile('Up', up, 'stat__value--up'),
        summaryTile('Down', down, down > 0 ? 'stat__value--down' : ''),
        summaryTile('Uptime, 24 h', formatUptime(average)),
    );
}

function monitorActions(monitor) {
    const act = (work) => () => work().then(refresh).catch((error) => report(byId('monitor-error'), error));
    return [
        h(
            'button',
            {
                class: 'button button--ghost button--small',
                type: 'button',
                onclick: act(() => api.updateMonitor(monitor.id, { paused: !monitor.paused })),
            },
            monitor.paused ? 'Resume' : 'Pause',
        ),
        h(
            'button',
            {
                class: 'button button--ghost button--small',
                type: 'button',
                'aria-label': `Delete ${monitor.name}`,
                onclick: act(() => api.removeMonitor(monitor.id)),
            },
            'Delete',
        ),
    ];
}

async function refresh() {
    const [monitors, incidents] = await Promise.all([api.monitors(), api.incidents()]);
    renderSummary(monitors);
    renderList(
        byId('monitors'),
        byId('monitors-empty'),
        monitors.map((monitor) => monitorCard(monitor, monitorActions(monitor))),
    );
    renderList(byId('incidents'), byId('incidents-empty'), incidents.map(incidentRow));
}

function showAuth() {
    clearInterval(refreshTimer);
    show(byId('dashboard'), false);
    show(byId('account'), false);
    show(byId('auth'), true);
}

async function showDashboard(user) {
    byId('account-email').textContent = user.email;
    byId('status-link').href = `/status/${user.statusSlug}`;
    show(byId('auth'), false);
    show(byId('account'), true);
    show(byId('dashboard'), true);
    await refresh();
    refreshTimer = setInterval(() => refresh().catch(showAuth), REFRESH_MS);
}

byId('auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    show(byId('auth-error'), false);
    try {
        const user = await api.authenticate(event.submitter.value, {
            email: data.get('email'),
            password: data.get('password'),
        });
        form.reset();
        await showDashboard(user);
    } catch (error) {
        report(byId('auth-error'), error);
    }
});

byId('monitor-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    show(byId('monitor-error'), false);
    try {
        await api.addMonitor({
            name: data.get('name'),
            url: data.get('url'),
            intervalSeconds: Number(data.get('intervalSeconds')),
        });
        form.reset();
        await refresh();
    } catch (error) {
        report(byId('monitor-error'), error);
    }
});

byId('sign-out').addEventListener('click', async () => {
    await api.signOut();
    showAuth();
});

api.me().then(showDashboard, showAuth);
