# Breached / common password list: source and licence

Used by `src/iam/auth/breached-passwords.ts` (F1-002, owner decision A11, ADR-013 D5). The list is
embedded in the API build at compile time. The API never reads these files or the network at
runtime, and the list is never shipped to a browser bundle or a public directory.

## Third-party file

| Field            | Value                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| File here        | `seclists-xato-net-10-million-passwords-100000.txt` (byte-for-byte copy, `-text` in `.gitattributes`)      |
| Repository       | https://github.com/danielmiessler/SecLists                                                                 |
| Path             | `Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt`                                    |
| Pinned commit    | `3a3b801dd916d0c37c5a52eac440153416d2c54f` (master on 2026-11-10; file last changed in `c205c36a`)         |
| Git blob SHA-1   | `fa9a7c2e9f930c99b125aa96b7d87b3b9fcbe333` (matches the GitHub contents API for that commit)               |
| SHA-256          | `1472aafa2561df5e3293aee252aee3ca660c12b399a283cf808bb01b39be388b`                                         |
| Size / lines     | 781,879 bytes; 100,000 lines (LF, ASCII); one empty line                                                   |
| Licence          | MIT, Copyright (c) 2018 Daniel Miessler: `SECLISTS-LICENSE` (byte-for-byte copy of the repository LICENSE) |
| Original dataset | Mark Burnett (xato.net), "Ten Million Passwords" (2015); top 100,000 by frequency, as curated by SecLists  |

Fetched with:

```bash
curl -fsSL https://raw.githubusercontent.com/danielmiessler/SecLists/3a3b801dd916d0c37c5a52eac440153416d2c54f/Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt
```

## Processing

`scripts/build-breached-passwords.mjs` does the following:

1. Refuses to run unless the file's SHA-256 is the value above.
2. Merges the file with `seed.txt`.
3. Trims each line and applies Unicode NFKC and JavaScript `toLowerCase()`. This is exactly what
   `isBreachedPassword` applies to a candidate password.
4. Drops empty lines and duplicates, then sorts the result.

It writes `src/iam/auth/breached-passwords.data.ts`. A unit test pins the SHA-256 and line count,
and fails when the generated module is out of date.

## Updating

To update the list:

1. Pick a new commit.
2. Download the file to this folder.
3. Update the SHA-256 in the script, the unit test and this file.
4. Run `node scripts/build-breached-passwords.mjs`, then Prettier.
