/**
 * The heading levels a rich text field lets editors create, from the field's
 * `options.headingLevels`. Menus, shortcuts, and Markdown typing only offer
 * these levels, and pasted headings move to the closest one. Headings already
 * in the content keep their level.
 */

import { Extension, type Editor } from "@tiptap/core";
import { Fragment, Slice, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";

import type { HeadingLevel } from "./HeadingDropdownMenu.js";
import { ALL_HEADING_LEVELS, isHeadingLevel } from "./headingLevelSettings.js";

export { ALL_HEADING_LEVELS, readHeadingLevels } from "./headingLevelSettings.js";

/**
 * The allowed level closest to `level`, preferring the smaller heading on a
 * tie so pasted text never grows more prominent. `null` when none is allowed.
 */
export function closestHeadingLevel(
	level: number,
	allowed: readonly HeadingLevel[],
): HeadingLevel | null {
	let closest: HeadingLevel | null = null;
	for (const candidate of allowed) {
		if (
			closest === null ||
			Math.abs(candidate - level) < Math.abs(closest - level) ||
			(Math.abs(candidate - level) === Math.abs(closest - level) && candidate > closest)
		) {
			closest = candidate;
		}
	}
	return closest;
}

function paragraphAttrs(schema: Schema, heading: ProseMirrorNode): Record<string, unknown> {
	const known = schema.nodes.paragraph!.spec.attrs ?? {};
	return Object.fromEntries(Object.entries(heading.attrs).filter(([name]) => name in known));
}

function mapHeadings(
	fragment: Fragment,
	allowed: readonly HeadingLevel[],
	schema: Schema,
): Fragment {
	const nodes: ProseMirrorNode[] = [];
	fragment.forEach((node) => {
		const current: unknown = node.attrs.level;
		if (node.type.name === "heading" && !(isHeadingLevel(current) && allowed.includes(current))) {
			const level = closestHeadingLevel(typeof current === "number" ? current : 1, allowed);
			nodes.push(
				level === null
					? schema.nodes.paragraph!.create(paragraphAttrs(schema, node), node.content, node.marks)
					: node.type.create({ ...node.attrs, level }, node.content, node.marks),
			);
		} else {
			nodes.push(node.isTextblock ? node : node.copy(mapHeadings(node.content, allowed, schema)));
		}
	});
	return Fragment.from(nodes);
}

/**
 * Moves headings at levels outside `allowed` to the closest allowed level, or
 * to paragraphs. Applies to content new to the field: pastes, outside drops,
 * duplicated blocks, and inserted sections.
 */
export function mapPastedHeadings(
	slice: Slice,
	allowed: readonly HeadingLevel[],
	schema: Schema,
): Slice {
	if (allowed.length === ALL_HEADING_LEVELS.length) return slice;
	return new Slice(mapHeadings(slice.content, allowed, schema), slice.openStart, slice.openEnd);
}

interface HeadingLevelsOptions {
	getLevels: () => readonly HeadingLevel[];
}

export const HeadingLevels = Extension.create<HeadingLevelsOptions>({
	name: "emdashHeadingLevels",
	addOptions() {
		return { getLevels: () => ALL_HEADING_LEVELS };
	},
	addProseMirrorPlugins() {
		const { getLevels } = this.options;
		return [
			new Plugin({
				props: {
					// A block dragged inside the editor keeps its level. `view.dragging` can outlive a drag
					// that ended outside the editor, so only the dragged slice itself is let through.
					transformPasted: (slice, view) =>
						slice === view.dragging?.slice
							? slice
							: mapPastedHeadings(slice, getLevels(), view.state.schema),
				},
			}),
		];
	},
});

/** `mapPastedHeadings` for Portable Text converted to editor JSON, such as an inserted section. */
export function mapHeadingsInContent(editor: Editor, content: unknown[]): unknown[] {
	const allowed = allowedHeadingLevels(editor);
	if (allowed.length === ALL_HEADING_LEVELS.length) return content;
	const { schema } = editor;
	const nodes = Fragment.fromArray(content.map((node) => schema.nodeFromJSON(node)));
	const mapped: unknown[] = [];
	mapPastedHeadings(new Slice(nodes, 0, 0), allowed, schema).content.forEach((node) => {
		mapped.push(node.toJSON());
	});
	return mapped;
}

/** The levels editors can create in this editor; all six when it has no `HeadingLevels` extension. */
export function allowedHeadingLevels(editor: Editor): readonly HeadingLevel[] {
	const extension = editor.extensionManager.extensions.find(
		(candidate) => candidate.name === HeadingLevels.name,
	);
	const options: unknown = extension?.options;
	return hasLevelsGetter(options) ? options.getLevels() : ALL_HEADING_LEVELS;
}

function hasLevelsGetter(options: unknown): options is HeadingLevelsOptions {
	return (
		typeof options === "object" &&
		options !== null &&
		"getLevels" in options &&
		typeof options.getLevels === "function"
	);
}
