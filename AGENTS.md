# Agent Development Notes

This is a Foldkit app. Read [`FOLDKIT.md`](./FOLDKIT.md) before writing any code in this project. It covers the architecture, the APIs, and the conventions the project is built on.

Foldkit owns `FOLDKIT.md` and replaces it whole on upgrade. This file is yours. Anything you want an agent to know about this project goes below, where an upgrade won't touch it.

`FOLDKIT.md` reads the line below to decide whether it has already offered to vendor the Foldkit source. Leave it in place.

subtree_prompted: true

## Project Notes

- The discord bot owns the SQLite database and is the only writer. The site only reads it, through `server/db.ts`.
- The site has two pages. Fio Radio is at `/`, and the song list Fiona can sing is at `/songs`. The old `/radio`, `/karaoke`, `/cover`, `/about` and `/credits` paths redirect to `/` in `server/main.ts`. Fio Radio lists karaoke, cover and original videos together. `src/page/karaoke/karaoke.ts` holds that page's state and `view.ts` its markup. `setlist.ts` holds the queue rules as pure functions. Run the `karaoke-queue` skill when you change it.
- Tailwind stays on v3 with PostCSS, unlike Foldkit's default of v4, so the page styles did not change in the migration.
- `server/` runs directly with Node's type stripping and has no build step. Keep its imports type-only or relative with a `.ts` extension. It is not covered by Foldkit's lint.
- When you add a page, add its path to both `src/route.ts` and `PAGE_PATHS` in `server/main.ts`. The about and credits text lives in the info panel, `src/page/karaoke/info.ts`.
- Use the `verify` skill to confirm a change in a real browser. It drives the production build.
- The song list's source is a Google Sheet that Fiona edits, not the database. `server/songbook.ts` reads its CSV export (`SONGBOOK_SHEET_ID` overrides the sheet) and serves it as `/api/get-songbook`. A future YouTube chat bot reads that route.
