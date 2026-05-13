(function () {
    let isEnabled = true;
    let currentPathname = window.location.pathname;

    chrome.storage.sync.get('emails-enabled', (items) => {
        isEnabled = items['emails-enabled'] !== false;
        syncPrivateEmailState();
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'SETTINGS_CHANGED' && request.setting === 'emails-enabled') {
            isEnabled = request.value;
            syncPrivateEmailState();
        } else if (request.type === 'SETTINGS_RESET') {
            isEnabled = true;
            syncPrivateEmailState();
        }
    });

    function syncPrivateEmailState() {
        if (window.location.pathname === currentPathname) {
            if (!isEnabled) {
                removePrivateEmailClick();
                return;
            }

            if (window.location.pathname.includes('/settings/emails')) {
                setupPrivateEmailCopy();
            } else {
                removePrivateEmailClick();
            }
            return;
        }

        currentPathname = window.location.pathname;

        if (!isEnabled || !window.location.pathname.includes('/settings/emails')) {
            removePrivateEmailClick();
            return;
        }

        setupPrivateEmailCopy();
    }

    function installNavigationWatcher() {
        if (window.__ghpEmailsNavigationWatcherInstalled) return;
        window.__ghpEmailsNavigationWatcherInstalled = true;

        const emitLocationChange = () => {
            window.dispatchEvent(new Event('ghp:locationchange'));
        };

        const wrapHistoryMethod = (method) => {
            const original = history[method];
            history[method] = function () {
                const result = original.apply(this, arguments);
                emitLocationChange();
                return result;
            };
        };

        wrapHistoryMethod('pushState');
        wrapHistoryMethod('replaceState');

        window.addEventListener('popstate', emitLocationChange);
        window.addEventListener('turbo:load', emitLocationChange);
        window.addEventListener('turbo:render', emitLocationChange);
        window.addEventListener('turbo:frame-load', emitLocationChange);
        window.addEventListener('ghp:locationchange', () => {
            setTimeout(syncPrivateEmailState, 0);
        });
    }

    function setupPrivateEmailCopy() {
        if (!window.location.pathname.includes('/settings/emails')) return;

        if (!document.getElementById('ghp-email-copy-styles')) {
            const style = document.createElement('style');
            style.id = 'ghp-email-copy-styles';
            style.textContent = `
                .ghp-email-clickable {
                    cursor: pointer;
                }

                .ghp-copy-tooltip {
                    position: absolute;
                    left: 50%;
                    transform: translateX(-50%);
                    bottom: calc(100% + 6px);
                    background: #238636;
                    color: white;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    pointer-events: none;
                    z-index: 1000;
                    white-space: nowrap;
                }
            `;
            document.head.appendChild(style);
        }

        const container = document.getElementById('settings-emails');
        if (!container) return;

        makeNoreplyClickable();
        makeListEmailsClickable();
        setupDelegationHandlers(container);
        setupMutationObserver(container);
    }

    function makeNoreplyClickable() {
        const noteEmail = document.querySelector('#toggle_visibility_note strong');
        if (!noteEmail || noteEmail.classList.contains('ghp-email-clickable')) return;

        const emailText = noteEmail.textContent.trim();

        noteEmail.classList.add('ghp-email-clickable');
        noteEmail.setAttribute('role', 'button');
        noteEmail.setAttribute('tabindex', '0');

        const handleClick = (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            performCopy(emailText, noteEmail);
        };

        const handleKeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopImmediatePropagation();
                performCopy(emailText, noteEmail);
            }
        };

        noteEmail.addEventListener('click', handleClick);
        noteEmail.addEventListener('keydown', handleKeydown);
    }

    function makeListEmailsClickable() {
        const container = document.getElementById('settings-emails');
        if (!container) return;

        const emailRegex = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/;
        const processedEmails = new Set();

        const isInsideClickable = (node) => Boolean(node.parentElement && node.parentElement.closest('.ghp-email-clickable'));

        const enhanceTextNode = (node) => {
            if (!node || !node.nodeValue || isInsideClickable(node)) return;

            const text = node.nodeValue;
            if (!text.includes('@')) return;

            const match = text.match(emailRegex);
            if (!match) return;

            const email = match[1];
            if (processedEmails.has(email)) return;
            processedEmails.add(email);

            const before = text.slice(0, match.index);
            const after = text.slice(match.index + email.length);

            const fragment = document.createDocumentFragment();
            if (before) fragment.appendChild(document.createTextNode(before));

            const emailSpan = document.createElement('span');
            emailSpan.textContent = email;
            emailSpan.className = 'ghp-email-clickable';
            emailSpan.setAttribute('role', 'button');
            emailSpan.setAttribute('tabindex', '0');
            fragment.appendChild(emailSpan);

            if (after) fragment.appendChild(document.createTextNode(after));

            node.parentNode.replaceChild(fragment, node);
        };

        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                if (!node || !node.nodeValue || !node.nodeValue.includes('@')) return NodeFilter.FILTER_REJECT;
                if (isInsideClickable(node)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        }, false);

        let node;
        while (node = walker.nextNode()) {
            enhanceTextNode(node);
        }
    }

    function setupDelegationHandlers(container) {
        if (!container.dataset.ghpDelegation) {
            container.addEventListener('click', (e) => {
                const target = e.target.closest('.ghp-email-clickable');
                if (!target) return;
                e.preventDefault();
                e.stopPropagation();
                performCopy(target.textContent.trim(), target);
            });

            container.addEventListener('keydown', (e) => {
                const target = e.target.closest('.ghp-email-clickable');
                if (!target || (e.key !== 'Enter' && e.key !== ' ')) return;
                e.preventDefault();
                e.stopPropagation();
                performCopy(target.textContent.trim(), target);
            });

            container.dataset.ghpDelegation = '1';
        }
    }

    function performCopy(email, targetElement) {
        const showTooltip = () => {
            const tooltip = document.createElement('div');
            tooltip.className = 'ghp-copy-tooltip';
            tooltip.textContent = 'Copied!';
            if (getComputedStyle(targetElement).position === 'static') {
                targetElement.style.position = 'relative';
            }
            targetElement.appendChild(tooltip);
            setTimeout(() => tooltip.remove(), 2000);
        };

        const fallbackCopy = () => {
            try {
                const textarea = document.createElement('textarea');
                textarea.value = email;
                textarea.style.position = 'fixed';
                textarea.style.top = '-9999px';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                const success = document.execCommand('copy');
                document.body.removeChild(textarea);
                return success;
            } catch (err) {
                return false;
            }
        };

        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(email).then(() => {
                showTooltip();
            }).catch(() => {
                if (fallbackCopy()) showTooltip();
            });
        } else if (fallbackCopy()) {
            showTooltip();
        }
    }

    function setupMutationObserver(container) {
        if (!container.dataset.ghpObserver) {
            let debounceTimeout;
            const observer = new MutationObserver(() => {
                if (debounceTimeout) clearTimeout(debounceTimeout);
                debounceTimeout = setTimeout(() => {
                    if (isEnabled && window.location.pathname.includes('/settings/emails')) {
                        setupPrivateEmailCopy();
                    }
                }, 300);
            });

            observer.observe(container, { childList: true, subtree: true, characterData: true });
            container.dataset.ghpObserver = '1';
        }
    }

    function removePrivateEmailClick() {
        document.querySelectorAll('.ghp-email-clickable').forEach(el => {
            const clone = el.cloneNode(true);
            clone.classList.remove('ghp-email-clickable');
            clone.removeAttribute('role');
            clone.removeAttribute('tabindex');
            if (clone.style) clone.style.cursor = '';
            el.parentNode.replaceChild(clone, el);
        });
    }

    installNavigationWatcher();

    setTimeout(() => {
        syncPrivateEmailState();
    }, 500);
})();