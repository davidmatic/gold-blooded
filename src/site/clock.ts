// The site's clock: the moment it is built. Pages that depend on what has already happened
// (the Archive) read it from here. The built-site tests pin it through GOLD_BLOODED_NOW.
export function buildTime(): Date {
  const pinned = process.env.GOLD_BLOODED_NOW;
  return pinned ? new Date(pinned) : new Date();
}
