import { listTrustedDevices, removeTrustedDevice } from './vault-sync.js';

const deviceList = document.getElementById('trusted-devices-list');
const deviceStatus = document.getElementById('trusted-devices-status');
const deviceRefreshButton = document.getElementById('trusted-devices-refresh');

function setDeviceStatus(message, state = 'info') {
    if (!deviceStatus) return;
    deviceStatus.textContent = message;
    deviceStatus.dataset.state = state;
}

function formatDeviceDate(value) {
    if (!Number.isFinite(value) || value <= 0) return 'Unknown';
    try {
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(new Date(value));
    } catch {
        return 'Unknown';
    }
}

async function refreshTrustedDevices() {
    if (!deviceList || !deviceRefreshButton) return;
    deviceRefreshButton.disabled = true;
    setDeviceStatus('Loading trusted devices…');
    deviceList.replaceChildren();
    try {
        const result = await listTrustedDevices();
        if (!result.devices.length) {
            setDeviceStatus('No trusted devices are registered.', 'success');
            return;
        }
        result.devices.forEach(device => {
            const item = document.createElement('li');
            item.className = 'trusted-device-item';
            const details = document.createElement('div');
            details.className = 'trusted-device-copy';
            const title = document.createElement('strong');
            title.textContent = device.isCurrent ? 'This device' : 'Device ' + device.deviceId.slice(0, 8);
            const lastUsed = document.createElement('span');
            lastUsed.textContent = 'Last sign-in: ' + formatDeviceDate(device.lastAuthenticatedAt);
            details.append(title, lastUsed);
            item.append(details);
            if (device.isCurrent) {
                const current = document.createElement('span');
                current.className = 'trusted-device-current';
                current.textContent = 'Current';
                item.append(current);
            } else {
                const removeButton = document.createElement('button');
                removeButton.type = 'button';
                removeButton.className = 'garden-action-button';
                removeButton.textContent = 'Remove';
                removeButton.addEventListener('click', async () => {
                    const accepted = window.confirm(
                        'Remove this trusted device? Its active sessions will be revoked. It must sign in again to reconnect.'
                    );
                    if (!accepted) return;
                    removeButton.disabled = true;
                    try {
                        const removed = await removeTrustedDevice(device.deviceId);
                        if (removed?.ok !== true || removed.removed !== true) {
                            throw new Error('The device removal was not confirmed.');
                        }
                        setDeviceStatus('The trusted device was removed and its active sessions were revoked.', 'success');
                        await refreshTrustedDevices();
                    } catch (error) {
                        setDeviceStatus(error?.message || 'The trusted device could not be removed.', 'error');
                        removeButton.disabled = false;
                    }
                });
                item.append(removeButton);
            }
            deviceList.append(item);
        });
        setDeviceStatus(result.devices.length + ' trusted device' + (result.devices.length === 1 ? '' : 's') + ' registered.', 'success');
    } catch (error) {
        setDeviceStatus(error?.message || 'The trusted-device list is unavailable.', 'error');
    } finally {
        deviceRefreshButton.disabled = false;
    }
}

deviceRefreshButton?.addEventListener('click', refreshTrustedDevices);
document.getElementById('trusted-devices-settings')?.addEventListener('toggle', event => {
    if (event.target.open) refreshTrustedDevices();
});
