let extractPromise;

function loadExtract() {
  extractPromise ??= import("@electron-internal/extract-zip").then(
    (module) => module.default,
  );
  return extractPromise;
}

function extract(zipPath, options, callback) {
  const result = loadExtract().then((extractArchive) =>
    extractArchive(zipPath, options),
  );
  if (typeof callback === "function") {
    result.then(() => callback(), callback);
  }
  return result;
}

module.exports = extract;
