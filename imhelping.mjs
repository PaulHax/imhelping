#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const LIMIT_RE =
  /usage limit|rate limit|spend limit|quota|insufficient_quota|too many requests|\b429\b|resource[ _]exhausted|limit (will )?reset|reset[s]? (in|at)|out of (credit|quota)|try again (later|in)|exceeded your/i;

const CHECKBOX_RE =
  /^(\s*-\s+\[([ xX])\]\s+)((?:\*\*)?([A-Za-z0-9][A-Za-z0-9_.-]*)(?:\*\*)?.*)$/;

const KNOWN_STATUSES = new Set([
  "DONE",
  "PARTIAL",
  "STUCK",
  "REVIEWED",
  "REVIEWED-A",
  "REVIEWED-B",
  "REVIEW-FAIL",
  "REVIEW-BASELINE",
  "VERIFIED",
]);

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function utcStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function utcLogTime() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolvePath(base, value, fallback = "") {
  const raw = expandHome(String(value || fallback));
  return path.resolve(path.isAbsolute(raw) ? raw : path.join(base, raw));
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== "");
  if (!value) return [];
  return String(value)
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stageFrom(raw, key, base, defaultStatus) {
  const engine = String(raw.engine || "none").toLowerCase();
  return {
    key,
    label: raw.label || key,
    engine,
    prompt: resolvePath(base, raw.prompt || ""),
    status: raw.status || defaultStatus,
    model: raw.model || "",
    args: asArray(raw.args),
    enabled: raw.enabled !== false && engine !== "none",
    itemFilter: raw.itemFilter || raw.item_filter || "",
    description: raw.description || "",
    verdictFile:
      raw.verdictFile || raw.verdict_file
        ? resolvePath(base, raw.verdictFile || raw.verdict_file)
        : "",
    blockOnVerdictFail:
      Boolean(raw.blockOnVerdictFail) || Boolean(raw.block_on_verdict_fail),
    cleanupAfter: Boolean(raw.cleanupAfter) || Boolean(raw.cleanup_after),
  };
}

export async function readConfig(configPath) {
  const resolved = path.resolve(configPath);
  const base = path.dirname(resolved);
  const raw = JSON.parse(await fs.readFile(resolved, "utf8"));
  const session = raw.session || {};
  const implementation = stageFrom(
    raw.implementation || {},
    "implementation",
    base,
    "DONE",
  );
  const reviews = [];
  for (const review of raw.reviews || []) {
    const stage = stageFrom(review, review.key, base, "REVIEWED");
    if (stage.enabled) reviews.push(stage);
  }
  return {
    path: resolved,
    name: session.name || path.basename(base),
    workdir: resolvePath(base, session.workdir || "."),
    progress: resolvePath(base, session.progress || "PROGRESS.md"),
    logs: resolvePath(base, session.logs || "logs"),
    addDirs: asArray(session.addDirs || session.add_dirs).map((entry) =>
      resolvePath(base, entry),
    ),
    watchGit: asArray(session.watchGit || session.watch_git).map((entry) =>
      resolvePath(base, entry),
    ),
    watchFiles: asArray(session.watchFiles || session.watch_files).map((entry) =>
      resolvePath(base, entry),
    ),
    maxSteps: Number(session.maxSteps || session.max_steps || 40),
    retrySleep: Number(session.retrySleep || session.retry_sleep || 3600),
    retryMinSleep: Number(session.retryMinSleep ?? session.retry_min_sleep ?? 60),
    retryMaxSleep: Number(session.retryMaxSleep ?? session.retry_max_sleep ?? 21600),
    retryBuffer: Number(session.retryBuffer ?? session.retry_buffer ?? 30),
    retryMax: Number(session.retryMax || session.retry_max || 24),
    requireProgressChange:
      session.requireProgressChange ?? session.require_progress_change ?? true,
    logAfter: session.logAfter || session.log_after || "",
    implementation,
    reviews,
  };
}

export async function readProgress(config) {
  const text = await fs.readFile(config.progress, "utf8");
  const lines = text.split(/\r?\n/);
  const items = [];
  for (const [lineNo, line] of lines.entries()) {
    const match = CHECKBOX_RE.exec(line);
    if (!match) continue;
    items.push({
      itemId: match[4],
      checked: match[2].toLowerCase() === "x",
      blocked: line.includes("**BLOCKED**"),
      lineNo,
      line,
    });
  }

  let logFloor = -1;
  if (config.logAfter) {
    const found = lines.findIndex((line) => line.includes(config.logAfter));
    if (found >= 0) logFloor = found;
  }

  const logs = [];
  for (const [index, line] of lines.entries()) {
    if (index <= logFloor) continue;
    const entry = parseLogLine(index, line);
    if (entry) logs.push(entry);
  }
  return { lines, items, logs };
}

