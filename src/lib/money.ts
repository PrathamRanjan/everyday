/** Cents as dollars for messages and flash text, e.g. 1234 -> "$12.34". */
export const money = (c: number | null | undefined) => (c === null || c === undefined ? "—" : `$${(c / 100).toFixed(2)}`);
