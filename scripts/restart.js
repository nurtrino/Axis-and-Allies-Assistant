// Dev-server restarter, launched by POST /api/restart just before the running
// server exits. Waits for port 3000 to be released, then relaunches the dev
// server with NO visible console window (Windows: PowerShell Start-Process
// -WindowStyle Hidden), logging to dev-server.log.
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 3000;
const cwd = process.cwd();

function portFree() {
  return new Promise((resolve) => {
    const socket = net.connect(PORT, "127.0.0.1");
    socket.setTimeout(800);
    socket.on("connect", () => {
      socket.destroy();
      resolve(false);
    });
    const free = () => {
      socket.destroy();
      resolve(true);
    };
    socket.on("error", free);
    socket.on("timeout", free);
  });
}

(async () => {
  // Wait up to ~30s for the exiting server to release the port.
  for (let i = 0; i < 60; i++) {
    if (await portFree()) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const nextBin = path.join(cwd, "node_modules", "next", "dist", "bin", "next");
  const logPath = path.join(cwd, "dev-server.log");
  fs.appendFileSync(logPath, `\n--- restart ${new Date().toISOString()} ---\n`);

  if (process.platform === "win32") {
    // cmd runs `node next dev` and merges output to the log; PowerShell launches
    // it with a hidden window. spawnSync keeps this process alive until the
    // (fast) Start-Process call returns, after which the server runs detached.
    const inner = `/c node "${nextBin}" dev > "${logPath}" 2>&1`;
    const psCommand =
      `Start-Process -FilePath 'cmd.exe' -ArgumentList '${inner.replace(/'/g, "''")}'` +
      ` -WorkingDirectory '${cwd.replace(/'/g, "''")}' -WindowStyle Hidden`;
    spawnSync(
      "powershell.exe",
      ["-NoProfile", "-WindowStyle", "Hidden", "-Command", psCommand],
      { windowsHide: true },
    );
  } else {
    const out = fs.openSync(logPath, "a");
    const child = spawn(process.execPath, [nextBin, "dev"], {
      cwd,
      detached: true,
      stdio: ["ignore", out, out],
    });
    child.unref();
  }
})();
