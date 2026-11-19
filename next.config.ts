import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Allow access from your phone on campus Wi-Fi */
  allowedDevOrigins: ["10.17.1.156"],    //IMP : find your ip and put it here..

  cacheComponents: true,
  partialPrefetching: true,

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },

  async redirects() {
    return [
      {
        source: "/cart/:cartId",
        destination: "/:cartId",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;