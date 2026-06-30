import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  cmdInit,
  cmdLoop,
  cmdOnce,
  cmdPause,
  cmdResume,
  formatDuration,
  nextAction,
  parseLimitWait,
  readConfig,
} from "./imhelping.mjs";

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "imhelping-"));
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function makeConfig(root, engine = "codex") {
  await fs.writeFile(
    path.join(root, "PROGRESS.md"),
    `# Progress

## Checklist
- [ ] T1 — first task
- [ ] T2 — second task

## Log
`,
  );
  await fs.writeFile(path.join(root, "PROMPT.md"), "do one task\n");
  const config = path.join(root, "imhelping.json");
  await writeJson(config, {
    session: {
      name: "test-loop",
      workdir: root,
      progress: "PROGRESS.md",
      logs: "logs",
      retrySleep: 0,
      retryMinSleep: 0,
      retryMaxSleep: 0,
      retryBuffer: 0,
      retryMax: 2,
    },
    implementation: {
      engine,
      prompt: "PROMPT.md",
      status: "DONE",
    },
    reviews: [],
  });
  return config;
}

async function fakeCli(root, name) {
  const binDir = path.join(root, "bin");
  await fs.mkdir(binDir);
  const script = path.join(binDir, name);
  await fs.writeFile(
    script,
    `#!/usr/bin/env bash
set -eu
if [ ! -f "$TASK_LOOP_FAKE_STATE" ]; then
  echo "usage limit will reset in 0s"
  touch "$TASK_LOOP_FAKE_STATE"
  exit 1
fi
cat >/dev/null
printf '2026-01-01T00:00:00Z T1 abc123 DONE fake implementation\\n' >> "$TASK_LOOP_PROGRESS"
`,
  );
  await fs.chmod(script, 0o755);
  return binDir;
}

test("routes review before starting the next item", async () => {
  const root = await tempDir();
  await fs.writeFile(
    path.join(root, "PROGRESS.md"),
    `# Progress

- [x] A1 — done task
- [ ] A2 — next task

## Log
2026-01-01T00:00:00Z A1 abc DONE implementation
`,
  );
  await fs.writeFile(path.join(root, "AGENT.md"), "impl");
  await fs.writeFile(path.join(root, "REVIEW.md"), "review");
  const configPath = path.join(root, "imhelping.json");
  await writeJson(configPath, {
    session: {
      name: "review-routing",
      workdir: root,
      progress: "PROGRESS.md",
      logs: "logs",
    },
    implementation: {
      engine: "codex",
      prompt: "AGENT.md",
      status: "DONE",
    },
    reviews: [
      {
        key: "review-a",
        engine: "claude",
        prompt: "REVIEW.md",
        status: "REVIEWED-A",
      },
    ],
  });

  const action = await nextAction(await readConfig(configPath));

  assert.equal(action.kind, "stage");
  assert.equal(action.item.itemId, "A1");
  assert.equal(action.stage.key, "review-a");
});

test("a bulleted DONE log entry still routes to review", async () => {
  // A hand-authored ledger often writes log lines as Markdown bullets. The
  // timestamp is no longer the first token, so an intolerant parser drops the
  // DONE record and the loop reports the NEXT item's implementation instead of
  // the pending review — the exact mismatch that confused a setup session.
  const root = await tempDir();
  await fs.writeFile(
    path.join(root, "PROGRESS.md"),
    `# Progress

- [x] A1 — done task
- [ ] A2 — next task

## Log
- 2026-01-01T00:00:00Z A1 abc DONE implementation
`,
  );
  await fs.writeFile(path.join(root, "AGENT.md"), "impl");
  await fs.writeFile(path.join(root, "REVIEW.md"), "review");
  const configPath = path.join(root, "imhelping.json");
  await writeJson(configPath, {
    session: { name: "bullet-log", workdir: root, progress: "PROGRESS.md", logs: "logs" },
    implementation: { engine: "codex", prompt: "AGENT.md", status: "DONE" },
    reviews: [
      { key: "review-a", engine: "claude", prompt: "REVIEW.md", status: "REVIEWED-A" },
    ],
  });

  const action = await nextAction(await readConfig(configPath));

  assert.equal(action.kind, "stage");
  assert.equal(action.item.itemId, "A1");
  assert.equal(action.stage.key, "review-a");
});

