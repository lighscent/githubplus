(function () {
    const STYLES = {
        'Public': { border: '2px solid #2da44e', color: '#2da44e' },
        'Private': { border: '2px solid #cf222e', color: '#cf222e' },
        'Public template': { border: '2px solid #0969da', color: '#0969da' }
    };

    function applyStyles() {
        const badges = document.querySelectorAll('span.Label:not([data-ghp-styled]), span[class*="prc-Label-Label"]:not([data-ghp-styled])');

        badges.forEach(badge => {
            const text = badge.textContent.trim();
            const style = STYLES[text];
            if (style) {
                Object.assign(badge.style, style);
                badge.style.borderRadius = '2em';
            }
            badge.setAttribute('data-ghp-styled', 'true');
        });
    }

    applyStyles();

    let debounceFrame;
    const observer = new MutationObserver(() => {
        if (debounceFrame) cancelAnimationFrame(debounceFrame);
        debounceFrame = requestAnimationFrame(applyStyles);
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();