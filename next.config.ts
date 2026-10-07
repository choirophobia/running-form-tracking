import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Lets a Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:3001`)
  // load dev-only assets — Next blocks non-localhost origins in dev by default,
  // which leaves the page unhydrated (nothing clickable) through the tunnel.
  allowedDevOrigins: ["*.trycloudflare.com"],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
