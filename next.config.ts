import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Flag art is our own trusted SVG in /public/flags.
    dangerouslyAllowSVG: true,
    contentDispositionType: "inline",
  },
  // PGlite (the Docker-free local dev database) ships WASM and resolves its own
  // filesystem paths at runtime; bundling it breaks that (e.g. a URL is passed
  // where a path string is expected). Keep it external so Next loads it as a
  // normal node module on the server. Harmless in production, where the app
  // uses @prisma/adapter-pg instead and never imports PGlite.
  serverExternalPackages: ["@electric-sql/pglite", "pglite-prisma-adapter"],
};

export default nextConfig;
