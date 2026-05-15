(function () {
    let isEnabled = true;
    let isAddingPagination = false;
    const REPO_PER_PAGE = 30;
    const DEFAULT_COMMITS_PER_PAGE = 35;
    const COMMITS_CACHE_NAMESPACE = 'commits-pagination-cache';
    const FORCE_REFRESH_KEY = 'force-refresh-generation';
    let githubToken = '';
    let forceRefreshGeneration = 0;
    let commitsCursorCache = new Map();
    let commitsPageHrefCache = new Map();
    let commitsCachePromise = null;
    let cachedCommitRepoKey = null;
    let cachedCommitExpiresAt = null;

    // Check if pagination is enabled and load token
    chrome.storage.sync.get(['pagination-enabled', 'github-token'], (items) => {
        isEnabled = items['pagination-enabled'] !== false;
        githubToken = items['github-token'] || '';
        chrome.storage.local.get([FORCE_REFRESH_KEY], (localItems) => {
            forceRefreshGeneration = localItems[FORCE_REFRESH_KEY] || 0;
            managePagination();
        });
    });

    // Listen for settings changes
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'SETTINGS_CHANGED' && request.setting === 'pagination-enabled') {
            isEnabled = request.value;
            managePagination();
        } else if (request.type === 'SETTINGS_CHANGED' && request.setting === 'github-token') {
            githubToken = request.value || '';
            if (!githubToken) {
                clearAllCommitPaginationCache();
                removePagination();
            }
            managePagination();
        } else if (request.type === 'SETTINGS_CHANGED' && request.setting === FORCE_REFRESH_KEY) {
            forceRefreshGeneration = request.value || 0;
            clearAllCommitPaginationCache();
            managePagination();
        } else if (request.type === 'SETTINGS_RESET') {
            isEnabled = true;
            githubToken = '';
            clearAllCommitPaginationCache();
            managePagination();
        }
    });

    function removePagination() {
        const customPagination = document.querySelector('.custom-repo-pagination');
        if (customPagination) {
            customPagination.remove();
        }
        const customCommitsPagination = document.querySelectorAll('.custom-commits-pagination');
        customCommitsPagination.forEach(el => el.remove());
        
        // Restore default repo pagination
        const defaultRepoPagination = document.querySelector('.paginate-container');
        if (defaultRepoPagination) {
            defaultRepoPagination.style.display = '';
        }
        
        // Restore default commits pagination (search for nav with aria-label)
        const defaultCommitsPaginationContainers = document.querySelectorAll('nav[aria-label="Pagination"]');
        defaultCommitsPaginationContainers.forEach(pagination => {
            pagination.style.display = '';
        });
    }

    function clearCommitPaginationMemory() {
        commitsCursorCache = new Map();
        commitsPageHrefCache = new Map();
        commitsCachePromise = null;
        cachedCommitRepoKey = null;
        cachedCommitExpiresAt = null;
    }

    function clearAllCommitPaginationCache() {
        clearCommitPaginationMemory();
        chrome.storage.local.get(null, (items) => {
            const keysToRemove = Object.keys(items).filter((key) => key.startsWith(`${COMMITS_CACHE_NAMESPACE}:`));
            if (keysToRemove.length > 0) {
                chrome.storage.local.remove(keysToRemove);
            }
        });
    }

    function isCacheValid(expiresAt) {
        return Number.isFinite(expiresAt) && Date.now() < expiresAt;
    }

    function isForcedRefreshPending(cacheGeneration) {
        return forceRefreshGeneration > 0 && (cacheGeneration || 0) < forceRefreshGeneration;
    }

    function getNextRefreshDate() {
        const now = new Date();
        const nextRefresh = new Date(now);
        nextRefresh.setHours(2, 0, 0, 0);
        if (now >= nextRefresh) nextRefresh.setDate(nextRefresh.getDate() + 1);
        return nextRefresh;
    }

    function getNextRefreshTimestamp() {
        return getNextRefreshDate().getTime();
    }

    function formatCacheDate(timestamp) {
        return new Date(timestamp).toLocaleString();
    }

    function getCommitCacheKey(repoKey) {
        return `${COMMITS_CACHE_NAMESPACE}:${repoKey}`;
    }

    function readStoredCommitCache(repoKey) {
        return new Promise((resolve) => {
            chrome.storage.local.get(getCommitCacheKey(repoKey), (items) => {
                resolve(items[getCommitCacheKey(repoKey)] || null);
            });
        });
    }

    function writeStoredCommitCache(repoKey, payload) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ [getCommitCacheKey(repoKey)]: payload }, () => resolve());
        });
    }

    function getPaginationNav(root = document) {
        return root.querySelector('nav[aria-label="Pagination"]');
    }

    function getPaginationNextHref(root = document) {
        const nextBtn = root.querySelector('nav[aria-label="Pagination"] [data-component="Pagination.NextPage"]');
        const href = nextBtn?.getAttribute('href') || nextBtn?.href;
        return href ? new URL(href, window.location.origin).href : null;
    }

    function normalizeUrl(href) {
        const url = new URL(href, window.location.origin);
        url.hash = '';
        return `${url.pathname}${url.search}`;
    }

    function getCommitAfterOffset() {
        const rawMatch = window.location.search.match(/[?&]after=([^&]+)/);
        if (!rawMatch) return null;

        const afterCursor = decodeURIComponent(rawMatch[1].replace(/\+/g, '%2B'));
        const match = afterCursor.match(/\+(\d+)$/);
        return match ? parseInt(match[1], 10) : null;
    }

    function getCurrentCommitPage(itemsPerPage) {
        const offset = getCommitAfterOffset();
        if (offset === null) return 1;
        return Math.floor(offset / itemsPerPage) + 2;
    }

    function buildVisiblePages(totalPages, currentPage) {
        const pages = [];
        const pagesBefore = 2;
        const pagesAfter = 4;

        for (let i = 1; i <= totalPages; i++) {
            if (
                i === 1 ||
                i === totalPages ||
                (i >= currentPage - pagesBefore && i <= currentPage + pagesAfter)
            ) {
                pages.push(i);
            }
        }

        return pages;
    }

    function getCommitPageCacheKey(repoKey, limit) {
        return `commit-pages-${repoKey}/${limit}`;
    }

    function clearExtraCommitPagination() {
        const existing = document.querySelectorAll('.custom-commits-pagination');
        if (existing.length <= 1) return;

        existing.forEach((node, index) => {
            if (index > 0) node.remove();
        });
    }

    function managePagination() {
        if (!isEnabled) {
            removePagination();
            return;
        }
        if (isAddingPagination) return;
        
        isAddingPagination = true;
        Promise.resolve()
            .then(() => addRepoPagination())
            .then(() => addCommitsPagination())
            .finally(() => {
                isAddingPagination = false;
            });
    }

    function addRepoPagination() {
        if (!window.location.search.includes('tab=repositories')) return;

        const repoTab = document.querySelector('a[data-tab-item="repositories"]');
        const counterLabel = repoTab?.querySelector('.Counter, [class*="CounterLabel"]');

        if (!counterLabel || document.querySelector('.custom-repo-pagination')) return;

        const repoCount = parseInt(counterLabel.textContent.replace(/,/g, '').trim());
        if (isNaN(repoCount) || repoCount <= REPO_PER_PAGE) return;

        const defaultPagination = document.querySelector('.paginate-container');
        if (defaultPagination) defaultPagination.style.display = 'none';

        const totalPages = Math.ceil(repoCount / REPO_PER_PAGE);
        const urlParams = new URLSearchParams(window.location.search);
        const currentPage = parseInt(urlParams.get('page')) || 1;

        const container = document.createElement('div');
        container.className = 'custom-repo-pagination d-flex flex-justify-center my-4 py-3';
        container.style.cssText = 'gap: 8px; border-top: 1px solid var(--color-border-muted);';

        const createBtn = (text, page, isActive = false, isDisabled = false) => {
            const btn = document.createElement(isDisabled ? 'span' : 'a');
            btn.textContent = text;
            btn.className = `btn btn-sm d-flex flex-items-center flex-justify-center ${isActive ? 'btn-primary' : ''} ${isDisabled ? 'disabled' : ''}`;
            btn.style.minWidth = '32px';
            if (!isDisabled) {
                btn.href = `${window.location.pathname}?tab=repositories&page=${page}`;
            }
            return btn;
        };

        const pages = [];
        const pagesBefore = 2;
        const pagesAfter = 4;

        for (let i = 1; i <= totalPages; i++) {
            if (
                i === 1 ||
                i === totalPages ||
                (i >= currentPage - pagesBefore && i <= currentPage + pagesAfter)
            ) {
                pages.push(i);
            }
        }

        container.appendChild(createBtn('Previous', currentPage - 1, false, currentPage === 1));

        let lastPage = 0;
        pages.forEach(page => {
            if (lastPage !== 0 && page - lastPage > 1) {
                const ellipsis = document.createElement('span');
                ellipsis.textContent = '...';
                ellipsis.className = 'd-flex flex-items-center px-2';
                container.appendChild(ellipsis);
            }
            container.appendChild(createBtn(page, page, page === currentPage));
            lastPage = page;
        });

        container.appendChild(createBtn('Next', currentPage + 1, false, currentPage === totalPages));

        const profileFrame = document.querySelector('#user-profile-frame');
        if (profileFrame) profileFrame.appendChild(container);
    }

    function isCommitPage() {
        const pathParts = window.location.pathname.split('/').filter(p => p);
        return pathParts.length >= 3 && pathParts[2] === 'commits';
    }

    function getCommitPageInfo() {
        const pathParts = window.location.pathname.split('/').filter(p => p);
        if (pathParts.length < 4) return null;
        
        return {
            owner: pathParts[0],
            repo: pathParts[1],
            branch: pathParts[3]
        };
    }

    function getActualCommitsPerPage() {
        // Count the actual number of visible commits on the current page
        const commitRows = document.querySelectorAll('[data-testid="commit"], [data-testid="commit-row"]');
        return commitRows.length || DEFAULT_COMMITS_PER_PAGE;
    }

    function getPageStatus() {
        const nav = document.querySelector('nav[aria-label="Pagination"]');
        if (!nav) return { isFirstPage: true, hasNextPage: false };

        const prevBtn = nav.querySelector('[data-component="Pagination.PreviousPage"]');
        const nextBtn = nav.querySelector('[data-component="Pagination.NextPage"]');

        const isFirstPage = !prevBtn || prevBtn.getAttribute('aria-disabled') === 'true';
        const hasNextPage = nextBtn && nextBtn.hasAttribute('href');

        return { isFirstPage, hasNextPage };
    }

    async function fetchCommitPaginationSnapshot(owner, repo, branch) {
        if (!githubToken) return null;

        const repoKey = `${owner}/${repo}/${branch}`;
        console.log(`[Pagination Cache] Loading cache for: ${repoKey}`);
        
        if (commitsCachePromise && cachedCommitRepoKey === repoKey) {
            console.log(`[Pagination Cache] Using snapshot in progress...`);
            return commitsCachePromise;
        }

        if (cachedCommitRepoKey === repoKey && commitsCursorCache.has(repoKey) && isCacheValid(cachedCommitExpiresAt)) {
            console.log(`[Pagination Cache] Valid memory cache found`);
            return commitsCursorCache.get(repoKey);
        }

        cachedCommitRepoKey = repoKey;
        commitsCachePromise = (async () => {
            try {
                const storedCache = await readStoredCommitCache(repoKey);
                if (storedCache) {
                    const cacheCreatedTime = storedCache.expiresAt - 60*60*1000;
                    console.log(`[Pagination Cache] Cache found - Created: ${formatCacheDate(cacheCreatedTime)} | Expires: ${formatCacheDate(storedCache.expiresAt)}`);
                }
                console.log(`[Pagination Cache] Reading local storage...`);
                if (
                    storedCache &&
                    isCacheValid(storedCache.expiresAt) &&
                    storedCache.data &&
                    !isForcedRefreshPending(storedCache.generation)
                ) {
                    const cachedData = storedCache.data;
                    const cacheCreatedTime = storedCache.expiresAt - 60*60*1000;
                    const ageMinutes = Math.round((Date.now() - cacheCreatedTime) / 60000);
                    commitsCursorCache.set(repoKey, cachedData);
                    cachedCommitExpiresAt = storedCache.expiresAt;
                    console.log(`[Pagination Cache] Cache HIT (age: ${ageMinutes} min) - ${cachedData.totalCommits} commits, ${cachedData.totalPages} pages`);
                    return cachedData;
                }

                console.log(`[Pagination Cache] Cache MISS or EXPIRED - API call required`);
                return await refreshCommitPaginationSnapshot(owner, repo, branch, repoKey, null);
            } catch (error) {
                console.warn('Error loading commit pagination snapshot:', error);
                return null;
            } finally {
                commitsCachePromise = null;
            }
        })();

        return commitsCachePromise;
    }

    async function refreshCommitPaginationSnapshot(owner, repo, branch, repoKey, previousSnapshot) {
        if (!githubToken) return null;

        try {
            console.log(`[Pagination API] API request for: ${owner}/${repo}/${branch}`);
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`
            };

            const fetchStartTime = performance.now();
            const response = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/commits?sha=${branch}&per_page=1`,
                { headers }
            );
            const fetchEndTime = performance.now();

            if (!response.ok) {
                console.warn(`[Pagination API] Error: ${response.status} - Using previous cache`);
                return previousSnapshot;
            }

            console.log(`[Pagination API] Response received in ${(fetchEndTime - fetchStartTime).toFixed(2)}ms (status: ${response.status})`);

            const linkHeader = response.headers.get('Link');
            const itemsPerPage = getActualCommitsPerPage();
            let totalCommits = 0;

            if (linkHeader) {
                const lastMatch = linkHeader.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/i);
                if (lastMatch) {
                    totalCommits = parseInt(lastMatch[1], 10);
                }
            }

            if (!totalCommits) {
                const commits = await response.json();
                if (Array.isArray(commits)) {
                    totalCommits = commits.length;
                }
            }

            const totalPages = totalCommits > 0 ? Math.ceil(totalCommits / itemsPerPage) : 0;
            console.log(`[Pagination API] Result: ${totalCommits} commits, ${totalPages} pages (${itemsPerPage} per page)`);
            
            // Check if cache changed
            if (previousSnapshot) {
                const hasPreviousChanged = previousSnapshot.totalCommits !== totalCommits || 
                                          previousSnapshot.totalPages !== totalPages;
                console.log(`[Pagination Comparison] Cache vs API: ${hasPreviousChanged ? 'CHANGE DETECTED' : 'identical'}`);
                if (hasPreviousChanged) {
                    console.log(`  - Commits: ${previousSnapshot.totalCommits} → ${totalCommits}`);
                    console.log(`  - Pages: ${previousSnapshot.totalPages} → ${totalPages}`);
                }
            }
            
            const pageHrefs = await buildCommitPageHrefMap(totalPages, previousSnapshot?.pageHrefs || null);
            const snapshot = {
                totalCommits,
                totalPages,
                itemsPerPage,
                pageHrefs: Object.fromEntries(pageHrefs)
            };

            commitsCursorCache.set(repoKey, snapshot);
            cachedCommitExpiresAt = getNextRefreshTimestamp();
            console.log(`[Pagination Cache] Updating cache - Expires at: ${formatCacheDate(cachedCommitExpiresAt)} (at 2:00 AM)`);

            await writeStoredCommitCache(repoKey, {
                expiresAt: cachedCommitExpiresAt,
                generation: forceRefreshGeneration,
                data: snapshot
            });
            console.log(`[Pagination Cache] Snapshot written to local storage`);

            return snapshot;
        } catch (error) {
            console.warn('Error refreshing commit pagination snapshot:', error);
            return previousSnapshot;
        }
    }

    async function buildCommitPageHrefMap(maxPage, initialHrefMap = null, startHref = null) {
        const cacheKey = getCommitPageCacheKey(cachedCommitRepoKey || 'unknown', maxPage);
        if (commitsPageHrefCache.has(cacheKey)) {
            return commitsPageHrefCache.get(cacheKey);
        }

        const hrefMap = new Map();
        hrefMap.set(1, window.location.pathname);

        if (initialHrefMap) {
            Object.entries(initialHrefMap).forEach(([pageNum, href]) => {
                hrefMap.set(parseInt(pageNum, 10), href);
            });
        }

        if (!maxPage || maxPage <= 1) {
            commitsPageHrefCache.set(cacheKey, hrefMap);
            return hrefMap;
        }

        let nextHref = startHref || getPaginationNextHref(document);
        let currentPage = 1;

        while (nextHref && currentPage < maxPage) {
            currentPage += 1;
            if (!hrefMap.has(currentPage)) {
                hrefMap.set(currentPage, nextHref);
            }

            let response;
            try {
                response = await fetch(nextHref, {
                    credentials: 'same-origin',
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml'
                    }
                });
            } catch (error) {
                console.warn('Error fetching commit pagination page:', error);
                break;
            }

            if (!response.ok) {
                console.warn(`Failed to fetch commit pagination page ${currentPage}: ${response.status}`);
                break;
            }

            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            nextHref = getPaginationNextHref(doc);
        }

        commitsPageHrefCache.set(cacheKey, hrefMap);
        return hrefMap;
    }

    async function addCommitsPagination() {
        if (!isCommitPage()) return;
        if (!githubToken) {
            removePagination();
            return;
        }

        if (document.querySelector('.custom-commits-pagination')) return;

        const pageInfo = getCommitPageInfo();
        if (!pageInfo) return;

        // Find GitHub's existing pagination
        const existingPagination = getPaginationNav();
        if (!existingPagination) return;

        const { isFirstPage, hasNextPage } = getPageStatus();
        const snapshot = await fetchCommitPaginationSnapshot(pageInfo.owner, pageInfo.repo, pageInfo.branch);
        if (!snapshot || !snapshot.totalCommits) return;

        if (document.querySelector('.custom-commits-pagination')) return;

        const itemsPerPage = snapshot.itemsPerPage || getActualCommitsPerPage();
        const totalPages = snapshot.totalPages || Math.ceil(snapshot.totalCommits / itemsPerPage);
        const currentPage = getCurrentCommitPage(itemsPerPage);
        const pages = buildVisiblePages(totalPages, currentPage);
        const hrefMap = new Map(Object.entries(snapshot.pageHrefs || {}).map(([pageNum, href]) => [parseInt(pageNum, 10), href]));
        hrefMap.set(1, window.location.pathname);
        const maxPreloadPage = Math.min(totalPages, currentPage + 4);

        // Create container for improved pagination
        const container = document.createElement('div');
        container.className = 'custom-commits-pagination d-flex flex-justify-center my-4 py-3';
        container.style.cssText = `
            gap: 8px;
            border-top: 1px solid var(--color-border-muted);
            flex-wrap: wrap;
            justify-content: center;
            align-items: center;
            min-height: 44px;
        `;

        // Create button helper
        const createBtn = (text, pageNum, isActive = false, isDisabled = false, href = null) => {
            const btn = document.createElement(isDisabled ? 'span' : 'a');
            btn.textContent = text;
            btn.className = `btn btn-sm d-flex flex-items-center flex-justify-center ${isActive ? 'btn-primary' : ''} ${isDisabled ? 'disabled' : ''}`;
            btn.style.cssText = `
                min-width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            `;
            if (!isDisabled && href) {
                btn.href = href;
            }
            return btn;
        };

        const navigateToCommitPage = async (pageNum) => {
            if (pageNum <= 1) {
                window.location.href = window.location.pathname;
                return;
            }

            const cachedHref = hrefMap.get(pageNum);
            if (cachedHref) {
                window.location.href = cachedHref;
                return;
            }

            const refreshedSnapshot = await refreshCommitPaginationSnapshot(pageInfo.owner, pageInfo.repo, pageInfo.branch, cachedCommitRepoKey, snapshot);
            const refreshedHref = refreshedSnapshot?.pageHrefs ? refreshedSnapshot.pageHrefs[pageNum] : null;
            if (refreshedHref) {
                window.location.href = refreshedHref;
            }
        };

        // Add Previous button
        const prevBtn = existingPagination.querySelector('[data-component="Pagination.PreviousPage"]');
        if (prevBtn) {
            const href = isFirstPage ? null : (prevBtn.getAttribute('href') || prevBtn.href);
            container.appendChild(createBtn('Previous', 0, false, isFirstPage, href ? new URL(href, window.location.origin).href : null));
        }

        // Add page number buttons
        let lastPage = 0;
        for (const pageNum of pages) {
            if (lastPage !== 0 && pageNum - lastPage > 1) {
                const ellipsis = document.createElement('span');
                ellipsis.textContent = '...';
                ellipsis.className = 'd-flex flex-items-center px-2';
                ellipsis.style.flexShrink = '0';
                container.appendChild(ellipsis);
            }

            let pageHref = hrefMap.get(pageNum) || null;
            if (pageNum === 1) {
                // First page has no cursor
                pageHref = `${window.location.pathname}`;
            }

            const btn = createBtn(pageNum, pageNum, pageNum === currentPage, false, pageHref);

            if (!pageHref || pageNum > maxPreloadPage || pageNum === totalPages) {
                btn.removeAttribute('href');
                btn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    btn.style.pointerEvents = 'none';
                    await navigateToCommitPage(pageNum);
                });
            }
            
            container.appendChild(btn);
            lastPage = pageNum;
        }

        // Add Next button
        const nextBtn = existingPagination.querySelector('[data-component="Pagination.NextPage"]');
        if (nextBtn) {
            const href = hasNextPage ? (nextBtn.getAttribute('href') || nextBtn.href) : null;
            container.appendChild(createBtn('Next', 0, false, !hasNextPage, href ? new URL(href, window.location.origin).href : null));
        }

        // Hide GitHub's default pagination
        existingPagination.style.display = 'none';
        clearExtraCommitPagination();

        // Insert our improved pagination
        if (existingPagination.parentElement) {
            existingPagination.parentElement.insertBefore(container, existingPagination);
        }
    }

    let debounceFrame;
    const observer = new MutationObserver(() => {
        if (debounceFrame) cancelAnimationFrame(debounceFrame);
        debounceFrame = requestAnimationFrame(managePagination);
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();