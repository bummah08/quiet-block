# Quiet Block

A custom Manifest V3 extension for Opera GX and Chrome. Filtering is local, with no analytics or external filter subscriptions. The optional Windows updater downloads releases from this private GitHub repository using your local GitHub CLI sign-in.

Repository: [bummah08/quiet-block](https://github.com/bummah08/quiet-block) (private).

## Automatic updates on Windows

Because unpacked extensions do not install browser-store updates, this version uses a separate, per-user Windows helper. GitHub credentials are kept by GitHub CLI, outside the extension. No public repository, public update feed, or token inside the extension is needed.

One-time setup from a downloaded or cloned copy of this repository:

```powershell
gh auth login --hostname github.com --git-protocol https --web --scopes repo
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Updates.ps1 -Repository bummah08/quiet-block
```

Then load `%LOCALAPPDATA%\QuietBlock\extension` in `opera://extensions` using **Developer mode → Load unpacked**. Keep Developer mode enabled; Opera can disable a reloaded development extension when it is off. Disable your older copy. Moving to this managed folder creates a different extension ID, so copy any custom domains/exceptions from the old copy first; subsequent updates preserve preferences.

The installer registers **Quiet Block Updates** in Windows Task Scheduler. It checks the latest stable GitHub release hourly while your Windows user is signed in. It verifies the package SHA-256 checksum and expected archive contents, stages the files, preserves the previous version, and swaps the extension directory. Same-version replacements and downgrades are refused. Opera checks the local installed-version marker every minute and reloads the extension when a newer version is ready. Open website tabs need a refresh to receive updated page scripts; the updater does not refresh them automatically.

The helper does not bypass GitHub authentication. If access expires, sign in again with `%LOCALAPPDATA%\QuietBlock\tools\gh.exe auth login`. Failed downloads leave the installed release intact. Check `%LOCALAPPDATA%\QuietBlock\update-status.json` for the last check result.

To check immediately:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\QuietBlock\Update-QuietBlock.ps1" -InstallDirectory "$env:LOCALAPPDATA\QuietBlock"
```

To stop automatic downloads while keeping the extension, run `scripts/Disable-Updates.ps1` from this repository. The helper itself is updated by rerunning the installer after pulling new source. Browser-store distribution is not configured.

## Included

- Network filtering for 30 bundled ad-network domains and their subdomains.
- Custom blocked domains, up to 1,000 entries.
- Website exceptions, including embedded content and page helpers.
- A global on/off switch.
- Blocking of navigation/redirects to listed ad domains.
- A guard against automatic `window.open()` pop-ups without recent user activation.
- Optional YouTube video-ad filtering: remove known ad instructions before the player consumes its initial data or later player responses, and hide recognized promotional tiles. The older Skip/mute helper remains a fallback for ads that get through.

All features are initially enabled. Open Settings to disable any individual helper.

## Install in Opera GX

These steps are for a **manual development installation**. For automatic updates, use the managed folder described above.

1. Extract `quiet-block.zip` to a permanent folder.
2. Open `opera://extensions`.
3. Enable **Developer mode**, then choose **Load unpacked**.
4. Select the `quiet-block` folder containing `manifest.json`.
5. Pin Quiet Block from the Extensions menu and reload the pages where you want to use it. Existing tabs need a reload to receive the page helpers.

In Chrome, use `chrome://extensions` instead. Requires Chromium 111+.

## Use

Click the toolbar icon to turn blocking off/on or pause it on the current website. The toolbar badge shows the global ON/OFF state; site exceptions are shown in the popup. Reload after changing rules for the new state to cover the entire page.

**Manage domains & exceptions** opens Settings. Enter one domain per line. Full URLs are reduced to their host; `*.example.com` becomes `example.com`. Subdomains are included automatically. Lines beginning with `#` are comments. Domain lists are not EasyList/uBlock filter files and do not accept their syntax.

Exceptions are for the top-level website, not a destination domain you want to allow everywhere. Adding `example.com` pauses all Quiet Block features while visiting that site and its subdomains. To remove a parent-domain exception, use Settings. If another blocker or Opera's built-in blocker is active, Quiet Block's exceptions cannot override it.

## What to expect

This is a small customizable blocker, not a comprehensive, automatically maintained filter subscription. Ads from unlisted hosts or the same domains as a site's content can get through. Empty ad spaces may remain. Blocking a shared service domain can affect useful content; pause on that site or adjust your custom list.

YouTube filtering is experimental. Version 1.2 filters known `playerAds`, `adPlacements`, and `adSlots` instructions out of initial player data and later JSON/fetch/XHR responses before they schedule client-side ads. Normal stream URLs, captions, and playability information are preserved. The filter runs at document start only when enabled and outside site exceptions. Reload YouTube after an update or settings change so filtering starts before the player does.

This is not a guarantee against every YouTube ad format: server-inserted ads, new player formats, anti-blocking screens, embedded players, Shorts-specific ads, sponsored segments within creator videos, and other video services are not covered. Ads that get through can still be muted/skipped by the fallback. Live videos were checked in an isolated, signed-out profile; this does not verify full ad coverage for a signed-in account. Disable the YouTube feature if it interferes with playback.

The pop-up guard allows windows opened during a recent user interaction so ordinary sign-in/payment windows can work. Some unwanted pop-ups triggered by a click may therefore get through. It does not comprehensively detect popunders or redirect scripts. Redirect protection only applies when the destination is on the blocked-domain list. Page scripts can work around the page-level pop-up guard; this extension is not a malware or phishing protection product.

## Privacy and permissions

- `declarativeNetRequest` lets the browser block matching requests without exposing their contents to this extension.
- `storage` saves your settings locally, across browser restarts. Nothing is synchronized to a server.
- `activeTab` identifies the website when you click the extension.
- `alarms` checks the local update marker periodically. The extension does not contact GitHub or store GitHub credentials.
- `scripting` and host access to `*.youtube.com` register the player filter before site scripts run. Registration persists across browser sessions and is removed when filtering is disabled; YouTube site exceptions exclude matching pages.
- Content scripts run on HTTP/HTTPS pages and frames to control pop-ups. On top-level YouTube pages, a page-world script filters player data locally; a separate helper hides ad tiles and provides the fallback. This requires website access and may produce an installation warning.

The extension has no telemetry, downloaded runtime scripts, external network fetches, browsing-history log, or document-content collection. It uses no debugger permission and displays no debugging banner. The separate Windows helper contacts GitHub to install newer complete extension packages from this repository.

## Verification

Tested in Opera GX 136.0.6008.76 using a separate temporary profile and local fixtures:

- A blocked request never reached the local HTTP server.
- A website exception restored embedded requests after reload.
- Turning the blocker off restored requests.
- Navigation to a blocked host was rejected.
- An automatic pop-up was blocked while a real user-clicked window remained available.
- A local YouTube-shaped fixture triggered the Skip button, muted an ad, hid an ad tile, and restored the prior mute state afterward.
- Disabling the YouTube helper restored the hidden tile.
- A document-start fixture consumed its inline player data immediately: with filtering enabled, no ad-media request was sent and the normal media resource was requested. Disabling the feature restored the ad request, providing a control.
- Real browser fetch/Request/Response/clone and XHR text/JSON paths filtered player data while preserving ordinary stream/caption metadata. Parent/subdomain exceptions and global/YouTube switches worked on existing pages and after reload.
- Public YouTube videos played with filtering enabled and disabled in a signed-out profile. One live initial response contained an `adPlacements` field when blocking was off; the enabled run had no known ad fields and normal playback continued. This confirms compatibility and filtering on that response, not comprehensive live ad prevention.
- Popup and settings pages loaded and were visually inspected.
- A managed installation upgraded from 1.0.0 to 1.1.0 in Opera GX through the real local-file check and runtime reload, retaining its saved custom domain list. The test triggered the registered alarm early rather than waiting for the normal hourly download cycle.
- The actual 1.1.0 runtime upgraded to 1.2.0 in an isolated Opera profile, retained custom settings, and registered the new filter without additional interaction beyond the already-enabled development mode.

The fixture tests verify extension behavior, not live ad coverage on YouTube or other websites. No changes were made to the user's regular Opera profile.

Run the included core, worker, update-bridge, and player-interception tests with Node.js 20+: `npm test`. Run `tests/updater.ps1` for release packaging, installation, directory replacement, version, and checksum checks. Run `node tests/youtube-browser.cjs` with Playwright installed and `QUIET_BLOCK_BROWSER` set to an Opera/Chrome executable for the isolated browser fixture tests. `PLAYWRIGHT_MODULE` may point to an existing Playwright installation. These tests create a disposable profile under the ignored `work/` folder.

The 1.2 package adds `youtube-block.js`. Before installing it with a 1.1 Windows helper, rerun `scripts/Install-Updates.ps1` from the new source to update the archive allowlist. Use `-SkipTask` to preserve the existing updater task unchanged. The new helper accepts both old and new packages and requires the player filter in packages version 1.2 or newer.

## Publishing the next update

1. Update `manifest.json` and `package.json` to the same newer version.
2. Run `npm test` and `tests/updater.ps1`.
3. Commit the change, tag it `vX.Y.Z`, and push the commit and tag.
4. The **Release** GitHub Actions workflow tests the code, builds `quiet-block.zip` and `SHA256SUMS`, and publishes a private GitHub release. Installed Windows helpers pick it up during their next successful check.

Only published stable releases are installed. A push to `main` alone runs tests but does not update installed copies. GitHub Actions must be enabled and have available runner capacity/minutes for automated releases. A maintainer can also run `scripts/Build-Release.ps1 -Tag vX.Y.Z` locally and upload the two generated files to the matching private release.

## Files and maintenance

`rules.mjs` contains the bundled domains, settings validation, and rule builder. `background.js` persists settings, installs network rules, and registers the YouTube filter. `youtube-block.js` filters known player ad data in the page world. `popup-guard.js` handles automatic pop-ups. `page-controls.js` applies site exceptions, hides ad tiles, and manages the fallback. The remaining HTML/CSS/JS files provide the popup and settings screens.

Edit the repository copy, not the managed installation: the helper replaces managed files with release files. For manual development copies, reload the extension in `opera://extensions`, then reload affected pages. Keep the extension folder on disk while it is installed.

Technical references: [Chrome network-rule API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest), [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [user activation](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/userActivation), and [Opera installation instructions](https://help.opera.com/en/extensions/testing/).

The player-filter implementation is original code; the known YouTube ad-field names and response-pruning approach were checked against the [uAssets filter rules](https://github.com/uBlockOrigin/uAssets/blob/master/filters/quick-fixes.txt). Registration uses Chrome's [scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting).