function parseLogLine(index, line) {
  const parts = line.split(/\s+/, 5);
  if (parts.length < 3 || !/^\d{4}-\d{2}-\d{2}/.test(parts[0])) return null;
  const itemId = parts[1];
  if (KNOWN_STATUSES.has(parts[2])) {
    return { index, itemId, status: parts[2], commit: "", line };
  }
  if (parts.length >= 4 && KNOWN_STATUSES.has(parts[3])) {
    return { index, itemId, status: parts[3], commit: parts[2], line };
  }
  return null;
}

function logsForItem(logs, itemId) {
  return logs.filter((entry) => entry.itemId === itemId);
}

function reviewSatisfied(item, stage, entries, after) {
  if (stage.itemFilter && !item.line.includes(stage.itemFilter)) return true;
  return entries.some((entry) => entry.status === stage.status && entry.index > after);
}

export async function nextAction(config) {
  const { items, logs } = await readProgress(config);
  if (!items.length) return { kind: "blocked", reason: "no checkbox items found" };
  const blocked = items.find((item) => item.blocked);
  if (blocked) return { kind: "blocked", item: blocked, reason: "blocked item" };

  for (const item of items) {
    const entries = logsForItem(logs, item.itemId);
    const latestImpl = entries
      .filter((entry) => entry.status === "DONE" || entry.status === "PARTIAL")
      .reduce((latest, entry) => Math.max(latest, entry.index), -1);
    if (latestImpl >= 0) {
      const failAfter = entries.some(
        (entry) => entry.status === "REVIEW-FAIL" && entry.index > latestImpl,
      );
      if (!failAfter) {
        for (const stage of config.reviews) {
          if (!reviewSatisfied(item, stage, entries, latestImpl)) {
            return { kind: "stage", item, stage };
          }
        }
      }
    }
    if (!item.checked) return { kind: "stage", item, stage: config.implementation };
  }
  return { kind: "done" };
}

async function progressHash(config) {
  return sha256(await fs.readFile(config.progress));
}

async function fileHash(filePath) {
  if (!fsSync.existsSync(filePath)) return "missing";
  const stat = await fs.stat(filePath);
  if (stat.isFile()) return sha256(await fs.readFile(filePath));
  const entries = [];
  async function walk(dir) {
    for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        await walk(full);
      } else if (dirent.isFile()) {
        entries.push(`${path.relative(filePath, full)}:${sha256(await fs.readFile(full))}`);
      }
    }
  }
  await walk(filePath);
  return sha256(entries.sort().join("\n"));
}

