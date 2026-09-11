/*
 * Folder Auto Tagger
 * ------------------
 * Watches your vault and automatically adds an inline #tag line to a note
 * based on the folders it lives in. A note inside "History/Medieval Europe"
 * gets a line containing #history and #medieval-europe (exact format is
 * configurable in the plugin settings).
 *
 * - Tags are written as real inline #tags on one dedicated line near the
 *   top of the note (right after frontmatter, if any). That line ends with
 *   a small `%%folder-auto-tagger%%` marker — Obsidian's native comment
 *   syntax — which is hidden in Reading view and Live Preview, and is only
 *   used so the plugin can find and update its own line later. The tags
 *   themselves are fully real, visible, clickable, and indexed.
 * - The plugin only ever edits that one marked line. Any other #tags you
 *   type elsewhere in the note are left completely alone.
 * - When a note moves to a different folder, that line is regenerated to
 *   match the new folder tags. Whether old, no-longer-applicable tags are
 *   dropped or kept is controlled by a setting.
 * - Runs automatically on note creation/move. Existing notes need a one-time
 *   pass via the command palette ("Apply folder tags to entire vault"),
 *   since auto-run intentionally skips the initial vault load.
 */

const { Plugin, PluginSettingTab, Setting, Notice, TFile, TFolder } = require('obsidian');

const MARKER = '%%folder-auto-tagger%%';

const DEFAULT_SETTINGS = {
	autoRun: true,
	removeStaleTags: true,
	tagStyle: 'flat', // 'flat' | 'nested' | 'both'
	separator: 'hyphen', // 'hyphen' | 'underscore' | 'none' | 'camel'
	lowercase: true,
	excludedFolders: '', // comma-separated folder names to ignore
	ignoreTopLevelFolders: 0, // skip this many folders counting from the vault root
	tagOverrides: '', // one per line: "folder name = custom tag, another tag"
};

class FolderAutoTaggerPlugin extends Plugin {
	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.addSettingTab(new FolderAutoTaggerSettingTab(this.app, this));

