// Checks every barcode in stages.json. Full barcodes (8, 12, 13 or 14 digits) get a checksum check, then
// an Open Food Facts lookup that prints the product name next to your note so you can eyeball mismatches.
// Anything shorter is a prefix (it matches every barcode starting with it): it can't be looked up, so it is
// only flagged if it's short enough to match far more than one maker (under 6 digits).
// Usage: node verify-barcodes.mjs
import { readFileSync } from 'node:fs';

const hunt = JSON.parse(readFileSync(new URL('./stages.json', import.meta.url)));

const checksumOk = (code) => {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
};

const lookup = async (code) => {
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,quantity`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'treasure-hunt-verify/1.0' } });
      const json = JSON.parse(await res.text());
      if (json.status !== 1) return null;
      const p = json.product;
      return [p.brands, p.product_name, p.quantity].filter(Boolean).join(' | ');
    } catch {
      // Open Food Facts sometimes drops the connection or answers with an HTML error page when rate limited: back off and retry.
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return 'LOOKUP ERROR (API unavailable, re-run)';
};

let problems = 0;
for (const [i, stage] of hunt.stages.entries()) {
  for (const b of stage.barcodes ?? []) {
    const code = typeof b === 'string' ? b : b.code;
    const note = typeof b === 'string' ? '' : b.note ?? '';
    const isPrefix = !/^\d{8}$|^\d{12,14}$/.test(code.replace(/\s+/g, ''));
    let status;
    if (isPrefix) {
      status = code.replace(/^0+/, '').length < 6 ? 'PREFIX TOO SHORT (matches many makers)' : 'prefix: matches any product starting with this';
      if (status.startsWith('PREFIX TOO')) problems++;
      console.log(`stage ${i} (${stage.location?.name})  ${code}\n    note: ${note || '-'}\n    API:  ${status}`);
      continue;
    }
    if (!checksumOk(code)) status = 'BAD CHECKSUM';
    else status = (await lookup(code)) ?? 'not found in Open Food Facts';
    if (status === 'BAD CHECKSUM' || status.startsWith('not found') || status.startsWith('LOOKUP ERROR')) problems++;
    console.log(`stage ${i} (${stage.location?.name})  ${code}\n    note: ${note || '-'}\n    API:  ${status}`);
    await new Promise((r) => setTimeout(r, 700));
  }
}
console.log(`\n${problems} barcode(s) failed checksum or lookup`);