test("conditional verifier skips unmarked items", async () => {
  const root = await tempDir();
  await fs.writeFile(
    path.join(root, "PROGRESS.md"),
    `# Progress

- [x] F1 — plain phase
- [ ] F2 — next phase

## Log
2026-01-01T00:00:00Z F1 abc DONE implementation
`,
  );
  await fs.writeFile(path.join(root, "AGENT.md"), "impl");
  await fs.writeFile(path.join(root, "VERIFY.md"), "verify");
  const configPath = path.join(root, "imhelping.json");
  await writeJson(configPath, {
    session: {
      name: "verify-routing",
      workdir: root,
      progress: "PROGRESS.md",
      logs: "logs",
    },
    implementation: {
      engine: "codex",
      prompt: "AGENT.md",
      status: "DONE",
    },
    reviews: [
      {
        key: "verify",
        engine: "claude",
        prompt: "VERIFY.md",
        status: "VERIFIED",
        itemFilter: "[VERIFY]",
      },
    ],
  });

  const action = await nextAction(await readConfig(configPath));

  assert.equal(action.kind, "stage");
  assert.equal(action.item.itemId, "F2");
  assert.equal(action.stage.key, "implementation");
});

test("omitted prompt falls back to the bundled stage default", async () => {
  const root = await tempDir();
  await fs.writeFile(path.join(root, "PROGRESS.md"), "## Checklist\n- [ ] T1 — x\n\n## Log\n");
  const configPath = path.join(root, "imhelping.json");
  await writeJson(configPath, {
    session: { name: "defaults", workdir: root, progress: "PROGRESS.md", logs: "logs" },
    implementation: { engine: "codex" },
    reviews: [{ key: "review-a", engine: "claude", status: "REVIEWED-A" }],
  });

  const config = await readConfig(configPath);

  assert.equal(path.basename(config.implementation.prompt), "base-implementation.md");
  assert.ok(fsSync.existsSync(config.implementation.prompt));
  assert.equal(path.basename(config.reviews[0].prompt), "base-review.md");
  assert.ok(fsSync.existsSync(config.reviews[0].prompt));
});

test("a bare prompt name resolves against the installed prompts dir", async () => {
  const root = await tempDir();
  await fs.writeFile(path.join(root, "PROGRESS.md"), "## Checklist\n- [ ] T1 — x\n\n## Log\n");
  const configPath = path.join(root, "imhelping.json");
  await writeJson(configPath, {
    session: { name: "bare", workdir: root, progress: "PROGRESS.md", logs: "logs" },
    implementation: { engine: "codex", prompt: "base-verifier" },
    reviews: [],
  });

  const config = await readConfig(configPath);

  assert.equal(path.basename(config.implementation.prompt), "base-verifier.md");
  assert.ok(fsSync.existsSync(config.implementation.prompt));
});

test("init scaffolds a usable config and ledger next to the plan doc", async () => {
  const root = await tempDir();
  const plan = path.join(root, "plan", "BUILD.md");
  await fs.mkdir(path.dirname(plan), { recursive: true });
  await fs.writeFile(plan, "# build it\n");
  const workdir = path.join(root, "checkout");
  await fs.mkdir(workdir);
  const configPath = path.join(root, "session", "imhelping.json");

  const status = await cmdInit(configPath, { plan, workdir, name: "demo" });
  assert.equal(status, 0);

  assert.ok(fsSync.existsSync(configPath));
  assert.ok(fsSync.existsSync(path.join(root, "session", "PROGRESS.md")));

  const config = await readConfig(configPath);
  assert.equal(config.name, "demo");
  assert.equal(config.workdir, workdir);
  assert.deepEqual(config.addDirs, [path.dirname(plan)]);
  assert.equal(config.implementation.engine, "codex");
  assert.equal(path.basename(config.implementation.prompt), "base-implementation.md");
  assert.equal(config.reviews[0].engine, "claude");
  assert.equal(path.basename(config.reviews[0].prompt), "base-review-with-simplify.md");
  assert.ok(fsSync.existsSync(config.reviews[0].prompt));

  // A second init must not clobber an edited ledger.
  await fs.writeFile(path.join(root, "session", "PROGRESS.md"), "edited\n");
  await cmdInit(configPath, { plan, workdir, name: "demo" });
  assert.equal(await fs.readFile(path.join(root, "session", "PROGRESS.md"), "utf8"), "edited\n");
});

