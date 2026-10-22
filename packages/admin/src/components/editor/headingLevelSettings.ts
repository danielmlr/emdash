/**
 * A rich text field's `options.headingLevels`, without the editor, so the
 * field settings dialog can read and label it.
 */

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type { HeadingLevel } from "./HeadingDropdownMenu.js";

export const ALL_HEADING_LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6];

export const HEADING_LABELS: Record<HeadingLevel, MessageDescriptor> = {
	1: msg`Heading 1`,
	2: msg`Heading 2`,
	3: msg`Heading 3`,
	4: msg`Heading 4`,
	5: msg`Heading 5`,
	6: msg`Heading 6`,
};

export function isHeadingLevel(value: unknown): value is HeadingLevel {
	return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6;
}

/**
 * Reads a field's `headingLevels` option: sorted and without duplicates. A
 * missing value, or a list with no valid level in it, means all six; an empty
 * list means none.
 */
export function readHeadingLevels(value: unknown): readonly HeadingLevel[] {
	if (!Array.isArray(value)) return ALL_HEADING_LEVELS;
	const levels = ALL_HEADING_LEVELS.filter((level) => value.includes(level));
	if (levels.length === 0 && value.some((entry) => !isHeadingLevel(entry))) {
		return ALL_HEADING_LEVELS;
	}
	return levels.length === ALL_HEADING_LEVELS.length ? ALL_HEADING_LEVELS : levels;
}
