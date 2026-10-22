/**
 * Repeater sub-field type validation (issue #1424).
 *
 * The Zod enum guarding `validation.subFields[].type` must stay in sync with
 * `REPEATER_SUB_FIELD_TYPES` (schema/types.ts). It was missing "url" (a
 * documented sub-field type the schema-builder UI offers) and gained "image"
 * together with media-picker support in repeater rows.
 */

import { describe, it, expect } from "vitest";

import { createFieldBody, updateFieldBody } from "../../../src/api/schemas/schema.js";
import { REPEATER_SUB_FIELD_TYPES } from "../../../src/schema/types.js";

function repeaterFieldWith(subFieldType: string) {
	return {
		slug: "gallery",
		label: "Gallery",
		type: "repeater",
		validation: {
			subFields: [{ slug: "entry", type: subFieldType, label: "Entry" }],
		},
	};
}

describe("createFieldBody repeater sub-field types", () => {
	it.each([...REPEATER_SUB_FIELD_TYPES])("accepts %s sub-fields", (type) => {
		const result = createFieldBody.safeParse(repeaterFieldWith(type));
		expect(result.success).toBe(true);
	});

	it("rejects unsupported sub-field types", () => {
		for (const type of ["repeater", "portableText", "reference", "nonsense"]) {
			const result = createFieldBody.safeParse(repeaterFieldWith(type));
			expect(result.success).toBe(false);
		}
	});
});

describe("createFieldBody reference config", () => {
	it("preserves targetCollection and multiple on the parsed validation", () => {
		const result = createFieldBody.safeParse({
			slug: "author",
			label: "Author",
			type: "reference",
			validation: { targetCollection: "authors", multiple: false },
		});

		expect(result.success).toBe(true);
		expect(result.data?.validation).toMatchObject({
			targetCollection: "authors",
			multiple: false,
		});
	});
});

describe("field heading levels option", () => {
	const contentField = (options: Record<string, unknown>) => ({
		slug: "content",
		label: "Content",
		type: "portableText",
		validation: null,
		options,
	});

	it("accepts distinct levels from 1 to 6, an empty list, and other options alongside", () => {
		for (const options of [{ headingLevels: [2, 3, 4] }, { headingLevels: [] }, { rows: 4 }]) {
			const result = createFieldBody.safeParse(contentField(options));
			expect(result.success).toBe(true);
			expect(result.data?.options).toEqual(options);
		}
	});

	it("rejects levels outside 1 to 6, decimals, duplicates, and non-lists", () => {
		for (const headingLevels of [[0, 2], [7], [2.5], [2, 2], "2,3", null]) {
			const created = createFieldBody.safeParse(contentField({ headingLevels }));
			const updated = updateFieldBody.safeParse({ validation: null, options: { headingLevels } });
			expect(created.success).toBe(false);
			expect(updated.success).toBe(false);
			expect(created.error?.issues[0]?.path).toEqual(["options", "headingLevels"]);
		}
	});
});
