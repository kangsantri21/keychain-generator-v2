import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // paper.js's Node environment shim does a conditional `require('jsdom/...')`
  // that's dead code here (jsdom isn't installed) but still trips Turbopack's
  // static bundling. Keep it external so Node's native `require` handles it.
  serverExternalPackages: ["paper"],
};

export default nextConfig;
