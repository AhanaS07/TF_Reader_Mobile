# Pinned API contracts

Fetched 16 August 2026. These are the documents the mock fixtures and the OPDS adapter
were built from, kept here so a contract change shows up as a diff rather than as a
mystery test failure.

| File | Source |
|---|---|
| `wokay-api.yaml` | https://abhishek-tf.github.io/tf_reader_backend_temp/api-docs/wokay-api.yaml |
| `flambeau-api.yaml` | https://deepu1004.github.io/flambeau-api-contracts/flambeau-api.yaml |

Fetch the `.yaml`. The `.html` siblings are Swagger shells that render nothing without
JavaScript, and the worked examples are in the YAML only.

**The `example:` blocks are one tenant's data, not the schema.** A field showing three
items does not mean it always returns three; a value shown once is not a constant. Read
the schema for what is guaranteed — `required`, `minItems`, `maxItems`, `enum` — and treat
everything in an `example:` as one instance of many.
