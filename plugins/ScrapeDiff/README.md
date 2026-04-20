# ScrapeDiff

Highlights what changed between your existing data and the scraped result in Stash scrape result modals — word-level diff on Details/Synopsis text, and added/removed color coding on tags.

![ScrapeDiff in Scene scrape modal](assets/scene-scrape.png)

## Features

- Word-level diff with red (removed) and green (added) highlights on Details/Synopsis
- Tag diff highlighting — removed tags turn red, added tags turn green
- Works across Scene, Gallery, Performer, and Group scrape modals
- Synchronized height resize — drag either textarea and the other follows
- Scroll-synced overlays
- Debounced live update as you edit the scraped field
- No external dependencies, no build step

## Installation

### Via Stash (recommended)

1. Go to **Settings → Plugins → Available Plugins**
2. Click **Add Source** and fill in:
   - **Name:** anything you like (e.g. `rchrdcho`)
   - **Source URL:** `https://rchrdcho.github.io/StashPlugins/main/index.yml`
3. Find **ScrapeDiff** in the list, check the box, and click **Install**
4. Click **Reload Plugins**
5. Refresh the page

### Manual install

1. Clone this repository, or download it as a ZIP and unzip it
2. Copy the `ScrapeDiff` folder into your Stash plugins directory (default: `~/.stash/plugins/`)
3. Go to **Settings → Plugins** and click **Reload Plugins**
4. Refresh the page

## Usage

Open any scrape result modal. The Details/Synopsis field will display a word-level diff, and the Tags field will highlight which tags are new or removed.

No configuration required.

## Notes

- Skips the Details/Synopsis diff when the existing field is empty (new data, nothing to diff against)
- Skips the Tags diff when the existing tags field is empty (new data, nothing to diff against)
- Cleans up all event listeners and observers when the modal closes
