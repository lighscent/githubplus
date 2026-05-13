// Default settings
const DEFAULT_SETTINGS = {
    'badges-enabled': true,
    'pagination-enabled': true,
    'vscode-enabled': true,
    'repo-info-enabled': true,
    'contributors-enabled': true,
    'emails-enabled': true,
    'github-token': ''
};
const FORCE_REFRESH_KEY = 'force-refresh-generation';

let currentView = 'features';
let savedTokenValue = DEFAULT_SETTINGS['github-token'];

// Load version from manifest
function loadVersion() {
    const versionEl = document.getElementById('version');
    fetch(chrome.runtime.getURL('manifest.json'))
        .then(response => response.json())
        .then(data => {
            versionEl.textContent = `v${data.version}`;
        });
}

// Load settings from storage
function loadSettings() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
        document.getElementById('toggle-badges').checked = items['badges-enabled'];
        document.getElementById('toggle-pagination').checked = items['pagination-enabled'];
        document.getElementById('toggle-vscode').checked = items['vscode-enabled'];
        document.getElementById('toggle-repo-info').checked = items['repo-info-enabled'];
        document.getElementById('toggle-contributors').checked = items['contributors-enabled'];
        document.getElementById('toggle-private-email').checked = items['emails-enabled'];
        document.getElementById('github-token').value = items['github-token'];
        savedTokenValue = items['github-token'];

        updateFeatureStates(items['github-token']);
        updateSaveUI(false);
    });
}

// Save setting to storage
function saveSetting(key, value) {
    chrome.storage.sync.set({ [key]: value }, () => {
        // Notify content scripts about the change
        chrome.tabs.query({ url: 'https://github.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'SETTINGS_CHANGED',
                    setting: key,
                    value: value
                }).catch(() => {
                    // Tab might not have content script loaded
                });
            });
        });
    });

    // Update feature states if token changed
    if (key === 'github-token') {
        updateFeatureStates(value);
    }
}

function broadcastSettingChange(key, value) {
    chrome.tabs.query({ url: 'https://github.com/*' }, (tabs) => {
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
                type: 'SETTINGS_CHANGED',
                setting: key,
                value: value
            }).catch(() => {
                // Tab might not have content script loaded
            });
        });
    });
}

function requestForceRefresh() {
    const refreshStatus = document.getElementById('refresh-status');
    const nextGeneration = Date.now();

    chrome.storage.local.set({ [FORCE_REFRESH_KEY]: nextGeneration }, () => {
        if (refreshStatus) {
            refreshStatus.textContent = 'Refresh queued';
            refreshStatus.className = 'save-status success';
        }

        broadcastSettingChange(FORCE_REFRESH_KEY, nextGeneration);
    });
}

function updateSaveUI(isDirty, statusText = '') {
    const tokenInput = document.getElementById('github-token');
    const saveButton = document.getElementById('save-settings');
    const status = document.getElementById('save-status');

    if (!tokenInput || !saveButton || !status) return;

    tokenInput.classList.toggle('dirty', isDirty);
    saveButton.disabled = !isDirty;
    status.textContent = statusText;
    status.className = 'save-status';

    if (statusText) {
        status.classList.add(isDirty ? 'pending' : 'success');
    }
}

