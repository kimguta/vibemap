import { createServer } from "node:http";
import { readFile, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const dbPath = join(__dirname, "data", "vibemap-db.json");
const port = Number(process.env.PORT || 8788);
let memoryDb = null;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

async function loadDb() {
  if (!memoryDb) {
    memoryDb = JSON.parse(await readFile(dbPath, "utf8"));
  }
  return memoryDb;
}

async function saveDb(db) {
  memoryDb = db;
  try {
    await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn(`Vibemap dev server is using memory storage only: ${error.code || error.message}`);
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(payload));
}

function ok(res, data) {
  sendJson(res, 200, { ok: true, data });
}

function fail(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function regionByName(db, name) {
  return db.regions.find((region) => region.name === name || region.id === name);
}

function getQuestion(db, questionId) {
  if (questionId) return db.questions.find((question) => question.id === questionId);
  return db.questions.find((question) => question.status === "active") || db.questions[0];
}

function snapshotKey(snapshot) {
  return `${snapshot.questionId}:${snapshot.period}:${snapshot.regionId}`;
}

function baseSnapshots(db, questionId, period) {
  return db.snapshots.filter((snapshot) => snapshot.questionId === questionId && snapshot.period === period);
}

function applyChoiceDeltas(snapshots, db, questionId, period) {
  const byKey = new Map(snapshots.map((snapshot) => [snapshotKey(snapshot), { ...snapshot }]));
  for (const choice of db.choices) {
    if (choice.questionId !== questionId || choice.period !== period) continue;
    const key = `${choice.questionId}:${choice.period}:${choice.regionId}`;
    const snapshot = byKey.get(key);
    if (!snapshot) continue;

    snapshot[choice.choiceId] = (snapshot[choice.choiceId] || 0) + 1;
    byKey.set(key, snapshot);
  }
  return Array.from(byKey.values());
}

function decorateSnapshot(snapshot, db) {
  const region = db.regions.find((item) => item.id === snapshot.regionId);
  const blue = snapshot.blue || 0;
  const red = snapshot.red || 0;
  const gray = snapshot.gray || 0;
  const total = blue + red + gray;
  const decided = Math.max(0, total - gray);
  const gapCount = Math.abs(blue - red);
  const gapPercent = decided > 0 ? (gapCount / decided) * 100 : 0;
  let leadingChoice = "gray";

  if (total >= 50) {
    if (gapPercent <= 3) leadingChoice = "tie";
    else leadingChoice = blue > red ? "blue" : "red";
  }

  return {
    regionId: snapshot.regionId,
    name: region?.name || snapshot.regionId,
    period: snapshot.period,
    counts: { blue, red, gray },
    total,
    leadingChoice,
    gapPercent: Number(gapPercent.toFixed(1)),
    updatedAt: new Date().toISOString()
  };
}

function makeParticipantId(req) {
  const raw = `${req.headers["user-agent"] || ""}:${req.socket.remoteAddress || ""}`;
  return `weak-${createHash("sha256").update(raw).digest("hex").slice(0, 24)}`;
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  const db = await loadDb();

  if (url.pathname === "/api/health") {
    return ok(res, { status: "ready", service: "vibemap", time: new Date().toISOString() });
  }

  if (url.pathname === "/api/questions" && req.method === "GET") {
    return ok(res, db.questions);
  }

  if (url.pathname === "/api/questions/current" && req.method === "GET") {
    return ok(res, getQuestion(db));
  }

  if (url.pathname === "/api/me/location" && req.method === "GET") {
    return ok(res, {
      nation: regionByName(db, "전국"),
      province: regionByName(db, "경기"),
      city: regionByName(db, "수원시")
    });
  }

  if (url.pathname === "/api/me/identity" && req.method === "GET") {
    return ok(res, { participantId: makeParticipantId(req), strength: "weak-browser-ip" });
  }

  if (url.pathname === "/api/me/choice" && req.method === "GET") {
    const questionId = url.searchParams.get("questionId") || getQuestion(db)?.id;
    const participantId = url.searchParams.get("participantId") || makeParticipantId(req);
    const regionName = url.searchParams.get("region") || "수원시";
    const region = regionByName(db, regionName);
    if (!region) return fail(res, 400, "INVALID_REGION", "유효하지 않은 지역입니다.");
    const choice = db.choices.find((item) => (
      item.questionId === questionId &&
      item.participantId === participantId &&
      item.regionId === region.id
    ));
    return ok(res, choice || { questionId, participantId, regionId: region.id, choiceId: null, updatedAt: null });
  }

  if (url.pathname === "/api/summary" && req.method === "GET") {
    const question = getQuestion(db, url.searchParams.get("questionId"));
    const period = url.searchParams.get("period") || "7d";
    const scopeRegion = regionByName(db, url.searchParams.get("scopeRegion") || "경기");
    if (!question) return fail(res, 404, "QUESTION_NOT_FOUND", "질문을 찾을 수 없습니다.");
    const snapshots = applyChoiceDeltas(baseSnapshots(db, question.id, period), db, question.id, period)
      .map((snapshot) => decorateSnapshot(snapshot, db));
    const nationalTotal = snapshots
      .filter((snapshot) => db.regions.find((region) => region.id === snapshot.regionId)?.level === "province")
      .reduce((sum, snapshot) => sum + snapshot.total, 0);
    const local = snapshots.find((snapshot) => snapshot.regionId === scopeRegion?.id);
    return ok(res, {
      questionId: question.id,
      period,
      nationalTotal,
      localLabel: `${scopeRegion?.name || "지역"} 참여`,
      localTotal: local?.total || 0,
      closeRegionsCount: snapshots.filter((snapshot) => snapshot.leadingChoice === "tie").length,
      lowVolumeRegionsCount: snapshots.filter((snapshot) => snapshot.total < 50).length,
      updatedAt: new Date().toISOString()
    });
  }

  if (url.pathname === "/api/map" && req.method === "GET") {
    const question = getQuestion(db, url.searchParams.get("questionId"));
    const period = url.searchParams.get("period") || "7d";
    const regionName = url.searchParams.get("region") || "전국";
    const region = regionByName(db, regionName);
    if (!question) return fail(res, 404, "QUESTION_NOT_FOUND", "질문을 찾을 수 없습니다.");
    if (!region) return fail(res, 400, "INVALID_REGION", "유효하지 않은 지역입니다.");

    const regionIds = region.level === "nation"
      ? db.regions.filter((item) => item.level === "province").map((item) => item.id)
      : db.regions.filter((item) => item.parentId === region.id).map((item) => item.id);

    const snapshots = applyChoiceDeltas(baseSnapshots(db, question.id, period), db, question.id, period)
      .filter((snapshot) => regionIds.includes(snapshot.regionId))
      .map((snapshot) => decorateSnapshot(snapshot, db));

    return ok(res, { question, region, period, items: snapshots });
  }

  if (url.pathname === "/api/choices" && req.method === "POST") {
    const body = await readBody(req);
    const question = getQuestion(db, body.questionId);
    const region = regionByName(db, body.region || body.regionName || "수원시");
    const participantId = body.participantId || makeParticipantId(req);
    const period = body.period || "7d";
    const validChoices = new Set(["blue", "red", "gray"]);

    if (!question) return fail(res, 404, "QUESTION_NOT_FOUND", "질문을 찾을 수 없습니다.");
    if (!region) return fail(res, 400, "INVALID_REGION", "유효하지 않은 지역입니다.");
    if (!validChoices.has(body.choiceId)) return fail(res, 400, "INVALID_CHOICE", "유효하지 않은 선택입니다.");

    const now = new Date().toISOString();
    let participant = db.participants.find((item) => item.id === participantId);
    if (!participant) {
      participant = {
        id: participantId,
        firstSeenAt: now,
        lastSeenAt: now,
        userAgent: req.headers["user-agent"] || "",
        ipHash: makeParticipantId(req)
      };
      db.participants.push(participant);
    } else {
      participant.lastSeenAt = now;
    }

    const existing = db.choices.find((item) => (
      item.questionId === question.id &&
      item.participantId === participantId &&
      item.regionId === region.id &&
      item.period === period
    ));
    const previousChoiceId = existing?.choiceId || null;

    if (existing) {
      existing.previousChoiceId = previousChoiceId;
      existing.choiceId = body.choiceId;
      existing.updatedAt = now;
    } else {
      db.choices.push({
        id: randomUUID(),
        questionId: question.id,
        participantId,
        regionId: region.id,
        period,
        previousChoiceId,
        choiceId: body.choiceId,
        createdAt: now,
        updatedAt: now
      });
    }

    db.events.push({
      id: randomUUID(),
      questionId: question.id,
      participantId,
      regionId: region.id,
      period,
      previousChoiceId,
      choiceId: body.choiceId,
      createdAt: now,
      source: "web"
    });

    await saveDb(db);
    return ok(res, {
      questionId: question.id,
      participantId,
      regionId: region.id,
      period,
      previousChoiceId,
      choiceId: body.choiceId,
      updatedAt: now
    });
  }

  return fail(res, 404, "NOT_FOUND", "API 경로를 찾을 수 없습니다.");
}

async function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/minsimp-map-prototype.html" : decodeURIComponent(url.pathname);
  const candidate = normalize(join(projectRoot, pathname));
  if (!candidate.startsWith(projectRoot)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const fileStat = await stat(candidate);
    if (!fileStat.isFile()) throw new Error("not file");
    res.writeHead(200, { "content-type": contentTypes[extname(candidate)] || "application/octet-stream" });
    createReadStream(candidate).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `127.0.0.1:${port}`}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    fail(res, 500, "SERVER_ERROR", error.message || "서버 오류가 발생했습니다.");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Vibemap server ready: http://127.0.0.1:${port}/minsimp-map-prototype.html`);
});
