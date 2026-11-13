# @dream/visual-qa

Playwright capture and measurement scripts copied unchanged from
`iccsyn-hero-prototype/review/tools/` (except the default base URL, now `http://localhost:3110`).

They drive the system Chrome (`channel: "chrome"`) through `playwright-core`; no browser is downloaded.
Pass the base URL and an output folder explicitly, e.g.

    node scripts/footer.mjs http://localhost:3110 output/footer

Outputs belong in `output/` (git-ignored). The prototype's own reports and screenshots stay in
the prototype folder; they were not copied.
