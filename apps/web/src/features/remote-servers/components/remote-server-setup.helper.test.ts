import { expect, test } from "bun:test";
import { getSetupFailureDetails } from "./remote-server-setup.helper";

test("classifies denied remote overlay mounts with host remediation", () => {
  const details = getSetupFailureDetails(
    "failed to mount overlay: permission denied; driver=overlayfs",
  );

  expect(details.title).toBe("Remote Docker cannot use overlay storage");
  expect(details.steps.join(" ")).toContain("nesting, keyctl");
  expect(details.steps.join(" ")).toContain("hello-world");
});

test("classifies missing Docker without exposing raw command output", () => {
  const details = getSetupFailureDetails(
    "bash: line 1: docker: command not found",
  );

  expect(details.title).toBe("Docker is not available on the remote host");
  expect(details.description).not.toContain("bash: line 1");
});
