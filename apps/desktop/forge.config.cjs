/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "upstand",
    // The main and preload bundles have no runtime npm dependencies. Excluding
    // Bun's workspace symlinks prevents Electron Packager from treating Forge's
    // own dev-only modules as application modules during its dependency walk.
    ignore: [/(^|[\\/])node_modules([\\/]|$)/],
  },
  makers: [
    { name: "@electron-forge/maker-squirrel", config: { name: "upstand" } },
    { name: "@electron-forge/maker-zip", platforms: ["darwin", "linux"] },
    { name: "@electron-forge/maker-dmg" },
    { name: "@electron-forge/maker-deb", config: { bin: "upstand" } },
  ],
};
