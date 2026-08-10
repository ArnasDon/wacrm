const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const en = require(path.join(ROOT, 'messages/en.json'));

const files = {
  'src/components/products/product-list.tsx': 'Products.list',
  'src/components/products/orders-list.tsx': 'Products.orders',
  'src/components/products/product-form.tsx': 'Products.product',
  'src/components/settings/payments-settings.tsx': 'Settings.payments',
  'src/app/(dashboard)/products/page.tsx': 'Products',
  'src/app/(dashboard)/products/new/page.tsx': 'Products.new',
  'src/app/(dashboard)/products/[id]/page.tsx': 'Products.edit',
};

const walk = (o, p = '') => {
  const r = {};
  for (const [k, v] of Object.entries(o)) {
    const kk = p ? p + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(r, walk(v, kk));
    else r[kk] = true;
  }
  return r;
};
const all = walk(en);

let failed = false;
for (const [f, ns] of Object.entries(files)) {
  const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
  const re = /\bt\("([a-zA-Z0-9_.]+)"\)/g;
  let m;
  const keys = new Set();
  const missing = [];
  while ((m = re.exec(src))) {
    const k = m[1];
    keys.add(k);
    if (!all[ns + '.' + k]) missing.push(k);
  }
  if (missing.length) {
    failed = true;
    console.log('MISSING in', f, '[' + ns + ']:', missing.join(', '));
  } else {
    console.log('ok', f, '[' + ns + '] (' + keys.size + ' keys checked)');
  }
}
if (failed) process.exit(1);
console.log('ALL KEY COVERAGE CHECKS PASSED');
