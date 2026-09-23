/** @type {import('next').NextConfig} */
const nextConfig = {
  // resvg ships a native .node binary that webpack cannot parse. Keeping it
  // external leaves it to Node's own require at runtime.
  serverExternalPackages: ["@resvg/resvg-js"],

  /**
   * The commit this build came from, carried into the browser.
   *
   * Netlify sets COMMIT_REF at build time, but only NEXT_PUBLIC_* variables
   * are inlined into client code, and the sign-in page that shows it is a
   * client component. Renamed here rather than in the deployment settings so a
   * fresh Netlify site needs no configuring to report its own version.
   */
  env: {
    NEXT_PUBLIC_COMMIT_REF:
      process.env.COMMIT_REF ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  },
};

export default nextConfig;
