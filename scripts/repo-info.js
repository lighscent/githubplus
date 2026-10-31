(function () {
    let isEnabled = true;
    let repoInfoCache = null;
    let repoInfoFetchPromise = null;
    let cachedRepoKey = null;
    let cachedExpiresAt = null;
    let githubToken = '';
    let refreshTimerId = null;
    let repoInfoObserver = null;
    let repoInfoDebounceTimeout = null;
    const CACHE_NAMESPACE = 'repo-info-cache';
    const FORCE_REFRESH_KEY = 'force-refresh-generation';
    let forceRefreshGeneration = 0;

    // Listen for settings changes
    chrome.storage.sync.get(['repo-info-enabled', 'github-token'], (items) => {
        isEnabled = items['repo-info-enabled'] !== false;
        githubToken = items['github-token'] || '';
        chrome.storage.local.get([FORCE_REFRESH_KEY], (localItems) => {
            forceRefreshGeneration = localItems[FORCE_REFRESH_KEY] || 0;
            manageRepoInfo();
        });
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'SETTINGS_CHANGED') {
            if (request.setting === 'repo-info-enabled') {
                isEnabled = request.value;
                manageRepoInfo();
            } else if (request.setting === 'github-token') {
                githubToken = request.value;
                manageRepoInfo();
            } else if (request.setting === FORCE_REFRESH_KEY) {
                forceRefreshGeneration = request.value || 0;
                repoInfoCache = null;
                cachedExpiresAt = null;
                manageRepoInfo();
            }
        } else if (request.type === 'SETTINGS_RESET') {
            isEnabled = true;
            githubToken = '';
            manageRepoInfo();
        }
    });

    function manageRepoInfo() {
        if (!isEnabled) {
            removeRepoInfo();
            return;
        }

        if (hasVisibleRepoInfo()) {
            ensureStatsSection();
            return;
        }

        displayRepoInfo();
    }

    function hasVisibleRepoInfo() {
        const statsSection = document.getElementById('ghp-repo-stats-section');
        return !!statsSection && statsSection.style.display !== 'none' && statsSection.childElementCount > 0;
    }

    function getNextRefreshDate() {
        const now = new Date();
        const nextRefresh = new Date(now);
        nextRefresh.setHours(2, 0, 0, 0);

        if (now >= nextRefresh) {
            nextRefresh.setDate(nextRefresh.getDate() + 1);
        }

        return nextRefresh;
    }

    function getNextRefreshTimestamp() {
        return getNextRefreshDate().getTime();
    }

    function isCacheValid(expiresAt) {
        return Number.isFinite(expiresAt) && Date.now() < expiresAt;
    }

    function isForcedRefreshPending(cacheGeneration) {
        return forceRefreshGeneration > 0 && (cacheGeneration || 0) < forceRefreshGeneration;
    }

    function formatRemainingTime() {
        const now = new Date();
        const nextRefresh = getNextRefreshDate();
        const diffMs = Math.max(0, nextRefresh.getTime() - now.getTime());
        const totalMinutes = Math.floor(diffMs / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        if (hours === 0) {
            return `${minutes}m until refresh`;
        }

        return `${hours}h ${minutes}m until refresh`;
    }

    function updateRefreshCountdown() {
        const countdown = document.getElementById('ghp-repo-refresh-countdown');
        if (!countdown) return;

        countdown.textContent = formatRemainingTime();
    }

    function getCacheKey(repoKey) {
        return `${CACHE_NAMESPACE}:${repoKey}`;
    }

    function readStoredCache(repoKey) {
        return new Promise((resolve) => {
            chrome.storage.local.get(getCacheKey(repoKey), (items) => {
                resolve(items[getCacheKey(repoKey)] || null);
            });
        });
    }

    function writeStoredCache(repoKey, payload) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ [getCacheKey(repoKey)]: payload }, () => resolve());
        });
    }

    function getApiHeaders() {
        return {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            Authorization: `Bearer ${githubToken}`
        };
    }

    function getApiHeaders() {
        return {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            Authorization: `Bearer ${githubToken}`
        };
    }

    function ensureStyles() {
        if (document.getElementById('ghp-repo-stats-styles')) return;

        const style = document.createElement('style');
        style.id = 'ghp-repo-stats-styles';
        style.textContent = `
            .ghp-repo-stats {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .ghp-repo-stats-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 0;
                border-bottom: 1px solid #30363d;
            }

            .ghp-repo-stats-item:last-child {
                border-bottom: none;
            }

            .ghp-repo-stats-label {
                color: #8b949e;
                font-size: 14px;
            }

            .ghp-repo-stats-value {
                color: #c9d1d9;
                font-weight: 600;
                font-size: 14px;
            }

            .ghp-contributors-header {
            .ghp-contributors-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }

            .ghp-refresh-countdown {
            .ghp-refresh-countdown {
                flex: 0 0 auto;
                font-size: 12px;
                font-weight: 400;
                color: #8b949e;
                white-space: nowrap;
            }
        `;
        document.head.appendChild(style);
    }

    function ensureStatsSection() {
        const insertionTarget = getStatsInsertionTarget();
        if (!insertionTarget) return null;

        let statsSection = document.getElementById('ghp-repo-stats-section');
        if (!statsSection) {
            statsSection = document.createElement('div');
            statsSection.id = 'ghp-repo-stats-section';
        }
        const isModernSidebar = !insertionTarget.classList.contains('BorderGrid-row');
        statsSection.className = isModernSidebar ? insertionTarget.className : insertionTarget.classList.contains('BorderGrid-row')
            ? 'BorderGrid-row'
            : insertionTarget.className;
        statsSection.dataset.ghpModernSidebar = String(!insertionTarget.classList.contains('BorderGrid-row'));
        statsSection.dataset.ghpModernSidebar = String(isModernSidebar);

        if (statsSection.previousElementSibling !== insertionTarget) {
            insertionTarget.insertAdjacentElement('afterend', statsSection);
        }

        return statsSection;
    }

    function getSidebarHeadingMarkup() {
        const languagesHeading = Array.from(document.querySelectorAll('h2[data-component="Heading"], h3[data-component="Heading"], h2, h3')).find((heading) => {
            return Array.from(heading.querySelectorAll('span')).some((span) => {
                return span.textContent?.trim() === 'Languages';
            }) || heading.textContent?.trim() === 'Languages';
        });
        if (!languagesHeading) return null;

        return {
            className: languagesHeading.className,
            variant: languagesHeading.getAttribute('data-variant') || 'small',
            component: languagesHeading.getAttribute('data-component') || 'Heading'
        };
    }

    function getSidebarHeadingMarkup() {
        const languagesHeading = Array.from(document.querySelectorAll('h2, h3')).find((heading) => {
            return heading.textContent && heading.textContent.trim().startsWith('Languages');
        });
        if (!languagesHeading) return null;

        return {
            className: languagesHeading.className,
            variant: languagesHeading.getAttribute('data-variant') || 'small',
            component: languagesHeading.getAttribute('data-component') || 'Heading'
        };
    }

    function getStatsInsertionTarget() {
        const languagesSection = Array.from(document.querySelectorAll('.BorderGrid-row')).find((row) => {
            return Array.from(row.querySelectorAll('h2, h3')).some((heading) => {
                return heading.textContent?.trim() === 'Languages';
            });
        });

        if (languagesSection) return languagesSection;

        const languagesHeading = Array.from(document.querySelectorAll('h2, h3')).find((heading) => {
            return heading.textContent && heading.textContent.trim().startsWith('Languages');
        });
        if (languagesHeading?.parentElement) return languagesHeading.parentElement;

        const languagesHeading = Array.from(document.querySelectorAll('h2, h3')).find((heading) => {
            return heading.textContent && heading.textContent.trim().startsWith('Languages');
        });
        if (languagesHeading?.parentElement) return languagesHeading.parentElement;

        const languagesHeading = Array.from(document.querySelectorAll('h2, h3')).find((heading) => {
            return Array.from(heading.querySelectorAll('span')).some((span) => {
                return span.textContent?.trim() === 'Languages';
            }) || heading.textContent?.trim() === 'Languages';
        });
        if (languagesHeading) {
            let section = languagesHeading.parentElement;
            while (section && section !== document.body) {
                if (Array.from(section.classList).some(className => className.startsWith('sidebarSection'))) {
                    return section;
                }
                section = section.parentElement;
            }
            return languagesHeading.parentElement;
        }

        return null;
    }

    function renderRepoInfo(stats) {
        ensureStyles();

        const statsSection = ensureStatsSection();
        if (!statsSection) return;

        if (statsSection.dataset.ghpModernSidebar === 'true') {
            const heading = getSidebarHeadingMarkup();
            if (!heading) return;

        if (statsSection.dataset.ghpModernSidebar === 'true') {
            const heading = getSidebarHeadingMarkup();
            if (!heading) return;

            statsSection.innerHTML = `
                <h2 class="${heading.className} ghp-contributors-header"
                    data-variant="${heading.variant}"
                    data-component="${heading.component}">
                    <span>Repository Statistics</span>
                    <span id="ghp-repo-refresh-countdown" class="ghp-refresh-countdown"></span>
                </h2>
                <div class="ghp-repo-stats">
                    <div class="ghp-repo-stats-item">
                        <span class="ghp-repo-stats-label">Repository Size</span>
                        <span class="ghp-repo-stats-value">${stats.sizeDisplay}</span>
                    </div>
                    <div class="ghp-repo-stats-item">
                        <span class="ghp-repo-stats-label">Total Files</span>
                        <span class="ghp-repo-stats-value">${stats.fileCount}</span>
                    </div>
                </div>
            `;
        } else {
            statsSection.innerHTML = `
                <div class="BorderGrid-cell">
                    <h2 class="h4 tmp-mb-3 ghp-contributors-header">
                        <span>Repository Statistics</span>
                        <span id="ghp-repo-refresh-countdown" class="ghp-refresh-countdown"></span>
                    </h2>
                    <div class="ghp-repo-stats">
                        <div class="ghp-repo-stats-item">
                            <span class="ghp-repo-stats-label">Repository Size</span>
                            <span class="ghp-repo-stats-value">${stats.sizeDisplay}</span>
                        </div>
                        <div class="ghp-repo-stats-item">
                            <span class="ghp-repo-stats-label">Total Files</span>
                            <span class="ghp-repo-stats-value">${stats.fileCount}</span>
                        </div>
                    </div>
                </div>
            `;
        }

        statsSection.style.display = '';
        updateRefreshCountdown();

        if (!refreshTimerId) {
            refreshTimerId = window.setInterval(updateRefreshCountdown, 60000);
        }
    }

    async function loadRepoInfo(owner, repo) {
        const repoKey = `${owner}/${repo}`;
        const nextRefreshAt = getNextRefreshTimestamp();

        if (repoInfoCache && cachedRepoKey === repoKey && isCacheValid(cachedExpiresAt)) {
            return repoInfoCache;
        }

        if (repoInfoFetchPromise && cachedRepoKey === repoKey) {
            return repoInfoFetchPromise;
        }

        cachedRepoKey = repoKey;
        repoInfoFetchPromise = (async () => {
            try {
                const storedCache = await readStoredCache(repoKey);
                if (
                    storedCache &&
                    isCacheValid(storedCache.expiresAt) &&
                    storedCache.data &&
                    !isForcedRefreshPending(storedCache.generation)
                ) {
                    repoInfoCache = storedCache.data;
                    cachedExpiresAt = storedCache.expiresAt;
                    return repoInfoCache;
                }

                // If no token is set, we can still display a valid stored cache but cannot refresh it.
                if (!githubToken) return null;

                const headers = getApiHeaders();
                const headers = getApiHeaders();
                const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
                if (!response.ok) return null;

                const data = await response.json();
                if (!data || typeof data.size !== 'number' || !data.default_branch) return null;
                if (!data || typeof data.size !== 'number' || !data.default_branch) return null;
                const sizeInKB = Math.round(data.size);
                const sizeDisplay = sizeInKB > 1024
                    ? `${(sizeInKB / 1024).toFixed(1)} MB`
                    : `${sizeInKB} KB`;

                let fileCount = '—';
                try {
                    const branchResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${data.default_branch}?recursive=1`, { headers });
                    if (branchResponse.ok) {
                        const treeData = await branchResponse.json();
                        if (treeData.tree) {
                            fileCount = treeData.tree.filter(item => item.type === 'blob').length.toString();
                        }
                    }
                } catch (error) {
                    // File count unavailable
                }

                repoInfoCache = { sizeDisplay, fileCount };
                cachedExpiresAt = nextRefreshAt;

                await writeStoredCache(repoKey, {
                    expiresAt: nextRefreshAt,
                    generation: forceRefreshGeneration,
                    data: repoInfoCache
                });

                return repoInfoCache;
            } catch (error) {
                return null;
            } finally {
                repoInfoFetchPromise = null;
            }
        })();

        return repoInfoFetchPromise;
    }

    async function displayRepoInfo() {
        // Avoid running on /settings/* and other non-repo pages
        if (window.location.pathname.startsWith('/settings/')) {
            removeRepoInfo();
            return;
        }

        // Check if we're on a repo page
        const repoMatch = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)(\/.*)?$/);
        if (!repoMatch) {
            removeRepoInfo();
            return;
        }

        const owner = repoMatch[1];
        const repo = repoMatch[2];

        // Only show on repo root page
        if (!window.location.pathname.match(/^\/[^\/]+\/[^\/]+\/?$/)) {
            removeRepoInfo();
            return;
        }

        if (hasVisibleRepoInfo()) return;

        const stats = await loadRepoInfo(owner, repo);
        if (!stats) return;

        renderRepoInfo(stats);
    }

    function removeRepoInfo() {
        const statsSection = document.getElementById('ghp-repo-stats-section');
        if (statsSection) {
            statsSection.style.display = 'none';
        }
    }

    function startRepoInfoObserver() {
        if (repoInfoObserver || !document.body) return;

        repoInfoObserver = new MutationObserver(() => {
            if (repoInfoDebounceTimeout) clearTimeout(repoInfoDebounceTimeout);
            repoInfoDebounceTimeout = setTimeout(() => {
                if (isEnabled) {
                    manageRepoInfo();
                }
            }, 250);

            // GitHub replaces the sidebar after the initial render. Re-apply
            // placement after those asynchronous updates have settled.
            [750, 1500, 3000].forEach((delay) => {
                window.setTimeout(() => {
                    if (isEnabled && hasVisibleRepoInfo()) {
                        ensureStatsSection();
                    }
                }, delay);
            });
        });

        repoInfoObserver.observe(document.body, { childList: true, subtree: true });
    }

    startRepoInfoObserver();
})();
