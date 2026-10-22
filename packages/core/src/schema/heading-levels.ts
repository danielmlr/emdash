/** Whether `value` is a valid `headingLevels` field option: distinct whole numbers from 1 to 6. */
export function isValidHeadingLevels(value: unknown): value is Array<1 | 2 | 3 | 4 | 5 | 6> {
	return (
		Array.isArray(value) &&
		value.every((level) => Number.isInteger(level) && level >= 1 && level <= 6) &&
		new Set(value).size === value.length
	);
}

export const INVALID_HEADING_LEVELS_MESSAGE =
	"must be a list of distinct heading levels from 1 to 6";