test("a no-op stage is retried with a fresh session and then succeeds", async () => {
  const root = await tempDir();
  const progress = path.join(root, "PROGRESS.md");
  await fs.writeFile(progress, "## Checklist\n- [ ] T1 - x\n\n## Log\n");
  await fs.writeFile(path.join(root, "PROMPT.md"), "do it\n");
  const binDir = path.join(root, "bin");
  await fs.mkdir(binDir);
  const state = path.join(root, "noop.once");
  const script = path.join(binDir, "codex");
  // first call: consume prompt, no-op. second call: log a DONE line.
  await fs.writeFile(
    script,
    `#!/usr/bin/env bash
cat >/dev/null
if [ ! -f ${JSON.stringify(state)} ]; then touch ${JSON.stringify(state)}; exit 0; fi
printf '2026-01-01T00:00:00Z T1 abc DONE second try\\n' >> ${JSON.stringify(progress)}
`,
  );
  await fs.chmod(script, 0o755);
  const configPath = path.join(root, "imhelping.json");
  await writeJson(configPath, {
    session: { name: "noop", workdir: root, progress: "PROGRESS.md", logs: "logs" },
    implementation: { engine: "codex", prompt: "PROMPT.md", status: "DONE" },
    reviews: [],
  });
  const oldPath = process.env.PATH || "";
  try {
    process.env.PATH = `${binDir}:${oldPath}`;
    assert.equal(await cmdOnce(await readConfig(configPath)), 0);
    assert.match(await fs.readFile(progress, "utf8"), /T1 abc DONE second try/);
  } finally {
    process.env.PATH = oldPath;
  }
});

test("a stage that exits without logging gets a STUCK safety-net line", async () => {
  const root = await tempDir();
  await fs.writeFile(path.join(root, "PROGRESS.md"), "## Checklist\n- [ ] T1 - x\n\n## Log\n");
  await fs.writeFile(path.join(root, "PROMPT.md"), "do it\n");
  const binDir = path.join(root, "bin");
  await fs.mkdir(binDir);
  const script = path.join(binDir, "codex");
  // fake engine: consume the prompt, exit 0, write nothing to the ledger.
  await fs.writeFile(script, "#!/usr/bin/env bash\ncat >/dev/null\nexit 0\n");
  await fs.chmod(script, 0o755);
  const configPath = path.join(root, "imhelping.json");
  await writeJson(configPath, {
    session: { name: "silent", workdir: root, progress: "PROGRESS.md", logs: "logs" },
    implementation: { engine: "codex", prompt: "PROMPT.md", status: "DONE" },
    reviews: [],
  });
  const oldPath = process.env.PATH || "";
  try {
    process.env.PATH = `${binDir}:${oldPath}`;
    assert.equal(await cmdOnce(await readConfig(configPath)), 3);
    assert.match(
      await fs.readFile(path.join(root, "PROGRESS.md"), "utf8"),
      /T1 — STUCK .*exited without updating the ledger/,
    );
  } finally {
    process.env.PATH = oldPath;
  }
});

test("a pause sentinel stops the loop cleanly without running a stage", async () => {
  const root = await tempDir();
  await fs.writeFile(path.join(root, "PROGRESS.md"), "## Checklist\n- [ ] T1 - x\n\n## Log\n");
  const configPath = path.join(root, "imhelping.json");
  await writeJson(configPath, {
    session: { name: "pause", workdir: root, progress: "PROGRESS.md", logs: "logs" },
    implementation: { engine: "codex" },
    reviews: [],
  });
  const config = await readConfig(configPath);

  await cmdPause(config);
  assert.ok(fsSync.existsSync(config.pauseFile));

  // cmdLoop returns the paused code before spawning any engine (codex is not
  // even on PATH here, so reaching a stage would throw).
  assert.equal(await cmdLoop(config), 14);
  assert.doesNotMatch(await fs.readFile(path.join(root, "PROGRESS.md"), "utf8"), /DONE/);

  await cmdResume(config);
  assert.ok(!fsSync.existsSync(config.pauseFile));
});

