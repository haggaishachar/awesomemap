/**
 * Given a tool id and a list of filenames (e.g. from fs.readdirSync),
 * returns the filename that matches `<id>.<any extension>`, or null if
 * none exists. Matches on the full id followed by a literal dot, so an id
 * that's a prefix of another file's basename (e.g. "ray" vs
 * "raytracer.png") never false-matches.
 */
export function resolveImage(id, filenames) {
  const match = filenames.find((filename) => {
    const dotIndex = filename.lastIndexOf(".");
    if (dotIndex === -1) return false;
    return filename.slice(0, dotIndex) === id;
  });
  return match ?? null;
}
