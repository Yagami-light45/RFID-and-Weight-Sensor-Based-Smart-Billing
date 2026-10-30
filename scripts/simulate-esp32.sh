#!/usr/bin/env bash
# Simulates the ESP32 RFID reader, load cell, remove button, and checkout.
# Usage: bash scripts/simulate-esp32.sh
# Override the server with BASE_URL=http://localhost:3000

set -euo pipefail

BASE="${BASE_URL:-http://localhost:3000}"
LAST="/tmp/trolley-last.json"

request() {
  local method="$1"
  local path="$2"
  local expected="$3"
  local body="${4:-}"
  local tmp code
  tmp="$(mktemp)"
  if [[ -n "$body" ]]; then
    code="$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$BASE$path" \
      -H "Content-Type: application/json" \
      -d "$body")"
  else
    code="$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$BASE$path")"
  fi
  echo
  echo "$method $path -> HTTP $code (expected $expected)"
  cat "$tmp"
  echo
  cp "$tmp" "$LAST"
  rm -f "$tmp"
  if [[ "$code" != "$expected" ]]; then
    echo "Unexpected status for $method $path"
    exit 1
  fi
}

assert_py() {
  python3 -c 'import json,sys; data=json.load(open("/tmp/trolley-last.json")); exec(sys.argv[1])' "$1"
}

echo "Base URL: $BASE"

echo
echo "== CART_01 happy path, mismatch, remove, checkout =="
request POST "/api/cart/CART_01/reset" 200

request POST "/api/cart/CART_01/scan" 200 '{"rfidTag":"E2MILK001","measuredWeight":520}'
assert_py 'assert data["status"]=="SUCCESS" and data["product"]=="Amul Milk 500ml" and data["total"]==28'

request POST "/api/cart/CART_01/scan" 200 '{"rfidTag":"E2BREAD01","measuredWeight":920}'
assert_py 'assert data["status"]=="SUCCESS" and data["product"]=="Whole Wheat Bread" and data["total"]==73'

request POST "/api/cart/CART_01/scan" 200 '{"rfidTag":"E2RICE001","measuredWeight":1000}'
assert_py 'assert data["status"]=="MISMATCH" and data["alertBuzzer"] is True'

request GET "/api/cart/CART_01" 200
assert_py 'assert data["totalPrice"]==73 and data["hasMismatch"] is True and data["status"]=="FLAGGED_MISMATCH" and data["itemCount"]==2 and [item["name"] for item in data["items"]]==["Amul Milk 500ml","Whole Wheat Bread"]'

request POST "/api/cart/CART_01/scan" 404 '{"rfidTag":"E2NOTREAL","measuredWeight":920}'
assert_py 'assert data["status"]=="UNKNOWN_TAG"'

request POST "/api/cart/CART_01/remove-last" 200 '{"measuredWeight":920}'
assert_py 'assert data["status"]=="MISMATCH" and data["alertBuzzer"] is True and data["product"]=="Whole Wheat Bread" and data["total"]==28'

request POST "/api/cart/CART_01/scan" 200 '{"rfidTag":"E2BREAD01","measuredWeight":920}'
assert_py 'assert data["status"]=="SUCCESS" and data["total"]==73'

request POST "/api/cart/CART_01/scan" 200 '{"rfidTag":"E2EGGS001","measuredWeight":1280}'
assert_py 'assert data["status"]=="SUCCESS" and data["product"]=="Eggs 6 pack" and data["total"]==145'

request POST "/api/cart/CART_01/checkout" 200 '{"measuredWeight":1280}'
assert_py 'assert data["status"]=="VERIFIED" and data["total"]==145'

request POST "/api/cart/CART_01/checkout" 200 '{"measuredWeight":1280,"paymentMethod":"CARD"}'
assert_py 'assert data["status"]=="CHECKED_OUT" and data["paymentMethod"]=="CARD" and data["total"]==145 and str(data["reference"]).startswith("PAY-CART_01-")'

request POST "/api/cart/CART_01/scan" 409 '{"rfidTag":"E2MILK001","measuredWeight":1800}'
assert_py 'assert data["status"]=="ERROR"'

echo
echo "== CART_02 tolerance boundary and flagged checkout =="
request POST "/api/cart/CART_02/reset" 200
request POST "/api/cart/CART_02/scan" 200 '{"rfidTag":"E2MILK001","measuredWeight":535}'
assert_py 'assert data["status"]=="SUCCESS" and data["total"]==28'

request POST "/api/cart/CART_02/reset" 200
request POST "/api/cart/CART_02/scan" 200 '{"rfidTag":"E2MILK001","measuredWeight":536}'
assert_py 'assert data["status"]=="MISMATCH" and data["alertBuzzer"] is True'

request GET "/api/cart/CART_02" 200
assert_py 'assert data["itemCount"]==0 and data["hasMismatch"] is True'

request POST "/api/cart/CART_02/scan" 200 '{"rfidTag":"E2MILK001","measuredWeight":520}'
assert_py 'assert data["status"]=="SUCCESS"'

request POST "/api/cart/CART_02/checkout" 200 '{"measuredWeight":100,"paymentMethod":"UPI"}'
assert_py 'assert data["status"]=="FLAGGED" and data["alertBuzzer"] is True'

request GET "/api/cart/CART_02" 200
assert_py 'assert data["status"]=="FLAGGED_MISMATCH" and data["totalPrice"]==28'

echo
echo "== CART_03 manual remove and empty checkout =="
request POST "/api/cart/CART_03/reset" 200
request POST "/api/cart/CART_03/remove-last" 400 '{"measuredWeight":0}'
request POST "/api/cart/CART_03/checkout" 400 '{"measuredWeight":0}'
request POST "/api/cart/CART_03/scan" 400 '{}'

request POST "/api/cart/CART_03/scan" 200 '{"rfidTag":"E2MILK001","measuredWeight":520}'
request POST "/api/cart/CART_03/scan" 200 '{"rfidTag":"E2MILK001","measuredWeight":1040}'
assert_py 'assert data["status"]=="SUCCESS" and data["total"]==56'

request GET "/api/cart/CART_03" 200
assert_py 'assert data["items"][0]["quantity"]==2'
ITEM_ID="$(python3 -c 'import json; print(json.load(open("/tmp/trolley-last.json"))["items"][0]["id"])')"

request DELETE "/api/cart/CART_03/items/$ITEM_ID" 200 '{"measuredWeight":1040}'
assert_py 'assert data["status"]=="MISMATCH" and data["total"]==28'

request POST "/api/cart/CART_03/remove-last" 200 '{"measuredWeight":0}'
assert_py 'assert data["status"]=="SUCCESS" and data["total"]==0'

request GET "/api/cart/CART_03" 200
assert_py 'assert data["itemCount"]==0 and data["status"]=="ACTIVE" and data["hasMismatch"] is False'

echo
echo "ESP32 simulation passed."
