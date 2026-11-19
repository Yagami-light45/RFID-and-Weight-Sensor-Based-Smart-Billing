const fs = require('node:fs');
const path = require('node:path');

const target = path.join(process.cwd(), 'lib', 'cart.ts');
if (!fs.existsSync(target)) {
  console.error('ERROR: Run from the Next.js project root (lib/cart.ts missing).');
  process.exit(1);
}
const original = fs.readFileSync(target, 'utf8');
const start = original.indexOf('export async function scanItem(');
const end = original.indexOf('export async function removeLastItem(', start);
if (start < 0 || end < 0) {
  console.error('ERROR: Could not locate scanItem function. Nothing changed.');
  process.exit(1);
}
let scan = original.slice(start, end);
const changes = [
  [
`    if (exceedsTolerance(measuredWeight, nextExpected, product.weightTolerance)) {
      await recordScanEvent(
        tx,
        session.id,
        rfidUid,
        "ADD",
        measuredWeight,
        "MISMATCH",
        eventId,
      );
      const updated = await recalculateSessionTotals(
        tx,
        session.id,
        measuredWeight,
        true,
      );
      return result(200, { status: "MISMATCH", alertBuzzer: true }, updated);
    }

    // Within weight tolerance -> SUCCESS`,
`    const mismatch = exceedsTolerance(
      measuredWeight,
      nextExpected,
      product.weightTolerance,
    );

    // Registered RFID products are added regardless of weight mismatch.
    // The mismatch still flags the cart for the website to display.`
  ],
  [
`      "SUCCESS",
      eventId,
    );
    const updated = await recalculateSessionTotals(
      tx,
      session.id,
      measuredWeight,
      false,
    );`,
`      mismatch ? "MISMATCH" : "SUCCESS",
      eventId,
    );
    const updated = await recalculateSessionTotals(
      tx,
      session.id,
      measuredWeight,
      mismatch,
    );`
  ],
  [
`        status: "SUCCESS",
        product: product.name,
        total: Number(updated.totalPrice),`,
`        status: mismatch ? "MISMATCH" : "SUCCESS",
        alertBuzzer: mismatch,
        product: product.name,
        total: Number(updated.totalPrice),`
  ]
];
for (const [oldText, newText] of changes) {
  if (scan.split(oldText).length !== 2) {
    console.error('ERROR: lib/cart.ts differs from the reviewed GitHub version. File unchanged.');
    process.exit(1);
  }
  scan = scan.replace(oldText, newText);
}
const backup = target + '.before-rfid-mismatch-patch.bak';
if (fs.existsSync(backup)) {
  console.error('ERROR: Backup already exists. File unchanged:', backup);
  process.exit(1);
}
fs.copyFileSync(target, backup);
fs.writeFileSync(target, original.slice(0, start) + scan + original.slice(end), 'utf8');
console.log('SUCCESS: Registered RFID scans now add products even on weight mismatch.');
console.log('Mismatch still flags the cart for the website.');
console.log('Backup saved:', backup);
console.log('No checkout, schema or firmware changes.');
