export type ErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "isbn_already_exists"
  | "book_not_found"
  | "item_not_found"
  | "empty_cart"
  | "invalid_postal_code"
  | "shipping_unavailable"
  | "insufficient_stock"
  | "payment_declined"
  | "checkout_conflict"
  | "order_not_found"
  | "internal_error";

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
  ) {
    super(code);
  }
}
