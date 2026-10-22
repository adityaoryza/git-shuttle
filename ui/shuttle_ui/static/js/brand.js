/* Who made git-shuttle and where to find it. One place, so that the About dialog, the footer and the tests agree. */

export const PRODUCT = "git-shuttle";
export const TAGLINE = "Branch, commit, merge and release with a preview before every step.";
export const AUTHOR = "Aditya Oryza Mahendra";
export const AUTHOR_SHORT = "Aditya Oryza";

const REPO = "https://github.com/adityaoryza/git-shuttle";
export const LINKS = {
  website: { label: "Website", href: "https://adityaoryza.my.id/en" },
  github: { label: "GitHub", href: "https://github.com/adityaoryza" },
  linkedin: { label: "LinkedIn", href: "https://linkedin.com/in/adityaoryza" },
};
export const PROJECT_LINKS = [
  { label: "Source code", href: REPO },
  { label: "Report an issue", href: REPO + "/issues/new" },
  { label: "License (MIT)", href: REPO + "/blob/main/LICENSE" },
  { label: "Third-party notices", href: REPO + "/blob/main/THIRD_PARTY_NOTICES.md" },
];

// Every link out of the page: a new tab that gets no reference to this one and no referrer.
export const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" };

// The only addresses the page may link to (a test reads the sources for any other).
export const ALLOWED_URLS = [...Object.values(LINKS), ...PROJECT_LINKS].map(link => link.href);

// "git-shuttle 0.1.2" for the footer; the version is the server's, and empty until the server has answered.
export function versionLine(version) {
  return version ? PRODUCT + " " + version : PRODUCT;
}
