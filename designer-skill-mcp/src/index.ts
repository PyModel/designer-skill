#!/usr/bin/env node
import { HELP_TEXT, parseCli } from "./cli.js";
import { pkg } from "./pkg.js";
import { runHttp } from "./transports/http.js";
import { runStdio } from "./transports/stdio.js";
import { notifyAvailableUpdate, printCheckUpdate } from "./update-check.js";

async function main(): Promise<void> {
  const command = parseCli(process.argv);

  switch (command.kind) {
    case "help":
      console.log(HELP_TEXT.trimEnd());
      return;
    case "version":
      console.log(pkg.version);
      return;
    case "check-update":
      await printCheckUpdate();
      return;
    case "error":
      console.error(`designer-skill-mcp: ${command.message}\n\n${HELP_TEXT.trimEnd()}`);
      process.exitCode = 2;
      return;
    case "run":
      if (command.http) {
        await runHttp({
          port: command.port, host: command.host, roots: command.roots, allowedHosts: command.allowedHosts,
          token: process.env.DESIGNER_SKILL_HTTP_TOKEN || undefined,
        });
        if (command.notifyUpdates) notifyAvailableUpdate();
      } else {
        await runStdio({ roots: command.roots });
      }
  }
}

main().catch((err) => {
  console.error("designer-skill-mcp fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