for (const engine of ["codex", "claude"]) {
  test(`${engine} usage-limit retry then success`, async () => {
    const root = await tempDir();
    const configPath = await makeConfig(root, engine);
    const binDir = await fakeCli(root, engine);
    const oldPath = process.env.PATH || "";
    const oldState = process.env.TASK_LOOP_FAKE_STATE;
    const oldProgress = process.env.TASK_LOOP_PROGRESS;
    try {
      process.env.PATH = `${binDir}:${oldPath}`;
      process.env.TASK_LOOP_FAKE_STATE = path.join(root, "limited.once");
      process.env.TASK_LOOP_PROGRESS = path.join(root, "PROGRESS.md");

      const status = await cmdOnce(await readConfig(configPath));

      assert.equal(status, 0);
      const progress = await fs.readFile(path.join(root, "PROGRESS.md"), "utf8");
      assert.match(progress, /T1 abc123 DONE fake implementation/);
      const logs = (await fs.readdir(path.join(root, "logs"))).filter((file) =>
        file.startsWith("implementation-"),
      );
      assert.equal(logs.length, 2);
      assert.ok(
        logs.some((file) =>
          fsSync.readFileSync(path.join(root, "logs", file), "utf8").includes("usage limit"),
        ),
      );
    } finally {
      process.env.PATH = oldPath;
      if (oldState === undefined) delete process.env.TASK_LOOP_FAKE_STATE;
      else process.env.TASK_LOOP_FAKE_STATE = oldState;
      if (oldProgress === undefined) delete process.env.TASK_LOOP_PROGRESS;
      else process.env.TASK_LOOP_PROGRESS = oldProgress;
    }
  });
}

test("parseLimitWait reads an absolute clock time as a delta from now", () => {
  // The case that motivated hardening: upstream says "try again at 12:19 PM"
  // while it is 11:55:48 local — the wait must track the quoted time, not fall
  // back to the default hour.
  const now = new Date(2026, 5, 30, 11, 55, 48);
  const result = parseLimitWait(
    "Error: usage limit reached. Please try again at 12:19 PM.",
    now,
  );
  assert.equal(result.source, "clock");
  assert.equal(result.seconds, 23 * 60 + 12); // 11:55:48 -> 12:19:00
});

test("parseLimitWait handles 24-hour clock times", () => {
  const now = new Date(2026, 5, 30, 15, 0, 0);
  const result = parseLimitWait("quota exhausted; try again at 16:19", now);
  assert.equal(result.source, "clock");
  assert.equal(result.seconds, 79 * 60); // 15:00 -> 16:19
});

test("parseLimitWait rolls a clearly-past clock time to tomorrow", () => {
  const now = new Date(2026, 5, 30, 23, 0, 0);
  const result = parseLimitWait("rate limit — available at 6:00 AM", now);
  assert.equal(result.source, "clock");
  assert.equal(result.seconds, 7 * 3600); // 23:00 -> next 06:00
});

test("parseLimitWait treats a just-passed clock time as retry-now", () => {
  const now = new Date(2026, 5, 30, 12, 30, 0);
  const result = parseLimitWait("try again at 12:19 PM", now);
  assert.equal(result.source, "clock");
  assert.equal(result.seconds, 0);
});

test("parseLimitWait reads an absolute timestamp", () => {
  const now = new Date("2026-06-30T16:00:00Z");
  const result = parseLimitWait(
    "429 resource_exhausted, resets at 2026-06-30T16:19:00Z",
    now,
  );
  assert.equal(result.source, "timestamp");
  assert.equal(result.seconds, 19 * 60);
});

test("parseLimitWait sums combined relative durations", () => {
  const result = parseLimitWait("usage limit, try again in 1h30m");
  assert.equal(result.source, "duration");
  assert.equal(result.seconds, 90 * 60);
});

test("parseLimitWait reads a bare Retry-After as seconds", () => {
  const result = parseLimitWait("HTTP 429 Too Many Requests\nRetry-After: 120");
  assert.equal(result.source, "retry-after");
  assert.equal(result.seconds, 120);
});

