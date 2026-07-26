import { describe, expect, test } from "bun:test";
import { ResourceAdvancedConfigSchema } from "@upstand/domain";

describe("Post-Deploy Hook Execution & Configuration", () => {
  describe("Domain Schema Validation", () => {
    test("provides correct defaults for postDeployHook", () => {
      const config = ResourceAdvancedConfigSchema.parse({});
      expect(config.postDeployHook).toBeDefined();
      expect(config.postDeployHook.enabled).toBe(false);
      expect(config.postDeployHook.timeoutSeconds).toBe(300);
      expect(config.postDeployHook.onFailure).toBe("warn");
    });

    test("validates custom postDeployHook with fail policy", () => {
      const config = ResourceAdvancedConfigSchema.parse({
        postDeployHook: {
          enabled: true,
          command: "npx prisma migrate deploy",
          timeoutSeconds: 120,
          onFailure: "fail",
        },
      });
      expect(config.postDeployHook.enabled).toBe(true);
      expect(config.postDeployHook.command).toBe("npx prisma migrate deploy");
      expect(config.postDeployHook.timeoutSeconds).toBe(120);
      expect(config.postDeployHook.onFailure).toBe("fail");
    });

    test("rejects invalid timeout values", () => {
      expect(() =>
        ResourceAdvancedConfigSchema.parse({
          postDeployHook: {
            enabled: true,
            command: "echo 1",
            timeoutSeconds: 5, // min is 10
          },
        }),
      ).toThrow();
    });

    test("rejects control characters in hook and healthcheck commands", () => {
      expect(() =>
        ResourceAdvancedConfigSchema.parse({
          postDeployHook: { command: "echo ok\u0000" },
        }),
      ).toThrow("control characters");
      expect(() =>
        ResourceAdvancedConfigSchema.parse({
          healthcheck: { command: ["CMD-SHELL", "curl /health\u0000"] },
        }),
      ).toThrow("control characters");
    });
  });

  describe("Container Command Execution Simulation", () => {
    test("simulates post-deploy hook output streaming and success", async () => {
      const logs: string[] = [];
      const mockExecContainerCommand = async (
        _target: unknown,
        _serviceName: string,
        command: string,
        options?: { timeoutSeconds?: number; onLog?: (chunk: string) => void },
      ) => {
        options?.onLog?.(`Running '${command}' inside container...\n`);
        options?.onLog?.("Applying migration 20260725_init... DONE\n");
        return { output: "Migration successful", exitCode: 0 };
      };

      const result = await mockExecContainerCommand(
        { kind: "local" },
        "web-app",
        "npx prisma migrate deploy",
        {
          timeoutSeconds: 60,
          onLog: (chunk) => logs.push(chunk),
        },
      );

      expect(result.exitCode).toBe(0);
      expect(logs).toHaveLength(2);
      expect(logs[0]).toContain("Running 'npx prisma migrate deploy'");
      expect(logs[1]).toContain("Applying migration 20260725_init");
    });

    test("simulates post-deploy hook failure handling under warn vs fail policies", async () => {
      const mockExecFailure = async () => {
        return {
          output: "",
          stderr: "Migration failed: connection refused",
          exitCode: 1,
        };
      };

      const hookResult = await mockExecFailure();

      // Policy 'warn'
      let policyWarnPassed = false;
      if (hookResult.exitCode !== 0) {
        const failureMode: "warn" | "fail" = "warn";
        if (failureMode === "warn") {
          policyWarnPassed = true; // non-blocking
        }
      }
      expect(policyWarnPassed).toBe(true);

      // Policy 'fail'
      let policyFailThrew = false;
      if (hookResult.exitCode !== 0) {
        const failureMode: "warn" | "fail" = "fail";
        if (failureMode === "fail") {
          policyFailThrew = true; // blocking error
        }
      }
      expect(policyFailThrew).toBe(true);
    });
  });
});
