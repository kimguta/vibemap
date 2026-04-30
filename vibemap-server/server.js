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
const host = process.env.HOST || "0.0.0.0";
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
let memoryDb = null;
const rateLimits = new Map();
const choiceCooldownMs = 3000;
const reactionCooldownMs = 30000;

function hasSupabase() {
  return Boolean(supabaseUrl && supabaseKey);
}

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

async function supabaseRequest(path, options = {}) {
  if (!hasSupabase()) throw new Error("Supabase is not configured");
  const response = await fetch(`${supabaseUrl}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: supabaseKey,
      authorization: `Bearer ${supabaseKey}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${response.status}: ${body}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
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

function checkRateLimit(key, cooldownMs) {
  const now = Date.now();
  const lastAt = rateLimits.get(key) || 0;
  const retryAfterMs = cooldownMs - (now - lastAt);
  if (retryAfterMs > 0) {
    return {
      allowed: false,
      retryAfterMs,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000)
    };
  }
  rateLimits.set(key, now);
  return { allowed: true, retryAfterMs: 0, retryAfterSeconds: 0 };
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

function applyChoiceRows(snapshots, rows, questionId, period) {
  const byKey = new Map(snapshots.map((snapshot) => [snapshotKey(snapshot), { ...snapshot }]));
  for (const row of rows) {
    const rowQuestionId = row.questionId || row.question_id;
    const rowPeriod = row.period;
    const regionId = row.regionId || row.region_id;
    const choiceId = toClientChoice(row.choiceId || row.choice_id);
    if (rowQuestionId !== questionId || rowPeriod !== period) continue;
    const key = `${questionId}:${period}:${regionId}`;
    const snapshot = byKey.get(key);
    if (!snapshot) continue;

    snapshot[choiceId] = (snapshot[choiceId] || 0) + 1;
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

function toApiChoice(choiceId) {
  return choiceId === "gray" ? "undecided" : choiceId;
}

function toClientChoice(choiceId) {
  return choiceId === "undecided" ? "gray" : choiceId;
}

async function upsertSupabaseChoice({ req, question, region, period, participantId, choiceId }) {
  const now = new Date().toISOString();
  await supabaseRequest("/participants?on_conflict=id", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      id: participantId,
      user_agent: req.headers["user-agent"] || "",
      ip_hash: makeParticipantId(req),
      last_seen_at: now
    })
  });

  const existing = await supabaseRequest(
    `/participant_choices?question_id=eq.${encodeURIComponent(question.id)}&participant_id=eq.${encodeURIComponent(participantId)}&region_id=eq.${encodeURIComponent(region.id)}&period=eq.${encodeURIComponent(period)}&select=choice_id`
  );
  const previousChoiceId = existing?.[0]?.choice_id ? toClientChoice(existing[0].choice_id) : null;
  const dbChoiceId = toApiChoice(choiceId);

  await supabaseRequest("/participant_choices?on_conflict=question_id,participant_id,region_id,period", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      question_id: question.id,
      participant_id: participantId,
      region_id: region.id,
      period,
      choice_id: dbChoiceId,
      updated_at: now
    })
  });

  await supabaseRequest("/choice_events", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      question_id: question.id,
      participant_id: participantId,
      region_id: region.id,
      period,
      previous_choice_id: previousChoiceId ? toApiChoice(previousChoiceId) : null,
      choice_id: dbChoiceId,
      source: "web"
    })
  });

  return { previousChoiceId, updatedAt: now };
}

async function getSupabaseReactions(limit = 6) {
  const rows = await supabaseRequest(
    `/reactions?select=text,region_name,choice_label,created_at&order=created_at.desc&limit=${limit}`
  );
  return rows.map((row) => ({
    text: row.text,
    region: row.region_name,
    choice: row.choice_label,
    createdAt: row.created_at
  }));
}

async function insertSupabaseReaction({ questionId, participantId, regionName, choiceLabel, text }) {
  const cleanText = text.trim().replace(/\s+/g, " ").slice(0, 36);
  if (!cleanText) throw new Error("Reaction text is empty");
  await supabaseRequest("/reactions", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      question_id: questionId,
      participant_id: participantId,
      region_name: regionName,
      choice_label: choiceLabel,
      text: cleanText
    })
  });
}

async function getSupabaseSummary(questionId, period, scopeRegionId) {
  const rows = await supabaseRequest(
    `/participant_choices?question_id=eq.${encodeURIComponent(questionId)}&period=eq.${encodeURIComponent(period)}&select=region_id,choice_id`
  );
  const nationalTotal = rows.length;
  const localTotal = rows.filter((row) => row.region_id === scopeRegionId).length;
  const byRegion = new Map();

  for (const row of rows) {
    const counts = byRegion.get(row.region_id) || { blue: 0, red: 0, undecided: 0 };
    if (row.choice_id === "blue") counts.blue += 1;
    else if (row.choice_id === "red") counts.red += 1;
    else counts.undecided += 1;
    byRegion.set(row.region_id, counts);
  }

  let closeRegionsCount = 0;
  let lowVolumeRegionsCount = 0;
  for (const counts of byRegion.values()) {
    const decided = counts.blue + counts.red;
    const total = decided + counts.undecided;
    const gapPercent = decided > 0 ? Math.abs(counts.blue - counts.red) / decided * 100 : 0;
    if (decided > 0 && gapPercent <= 3) closeRegionsCount += 1;
    if (total < 50) lowVolumeRegionsCount += 1;
  }

  return {
    nationalTotal,
    localTotal,
    closeRegionsCount,
    lowVolumeRegionsCount
  };
}

