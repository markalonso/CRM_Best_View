# Netlify Next.js Chunk Verification

After deploying, verify that Netlify is serving Next.js chunks directly (not HTML rewrites):

1. Open your deployed site and copy a real chunk URL from page source (any `/_next/static/chunks/*.js` URL).
2. Check both endpoints:

```bash
curl -I https://<YOUR_DOMAIN>/_next/static/chunks/
curl -I https://<YOUR_DOMAIN>/_next/static/chunks/<REAL_CHUNK_FILE>.js
```

Expected results:
- Chunk file URL returns `200 OK`
- `Content-Type` is JavaScript (`application/javascript` or `text/javascript`)
- It must **not** return HTML (`text/html`)

If you see HTML or 404 for chunk URLs, check:
- `netlify.toml` is using `@netlify/plugin-nextjs`
- no SPA fallback redirects exist (`/* /index.html 200`)
- app is built with `next build` (not `next export`)


Example explicit check:

```bash
curl -I https://<YOUR_DOMAIN>/_next/static/chunks/webpack-<hash>.js
```

Expected: `200 OK` and JavaScript content type.


Netlify deploy settings:
- Do NOT set publish directory to `.next` when using `@netlify/plugin-nextjs`.
- In Netlify UI, leave publish directory empty/default and clear cache before redeploy.
