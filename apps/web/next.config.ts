import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
});

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ['@3sec/database', '@3sec/ocr', '@3sec/receipt-parser'],
  turbopack: {}
};

export default withPWA(nextConfig);
