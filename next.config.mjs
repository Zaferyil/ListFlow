/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Design uploads are posted as multipart bodies to /api/analyze.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
