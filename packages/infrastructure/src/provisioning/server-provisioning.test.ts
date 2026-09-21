import { expect, test } from "bun:test";
import {
  appendBoundedSshOutput,
  formatCaddyPullError,
  MAX_SSH_STDOUT_BYTES,
} from "./server-provisioning";

test("remote SSH output is bounded before it is accumulated", () => {
  expect(
    appendBoundedSshOutput("prefix", "suffix", MAX_SSH_STDOUT_BYTES, "stdout"),
  ).toBe("prefixsuffix");

  expect(() =>
    appendBoundedSshOutput(
      "x".repeat(MAX_SSH_STDOUT_BYTES),
      "y",
      MAX_SSH_STDOUT_BYTES,
      "stdout",
    ),
  ).toThrow("SSH stdout output exceeded");
});

test("Caddy pull failures explain unsupported remote overlay storage", () => {
  const message = formatCaddyPullError(
    "caddy:2.8-alpine@sha256:test",
    'failed to mount /var/lib/containerd/tmpmounts/containerd-mount: mount source: "overlay", target: "/var/lib/containerd/tmpmounts/containerd-mount", fstype: overlay, err: permission denied',
    "driver=overlay2 root=/var/lib/docker security=[]",
  );

  expect(message).toContain("cannot mount its overlay filesystem");
  expect(message).toContain("unprivileged LXC/Incus container");
  expect(message).toContain("ftype=1");
  expect(message).toContain("driver=overlay2");
});

test("Caddy pull failures identify a denied overlayfs snapshotter", () => {
  const message = formatCaddyPullError(
    "caddy:2.8-alpine@sha256:test",
    "failed to extract layer to overlayfs: failed to mount /var/lib/containerd/tmpmounts/containerd-mount: fstype: overlay, err: permission denied",
    'driver=overlayfs root=/var/lib/docker security=["name=apparmor,profile=default","name=seccomp,profile=builtin","name=cgroupns"]',
  );

  expect(message).toContain("using the overlayfs snapshotter");
  expect(message).toContain("restricted VPS kernel");
  expect(message).toContain("docker run --rm hello-world");
});

test("non-overlay Caddy pull failures preserve the Docker error", () => {
  expect(
    formatCaddyPullError("caddy:2.8-alpine@sha256:test", "access denied"),
  ).toBe("Failed to pull caddy:2.8-alpine@sha256:test: access denied");
});
