---
name: create_order
version: 1.0.0
license: MIT
---

# create_order

Create an order for a book, decrementing stock atomically in a single D1
transaction (INSERT order + UPDATE books.stock).

## Arguments

- `book_id` (number, required): book id to order.
- `qty` (number, required): quantity, integer >= 1.

## Returns

On success:
```json
{ "ok": true, "order_id": 3, "book_id": 1, "qty": 2, "remaining_stock": 8 }
```

On insufficient stock or missing book (HTTP 409):
```json
{ "ok": false, "status": 409, "error": "insufficient stock", "requested": 99999, "available": 10 }
```

The handler never throws on a 409; it returns `{ ok: false, ... }` with the
reason so the caller can react.

## Example

```json
{ "book_id": 1, "qty": 2 }
```