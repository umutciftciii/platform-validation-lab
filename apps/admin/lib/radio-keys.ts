/**
 * DP-269: the keyboard of an ARIA radio group (WAI-ARIA APG "Radio Group"). The group is one Tab
 * stop (only the checked option has tabIndex 0); the arrow keys move to the previous or next
 * option and wrap around, Home and End go to the first and last. Moving checks the option.
 *
 * Returns the index of the option to move to, or null when the key is not one of the group's keys
 * (Tab, Enter, Space and the rest keep their normal behaviour).
 */
export function radioKeyTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  const at = current < 0 ? 0 : current;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (at + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (at - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