// Update feature states based on token availability
function updateFeatureStates(token) {
    const contributorsInput = document.getElementById('toggle-contributors');
    const repoInfoInput = document.getElementById('toggle-repo-info');
    const contributorsItem = contributorsInput?.closest('.toggle-item');
    const repoInfoItem = repoInfoInput?.closest('.toggle-item');
    if (!contributorsInput || !repoInfoInput || !contributorsItem || !repoInfoItem) return; // Guard against null elements

    const hasToken = token && token.trim() !== '';

    if (!hasToken) {
        contributorsInput.checked = false;
        contributorsInput.disabled = true;
        contributorsItem.classList.add('disabled');
        contributorsItem.setAttribute('aria-disabled', 'true');

        repoInfoInput.checked = false;
        repoInfoInput.disabled = true;
        repoInfoItem.classList.add('disabled');
        repoInfoItem.setAttribute('aria-disabled', 'true');

        // Add warning messages under both token-dependent options
        if (!contributorsItem.querySelector('.warning')) {
            const warning = document.createElement('small');
            warning.className = 'warning';
            warning.textContent = 'Set a GitHub token to enable this feature';
            contributorsItem.appendChild(warning);
        }
        if (!repoInfoItem.querySelector('.warning')) {
            const warning = document.createElement('small');
            warning.className = 'warning';
            warning.textContent = 'Set a GitHub token to enable this feature';
            repoInfoItem.appendChild(warning);
        }
    } else {
        contributorsInput.disabled = false;
        contributorsItem.removeAttribute('aria-disabled');
        contributorsItem.classList.remove('disabled');

        repoInfoInput.disabled = false;
        repoInfoItem.removeAttribute('aria-disabled');
        repoInfoItem.classList.remove('disabled');

        // Remove warning messages
        const contribWarning = contributorsItem.querySelector('.warning');
        if (contribWarning) contribWarning.remove();
        const repoWarning = repoInfoItem.querySelector('.warning');
        if (repoWarning) repoWarning.remove();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadVersion();
    loadSettings();

    // Settings toggle
    document.getElementById('settings-toggle').addEventListener('click', () => {
        const featuresSection = document.getElementById('features-section');
        const apiSection = document.getElementById('api-settings-section');
        const button = document.getElementById('settings-toggle');

        if (currentView === 'features') {
            featuresSection.classList.add('hidden');
            apiSection.classList.remove('hidden');
            currentView = 'settings';
            button.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 12H5"></path>
                    <path d="M12 19l-7-7 7-7"></path>
                </svg>
            `;
            button.title = 'Back to Features';
        } else {
            featuresSection.classList.remove('hidden');
            apiSection.classList.add('hidden');
            currentView = 'features';
            button.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
            `;
            button.title = 'API Settings';
        }
    });

    document.getElementById('toggle-badges').addEventListener('change', (e) => {
        saveSetting('badges-enabled', e.target.checked);
    });

    document.getElementById('toggle-pagination').addEventListener('change', (e) => {
        saveSetting('pagination-enabled', e.target.checked);
    });

    document.getElementById('toggle-vscode').addEventListener('change', (e) => {
        saveSetting('vscode-enabled', e.target.checked);
    });

    document.getElementById('toggle-repo-info').addEventListener('change', (e) => {
        saveSetting('repo-info-enabled', e.target.checked);
    });

    document.getElementById('toggle-contributors').addEventListener('change', (e) => {
        saveSetting('contributors-enabled', e.target.checked);
    });

    document.getElementById('toggle-private-email').addEventListener('change', (e) => {
        saveSetting('emails-enabled', e.target.checked);
    });

    document.getElementById('github-token').addEventListener('input', (e) => {
        const nextValue = e.target.value;
        updateFeatureStates(nextValue);
        updateSaveUI(nextValue !== savedTokenValue, nextValue !== savedTokenValue ? 'Unsaved changes' : '');
    });

    document.getElementById('save-settings').addEventListener('click', () => {
        const tokenValue = document.getElementById('github-token').value;
        saveSetting('github-token', tokenValue);
        savedTokenValue = tokenValue;
        updateSaveUI(false, 'Saved');
    });

    document.getElementById('force-refresh').addEventListener('click', () => {
        requestForceRefresh();
    });

    // Handle settings changes from other sources (e.g., content scripts)
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'SETTINGS_CHANGED' && request.setting === 'github-token') {
            savedTokenValue = request.value;
            const tokenInput = document.getElementById('github-token');
            if (tokenInput && tokenInput.value !== request.value) {
                tokenInput.value = request.value;
            }
            updateFeatureStates(request.value);
            updateSaveUI(false, 'Saved');
        }
    });
});