async function getSupabaseSnapshots(db, questionId, period) {
  const rows = await supabaseRequest(
    `/participant_choices?question_id=eq.${encodeURIComponent(questionId)}&period=eq.${encodeURIComponent(period)}&select=region_id,choice_id,question_id,period`
  );
  return applyChoiceRows(baseSnapshots(db, questionId, period), rows, questionId, period)
    .map((snapshot) => decorateSnapshot(snapshot, db));
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  const db = await loadDb();

  if (url.pathname === "/api/health") {
    return ok(res, {
      status: "ready",
      service: "picked",
      storage: hasSupabase() ? "supabase" : "local-json",
      time: new Date().toISOString()
    });
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

    if (hasSupabase()) {
      const snapshots = await getSupabaseSnapshots(db, question.id, period);
      const liveSummary = await getSupabaseSummary(question.id, period, scopeRegion?.id);
      const atmosphereTotal = snapshots
        .filter((snapshot) => db.regions.find((region) => region.id === snapshot.regionId)?.level === "province")
        .reduce((sum, snapshot) => sum + snapshot.total, 0);
      const local = snapshots.find((snapshot) => snapshot.regionId === scopeRegion?.id);
      return ok(res, {
        questionId: question.id,
        period,
        nationalTotal: liveSummary.nationalTotal,
        liveTotal: liveSummary.nationalTotal,
        atmosphereTotal,
        localLabel: `${scopeRegion?.name || "지역"} 흐름`,
        localTotal: liveSummary.localTotal,
        localTrendLabel: local?.leadingChoice === "blue"
          ? "짜장면 강세"
          : local?.leadingChoice === "red"
            ? "짬뽕 강세"
            : local?.leadingChoice === "tie"
              ? "팽팽함"
              : "선택 적음",
        closeRegionsCount: snapshots.filter((snapshot) => snapshot.leadingChoice === "tie").length,
        lowVolumeRegionsCount: snapshots.filter((snapshot) => snapshot.total < 50).length,
        storage: "supabase",
        updatedAt: new Date().toISOString()
      });
    }

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

    const snapshots = hasSupabase()
      ? (await getSupabaseSnapshots(db, question.id, period)).filter((snapshot) => regionIds.includes(snapshot.regionId))
      : applyChoiceDeltas(baseSnapshots(db, question.id, period), db, question.id, period)
        .filter((snapshot) => regionIds.includes(snapshot.regionId))
        .map((snapshot) => decorateSnapshot(snapshot, db));

    return ok(res, { question, region, period, items: snapshots, storage: hasSupabase() ? "supabase" : "local-json" });
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

    const choiceLimit = checkRateLimit(`choice:${participantId}:${question.id}`, choiceCooldownMs);
    if (!choiceLimit.allowed) {
      return fail(res, 429, "RATE_LIMITED", `${choiceLimit.retryAfterSeconds}초 후 다시 선택해 주세요.`);
    }

    const now = new Date().toISOString();

    if (hasSupabase()) {
      const result = await upsertSupabaseChoice({
        req,
        question,
        region,
        period,
        participantId,
        choiceId: body.choiceId
      });
      return ok(res, {
        questionId: question.id,
        participantId,
        regionId: region.id,
        period,
        previousChoiceId: result.previousChoiceId,
        choiceId: body.choiceId,
        updatedAt: result.updatedAt,
        storage: "supabase"
      });
    }

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

  if (url.pathname === "/api/reactions" && req.method === "GET") {
    if (hasSupabase()) {
      return ok(res, await getSupabaseReactions(Number(url.searchParams.get("limit") || 6)));
    }

    const reactions = db.reactions || [];
    return ok(res, reactions.slice(-Number(url.searchParams.get("limit") || 6)).reverse());
  }

  if (url.pathname === "/api/reactions" && req.method === "POST") {
    const body = await readBody(req);
    const question = getQuestion(db, body.questionId);
    const participantId = body.participantId || makeParticipantId(req);
    const regionName = String(body.region || "전국").slice(0, 32);
    const choiceLabel = String(body.choice || "선택 전").slice(0, 20);
    const text = String(body.text || "").trim().replace(/\s+/g, " ").slice(0, 36);

    if (!question) return fail(res, 404, "QUESTION_NOT_FOUND", "질문을 찾을 수 없습니다.");
    if (!text) return fail(res, 400, "EMPTY_REACTION", "반응 내용을 입력해 주세요.");

    const reactionLimit = checkRateLimit(`reaction:${participantId}:${question.id}`, reactionCooldownMs);
    if (!reactionLimit.allowed) {
      return fail(res, 429, "RATE_LIMITED", `${reactionLimit.retryAfterSeconds}초 후 다시 남겨주세요.`);
    }

    if (hasSupabase()) {
      await insertSupabaseReaction({
        questionId: question.id,
        participantId,
        regionName,
        choiceLabel,
        text
      });
      return ok(res, await getSupabaseReactions(6));
    }

    const reaction = {
      id: randomUUID(),
      questionId: question.id,
      participantId,
      region: regionName,
      choice: choiceLabel,
      text,
      createdAt: new Date().toISOString()
    };
    db.reactions = db.reactions || [];
    db.reactions.push(reaction);
    db.reactions = db.reactions.slice(-100);
    await saveDb(db);
    return ok(res, db.reactions.slice(-6).reverse());
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

server.listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.log(`picked server ready: http://${displayHost}:${port}/minsimp-map-prototype.html`);
});
