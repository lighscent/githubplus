# Privacy Policy – GitHub+

**Last updated:** May 13, 2026

The **GitHub+** extension is designed to enhance your GitHub experience while strictly respecting your privacy.

---

## 1. Data Collection

GitHub+ **does not collect any personal data**.

- We do not track your browsing history.
- We do not collect your GitHub credentials, email addresses, or any other identifying information.
- No data is stored on external servers or transmitted to third parties.
- The extension operates entirely client-side.

## 2. How It Works

The extension modifies the GitHub user interface locally in your browser.

- **Content scripts:** The scripts (`badges.js`, `pagination.js`, `vscode.js`, `repo-info.js`, `contributors.js`, `emails.js`) run exclusively on pages under the `https://github.com/*` domain.
- **Enhancements:** These scripts add visibility badges, a numbered pagination system, a VS Code shortcut button, repository statistics, contributor information, and email copy functionality.
- **API Integration:** Some features (Contributor Stats and Repository Info) require a GitHub personal access token to access GitHub's API. The token is stored locally in your browser's storage and is only used to make authenticated requests to `api.github.com`.

## 3. Requested Permissions

In accordance with the extension's configuration file:

- **`storage`:** Allows the extension to store user settings and GitHub tokens locally in the browser.
- **`host_permissions` (`https://github.com/*`, `https://api.github.com/*`):** These permissions allow the extension to apply visual modifications on the GitHub website and make API calls to retrieve repository data when authorized.

## 4. Data Storage and API Usage

- **Local Storage:** User settings and GitHub tokens are stored locally using Chrome's storage API. This data never leaves your device.
- **API Calls:** When a GitHub token is provided, the extension makes requests to GitHub's official API (`api.github.com`) to fetch repository information and contributor data. These requests include your token for authentication and rate limit purposes.
- **Caching:** Retrieved data is cached locally for 24 hours to improve performance and reduce API calls.

## 5. Third-Party Services

GitHub+ communicates only with GitHub's official services. While it interacts with the GitHub Inc. interface and API, the extension is developed independently.

## 6. Security & Open Source

GitHub+'s code is **100% open source** and available for public inspection in the project repository. This transparency ensures that no malicious or tracking code is present.

## 7. Changes to This Policy

Any changes to this privacy policy will be published in the `README.md` file of the official repository.

## 8. Contact

For any questions or suggestions, feel free to open an Issue on the project's official GitHub repository.

---

*This extension is distributed under the **MIT License**.*