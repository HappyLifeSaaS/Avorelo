# Provenance Audit — Apache-2.0 Public Release

This audit records, at a high level, the provenance basis for releasing Avorelo under the Apache
License 2.0. It covers the files that enter the public export. Confidential detail (if any) is kept in
the maintainer's internal records and is not part of the public repository.

## Method

Every file eligible for the public export was classified as one of: original Avorelo work owned by the
copyright holder; generated output from owned inputs; third-party material redistributed under its own
compatible license with required notices; a third-party dependency that is **not** redistributed; or
excluded internal/private material. The tracked source tree was scanned for foreign copyright headers,
SPDX markers, vendored directories, and bundled binary assets.

## Findings

| Category | Result |
|---|---|
| Foreign copyright / SPDX / `@license` headers in `src/`, `tools/`, `tests/`, `fixtures/` | **None found** |
| Vendored / third-party source directories | **None** |
| Copied proprietary or copyleft (GPL/AGPL) source inside owned code | **None found** |
| Runtime dependencies (redistributed) | **Zero** (`package.json` `dependencies: {}`) |
| Build dependencies (`esbuild`, `tsx`) | MIT-licensed; **build-time only, not redistributed** (`node_modules` is excluded from the export; the published tarball contains only Avorelo's own bundle) |
| Web fonts (Satoshi / DM Sans / JetBrains Mono / Inter) | Loaded at runtime from the font CDNs via `<link>`; **not bundled or redistributed** — each governed by its own license (client fetch) |
| Bundled binary assets | Three brand assets only: `favicon-256.png`, `apple-touch-icon.png`, `og-card.svg` — original Avorelo brand assets, owned by the copyright holder |

## Conclusion

The public export consists of **Avorelo's own original source, tests, tools, documentation, static-site
content, and three owner-created brand assets.** No third-party code is bundled or redistributed inside
owned source. Build tooling and dependencies are permissively licensed and are not redistributed. Web
fonts are fetched at runtime from their CDNs under their own licenses, not shipped.

On this basis the project-owned material is eligible for Apache-2.0 relicensing, and there are **zero
unresolved provenance items** in the public export. The copyright holder attests to independent
ownership of the project; this audit found no evidence of employer/client-owned, proprietary-copied, or
incompatible-copyleft material entering the public export.

The authoritative license is the repository `LICENSE` (Apache-2.0); `NOTICE` records copyright.
