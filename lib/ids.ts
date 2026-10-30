const CART_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

export function isCartId(cartId: string) {
  return CART_ID.test(cartId);
}
