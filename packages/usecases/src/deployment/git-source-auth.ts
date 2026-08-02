import { assertSafeGitUrl } from "../git-provider/git-url-sanitizer";

export type GitSourceAuthentication = {
  cloneUrl: string;
  gitEnvironment?: Record<string, string>;
};

/** Keep Git credentials out of clone/fetch process arguments and repository URLs. */
export function createGitBasicAuthEnvironment(
  username: string,
  password: string,
): Record<string, string> {
  if (!username || !password) {
    throw new Error("Git provider credentials are incomplete");
  }
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    GIT_TERMINAL_PROMPT: "0",
  };
}

export function removeGitUrlCredentials(
  value: string,
): GitSourceAuthentication {
  assertSafeGitUrl(value);
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { cloneUrl: value };
    }
    if (!url.username && !url.password) return { cloneUrl: value };
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    url.username = "";
    url.password = "";
    return {
      cloneUrl: url.toString(),
      gitEnvironment: createGitBasicAuthEnvironment(username, password),
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("credentials")) {
      throw error;
    }
    throw new Error("Git repository URL is invalid");
  }
}
