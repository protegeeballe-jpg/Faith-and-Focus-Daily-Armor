/*
 * Faith & Focus: Daily Armor — Diary tabs (phone layout helper).
 *
 * Adds a Notes / Location / Voice tab bar inside the Diary and tells
 * mobile.css which section to show. It only changes what is visible; it never
 * reads, writes, encrypts, or syncs any Diary data. On wide screens the tab bar
 * stays hidden by CSS, and if this script fails to run, every section simply
 * stays visible as before.
 */
const TABS = [
    { id: 'notes', label: 'Notes' },
    { id: 'location', label: 'Location' },
    { id: 'voice', label: 'Voice' }
];

function setupDiaryTabs() {
    const panel = document.getElementById('diary-editor-panel');
    if (!panel) return false;
    if (panel.querySelector('.ff-diary-tabs')) return true;

    const bar = document.createElement('div');
    bar.className = 'ff-diary-tabs';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Diary sections');

    const buttons = TABS.map(tab => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ff-diary-tab';
        button.dataset.tab = tab.id;
        button.setAttribute('role', 'tab');
        button.textContent = tab.label;
        bar.appendChild(button);
        return button;
    });

    function select(tabId, { focus = false } = {}) {
        panel.dataset.ffTab = tabId;
        buttons.forEach(button => {
            const active = button.dataset.tab === tabId;
            button.setAttribute('aria-selected', active ? 'true' : 'false');
            button.tabIndex = active ? 0 : -1;
            if (active && focus) button.focus();
        });
    }

    buttons.forEach((button, index) => {
        button.addEventListener('click', () => select(button.dataset.tab));
        button.addEventListener('keydown', event => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            event.preventDefault();
            const step = event.key === 'ArrowRight' ? 1 : -1;
            const next = buttons[(index + step + buttons.length) % buttons.length];
            select(next.dataset.tab, { focus: true });
        });
    });

    const toolbar = panel.querySelector('.diary-current-toolbar');
    if (toolbar) toolbar.after(bar);
    else panel.insertBefore(bar, panel.firstChild);

    // While a recording is running, keep its Stop button on screen.
    const recordText = document.getElementById('record-text');
    if (recordText) {
        new MutationObserver(() => {
            if (/stop/i.test(recordText.textContent || '')) select('voice');
        }).observe(recordText, { childList: true, characterData: true, subtree: true });
    }

    panel.dataset.ffTabs = 'on';
    select('notes');
    return true;
}

function start() {
    if (setupDiaryTabs()) return;
    // The Diary panel may be created later; try again once the account opens.
    window.addEventListener('faith-focus:app-unlocked', setupDiaryTabs, { once: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
    start();
}
