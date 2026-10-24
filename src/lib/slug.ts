/** Turn a short model caption into a safe filename stem. */
export function slugify(caption: string, max = 60): string {
  const cleaned = caption
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return cleaned || "screenshot";
}
