import { createInterface } from "node:readline";

async function askQuestion(query: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    printUsage();
    process.exit(1);
  }

  const { getServiceProvider } = await import("./di");
  const { closeDb } = await import("@upstand/db");
  const { ResetTwoFactorUseCaseToken } = await import(
    "@upstand/usecases/tokens"
  );
  const scope = getServiceProvider().createScope();

  try {
    if (command !== "reset-2fa") {
      printUsage();
      process.exitCode = 1;
      return;
    }

    const resetTwoFactor = scope.resolve(ResetTwoFactorUseCaseToken);
    let email = args.find((a) => a.startsWith("--email="))?.slice(8);

    if (!email) {
      const mfaUsers = await resetTwoFactor.listEnabledUsers();

      if (mfaUsers.length === 0) {
        console.log("No users found with Two-Factor Authentication enabled.");
        return;
      }

      console.log("\nUsers with Two-Factor Authentication enabled:");
      mfaUsers.forEach((u, i) => {
        console.log(`  [${i + 1}] ${u.name} (${u.email})`);
      });
      console.log("");

      const input = await askQuestion(
        "Enter the number or email of the user to reset 2FA: ",
      );

      if (!input) {
        console.error("Error: Input cannot be empty.");
        process.exitCode = 1;
        return;
      }

      const index = Number.parseInt(input, 10) - 1;
      const selectedUser = mfaUsers[index];
      if (!Number.isNaN(index) && selectedUser) {
        email = selectedUser.email;
      } else {
        email = input;
      }
    }

    const targetUser = await resetTwoFactor.findUserByEmail(email);

    if (!targetUser) {
      console.error(`\nError: User with email '${email}' not found.`);
      process.exitCode = 1;
      return;
    }

    console.log(
      `\nResetting Two-Factor Authentication for ${targetUser.name} (${targetUser.email})...`,
    );

    try {
      await resetTwoFactor.reset(targetUser.id);

      console.log(
        "Success: Two-Factor Authentication has been successfully reset. The user can now log in using only their password.\n",
      );
    } catch (err) {
      console.error("Error: Failed to reset Two-Factor Authentication:", err);
      process.exitCode = 1;
    }
  } finally {
    await scope.dispose();
    await closeDb();
  }
}

function printUsage() {
  console.log("\nUpstand Administrative CLI Tools");
  console.log("=================================");
  console.log("Usage:");
  console.log("  bun dist/cli.mjs reset-2fa [--email=<email>]\n");
}

main().catch(async (err) => {
  console.error("CLI Execution failed:", err);
  try {
    const { closeDb } = await import("@upstand/db");
    await closeDb();
  } catch {}
  process.exit(1);
});
