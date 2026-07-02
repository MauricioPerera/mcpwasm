---
name: search_catalog
version: 1.0.0
license: MIT
---

# search_catalog

Search the bookstore catalog. Matches free text against `title` and `author`,
optionally filtered by `genre` (exact match) and `max_price` (inclusive).
Returns up to 10 books as a JSON array.

## Arguments

- `q` (string, optional): free-text query matched against title and author.
- `genre` (string, optional): exact genre filter, e.g. `science-fiction`.
- `max_price` (number, optional): maximum price, inclusive.

## Example

```json
{ "q": "dune", "max_price": 20 }
```