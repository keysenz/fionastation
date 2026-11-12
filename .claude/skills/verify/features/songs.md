# Song list

The `/songs` page lists the songs Fiona can sing, read from a Google Sheet through `/api/get-songbook`. The server reads the sheet's CSV export and keeps it for five minutes. When the sheet is unreachable it keeps serving the last good copy.

## Journey

`node drive.mjs songs` proves these behaviors:

- The API serves songs and viewer requests from the live sheet.
- The `Song list` link in the radio header opens `/songs`.
- Every song and request in the API appears as a row, and the tab title is `Songs | Fio Radio`.
- The page is one screen tall (`h-dvh`) and only the song list scrolls.
- The `lagi nyatet jangan ditagih` button opens a popup listing every song in the sheet's catatan column. On a 1280x800 screen it is centered, takes focus, and Escape closes it with focus back on the button. At 375px it slides up as a bottom sheet flush with the screen's bottom edge, and a tap on the backdrop closes it. Open `songs-notes-desktop.png` and `songs-notes-375.png`.
- A search keeps the matching song and hides the rest. A search with no match shows an empty state.
- The `Fio Radio` link returns to `/`.
- A cold load of `/songs` answers 200.

## Gotchas

- The sheet is real and Fiona edits it by hand, so the journey reads expected counts from the API.
- A labelled column in the sheet is a language. The unlabelled column, or one labelled `Request`, holds viewer requests. A column labelled `catatan` holds songs Fiona is still noting down, and only the popup shows them.
- No journey covers the sheet being unreachable.
