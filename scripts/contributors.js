(function () {
    let isEnabled = true;
    let contributorCache = null;
    let contributorFetchPromise = null;
    let cachedRepoKey = null;
    let cachedExpiresAt = null;
    let githubToken = '';
    let refreshTimerId = null;

    const CACHE_NAMESPACE = 'contributors-stats-cache';
    const FORCE_REFRESH_KEY = 'force-refresh-generation';
    let forceRefreshGeneration = 0;

    // Check if contributors feature is enabled and load token
    chrome.storage.sync.get(['contributors-enabled', 'github-token'], (items) => {
        isEnabled = items['contributors-enabled'] !== false;
        githubToken = items['github-token'] || '';
        chrome.storage.local.get([FORCE_REFRESH_KEY], (localItems) => {
            forceRefreshGeneration = localItems[FORCE_REFRESH_KEY] || 0;
            if (isEnabled) {
                enhanceContributors();
            }
        });
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'SETTINGS_CHANGED') {
            if (request.setting === 'contributors-enabled') {
                isEnabled = request.value;
                if (isEnabled) {
                    enhanceContributors();
                } else {
                    removeAllStats();
                }
            } else if (request.setting === 'github-token') {
                githubToken = request.value;
                if (isEnabled) {
                    removeAllStats();
                    enhanceContributors();
                }
            } else if (request.setting === FORCE_REFRESH_KEY) {
                forceRefreshGeneration = request.value || 0;
                contributorCache = null;
                cachedExpiresAt = null;
                if (isEnabled) {
                    removeAllStats();
                    enhanceContributors();
                }
            }
        } else if (request.type === 'SETTINGS_RESET') {
            isEnabled = true;
            githubToken = '';
            enhanceContributors();
        }
    });

    // Add styles if not already added
    function injectStyles() {
        if (!document.getElementById('ghp-contributors-styles')) {
            const style = document.createElement('style');
            style.id = 'ghp-contributors-styles';
            style.textContent = `
                .ghp-contrib-stats {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    margin-left: auto;
                    padding-left: 12px;
                    font-size: 12px;
                    color: #8b949e;
                }

                .ghp-contrib-stat {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                }

                .ghp-contrib-label {
                    color: #8b949e;
                }

                .ghp-contrib-value {
                    color: #c9d1d9;
                    font-weight: 500;
                }

                .ghp-contrib-percentage {
                    background: #1f6feb;
                    color: #ffffff;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-weight: 500;
                    font-size: 11px;
                }

                .ghp-contributors-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                }

                .ghp-refresh-countdown {
                    flex: 0 0 auto;
                    font-size: 12px;
                    color: #8b949e;
                    white-space: nowrap;
                }
            `;
            document.head.appendChild(style);
        }
    }

    function getRepoOwnerAndName() {
        // Prefer GitHub meta tag which reliably contains owner/repo
        const meta = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]');
        if (meta && meta.content) {
            const parts = meta.content.split('/');
            if (parts.length === 2) return { owner: parts[0], repo: parts[1] };
        }

        // Fallback to pathname but avoid matching settings and other non-repo pages
        const repoMatch = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)(\/.*)?$/);
        if (repoMatch && !window.location.pathname.startsWith('/settings/')) {
            return { owner: repoMatch[1], repo: repoMatch[2] };
        }

        return null;
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
        const countdown = document.getElementById('ghp-refresh-countdown');
        if (!countdown) return;

        countdown.textContent = formatRemainingTime();
    }

    function ensureRefreshCountdown() {
        const heading = Array.from(document.querySelectorAll('h2, h3')).find((el) => {
            return el.textContent && el.textContent.trim().startsWith('Contributors');
        });

        if (!heading) return;

        if (!heading.classList.contains('ghp-contributors-header')) {
            heading.classList.add('ghp-contributors-header');
        }

        let countdown = document.getElementById('ghp-refresh-countdown');
        if (!countdown) {
            countdown = document.createElement('span');
            countdown.id = 'ghp-refresh-countdown';
            countdown.className = 'ghp-refresh-countdown';
            heading.appendChild(countdown);
        }

        updateRefreshCountdown();

        if (!refreshTimerId) {
            refreshTimerId = window.setInterval(updateRefreshCountdown, 60000);
        }
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

    async function fetchContributors() {
        // Determine repo owner/name; bail out if not a repository page
        const repoInfo = getRepoOwnerAndName();
        if (!repoInfo) return null;

        const owner = repoInfo.owner;
        const repo = repoInfo.repo;
        const repoKey = `${owner}/${repo}`;
        const nextRefreshAt = getNextRefreshTimestamp();

        if (contributorCache && cachedRepoKey === repoKey && isCacheValid(cachedExpiresAt)) {
            return contributorCache;
        }

        if (contributorFetchPromise && cachedRepoKey === repoKey) {
            return contributorFetchPromise;
        }

        cachedRepoKey = repoKey;
        contributorFetchPromise = (async () => {
            try {
                const storedCache = await readStoredCache(repoKey);
                if (
                    storedCache &&
                    isCacheValid(storedCache.expiresAt) &&
                    storedCache.data &&
                    !isForcedRefreshPending(storedCache.generation)
                ) {
                    contributorCache = storedCache.data;
                    cachedExpiresAt = storedCache.expiresAt;
                    return contributorCache;
                }

                // If no token is set, we can still display a valid stored cache but cannot refresh it.
                if (!githubToken) return null;

                const headers = {};
                if (githubToken) {
                    headers['Authorization'] = `token ${githubToken}`;
                }
                const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contributors?per_page=100`, { headers });
                if (!response.ok) return null;

                const contributors = await response.json();
                const contributorMap = {};

                contributors.forEach(contrib => {
                    contributorMap[contrib.login.toLowerCase()] = {
                        commits: contrib.contributions,
                        id: contrib.id
                    };
                });

                const totalCommits = contributors.reduce((sum, c) => sum + c.contributions, 0);

                contributorCache = { map: contributorMap, total: totalCommits };
                cachedExpiresAt = nextRefreshAt;

                await writeStoredCache(repoKey, {
                    expiresAt: nextRefreshAt,
                    generation: forceRefreshGeneration,
                    data: contributorCache
                });

                return contributorCache;
            } catch (error) {
                return null;
            } finally {
                contributorFetchPromise = null;
            }
        })();

        return contributorFetchPromise;
    }

    async function enhanceContributors() {
        if (!isEnabled) return;

        injectStyles();
        ensureRefreshCountdown();

        const contributorItems = document.querySelectorAll('li.mb-2.d-flex');
        if (!contributorItems.length) return;

        const data = await fetchContributors();
        if (!data) return;

        const { map: contributorMap, total: totalCommits } = data;

        contributorItems.forEach(listItem => {
            // Skip if already enhanced
            if (listItem.querySelector('.ghp-contrib-stats')) return;

            // Find the user link within this item
            const userLink = listItem.querySelector('[data-hovercard-type="user"]');
            if (!userLink) return;

            // Get username from href
            const match = userLink.href.match(/\/([^\/]+)$/);
            if (!match) return;

            const username = match[1].toLowerCase();
            const contrib = contributorMap[username];

            if (!contrib) return;

            // Create stats container
            const statsContainer = document.createElement('div');
            statsContainer.className = 'ghp-contrib-stats';
            
            const percentage = ((contrib.commits / totalCommits) * 100).toFixed(1);
            
            statsContainer.innerHTML = `
                <div class="ghp-contrib-stat">
                    <span class="ghp-contrib-label">Commits:</span>
                    <span class="ghp-contrib-value">${contrib.commits}</span>
                </div>
                <div class="ghp-contrib-percentage">${percentage}%</div>
            `;

            // Ensure parent is flex
            listItem.style.display = 'flex';
            listItem.style.alignItems = 'center';

            // Append stats
            listItem.appendChild(statsContainer);
        });
    }

    function removeAllStats() {
        document.querySelectorAll('.ghp-contrib-stats').forEach(el => el.remove());
        const countdown = document.getElementById('ghp-refresh-countdown');
        if (countdown) countdown.remove();
    }

    // Watch for DOM changes and re-run enhancement
    let debounceTimeout;
    const observer = new MutationObserver(() => {
        if (debounceTimeout) clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
            if (isEnabled) {
                enhanceContributors();
            }
        }, 500);
    });

    // Start observing after a short delay to ensure DOM is ready
    setTimeout(() => {
        observer.observe(document.body, { childList: true, subtree: true });
        enhanceContributors();
    }, 1000);
})();
