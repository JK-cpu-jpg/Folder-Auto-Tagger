# Folder Auto Tagger

Automatically tags notes based on the folders they're in. A note inside
`History/Medieval Europe/` gets tagged with both `#history` and
`#medieval-europe` — nested folders stack up tags as you go deeper.

No build step needed — it's plain JavaScript, just drop it in and enable it.

## Install

1. In your vault, go to `.obsidian/plugins/` (a hidden folder at the root of
   your vault). Create a new folder there called `folder-auto-tagger`.
2. Copy `main.js` and `manifest.json` into that folder.
3. In Obsidian: **Settings → Community plugins**. If "Restricted mode" is on,
   turn it off.
4. Click the reload icon next to "Installed plugins" (or restart Obsidian).
5. Find **Folder Auto Tagger** in the list and enable it.

Your folder structure should look like:
```
YourVault/.obsidian/plugins/folder-auto-tagger/main.js
YourVault/.obsidian/plugins/folder-auto-tagger/manifest.json
```

## How it works

- Folder tags are written as real, visible inline `#tags` on a single
  dedicated line near the top of the note (right after frontmatter, if the
  note has any).
- That line ends with a small `%%folder-auto-tagger%%` marker — Obsidian's
  own comment syntax. It's hidden in Reading view and Live Preview, and is
  only there so the plugin can find and update its own line later. It's
  visible as plain text if you switch to Source mode, as a reminder that the
  line is plugin-managed.
- The plugin only ever touches that one marked line. Any other `#tags` you
  type elsewhere in the note — in the title, body, wherever — are left
  completely alone.
- New notes and notes moved into a folder get tagged automatically.
- Move a note to a different folder and the line is regenerated to match.
  Whether tags that no longer apply get dropped or kept is a setting (see
  below).
- Existing notes aren't retagged automatically when you first install the
  plugin (so it doesn't rewrite your whole vault on a whim). Run the command
  **"Apply folder tags to entire vault"** once from the command palette
  (`Ctrl/Cmd + P`) to backfill everything.
- There's also **"Apply folder tags to current note"** for a one-off refresh.

## Settings

Open **Settings → Folder Auto Tagger**:

- **Automatically tag new and moved notes** — turn off if you'd rather run it
  manually via the commands above.
- **Remove tags when a note leaves a folder** — on by default: moving a note
  out of "Medieval Europe" drops `#medieval-europe` from the managed line.
  Turn off to keep old folder tags around indefinitely (new ones still get
  added on top).
- **Tag style**
  - *Separate tag per folder* (default): `#history #medieval-europe`
  - *Nested path tag*: `#history #history/medieval-europe` — uses
    Obsidian's built-in nested tag feature, so it groups visually in the tag
    pane.
  - *Both*: gives you all of the above.
- **Word separator** — how a multi-word folder name like "Medieval Europe"
  becomes valid tag text (tags can't contain spaces): hyphen (default),
  underscore, camelCase, or just remove the spaces.
- **Lowercase tags** — on by default.
- **Excluded folder names** — comma-separated list of folder names that
  should never become a tag themselves (e.g. `Templates, Attachments`).
  Notes in subfolders beneath an excluded folder still pick up tags from
  those deeper folders.
- **Folder tag overrides** — replace the auto-generated tag for a specific
  folder with whatever tag(s) you actually want, instead of the folder's
  own name. One per line:
  ```
  novel-studies = analytical
  wwii = world-war-2, 20th-century
  templates =
  ```
  - Matches by the folder's own name, not its full path, and ignores case
    and spacing/hyphenation — `Novel Studies`, `novel-studies`, and
    `novel studies` all match the same folder.
  - You can list more than one replacement tag, comma-separated.
  - Leave the right side blank to give that folder no tag at all (same idea
    as the excluded list above, just one-by-one).
  - With *Nested path tag* style, only the first listed replacement tag is
    used to build the nested path; switch to *Both* to also get any extra
    replacement tags as standalone flat tags.
  - This only changes the tag for that exact folder — subfolders beneath it
    still get their own normal (or overridden) tags.
- **Ignore top-level folders** — skip this many folder levels from the vault
  root. Handy if your vault root is organized like `Areas/History/Medieval
  Europe/` and you don't want an `#areas` tag on everything.

## Example

With default settings, this structure:
```
History/
  Medieval Europe/
    Charlemagne.md
  Ancient Rome/
    Julius Caesar.md
```
turns `Charlemagne.md` into something like:
```
#history #medieval-europe %%folder-auto-tagger%%

# Charlemagne
...your existing note content, untouched...
```
and `Julius Caesar.md` gets `#history #ancient-rome` the same way.

## A note on hand-editing the managed line

If you manually edit the tag line itself (not just other tags elsewhere in
the note), keep the `%%folder-auto-tagger%%` marker in place so the plugin
can still find it. If you remove the marker entirely, the plugin will treat
the note as untagged and insert a fresh line the next time it runs — leaving
your edited line as ordinary, unmanaged text.
