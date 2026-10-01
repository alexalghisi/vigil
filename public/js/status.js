import { api } from './api.js';
import { byId, show } from './dom.js';
import { incidentRow, monitorCard, renderList } from './views.js';

const REFRESH_MS = 30_000;
const slug = window.location.pathname.split('/').pop();

function renderBanner(monitors) {
    const banner = byId('banner');
    const down = monitors.filter((monitor) => monitor.status === 'down').length;
    banner.textContent = down === 0 ? 'All systems operational' : `${down} of ${monitors.length} services are down`;
    banner.classList.toggle('banner--down', down > 0);
    show(banner, true);
}

async function refresh() {
    const { monitors, incidents } = await api.status(slug);
    renderBanner(monitors);
    byId('monitors').replaceChildren(...monitors.map((monitor) => monitorCard(monitor)));
    renderList(byId('incidents'), byId('incidents-empty'), incidents.map(incidentRow));
}

function unavailable() {
    const banner = byId('banner');
    banner.textContent = 'This status page does not exist';
    banner.classList.add('banner--down');
    show(banner, true);
}

refresh().then(() => setInterval(refresh, REFRESH_MS), unavailable);
