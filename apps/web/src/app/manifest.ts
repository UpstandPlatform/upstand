import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Upstand",
    short_name: "Upstand",
    description:
      "Self-hostable infrastructure control plane for deploying and operating workloads on Docker Swarm.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0068ff",
    icons: [
      {
        src: "/brand/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/favicon/web-app-manifest-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
