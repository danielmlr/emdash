/**
 * Per-field heading levels: the editor only offers the levels a field allows,
 * keeps headings already in the content, and moves pasted headings to an
 * allowed level.
 */

import { Fragment, Slice } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { describe, it, expect, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { duplicateBlocks } from "../../src/components/editor/BlockCommands";
import { turnIntoMenuTypes } from "../../src/components/editor/blockTypes";
import {
	closestHeadingLevel,
	mapPastedHeadings,
	readHeadingLevels,
} from "../../src/components/editor/headingLevels";
import {
	PortableTextEditor,
	type PortableTextEditorProps,
} from "../../src/components/PortableTextEditor";
import { render } from "../utils/render";

import "../../src/styles.css";

vi.mock("../../src/components/MediaPickerModal", () => ({
	MediaPickerModal: () => null,
}));

vi.mock("../../src/components/SectionPickerModal", () => ({
	SectionPickerModal: ({
		open,
		onOpenChange,
		onSelect,
	}: {
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onSelect: (section: { content: unknown[] }) => void;
	}) =>
		open ? (
			<button
				type="button"
				onClick={() => {
					onSelect({
						content: [
							{
								_type: "block",
								_key: "section-title",
								style: "h1",
								children: [{ _type: "span", _key: "section-span", text: "Section title" }],
							},
						],
					});
					onOpenChange(false);
				}}
			>
				Select test section
			</button>
		) : null,
}));

vi.mock("../../src/components/editor/DragHandleWrapper", () => ({
	DragHandleWrapper: () => null,
}));

vi.mock("../../src/components/editor/ImageNode", async () => {
	const { Node } = await import("@tiptap/core");
	const ImageExtension = Node.create({
		name: "image",
		group: "block",
		atom: true,
		addAttributes() {
			return { src: { default: null }, alt: { default: "" } };
		},
		parseHTML() {
			return [{ tag: "img[src]" }];
		},
		renderHTML({ HTMLAttributes }) {
			return ["img", HTMLAttributes];
		},
	});
	return { ImageExtension };
});

vi.mock("../../src/components/editor/PluginBlockNode", async () => {
	const { Node } = await import("@tiptap/core");
	const PluginBlockExtension = Node.create({
		name: "pluginBlock",
		group: "block",
		atom: true,
		addAttributes() {
			return { blockType: { default: "embed" }, id: { default: "" }, data: { default: {} } };
		},
		parseHTML() {
			return [{ tag: "div[data-plugin-block]" }];
		},
		renderHTML({ HTMLAttributes }) {
			return ["div", { ...HTMLAttributes, "data-plugin-block": "" }];
		},
	});
	return {
		PluginBlockExtension,
		getEmbedMeta: () => ({ label: "Embed", Icon: () => null }),
		registerPluginBlocks: () => {},
		resolveIcon: () => () => null,
	};
});

const NO_H1 = [2, 3, 4, 5, 6] as const;

async function renderEditor(props: Partial<PortableTextEditorProps> = {}) {
	let editorInstance: Editor | null = null;
	const screen = await render(
		<PortableTextEditor
			onEditorReady={(editor) => {
				editorInstance = editor;
			}}
			{...props}
		/>,
	);
	await vi.waitFor(() => expect(editorInstance).toBeTruthy(), { timeout: 3000 });
	const pm = document.querySelector<HTMLElement>(".ProseMirror")!;
	pm.focus();
	await vi.waitFor(() => expect(document.activeElement).toBe(pm));
	return { screen, editor: editorInstance!, pm };
}

function block(style: string, text: string) {
	return {
		_type: "block" as const,
		_key: `${style}-${text}`,
		style,
		children: [{ _type: "span" as const, _key: `${style}-${text}-span`, text }],
	};
}

/** Runs typed text through the editor's input rules, as a keyboard would. */
function simulateTyping(editor: Editor, text: string) {
	for (const char of text) {
		const { from, to } = editor.state.selection;
		const insertText = () => editor.state.tr.insertText(char, from, to);
		const handled = editor.view.someProp("handleTextInput", (handler) =>
			handler(editor.view, from, to, char, insertText),
		);
		if (!handled) editor.view.dispatch(insertText());
	}
}

function pasteHtml(editor: Editor, html: string) {
	const clipboardData = {
		files: [],
		items: [],
		types: ["text/html", "text/plain"],
		getData: (type: string) => (type === "text/html" ? html : ""),
	};
	const paste = new Event("paste", { bubbles: true, cancelable: true });
	Object.defineProperty(paste, "clipboardData", { value: clipboardData });
	editor.view.dom.dispatchEvent(paste);
}

function headingLevelsInDoc(editor: Editor): number[] {
	const levels: number[] = [];
	editor.state.doc.descendants((node) => {
		if (node.type.name === "heading") levels.push(node.attrs.level as number);
	});
	return levels;
}

async function slashMenuTitles(editor: Editor, query = ""): Promise<string[]> {
	editor.commands.insertContent(`/${query}`);
	let menu: HTMLElement | null = null;
	await vi.waitFor(() => {
		menu = document.querySelector<HTMLElement>("[data-slash-command-menu]");
		expect(menu).toBeTruthy();
	});
	return Array.from(menu!.querySelectorAll("[data-slash-item-title]"), (item) => item.textContent);
}

describe("readHeadingLevels", () => {
	it("offers all six levels when the option is missing or holds no valid level", () => {
		expect(readHeadingLevels(undefined)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(readHeadingLevels("2,3")).toEqual([1, 2, 3, 4, 5, 6]);
		expect(readHeadingLevels([0, 7, "2"])).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it("sorts the levels, drops duplicates and ignores invalid entries", () => {
		expect(readHeadingLevels([4, 2, 2, 3, 9, 2.5])).toEqual([2, 3, 4]);
	});

	it("reads an empty list as no headings", () => {
		expect(readHeadingLevels([])).toEqual([]);
	});
});

describe("closestHeadingLevel", () => {
	it("moves to the nearest allowed level", () => {
		expect(closestHeadingLevel(1, NO_H1)).toBe(2);
		expect(closestHeadingLevel(6, [2, 3, 4])).toBe(4);
	});

	it("takes the smaller heading when two levels are equally close", () => {
		expect(closestHeadingLevel(2, [1, 3])).toBe(3);
	});

	it("returns null when no level is allowed", () => {
		expect(closestHeadingLevel(1, [])).toBeNull();
	});
});

describe("turnIntoMenuTypes", () => {
	it("leaves out disallowed levels unless the block already uses one", () => {
		expect(turnIntoMenuTypes("paragraph", NO_H1).map((type) => type.id)).not.toContain("heading1");
		expect(turnIntoMenuTypes("heading1", NO_H1).map((type) => type.id)).toContain("heading1");
	});
});

describe("Heading levels in the editor", () => {
	it("keeps disallowed levels out of the slash menu, even when searched for", async () => {
		const { editor } = await renderEditor({ headingLevels: NO_H1 });

		const titles = await slashMenuTitles(editor);
		expect(titles).not.toContain("Heading 1");
		expect(titles).toContain("Heading 2");

		editor.commands.insertContent("heading");
		await vi.waitFor(() => {
			const searched = Array.from(
				document.querySelectorAll("[data-slash-command-menu] [data-slash-item-title]"),
				(item) => item.textContent,
			);
			expect(searched).toContain("Heading 6");
			expect(searched).not.toContain("Heading 1");
		});
	});

	it("keeps disallowed levels out of the toolbar's heading menu", async () => {
		const { screen } = await renderEditor({ headingLevels: NO_H1 });

		screen.getByRole("button", { name: "Headings" }).element().click();
		await expect.element(screen.getByRole("menuitem", { name: "Heading 2" })).toBeVisible();
		expect(screen.getByRole("menuitem", { name: "Heading 1" }).query()).toBeNull();
	});

	it("hides the heading menu when the field allows no headings", async () => {
		const { screen } = await renderEditor({ headingLevels: [] });

		await expect.element(screen.getByRole("button", { name: "Bold" })).toBeVisible();
		expect(screen.getByRole("button", { name: "Headings" }).query()).toBeNull();
	});

	it("leaves a disallowed Markdown heading as text and converts an allowed one", async () => {
		const { editor } = await renderEditor({ headingLevels: NO_H1 });

		simulateTyping(editor, "# ");
		expect(headingLevelsInDoc(editor)).toEqual([]);
		expect(editor.state.doc.textContent).toBe("# ");

		editor.commands.setContent("<p></p>");
		simulateTyping(editor, "## ");
		expect(headingLevelsInDoc(editor)).toEqual([2]);
	});

	it("ignores the keyboard shortcut for a disallowed level", async () => {
		const { editor } = await renderEditor({
			headingLevels: NO_H1,
			value: [block("normal", "Intro")],
		});
		editor.commands.setTextSelection(2);

		await userEvent.keyboard("{ControlOrMeta>}{Alt>}1{/Alt}{/ControlOrMeta}");
		expect(headingLevelsInDoc(editor)).toEqual([]);

		await userEvent.keyboard("{ControlOrMeta>}{Alt>}2{/Alt}{/ControlOrMeta}");
		expect(headingLevelsInDoc(editor)).toEqual([2]);
	});

	it("keeps an existing disallowed heading and shows it as the current level", async () => {
		const onChange = vi.fn();
		const { screen, editor, pm } = await renderEditor({
			headingLevels: NO_H1,
			value: [block("h1", "Old title"), block("normal", "Body")],
			onChange,
		});

		expect(pm.querySelector("h1")?.textContent).toBe("Old title");
		editor.commands.setTextSelection(2);

		screen.getByRole("button", { name: "Headings" }).element().click();
		await expect.element(screen.getByRole("menuitem", { name: "Heading 1" })).toBeVisible();
		expect(onChange).not.toHaveBeenCalled();
	});

	it("moves pasted headings to the closest allowed level", async () => {
		const { editor } = await renderEditor({ headingLevels: [2, 3, 4] });

		pasteHtml(editor, "<h1>Title</h1><h3>Section</h3><h6>Aside</h6><p>Text</p>");

		expect(headingLevelsInDoc(editor)).toEqual([2, 3, 4]);
	});

	it("keeps pasted headings unchanged when every level is allowed", async () => {
		const { editor } = await renderEditor();

		pasteHtml(editor, "<h1>Title</h1><h6>Aside</h6>");

		expect(headingLevelsInDoc(editor)).toEqual([1, 6]);
	});
});

describe("Heading levels in content new to the field", () => {
	it("maps a paste even when a block drag ended outside the editor", async () => {
		const { editor } = await renderEditor({
			headingLevels: NO_H1,
			value: [block("normal", "Intro")],
		});
		// A drag from the block handle that is dropped outside the editor leaves this set.
		Object.assign(editor.view, {
			dragging: { slice: editor.state.doc.slice(0, editor.state.doc.content.size), move: true },
		});

		pasteHtml(editor, "<h1>Title</h1>");

		expect(headingLevelsInDoc(editor)).toEqual([2]);
	});

	it("keeps the level of a block dragged inside the editor", async () => {
		const { editor } = await renderEditor({ headingLevels: NO_H1, value: [block("h1", "Old")] });
		const dragged = editor.state.doc.slice(0, editor.state.doc.child(0).nodeSize);
		Object.assign(editor.view, { dragging: { slice: dragged, move: true } });

		let dropped: Slice | undefined;
		editor.view.someProp("transformPasted", (transform) => {
			dropped = transform(dragged, editor.view, false);
		});

		expect(dropped?.content.child(0).attrs.level).toBe(1);
	});

	it("gives a duplicated disallowed heading an allowed level", async () => {
		const { editor } = await renderEditor({ headingLevels: NO_H1, value: [block("h1", "Old")] });
		editor.commands.setNodeSelection(0);

		duplicateBlocks(editor);

		expect(headingLevelsInDoc(editor)).toEqual([1, 2]);
	});

	it("gives the headings of an inserted section an allowed level", async () => {
		const { editor, screen } = await renderEditor({ headingLevels: NO_H1 });

		const titles = await slashMenuTitles(editor, "section");
		expect(titles).toContain("Section");
		await userEvent.keyboard("{Enter}");
		await screen.getByRole("button", { name: "Select test section" }).click();

		await vi.waitFor(() => expect(headingLevelsInDoc(editor)).toEqual([2]));
	});
});

describe("mapPastedHeadings", () => {
	it("turns pasted headings into paragraphs when no level is allowed", async () => {
		const { editor } = await renderEditor();
		const { schema } = editor.state;
		const heading = schema.nodes.heading!.create(
			{ level: 1, textAlign: "center" },
			schema.text("Title"),
		);
		const quote = schema.nodes.blockquote!.create(null, schema.nodes.paragraph!.create());

		const mapped = mapPastedHeadings(new Slice(Fragment.from([heading, quote]), 0, 0), [], schema);

		expect(mapped.content.child(0).type.name).toBe("paragraph");
		expect(mapped.content.child(0).attrs.textAlign).toBe("center");
		expect(mapped.content.child(0).textContent).toBe("Title");
		expect(mapped.content.child(1).type.name).toBe("blockquote");
	});
});
