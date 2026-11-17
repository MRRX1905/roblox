const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
for (let i = 1; i <= 4; i++) {
  const res = await fetch('https://www.tiktok.com/', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.tiktok.com/' },
    redirect: 'follow',
  });
  const cookies = res.headers.getSetCookie?.() ?? [];
  const ttwid = cookies.find((c) => c.startsWith('ttwid='));
  console.log(`req ${i}: status=${res.status} cookies=${cookies.length} ttwid=${ttwid ? ttwid.slice(0, 60) : 'NONE'}`);
  await res.body?.cancel();
  await new Promise((r) => setTimeout(r, 2500));
}
