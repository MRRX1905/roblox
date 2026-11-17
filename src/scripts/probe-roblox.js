// Probe kontrak API Roblox untuk satu username.
// Tujuan: melihat JSON mentah setiap endpoint sebelum parser ditulis,
// karena beberapa endpoint berubah/dihapus sepanjang 2026.
//
// Pakai: npm run probe:roblox -- <username>

const USERNAME = process.argv[2] || 'Roblox';
const UA = 'roblox-live-review/0.1 (+local tool)';

async function call(label, url, init = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        'user-agent': UA,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text.slice(0, 200);
    }
    const ms = Date.now() - started;
    console.log(`\n=== ${label} ===`);
    console.log(`${init.method || 'GET'} ${url} -> ${res.status} (${ms}ms)`);
    console.log(JSON.stringify(json, null, 1)?.slice(0, 2600) ?? '(kosong)');
    return { status: res.status, json };
  } catch (err) {
    console.log(`\n=== ${label} ===`);
    console.log(`${init.method || 'GET'} ${url} -> GAGAL: ${err.name}: ${err.message}`);
    return { status: 0, error: err };
  }
}

const resolve = await call('1. resolve username', 'https://users.roblox.com/v1/usernames/users', {
  method: 'POST',
  body: JSON.stringify({ usernames: [USERNAME], excludeBannedUsers: false }),
});

const userId = resolve.json?.data?.[0]?.id;
if (!userId) {
  console.log('\nUsername tidak ditemukan; probe berhenti.');
  process.exit(1);
}
console.log(`\n>>> userId = ${userId}`);

await call('2. profile', `https://users.roblox.com/v1/users/${userId}`);

const bare = await call('3a. avatar v4 (tanpa selectionTypes)', `https://avatar.roblox.com/v4/avatar/users/${userId}`);
await call('3b. avatar v4 (AvatarModel)', `https://avatar.roblox.com/v4/avatar/users/${userId}?selectionTypes=AvatarModel`);
await call('3c. currently-wearing (dihapus 11 Des 2026)', `https://avatar.roblox.com/v1/users/${userId}/currently-wearing`);

const assetIds =
  bare.json?.assets?.map((a) => a.id) ||
  bare.json?.avatar?.assets?.map((a) => a.id) ||
  bare.json?.wornAssets?.map((a) => (typeof a === 'number' ? a : a.id)) ||
  [];

await call('4. friends count', `https://friends.roblox.com/v1/users/${userId}/friends/count`);
await call('5. followers count', `https://friends.roblox.com/v1/users/${userId}/followers/count`);
await call('6. followings count', `https://friends.roblox.com/v1/users/${userId}/followings/count`);
await call('7. can view inventory', `https://inventory.roblox.com/v1/users/${userId}/can-view-inventory`);
const collectibles = await call(
  '8. collectibles (page 1)',
  `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=10&sortOrder=Asc`,
);
await call('9. bundles', `https://catalog.roblox.com/v1/users/${userId}/bundles?limit=10`);
await call('10. avatar thumbnail (full)', `https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png`);
await call('11. avatar headshot', `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`);
await call('12. avatar 3d', `https://thumbnails.roblox.com/v1/users/avatar-3d?userId=${userId}`);

const probeAssets = [...new Set([...assetIds.slice(0, 5), ...(collectibles.json?.data ?? []).slice(0, 3).map((c) => c.assetId)])].filter(Boolean);
if (probeAssets.length > 0) {
  const details = await call('13. catalog item details (batch)', 'https://catalog.roblox.com/v1/catalog/items/details', {
    method: 'POST',
    body: JSON.stringify({ items: probeAssets.map((id) => ({ itemType: 'Asset', id })), salesTypeFilter: 1 }),
  });
  const firstCiiid = details.json?.data?.find((d) => d.collectibleItemId)?.collectibleItemId;
  if (firstCiiid) {
    await call('14. marketplace resale-data', `https://apis.roblox.com/marketplace-sales/v1/item/${firstCiiid}/resale-data`);
    await call('15. marketplace resellers', `https://apis.roblox.com/marketplace-sales/v1/item/${firstCiiid}/resellers?limit=5`);
  }
  const firstAsset = probeAssets[0];
  await call('16. economy resale-data (legacy)', `https://economy.roblox.com/v1/assets/${firstAsset}/resale-data`);
  await call('17. economy asset details v2', `https://economy.roblox.com/v2/assets/${firstAsset}/details`);
}

console.log('\n>>> Probe selesai.');