function runText(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function gitFingerprint(repo) {
  const head = runText("git", ["-C", repo, "rev-parse", "HEAD"]);
  const status = runText("git", ["-C", repo, "status", "--porcelain=v1", "-uno"]);
  return `${repo}:${head}:${status}`;
}

async function watchedFingerprint(config) {
  const parts = [];
  for (const repo of config.watchGit) parts.push(gitFingerprint(repo));
  for (const watched of config.watchFiles) parts.push(`${watched}:${await fileHash(watched)}`);
  return sha256(parts.join("\n"));
}

function hasCommand(command) {
  const result = spawnSync("bash", ["-lc", `command -v ${JSON.stringify(command)}`], {
    encoding: "utf8",
  });
  return result.status === 0;
}

function commandForStage(config, stage, lastMessage) {
  if (stage.engine === "codex") {
    if (!hasCommand("codex")) throw new Error("codex CLI not found in PATH");
    const command = ["exec", "--dangerously-bypass-approvals-and-sandbox"];
    if (stage.model) command.push("--model", stage.model);
    command.push("--cd", config.workdir);
    for (const dir of config.addDirs) command.push("--add-dir", dir);
    command.push("--output-last-message", lastMessage, ...stage.args, "-");
    return { command: "codex", args: command };
  }

  if (stage.engine === "claude") {
    if (!hasCommand("claude")) throw new Error("claude CLI not found in PATH");
    const command = ["--dangerously-skip-permissions", "-p"];
    if (stage.model) command.push("--model", stage.model);
    for (const dir of config.addDirs) command.push("--add-dir", dir);
    command.push(...stage.args);
    return { command: "claude", args: command };
  }

  throw new Error(`Unknown engine for ${stage.label}: ${stage.engine}`);
}

async function teeRun(commandSpec, cwd, prompt, logPath) {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const log = fsSync.createWriteStream(logPath, { flags: "w" });
  const child = spawn(commandSpec.command, commandSpec.args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  createReadStream(prompt).pipe(child.stdin);
  const writeChunk = (chunk) => {
    process.stdout.write(chunk);
    log.write(chunk);
  };
  child.stdout.on("data", writeChunk);
  child.stderr.on("data", writeChunk);
  const status = await new Promise((resolve) => child.on("close", resolve));
  await new Promise((resolve) => log.end(resolve));
  return status;
}

async function logHasLimit(logPath) {
  if (!fsSync.existsSync(logPath)) return false;
  return LIMIT_RE.test(await fs.readFile(logPath, "utf8"));
}

async function limitWaitSeconds(config, logPath) {
  const text = await fs.readFile(logPath, "utf8");
  const hint = text.match(/(try again|reset[s]?|available|back) (in|at)[^.]*/i)?.[0] || "";
  let seconds = config.retrySleep;
  const hour = hint.match(/([0-9]+)\s*(h|hour)/i);
  const minute = hint.match(/([0-9]+)\s*(m|min)/i);
  const second = hint.match(/([0-9]+)\s*(s|sec)/i);
  if (hour) seconds = Number(hour[1]) * 3600;
  else if (minute) seconds = Number(minute[1]) * 60;
  else if (second) seconds = Number(second[1]);
  return Math.min(Math.max(seconds, config.retryMinSleep), config.retryMaxSleep) + config.retryBuffer;
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function appendProgress(config, line) {
  let prefix = "";
  if (fsSync.existsSync(config.progress)) {
    const current = await fs.readFile(config.progress);
    if (current.length && current.at(-1) !== 10) prefix = "\n";
  }
  await fs.appendFile(config.progress, `${prefix}${line.trimEnd()}\n`);
}

async function markBlocked(config, item, reason) {
  const text = await fs.readFile(config.progress, "utf8");
  const lines = text.split(/\r?\n/);
  if (!lines[item.lineNo].includes("**BLOCKED**")) {
    lines[item.lineNo] += ` **BLOCKED** — ${reason}`;
    await fs.writeFile(config.progress, `${lines.join("\n").replace(/\n*$/, "")}\n`);
  }
}

async function processVerdict(config, stage, item) {
  if (!stage.verdictFile) return true;
  if (!fsSync.existsSync(stage.verdictFile)) {
    await appendProgress(config, `${utcLogTime()} ${item.itemId} — STUCK ${stage.label} produced no verdict`);
    if (stage.blockOnVerdictFail) await markBlocked(config, item, `${stage.label} produced no verdict`);
    return false;
  }
  let verdict;
  try {
    verdict = JSON.parse(await fs.readFile(stage.verdictFile, "utf8"));
  } catch {
    await appendProgress(config, `${utcLogTime()} ${item.itemId} — STUCK ${stage.label} verdict was invalid JSON`);
    if (stage.blockOnVerdictFail) await markBlocked(config, item, `${stage.label} verdict was invalid JSON`);
    return false;
  }
  const result = String(verdict.verdict || "").toUpperCase();
  const reason = String(verdict.reason || "").replace(/\s+/g, " ").trim();
  if (result === "PASS") {
    await appendProgress(config, `${utcLogTime()} ${item.itemId} ${stage.status} ${reason}`);
    return true;
  }
  const summary = reason || "verdict did not pass";
  await appendProgress(config, `${utcLogTime()} ${item.itemId} — STUCK ${stage.label} FAIL ${summary}`);
  if (stage.blockOnVerdictFail) await markBlocked(config, item, `${stage.label} FAIL — ${summary}`);
  return false;
}

function cleanupWorktree(config) {
  spawnSync("git", ["checkout", "--", "."], { cwd: config.workdir, stdio: "ignore" });
  spawnSync("git", ["clean", "-fdq"], { cwd: config.workdir, stdio: "ignore" });
}

async function runReadyStage(config, action) {
  if (!action.stage || !action.item) {
    console.log(action.reason || action.kind);
    return action.kind === "done" ? 10 : action.kind === "blocked" ? 11 : 2;
  }

  const { stage, item } = action;
  if (!fsSync.existsSync(stage.prompt)) throw new Error(`Missing prompt: ${stage.prompt}`);
  await fs.mkdir(config.logs, { recursive: true });

  for (let attempt = 1; ; attempt += 1) {
    const beforeProgress = await progressHash(config);
    const beforeWatch = await watchedFingerprint(config);
    const logPath = path.join(config.logs, `${stage.key}-${stage.engine}-${utcStamp()}-a${attempt}.log`);
    const lastMessage = path.join(config.logs, `${stage.key}-${stage.engine}-last-message.md`);
    console.log(`=== ${config.name}: ${stage.label} for ${item.itemId} (${stage.engine}, attempt ${attempt}/${config.retryMax}) ===`);
    console.log(`log: ${logPath}`);

    const status = await teeRun(commandForStage(config, stage, lastMessage), config.workdir, stage.prompt, logPath);
    if (stage.cleanupAfter) cleanupWorktree(config);

    const verdictOk = await processVerdict(config, stage, item);
    const afterProgress = await progressHash(config);
    const afterWatch = await watchedFingerprint(config);
    const progressChanged = beforeProgress !== afterProgress;
    const watchedChanged = beforeWatch !== afterWatch;

    if (status === 0 && verdictOk) {
      if (progressChanged || (watchedChanged && !config.requireProgressChange)) {
        console.log(`${stage.label} complete.`);
        return 0;
      }
      if (!(await logHasLimit(logPath))) {
        console.log(`${stage.label} exited 0 but did not update the ledger.`);
        return 3;
      }
    }

    if (await logHasLimit(logPath)) {
      if (attempt >= config.retryMax) {
        console.log(`${stage.label} still limited after ${attempt} attempts.`);
        return 4;
      }
      const waitSeconds = await limitWaitSeconds(config, logPath);
      console.log(`Limit detected. Sleeping ${waitSeconds}s before retrying the same stage.`);
      await sleep(waitSeconds);
      continue;
    }

    if (status !== 0) {
      console.log(`${stage.label} exited non-zero (${status}). See ${logPath}.`);
      return status;
    }
    if (!verdictOk) {
      console.log(`${stage.label} verdict failed. See ${logPath}.`);
      return 13;
    }
  }
}

export async function cmdStatus(config) {
  const action = await nextAction(config);
  if (action.kind === "done") {
    console.log("done");
    return 0;
  }
  if (action.kind === "blocked") {
    console.log(`blocked${action.item ? ` ${action.item.itemId}` : ""}: ${action.reason}`);
    return 11;
  }
  console.log(`next ${action.stage.key} item=${action.item.itemId} engine=${action.stage.engine} prompt=${action.stage.prompt}`);
  return 0;
}

export async function cmdOnce(config, requestedStage = "") {
  const action = await nextAction(config);
  if (action.kind !== "stage") return runReadyStage(config, action);
  if (requestedStage && requestedStage !== action.stage.key) {
    console.log(`${requestedStage} is not ready; next is ${action.stage.key} for ${action.item.itemId}.`);
    return 12;
  }
  return runReadyStage(config, action);
}

export async function cmdLoop(config) {
  for (let step = 1; step <= config.maxSteps; step += 1) {
    console.log(`=== loop step ${step}/${config.maxSteps} ===`);
    const action = await nextAction(config);
    if (action.kind === "done") {
      console.log("All items complete.");
      return 0;
    }
    if (action.kind === "blocked") {
      console.log(action.reason);
      return 11;
    }
    const status = await runReadyStage(config, action);
    if (![0, 10].includes(status)) return status;
  }
  console.log(`maxSteps=${config.maxSteps} reached`);
  return 9;
}

function parseArgs(argv) {
  const args = [...argv];
  let config = "imhelping.json";
  const takeConfig = (index) => {
    if (!args[index + 1]) throw new Error("--config requires a path");
    config = args[index + 1];
    args.splice(index, 2);
  };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--config") {
      takeConfig(i);
      i -= 1;
    }
  }
  const command = args.shift();
  if (!command || ["-h", "--help"].includes(command)) {
    return { help: true, config };
  }
  return { command, config, rest: args };
}

function printHelp() {
  console.log(`Usage: imhelping.mjs [--config PATH] <status|once|stage|loop> [stage-key]

Commands:
  status   Print the next action without running a stage
  once     Run the next ready headless stage
  stage    Run a named stage only if it is next
  loop     Repeatedly run headless stages until done or blocked`);
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    printHelp();
    return 0;
  }
  const config = await readConfig(parsed.config);
  if (parsed.command === "status") return cmdStatus(config);
  if (parsed.command === "once") return cmdOnce(config);
  if (parsed.command === "stage") return cmdOnce(config, parsed.rest[0] || "");
  if (parsed.command === "loop") return cmdLoop(config);
  printHelp();
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((status) => process.exit(status)).catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
