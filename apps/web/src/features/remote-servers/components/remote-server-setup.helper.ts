export type SetupFailureDetails = {
  title: string;
  description: string;
  steps: string[];
};

export function getSetupFailureDetails(message: string): SetupFailureDetails {
  if (
    /Remote Docker cannot mount its overlay filesystem|failed to mount[^\n]*overlay[^\n]*(?:permission denied|operation not permitted)/i.test(
      message,
    )
  ) {
    return {
      title: "Remote Docker cannot use overlay storage",
      description:
        "Docker is running, but the server host denied the overlay mount required to unpack the Caddy image. This is a host capability or storage-policy issue, not an Upstand credential problem.",
      steps: [
        "Use Docker on a VM or bare-metal host, or enable nesting, keyctl, and overlayfs in the LXC/Incus host configuration.",
        "Verify the Docker data directory is on a supported ext4 or XFS filesystem, then run docker run --rm hello-world on the server.",
        "Retry setup after the host-level Docker check succeeds.",
      ],
    };
  }

  if (
    /docker(?:\.exe)?:?\s+command not found|command not found:\s*docker/i.test(
      message,
    )
  ) {
    return {
      title: "Docker is not available on the remote host",
      description:
        "The SSH connection succeeded, but the configured SSH user cannot run Docker yet.",
      steps: [
        "Install Docker Engine for the server distribution.",
        "Ensure the Docker service is running and the SSH user can execute docker.",
        "Retry setup to continue provisioning.",
      ],
    };
  }

  if (
    /socket connection was closed unexpectedly|socket hang up/i.test(message)
  ) {
    return {
      title: "The remote Docker connection closed",
      description:
        "The host stopped responding while Upstand was verifying Docker. The server may be restarting Docker or applying a firewall/security policy.",
      steps: [
        "Confirm Docker is running and reachable on the remote host.",
        "Check the host firewall, daemon logs, and available disk space.",
        "Retry setup after the host is stable.",
      ],
    };
  }

  return {
    title: "Server setup could not finish",
    description:
      "Upstand could not complete the last provisioning step. Review the technical details for the remote command output.",
    steps: [
      "Review the technical details below and resolve the reported host issue.",
      "Confirm the SSH user still has the required privileges.",
      "Retry setup; completed steps are safe to resume.",
    ],
  };
}
