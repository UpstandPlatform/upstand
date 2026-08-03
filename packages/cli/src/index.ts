#!/usr/bin/env bun
import { parseArgs } from "./args";
import { runCommand } from "./commands";

const context = await parseArgs(process.argv.slice(2));
process.exitCode = await runCommand(context);
