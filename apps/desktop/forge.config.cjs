/** @type {import('@electron-forge/shared-types').ForgeConfig} */
const { rm } = require("node:fs/promises");
const { resolve } = require("node:path");

module.exports = {
  packagerConfig: {
    asar: true,
    name: "upstand",
    executableName: "upstand",
    appBundleId: "dev.upstand.desktop",
    win32metadata: {
      CompanyName: "Upstand",
      ProductName: "Upstand",
      FileDescription: "Upstand Desktop",
      OriginalFilename: "upstand.exe",
    },
    icon: resolve(__dirname, "assets", "icon.ico"),
    // Allows an air-gapped verification host to provide a pre-verified Electron
    // archive while CI continues to use Electron Packager's normal download.
    electronZipDir: process.env.UPSTAND_ELECTRON_ZIP_DIR,
    extraResource: [resolve(__dirname, "dist/resources/local")],
    // The main and preload bundles have no runtime npm dependencies. Excluding
    // Bun's workspace symlinks prevents Electron Packager from treating Forge's
    // own dev-only modules as application modules during its dependency walk.
    ignore: [
      /(^|[\\/])node_modules([\\/]|$)/,
      /(^|[\\/])dist[\\/]resources[\\/]local([\\/]|$)/,
    ],
  },
  hooks: {
    // Squirrel treats its release directory as an update feed. Never mix a
    // previous app name/version's feed with the release being made now.
    preMake: async () => {
      await rm(resolve(__dirname, "out", "make", "squirrel.windows"), {
        force: true,
        recursive: true,
      });
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "upstand",
        title: "Upstand",
        setupIcon: resolve(__dirname, "assets", "icon.ico"),
        iconUrl:
          "https://raw.githubusercontent.com/UpstandPlatform/upstand/master/apps/desktop/assets/icon.ico",
      },
    },
    { name: "@electron-forge/maker-zip", platforms: ["darwin", "linux"] },
    { name: "@electron-forge/maker-dmg" },
    { name: "@electron-forge/maker-deb", config: { bin: "upstand" } },
  ],
};
