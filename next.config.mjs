/** @type {import('next').NextConfig} */
const nextConfig = {
  // resvg ships a native .node binary that webpack cannot parse. Keeping it
  // external leaves it to Node's own require at runtime.
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default nextConfig;
