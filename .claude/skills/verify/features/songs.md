# Song list

The `/songs` page lists the songs Fiona can sing, read from a Google Sheet through `/api/get-songbook`. The server reads the sheet's CSV export and keeps it for five minutes. When the sheet is unreachable it keeps serving the last good copy.

## Journey

`node drive.mjs songs` proves these behaviors:

- The API serves songs and viewer requests from the live sheet.
- The `Song list` link in the radio header opens `/songs`.
- Every song and request in the API appears as a row, and the tab title is `Songs | Fio Radio`.
- A search keeps the matching song and hides the rest. A search with no match shows an empty state.
- The `Fio Radio` link returns to `/`.
- A cold load of `/songs` answers 200.

## Gotchas

- The sheet is real and Fiona edits it by hand, so the journey reads expected counts from the API.
- A labelled column in the sheet is a language. The unlabelled column, or one labelled `Request`, holds viewer requests.
- No journey covers the sheet being unreachable.
