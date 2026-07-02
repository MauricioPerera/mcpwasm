---
name: get_doc
version: 1.0.0
license: MIT
---

# get_doc

Fetch the full markdown of one of the 4 published documents via
`host.fetchOrigin("/docs/<name>.md")`.

## Arguments

- `name` (string, required): one of `rfc-skills-in-llms-txt`,
  `ext-executable-skills`, `ext-skill-attestations`, `mcpwasm-readme`.

## Returns

`{ name, length, content }` — `content` is the markdown body truncated to 4000
chars; `length` is the full body length in characters.

## Example

```json
{ "name": "ext-executable-skills" }
```