		this.addCommand({
			id: 'apply-folder-tags-current-file',
			name: 'Apply folder tags to current note',
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice('No active file.');
					return;
				}
				if (file.extension !== 'md') {
					new Notice('Active file is not a markdown note.');
					return;
				}
				await this.applyTagsToFile(file);
				new Notice('Folder tags applied.');
			},
		});

		this.addCommand({
			id: 'apply-folder-tags-vault',
			name: 'Apply folder tags to entire vault',
			callback: async () => {
				const files = this.app.vault.getMarkdownFiles();
				new Notice(`Tagging ${files.length} notes\u2026`);
				for (const f of files) {
					await this.applyTagsToFile(f);
				}
				new Notice(`Done. Checked ${files.length} notes for folder tags.`);
			},
		});

		// Auto-run only kicks in once the vault has finished its initial load.
		// Otherwise 'create' fires for every existing file on every startup,
		// which would mean editing every note's body on every app launch.
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on('create', (file) => {
					if (!this.settings.autoRun) return;
					if (file instanceof TFile && file.extension === 'md') {
						this.applyTagsToFile(file);
					}
				})
			);

			this.registerEvent(
				this.app.vault.on('rename', (file) => {
					if (!this.settings.autoRun) return;
					this.handleRenameOrMove(file);
				})
			);
		});
	}

	// Handles both a single file being renamed/moved, and a whole folder
	// being renamed/moved (in which case every markdown file inside it
	// needs its tag line recomputed).
	async handleRenameOrMove(abstractFile) {
		if (abstractFile instanceof TFile) {
			if (abstractFile.extension !== 'md') return;
			await this.applyTagsToFile(abstractFile);
		} else if (abstractFile instanceof TFolder) {
			const files = this.getAllMarkdownFilesIn(abstractFile);
			for (const f of files) {
				await this.applyTagsToFile(f);
			}
		}
	}

	getAllMarkdownFilesIn(folder) {
		const result = [];
		const recurse = (f) => {
			for (const child of f.children || []) {
				if (child instanceof TFile && child.extension === 'md') {
					result.push(child);
				} else if (child instanceof TFolder) {
					recurse(child);
				}
			}
		};
		recurse(folder);
		return result;
	}

	// Normalizes a folder name for matching purposes only (independent of the
	// user's separator/lowercase settings), so "Novel Studies" and
	// "novel-studies" are treated as the same folder when matching overrides.
	canonicalizeFolderKey(s) {
		return s
			.trim()
			.toLowerCase()
			.replace(/\s+/g, '-')
			.replace(/[^\p{L}\p{N}_\-]/gu, '');
	}

	// Parses the "folder name = tag, tag" lines from settings into a map of
	// lowercased folder name -> array of raw replacement tag strings.
	// An empty right-hand side (e.g. "Templates =") maps to an empty array,
	// meaning "this folder produces no tag at all."
	parseOverrides() {
		const map = new Map();
		const lines = (this.settings.tagOverrides || '').split('\n');
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const eqIndex = trimmed.indexOf('=');
			if (eqIndex === -1) continue; // malformed line, skip it
			const folderName = this.canonicalizeFolderKey(trimmed.slice(0, eqIndex));
			if (!folderName) continue;
			const tagsPart = trimmed.slice(eqIndex + 1).trim();
			const rawTags = tagsPart
				? tagsPart
						.split(',')
						.map((t) => t.trim())
						.filter(Boolean)
				: [];
			map.set(folderName, rawTags);
		}
		return map;
	}

	// Turns one folder-name segment into a clean tag-safe string,
	// according to the user's separator/casing preferences.
	formatSegment(rawSegment) {
		let s = rawSegment.trim();

		switch (this.settings.separator) {
			case 'hyphen':
				s = s.replace(/\s+/g, '-');
				break;
			case 'underscore':
				s = s.replace(/\s+/g, '_');
				break;
			case 'camel':
				s = s
					.split(/\s+/)
					.map((w, i) => {
						if (!w) return w;
						return i === 0
							? w.charAt(0).toLowerCase() + w.slice(1)
							: w.charAt(0).toUpperCase() + w.slice(1);
					})
					.join('');
				break;
			case 'none':
			default:
				s = s.replace(/\s+/g, '');
				break;
		}

		// Strip anything that isn't a letter, number, underscore, or hyphen.
		// (Slashes are stripped too since they'd otherwise be misread as
		// tag-nesting separators when a folder name itself contains one.)
		s = s.replace(/[^\p{L}\p{N}_\-]/gu, '');

		if (this.settings.lowercase) s = s.toLowerCase();

		return s;
	}

	// Computes the list of tags a file should have based on its folder path.
	computeFolderTags(file) {
		const pathParts = file.path.split('/');
		pathParts.pop(); // drop the filename itself

		const skip = Math.max(0, this.settings.ignoreTopLevelFolders | 0);
		let parts = pathParts.slice(skip);

		const excludedSet = new Set(
			this.settings.excludedFolders
				.split(',')
				.map((s) => s.trim().toLowerCase())
				.filter(Boolean)
		);
		parts = parts.filter((p) => !excludedSet.has(p.toLowerCase()));

		if (parts.length === 0) return [];

		const overrides = this.parseOverrides();

		// Each entry is the list of formatted tag(s) that one folder level
		// contributes. Normally that's a single tag (the folder's own name),
		// but an override can replace it with zero, one, or several tags.
		const segments = parts.map((p) => {
			const override = overrides.get(this.canonicalizeFolderKey(p));
			if (override) {
				return override.map((t) => this.formatSegment(t)).filter(Boolean);
			}
			const formatted = this.formatSegment(p);
			return formatted ? [formatted] : [];
		});

		const tags = [];
		const addUnique = (t) => {
			if (t && !tags.includes(t)) tags.push(t);
		};

		if (this.settings.tagStyle === 'flat' || this.settings.tagStyle === 'both') {
			for (const seg of segments) {
				for (const t of seg) addUnique(t);
			}
		}

		if (this.settings.tagStyle === 'nested' || this.settings.tagStyle === 'both') {
			let cumulative = '';
			for (const seg of segments) {
				// A nested path needs exactly one segment per level, so an
				// override with several tags only contributes its first one
				// here (the rest still show up via the flat tags above).
				const rep = seg[0];
				if (!rep) continue;
				cumulative = cumulative ? `${cumulative}/${rep}` : rep;
				addUnique(cumulative);
			}
		}

		return tags;
	}

	buildTagLine(tags) {
		return tags.map((t) => `#${t}`).join(' ') + ` ${MARKER}`;
	}

	// Pulls the tag names out of an existing managed line (everything
	// before the marker), so they can be merged with newly computed tags.
	parseExistingLineTags(line) {
		const beforeMarker = line.split(MARKER)[0];
		const matches = beforeMarker.match(/#[^\s#]+/g) || [];
		return matches.map((m) => m.slice(1));
	}

	// Finds the line index right after the frontmatter block, or 0 if
	// there's no frontmatter (i.e. where a new tag line should be inserted).
	findInsertionIndex(lines) {
		if (lines[0] !== '---') return 0;
		for (let i = 1; i < lines.length; i++) {
			if (lines[i] === '---') return i + 1;
		}
		return 0; // unterminated frontmatter; fall back to top of file
	}

	// Reads the note, adds/updates/removes its single managed tag line to
	// reflect the current folder structure, and writes it back if changed.
	async applyTagsToFile(file) {
		if (!(file instanceof TFile) || file.extension !== 'md') return;

		const newTags = this.computeFolderTags(file);
		const content = await this.app.vault.read(file);
		const lines = content.split('\n');
		const markerIndex = lines.findIndex((line) => line.includes(MARKER));

		if (markerIndex === -1 && newTags.length === 0) return; // nothing to do

		let updatedLines = lines.slice();

		if (markerIndex !== -1) {
			const existingTags = this.parseExistingLineTags(lines[markerIndex]);
			const finalTags = this.settings.removeStaleTags
				? newTags
				: existingTags.concat(newTags.filter((t) => !existingTags.includes(t)));

			if (finalTags.length === 0) {
				updatedLines.splice(markerIndex, 1);
				// The line that follows is almost always the blank separator
				// we inserted alongside the tag line originally; remove it too.
				if (updatedLines[markerIndex] === '') {
					updatedLines.splice(markerIndex, 1);
				}
			} else {
				updatedLines[markerIndex] = this.buildTagLine(finalTags);
			}
		} else {
			const insertAt = this.findInsertionIndex(updatedLines);
			const newLine = this.buildTagLine(newTags);
			const nextLineHasContent = updatedLines[insertAt] !== undefined && updatedLines[insertAt].trim() !== '';
			const insertion = nextLineHasContent ? [newLine, ''] : [newLine];
			updatedLines.splice(insertAt, 0, ...insertion);
		}

		const updatedContent = updatedLines.join('\n');
		if (updatedContent !== content) {
			await this.app.vault.modify(file, updatedContent);
		}
	}
}

class FolderAutoTaggerSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Folder Auto Tagger' });
		containerEl.createEl('p', {
			text:
				'Adds a line of inline #tags near the top of a note based on the folders it sits in. ' +
				'E.g. a note in "History/Medieval Europe" can get both a #history tag and a #medieval-europe tag, ' +
				'placed on a dedicated line with a small hidden marker so the plugin can find and update it later.',
		});

		new Setting(containerEl)
			.setName('Automatically tag new and moved notes')
			.setDesc(
				'When on, tags are applied as soon as a note is created or moved to a different folder. ' +
					'Existing notes are not retagged automatically \u2014 use the command below for those.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoRun).onChange(async (value) => {
					this.plugin.settings.autoRun = value;
					await this.plugin.saveData(this.plugin.settings);
				})
			);

		new Setting(containerEl)
			.setName('Remove tags when a note leaves a folder')
			.setDesc(
				'If a note is moved out of "Medieval Europe", remove the #medieval-europe tag from the managed line. ' +
					'Turn this off to keep old folder tags around even after a note moves \u2014 new folder tags still get added either way.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.removeStaleTags).onChange(async (value) => {
					this.plugin.settings.removeStaleTags = value;
					await this.plugin.saveData(this.plugin.settings);
				})
			);

		new Setting(containerEl)
			.setName('Tag style')
			.setDesc(
				'Separate tag per folder: #history and #medieval-europe. ' +
					'Nested path tag: #history and #history/medieval-europe (uses Obsidian\u2019s built-in tag hierarchy). ' +
					'Both: all of the above.'
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('flat', 'Separate tag per folder')
					.addOption('nested', 'Nested path tag')
					.addOption('both', 'Both')
					.setValue(this.plugin.settings.tagStyle)
					.onChange(async (value) => {
						this.plugin.settings.tagStyle = value;
						await this.plugin.saveData(this.plugin.settings);
					})
			);

		new Setting(containerEl)
			.setName('Word separator')
			.setDesc('How multi-word folder names like "Medieval Europe" become tag text. Tags can\u2019t contain spaces.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('hyphen', 'Hyphen (medieval-europe)')
					.addOption('underscore', 'Underscore (medieval_europe)')
					.addOption('camel', 'camelCase (medievalEurope)')
					.addOption('none', 'Remove spaces (medievaleurope)')
					.setValue(this.plugin.settings.separator)
					.onChange(async (value) => {
						this.plugin.settings.separator = value;
						await this.plugin.saveData(this.plugin.settings);
					})
			);

		new Setting(containerEl)
			.setName('Lowercase tags')
			.setDesc('Force all generated tags to lowercase.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.lowercase).onChange(async (value) => {
					this.plugin.settings.lowercase = value;
					await this.plugin.saveData(this.plugin.settings);
				})
			);

		new Setting(containerEl)
			.setName('Excluded folder names')
			.setDesc(
				'Comma-separated folder names that should never become tags (their notes can still pick up tags from ' +
					'deeper subfolders). Example: Templates, Attachments, Daily Notes'
			)
			.addText((text) =>
				text
					.setPlaceholder('Templates, Attachments')
					.setValue(this.plugin.settings.excludedFolders)
					.onChange(async (value) => {
						this.plugin.settings.excludedFolders = value;
						await this.plugin.saveData(this.plugin.settings);
					})
			);

		new Setting(containerEl)
			.setName('Folder tag overrides')
			.setDesc(
				'Replace the auto-generated tag for a specific folder with whatever tag(s) you want, instead of using ' +
					'the folder\u2019s own name. One per line, as "folder name = tag" or "folder name = tag one, tag two". ' +
					'Matches by the folder\u2019s own name (not its full path). Leave the right side blank to give that ' +
					'folder no tag at all. Example: novel-studies = analytical'
			)
			.addTextArea((text) => {
				text.setPlaceholder('novel-studies = analytical\nwwii = world-war-2, 20th-century');
				text.setValue(this.plugin.settings.tagOverrides);
				text.onChange(async (value) => {
					this.plugin.settings.tagOverrides = value;
					await this.plugin.saveData(this.plugin.settings);
				});
				text.inputEl.rows = 5;
				text.inputEl.style.width = '100%';
				text.inputEl.style.resize = 'both';
				text.inputEl.style.minWidth = '100%';
				text.inputEl.style.boxSizing = 'border-box';
			});

		new Setting(containerEl)
			.setName('Ignore top-level folders')
			.setDesc(
				'Skip this many folder levels counting from the vault root before generating tags. Useful if your vault ' +
					'root looks like "Areas/History/Medieval Europe" and you don\u2019t want an "areas" tag. Set to 1 to skip it.'
			)
			.addText((text) =>
				text
					.setPlaceholder('0')
					.setValue(String(this.plugin.settings.ignoreTopLevelFolders))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						this.plugin.settings.ignoreTopLevelFolders = Number.isFinite(n) && n >= 0 ? n : 0;
						await this.plugin.saveData(this.plugin.settings);
					})
			);

		new Setting(containerEl)
			.setName('Apply folder tags to entire vault now')
			.setDesc('Run a one-time pass over every existing note, adding folder tags where they\u2019re missing.')
			.addButton((button) =>
				button
					.setButtonText('Apply now')
					.setCta()
					.onClick(async () => {
						const files = this.plugin.app.vault.getMarkdownFiles();
						new Notice(`Tagging ${files.length} notes\u2026`);
						for (const f of files) {
							await this.plugin.applyTagsToFile(f);
						}
						new Notice(`Done. Checked ${files.length} notes for folder tags.`);
					})
			);
	}
}

module.exports = FolderAutoTaggerPlugin;