test("parseLimitWait does not mistake unrelated numbers for a wait", () => {
  const result = parseLimitWait("You have 5 requests left this minute.");
  assert.equal(result.source, "default");
  assert.equal(result.seconds, null);
});

test("formatDuration renders a human-readable span", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(90), "1m30s");
  assert.equal(formatDuration(5400), "1h30m0s");
});

test("engine stdin names this session's ledger ahead of the prompt body", async () => {
  const root = await tempDir();
  const progress = path.join(root, "PROGRESS.md");
  await fs.writeFile(progress, "## Checklist\n- [ ] T1 - x\n\n## Log\n");
  await fs.writeFile(path.join(root, "PROMPT.md"), "BODY-MARKER do it\n");
  const binDir = path.join(root, "bin");
  await fs.mkdir(binDir);
  const capture = path.join(root, "captured-stdin.txt");
  const script = path.join(binDir, "codex");
  // fake engine: capture the full prompt stream, then log a DONE line.
  await fs.writeFile(
    script,
    `#!/usr/bin/env bash
cat > ${JSON.stringify(capture)}
printf '2026-01-01T00:00:00Z T1 abc DONE captured\\n' >> ${JSON.stringify(progress)}
`,
  );
  await fs.chmod(script, 0o755);
  const configPath = path.join(root, "imhelping.json");
  await writeJson(configPath, {
    session: { name: "preamble", workdir: root, progress: "PROGRESS.md", logs: "logs" },
    implementation: { engine: "codex", prompt: "PROMPT.md", status: "DONE" },
    reviews: [],
  });
  const oldPath = process.env.PATH || "";
  try {
    process.env.PATH = `${binDir}:${oldPath}`;
    assert.equal(await cmdOnce(await readConfig(configPath)), 0);
    const stdin = await fs.readFile(capture, "utf8");
    // the resolved (absolute) ledger path is named authoritatively...
    assert.match(stdin, new RegExp(`ledger is the file at: ${progress.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    // ...ahead of the bundled prompt body, which is still delivered.
    assert.match(stdin, /BODY-MARKER do it/);
    assert.ok(
      stdin.indexOf(progress) < stdin.indexOf("BODY-MARKER"),
      "session context must precede the prompt body",
    );
  } finally {
    process.env.PATH = oldPath;
  }
});

test("a self-declared STUCK is retried then halts instead of spinning", async () => {
  const root = await tempDir();
  const progress = path.join(root, "PROGRESS.md");
  await fs.writeFile(progress, "## Checklist\n- [ ] T1 - x\n\n## Log\n");
  await fs.writeFile(path.join(root, "PROMPT.md"), "do it\n");
  const binDir = path.join(root, "bin");
  await fs.mkdir(binDir);
  const script = path.join(binDir, "codex");
  // fake engine: always log a STUCK for T1 and leave it unchecked, like an agent
  // that hit a blocker (e.g. a dirty worktree) and stopped before editing.
  await fs.writeFile(
    script,
    `#!/usr/bin/env bash
cat >/dev/null
printf '2026-01-01T00:00:00Z T1 — STUCK baseline already red\\n' >> ${JSON.stringify(progress)}
`,
  );
  await fs.chmod(script, 0o755);
  const configPath = path.join(root, "imhelping.json");
  await writeJson(configPath, {
    session: { name: "stuck", workdir: root, progress: "PROGRESS.md", logs: "logs" },
    implementation: { engine: "codex", prompt: "PROMPT.md", status: "DONE" },
    reviews: [],
  });
  const oldPath = process.env.PATH || "";
  try {
    process.env.PATH = `${binDir}:${oldPath}`;
    // Halts (3) rather than reporting the STUCK append as success.
    assert.equal(await cmdOnce(await readConfig(configPath)), 3);
    const ledger = await fs.readFile(progress, "utf8");
    // Bounded: one retry (noProgressRetryMax default 1) then stop — not a spin.
    assert.equal((ledger.match(/STUCK baseline already red/g) || []).length, 2);
    // The agent's own STUCK is descriptive, so no engine safety-net line is piled on.
    assert.doesNotMatch(ledger, /exited without updating the ledger/);
    // The item stays open for a human to unblock.
    assert.match(ledger, /- \[ \] T1/);
  } finally {
    process.env.PATH = oldPath;
  }
});
