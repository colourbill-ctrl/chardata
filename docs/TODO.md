# CharData — deferred work

Running list of work items that have been scoped but not scheduled. Each entry
should link to a spec / notes doc so we can pick it up cold later.

## Translation of user manual

**Status:** scoped, deferred.

`MANUAL.md` → 11 supported locales (fr, de, it, es, pt-PT, pt-BR, sv, zh-CN,
zh-TW, ja, ko). The app UI is already fully translated; the manual is not.

See [`translation-glossary.md`](./translation-glossary.md) for:

- Cost/effort matrix (LLM-only vs LLM+spot-review vs full pro translation)
- Engineering plumbing required (generate-help.js per-locale loop, launcher
  fallback, pre-commit hook update, inline-HTML preservation)
- Glossary cross-correlation against the existing `I18N` table
- 8 inconsistencies in existing UI translations that should be fixed *before*
  the manual translation starts, or they propagate

Recommended path when resuming: LLM batch + glossary + native-speaker
spot-check on zh-CN / ja / de / es. ~2–3 days of work + ~$400–800 in reviewer
fees + ~½ day plumbing.
