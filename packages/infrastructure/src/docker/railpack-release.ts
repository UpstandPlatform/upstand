import { createHash } from "node:crypto";
import fs from "node:fs";

export type RailpackArtifact = {
  archiveSha256: string;
  binarySha256: string;
};

// Railpack is downloaded at runtime because the selected build version is part
// of the resource configuration. Keep the supported release set explicit: a
// URL alone is not an integrity boundary, and an arbitrary version would let
// a resource select an unreviewed executable.
export const RAILPACK_ARTIFACTS: Record<
  string,
  Record<string, RailpackArtifact>
> = {
  "0.15.4": {
    "arm64-unknown-linux-musl": {
      archiveSha256:
        "035856398a88894a7e57dbea44e8c88aacca33a86900d3b8c7750216b424806f",
      binarySha256:
        "9a852d912edd6a42d77a7645be7ef5e4a1df6f6a919171b148ffb7ed9fa0f9eb",
    },
    "x86_64-unknown-linux-musl": {
      archiveSha256:
        "459d86f5a9d8698bee8c7be4f224a305f51158fe5f44eb528255dfd568e4eaf1",
      binarySha256:
        "28f9875e01387e6a7effc0302b4506c6a193907ab65135b78b89daa95e504649",
    },
  },
  "0.16.0": {
    "arm64-unknown-linux-musl": {
      archiveSha256:
        "62828a6948ae097cb2818e9e38b22bcae1919c39b956f07c368b955851b12e9c",
      binarySha256:
        "819f000931a6f1cba9f8c2112ea05a76df17c6cfb45e59b9b72594c7f3e13ce4",
    },
    "x86_64-unknown-linux-musl": {
      archiveSha256:
        "f7cd2e86f2c32538ae59b0698da7010f7c5b52ba3785bda0b09278ba3c1d902e",
      binarySha256:
        "2bfb427ae201e35468aaf00e85d0657cd5e207ed5856c5f4f3a011fd74e6d2bc",
    },
  },
  "0.17.0": {
    "arm64-unknown-linux-musl": {
      archiveSha256:
        "2b70b7dd0bd19694d2913a6af31b8d8f127fe982d4c4ffc94178ffb40039e054",
      binarySha256:
        "e00b9407ebb95071961bb69a3f95c7d5f24b3b2a860201e41a71025ac9375775",
    },
    "x86_64-unknown-linux-musl": {
      archiveSha256:
        "3f55bfd39191b1da12887cac48b5fdb7893d78571245b47d5ea4968a7ff66024",
      binarySha256:
        "cd43f4281aa8a959e3ef709784701ce2920b75b4eb0562136502b31bac693d58",
    },
  },
  "0.18.0": {
    "arm64-unknown-linux-musl": {
      archiveSha256:
        "cd85926a1468af7a44edc7c22e4ff799d5b31fd457c66f088ff4aa25dc1de313",
      binarySha256:
        "6ac3bf8a792c1dc1a4e01e04e33c9693c6ee473075e7aed24883524016a40248",
    },
    "x86_64-unknown-linux-musl": {
      archiveSha256:
        "b45e710fbf73a2f8c384d0d5f202d389dd515b9d7aa0f66a46f8c1212f19e206",
      binarySha256:
        "7b19c163a5846c86ae894407b909ce4676bab10b37ecbc33fa8f7b04e814fa8a",
    },
  },
  "0.19.0": {
    "arm64-unknown-linux-musl": {
      archiveSha256:
        "3ba1a738f4ef1b7b9da420adb91460aced19542658a234d9ffbd8a5d1eff126a",
      binarySha256:
        "250c2566cd29cfd3f52a15295adbbeaf06bd7add1ba3c229c6aa2b135ec7b407",
    },
    "x86_64-unknown-linux-musl": {
      archiveSha256:
        "dc88b65390589782de1794dafbc82482d5c2f9491433aca6305b5f1ff84a987f",
      binarySha256:
        "f75852511f0d88be1389518aaf2ce8fec814187121e34d9c252a4d1152f564a9",
    },
  },
  "0.20.0": {
    "arm64-unknown-linux-musl": {
      archiveSha256:
        "49733cd5a185edbc3d4f8cb1457737452d5f25377b31e39fc1c15052209e8186",
      binarySha256:
        "08ae9b9ec66587a468f83080ce3d7439769eb452208a8f873e29d040d1656e6b",
    },
    "x86_64-unknown-linux-musl": {
      archiveSha256:
        "a87bd89765ba2ee8c01823b597d53322b085ddfce063a1b2b52d2e3c0b10b945",
      binarySha256:
        "6a94a3e64ac0baaa8388478dc974e846cb3678928d1710e277e67c9ba19776a5",
    },
  },
  "0.21.0": {
    "arm64-unknown-linux-musl": {
      archiveSha256:
        "88286ad6f947fd67e7e62432c80da1cae7dc99e1e16a5dfa3bd8048afb9d2c34",
      binarySha256:
        "5bb4f82983193dbfa69a4c81d320231fb22c8bc5a45d344c4bac4b60d89e2917",
    },
    "x86_64-unknown-linux-musl": {
      archiveSha256:
        "a65f8fe9d9b726a48e2e45d30b4f60dc33d66f654fc9f44b1a01be30bd5afe48",
      binarySha256:
        "8c3d0c435e0e8d156ea79007b54176b1bb1b7cbfa1ac0f08a1cc830fc74aca04",
    },
  },
  "0.22.0": {
    "arm64-unknown-linux-musl": {
      archiveSha256:
        "d3a4f3ccdc47f5a07ce2f3a6a93d2fdb6924364b433291c7a36bbf2220afc11e",
      binarySha256:
        "12d3118dae1d7af8639bc273db9fbf7aba88f676626ccd4ee814d781f54a295f",
    },
    "x86_64-unknown-linux-musl": {
      archiveSha256:
        "2bcdd13135100703c9a84a599093386408b4467f19aee035ed4db1b58f0c18f5",
      binarySha256:
        "ea69a15dd077726631e9c42856560da3378c71b8ebf375a66782d9d1d4d21a77",
    },
  },
  "0.23.0": {
    "arm64-unknown-linux-musl": {
      archiveSha256:
        "d4505d0f5f9f48c6350ad349111e10a1f5ba16c118834c85c6d0ecd630b25c34",
      binarySha256:
        "3f26251da1c263ccb45fe068aff40f0cd06c806f6c8334ca558c4e2fce156c5a",
    },
    "x86_64-unknown-linux-musl": {
      archiveSha256:
        "e8bffc181c13e68c1c78ec618f1418e60b1602ec548f3ec1054996394ce0f06a",
      binarySha256:
        "eaef0bd0a2343ac2d09f856b3db3aeca2a7e0f6587ea59763ce042ead7e1632a",
    },
  },
};

export function getRailpackTarget(architecture: string): string {
  if (architecture === "arm64") return "arm64-unknown-linux-musl";
  if (architecture === "x64") return "x86_64-unknown-linux-musl";
  throw new Error(`Railpack does not support architecture '${architecture}'`);
}

export function getRailpackArtifact(
  version: string,
  target: string,
): RailpackArtifact {
  const artifact = RAILPACK_ARTIFACTS[version]?.[target];
  if (!artifact) {
    throw new Error(
      `Railpack v${version} for ${target} has no checked-in integrity record`,
    );
  }
  return artifact;
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function verifyRailpackArchive(
  archivePath: string,
  expectedSha256: string,
): void {
  const actualSha256 = sha256File(archivePath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Railpack archive integrity check failed (expected ${expectedSha256}, got ${actualSha256})`,
    );
  }
}

export function verifyRailpackBinary(
  binaryPath: string,
  expectedSha256: string,
): void {
  const stat = fs.lstatSync(binaryPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      "Railpack cache does not contain a regular executable file",
    );
  }
  const actualSha256 = sha256File(binaryPath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Railpack cached binary integrity check failed (expected ${expectedSha256}, got ${actualSha256})`,
    );
  }
}
