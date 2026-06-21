import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Flag art is our own trusted SVG in /public/flags.
    dangerouslyAllowSVG: true,
    contentDispositionType: "inline",
  },
};

export default nextConfig;
