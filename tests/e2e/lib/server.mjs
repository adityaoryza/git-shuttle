/* Starts `python3 -m shuttle_ui` for a demo repository and reads the link it prints, like a user would. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitEnv } from "./demo.mjs";

// An add-on that is installed on the machine that runs the tests (git-shuttle-odoo-task, in ~/.local/bin) must not turn up next to the
// stand-in: the folders of the PATH that hold a git-shuttle-NAME program are left out.
const pathWithoutAddons = () => (process.env.PATH || "").split(path.delimiter).filter(dir => {
  try { return !fs.readdirSync(dir).some(f => f.startsWith("git-shuttle-")); } catch { return true; }
}).join(path.delimiter);

const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ui");

export async function startServer(demo, extraArgs = []) {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), "shuttle-e2e-cfg-"));
  const proc = spawn("python3", ["-m", "shuttle_ui", "--port", "0", "--no-open", "--repo", demo.work, ...extraArgs], {
    env: { ...gitEnv(), PATH: pathWithoutAddons(), PYTHONPATH: UI_DIR, XDG_CONFIG_HOME: config, GIT_SHUTTLE_GH: demo.gh, GIT_SHUTTLE_NO_UPDATE_CHECK: "1", GIT_SHUTTLE_SSH: demo.ssh, GIT_SHUTTLE_SECRET_TOOL: demo.secretTool, GIT_SHUTTLE_ADDON_PATH: demo.addons, GIT_SHUTTLE_ADDON_HOME: path.join(demo.root, "addon-home"), PYTHONUNBUFFERED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "", err = "";
  proc.stderr.on("data", d => { err += d; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the server printed no link: " + err)), 15000);
    proc.stdout.on("data", d => {
      out += d;
      const m = /http:\/\/127\.0\.0\.1:\d+\/#token=\S+/.exec(out);
      if (m) { clearTimeout(timer); resolve(m[0]); }
    });
    proc.on("exit", code => reject(new Error("the server stopped (" + code + "): " + err)));
  });
  return {
    url, config, log: () => err,
    stop: () => new Promise(resolve => { proc.removeAllListeners("exit"); proc.on("exit", () => { fs.rmSync(config, { recursive: true, force: true }); resolve(); }); proc.kill("SIGINT"); }),
  };
}
