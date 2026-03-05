/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep root-relative Next.js asset paths so Netlify can serve generated chunks
  // from /.netlify/functions/next_* without MIME/chunk loading issues.
  assetPrefix: undefined,
  basePath: ""
};

export default nextConfig;
