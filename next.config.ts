import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Allow access from your phone on campus Wi-Fi */
  allowedDevOrigins: ["10.202.3.210"],    //IMP : find your ip and put it here..

  cacheComponents: false,
  partialPrefetching: false,

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