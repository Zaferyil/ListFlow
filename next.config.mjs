/** @type {import('next').NextConfig} */
const nextConfig = {
  // resvg ships a native .node binary that webpack cannot parse. Keeping it
  // external leaves it to Node's own require at runtime.
  serverExternalPackages: ["@resvg/resvg-js"],
  experimental: {
    // Design uploads are posted as multipart bodies to /api/analyze.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
