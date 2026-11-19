// Run from the Smart Billing Trolley Next.js project root:
// node .\enable_trolley_live_logs.cjs
// Safe, one-time logging patch: preserves original files as .before-live-logs
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const scanPath = path.join(root, 'app', 'api', 'cart', '[cartId]', 'scan', 'route.ts');
const cartPath = path.join(root, 'lib', 'cart.ts');
const mark = '[TROLLEY LIVE LOGS]';

const scanOld = `    const { cartId } = await context.params;
    const body = await readBody(request);
    const result = await scanItem(
      readCartId(cartId),
      readRfidUid(body),
      readMeasuredWeight(body),
      readEventId(body),
    );
    await publishCartUpdate(result.cart);
    return Response.json(result.body, { status: result.status });`;

const scanNew = `    // ${mark} RFID HTTP input, database outcome and website publication.
    const started = Date.now();
    const { cartId: rawCartId } = await context.params;
    const cartId = readCartId(rawCartId);
    const body = await readBody(request);
    const uid = readRfidUid(body);
    const grams = readMeasuredWeight(body);
    const eventId = readEventId(body);

    console.log("\\n[RFID POST IN]", {
      time: new Date().toISOString(), cartId,
      rfidUid: uid, measuredWeightGrams: grams, eventId: eventId ?? null,
    });
    try {
      const result = await scanItem(cartId, uid, grams, eventId);
      console.log("[DATABASE RESULT]", {
        http: result.status,
        scanStatus: result.body.status,
        product: result.body.product ?? null,
        cartId: result.cart.cartId,
        cartStatus: result.cart.status,
        itemCount: result.cart.itemCount,
        totalPriceINR: result.cart.totalPrice,
        expectedWeightGrams: result.cart.totalExpectedWeight,
        measuredWeightGrams: result.cart.currentMeasuredWeight,
        hasMismatch: result.cart.hasMismatch,
        cartUpdatedAt: result.cart.updatedAt,
        durationMs: Date.now() - started,
      });
      console.log("[CART ITEMS]", result.cart.items.map(item => ({
        name: item.name, uid: item.rfidUid,
        quantity: item.quantity, subtotalINR: item.subtotal,
      })));
      await publishCartUpdate(result.cart);
      console.log("[RFID POST DONE]", {
        http: result.status, status: result.body.status,
        durationMs: Date.now() - started,
      });
      return Response.json(result.body, { status: result.status });
    } catch (error) {
      console.error("[RFID POST ERROR]", {
        cartId, rfidUid: uid, message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });
      throw error;
    }`;

const cartOld = `export async function publishCartUpdate(cart: CartPayload) {
  publish(cartChannel(cart.cartId), "cart", cart);
  publish(ADMIN_CHANNEL, "overview", await getOverview());
}`;

const cartNew = `export async function publishCartUpdate(cart: CartPayload) {
  // ${mark} Publishing events is not proof a browser received them.
  publish(cartChannel(cart.cartId), "cart", cart);
  publish(ADMIN_CHANNEL, "overview", await getOverview());
  console.log("[WEBSITE UPDATE PUBLISHED]", {
    time: new Date().toISOString(),
    cartId: cart.cartId, status: cart.status,
    itemCount: cart.itemCount, totalPriceINR: cart.totalPrice,
    hasMismatch: cart.hasMismatch,
  });
}`;

function read(file) {
  if (!fs.existsSync(file)) throw new Error('Missing file: ' + file + '\nRun this script from your Next.js project folder.');
  return fs.readFileSync(file, 'utf8');
}

try {
  const scan = read(scanPath);
  const cart = read(cartPath);
  if (scan.includes(mark) && cart.includes(mark)) {
    console.log('Logging is already enabled. No changes made.');
    process.exit(0);
  }
  if (scan.includes(mark) || cart.includes(mark)) {
    throw new Error('Only one file has the logging patch. Nothing changed; check the files manually.');
  }
  if (scan.split(scanOld).length !== 2) {
    throw new Error('Scan route differs from the expected version. Nothing changed; please share app/api/cart/[cartId]/scan/route.ts.');
  }
  if (cart.split(cartOld).length !== 2) {
    throw new Error('publishCartUpdate differs from the expected version. Nothing changed; please share the end of lib/cart.ts.');
  }
  const nextScan = scan.replace(scanOld, scanNew);
  const nextCart = cart.replace(cartOld, cartNew);
  for (const [file, original] of [[scanPath, scan], [cartPath, cart]]) {
    const backup = file + '.before-live-logs';
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, 'utf8');
  }
  fs.writeFileSync(scanPath, nextScan, 'utf8');
  fs.writeFileSync(cartPath, nextCart, 'utf8');
  console.log('SUCCESS: Terminal logging enabled for RFID POSTs, database results and cart website events.');
  console.log('Backups: route.ts.before-live-logs and cart.ts.before-live-logs');
  console.log('Restart/rebuild Next.js to see new logs in the terminal running your server.');
} catch (e) {
  console.error('ERROR:', e.message);
  process.exitCode = 1;
}
