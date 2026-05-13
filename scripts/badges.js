(function () {
    let isEnabled = true;
    
    const STYLES = {
        'Public': { border: '2px solid #2da44e', color: '#2da44e' },
        'Private': { border: '2px solid #cf222e', color: '#cf222e' },
        'Public template': { border: '2px solid #0969da', color: '#0969da' },
        'Private template': { border: '2px solid #bf3989', color: '#bf3989' },
        'Private archive': { border: '2px solid #8250df', color: '#8250df' },
        'Public archive': { border: '2px solid #d29922', color: '#d29922' }
    };

    // Check if badges are enabled
    chrome.storage.sync.get('badges-enabled', (items) => {
        isEnabled = items['badges-enabled'] !== false;
        applyStyles();
    });

    // Listen for settings changes
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'SETTINGS_CHANGED' && request.setting === 'badges-enabled') {
            isEnabled = request.value;
            applyStyles();
        } else if (request.type === 'SETTINGS_RESET') {
            isEnabled = true;
            applyStyles();
        }
    });

    function applyStyles() {
        // Select all potential badge elements (without the :not filter so we can reprocess them)
        const badges = document.querySelectorAll('span.Label, span[class*="prc-Label-Label"]');

        badges.forEach(badge => {
            if (!isEnabled) {
                // Remove styles if disabled
                badge.style.border = '';
                badge.style.color = '';
                badge.style.borderRadius = '';
                badge.removeAttribute('data-ghp-styled');
                return;
            }

            const text = badge.textContent.trim();
            const style = STYLES[text];
            if (style) {
                Object.assign(badge.style, style);
                badge.style.borderRadius = '2em';
                badge.setAttribute('data-ghp-styled', 'true');
            }
        });
    }

    let debounceFrame;
    const observer = new MutationObserver(() => {
        if (debounceFrame) cancelAnimationFrame(debounceFrame);
        debounceFrame = requestAnimationFrame(applyStyles);
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();