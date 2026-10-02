const SESSION_TTL = 1000 * 60 * 60 * 24 * 30;
const PRESENCE_TTL = 1000 * 45;
const ROOM_TTL = 1000 * 60 * 10;

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function response(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...extra } });
}

function fail(message, status = 400) { return response({ error: message }, status); }

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function cookie(request, name) {
  const header = request.headers.get("cookie") || "";
  const found = header.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : "";
}

function setSessionCookie(token, maxAge = SESSION_TTL / 1000) {
  return { "set-cookie": `cw_session=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax` };
}

function clearSessionCookie() {
  return { "set-cookie": "cw_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax" };
}

function randomToken(bytes = 24) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return [...data].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function digest(value) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function passwordHash(password, salt) { return digest(`${salt}:${password}`); }

function now() { return Date.now(); }

function baseState(username) {
  return {
    profile: { username },
    resources: { coins: 1000, food: 12, soap: 5, medicine: 3 },
    cats: [
      { id: "luna", name: "露娜", breed: "月影 · SR", emoji: "🐈‍⬛", hp: 100, happy: 86, clean: 80, level: 4 },
      { id: "momo", name: "糯米", breed: "奶油 · R", emoji: "🐱", hp: 100, happy: 90, clean: 91, level: 2 }
    ],
    selectedCat: "luna",
    loadout: { weapon: "星尘爪", weaponEmoji: "🪄", armor: "云朵护甲", armorEmoji: "🛡️", catId: "luna" },
    codex: { unlocked: 2, total: 32 },
    achievements: { wins: 0, visits: 0 },
    apiConfig: { provider: "猫猫世界", configured: false }
  };
}

function mergeState(current, incoming, username) {
  const source = incoming && typeof incoming === "object" ? incoming : {};
  return {
    ...current,
    ...source,
    profile: { ...(current.profile || {}), ...(source.profile || {}), username },
    resources: { ...(current.resources || {}), ...(source.resources || {}) },
    loadout: { ...(current.loadout || {}), ...(source.loadout || {}) },
    codex: { ...(current.codex || {}), ...(source.codex || {}) },
    achievements: { ...(current.achievements || {}), ...(source.achievements || {}) },
    cats: Array.isArray(source.cats) && source.cats.length ? source.cats : current.cats
  };
}

async function userFor(request, env) {
  const token = cookie(request, "cw_session");
  if (!token) return null;
  const row = await env.DB.prepare("SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?1").bind(token).first();
  if (!row) return null;
  if (row.expires_at < now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?1").bind(token).run();
    return null;
  }
  return { id: row.id, username: row.username, token };
}

async function stateFor(user, env) {
  const row = await env.DB.prepare("SELECT state_json FROM player_state WHERE user_id = ?1").bind(user.id).first();
  if (!row) return baseState(user.username);
  try { return mergeState(baseState(user.username), JSON.parse(row.state_json), user.username); } catch { return baseState(user.username); }
}

async function createSession(userId, env) {
  const token = randomToken(32);
  const timestamp = now();
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)").bind(token, userId, timestamp + SESSION_TTL, timestamp).run();
  return token;
}

async function cleanup(env) {
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(timestamp),
    env.DB.prepare("UPDATE rooms SET status = 'CANCELLED', updated_at = ?1 WHERE status IN ('INVITED', 'PICKS') AND updated_at < ?2").bind(timestamp, timestamp - ROOM_TTL)
  ]);
}

async function requireUser(request, env) {
  const user = await userFor(request, env);
  return user || { error: fail("请先登录", 401) };
}

async function roomFor(id, user, env) {
  const row = await env.DB.prepare("SELECT * FROM rooms WHERE id = ?1 AND (challenger_id = ?2 OR opponent_id = ?2)").bind(id, user.id).first();
  if (!row) return null;
  let state = {};
  try { state = JSON.parse(row.state_json); } catch {}
  return { ...row, state };
}

function publicRoom(room, user) {
  const opponentId = room.challenger_id === user.id ? room.opponent_id : room.challenger_id;
  return { id: room.id, mode: room.mode, status: room.status, challengerId: room.challenger_id, opponentId, seed: room.seed, state: room.state, createdAt: room.created_at, updatedAt: room.updated_at };
}

function hashNumber(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function damage(seed, step, action, actor) {
  const value = hashNumber(`${seed}:${step}:${action}:${actor}`);
  const roll = value / 4294967296;
  if (action === "defend" || action === "shield") return { amount: Math.floor(4 + roll * 5), guard: 0.55, label: action === "shield" ? "展开护盾" : "进入防御" };
  if (action === "skill") return { amount: 20 + Math.floor(roll * 16), guard: 0, label: "释放星尘技能" };
  if (action === "reload") return { amount: 0, guard: 0.1, label: "完成换弹" };
  return { amount: 13 + Math.floor(roll * 16), guard: 0, label: action === "fire" ? "命中开火" : "发动爪击" };
}

async function settle(env, room, game, winnerId, loserId) {
  const winnerRow = await env.DB.prepare("SELECT state_json FROM player_state WHERE user_id = ?1").bind(winnerId).first();
  const loserRow = await env.DB.prepare("SELECT state_json FROM player_state WHERE user_id = ?1").bind(loserId).first();
  const winner = winnerRow ? JSON.parse(winnerRow.state_json) : baseState("player");
  const loser = loserRow ? JSON.parse(loserRow.state_json) : baseState("player");
  winner.resources = { ...(winner.resources || {}), coins: Number(winner.resources?.coins || 0) + 220, food: Number(winner.resources?.food || 0) + 2 };
  loser.resources = { ...(loser.resources || {}), coins: Math.max(0, Number(loser.resources?.coins || 0) - 160) };
  const loserCatId = loser.loadout?.catId || loser.selectedCat || "luna";
  loser.cats = (loser.cats || []).map(cat => cat.id === loserCatId ? { ...cat, hp: Math.max(25, Number(cat.hp || 100) - 8) } : cat);
  winner.achievements = { ...(winner.achievements || {}), wins: Number(winner.achievements?.wins || 0) + 1 };
  game.result = { winnerId, loserId, rewards: { winner: ["🪙 +220 金币", "🍣 +2 猫粮", "✨ 星尘碎片 ×1"], loser: ["🪙 -160 金币", "💥 猫猫生命 -8"] } };
  await env.DB.batch([
    env.DB.prepare("UPDATE player_state SET state_json = ?1, updated_at = ?2 WHERE user_id = ?3").bind(JSON.stringify(winner), now(), winnerId),
    env.DB.prepare("UPDATE player_state SET state_json = ?1, updated_at = ?2 WHERE user_id = ?3").bind(JSON.stringify(loser), now(), loserId),
    env.DB.prepare("UPDATE rooms SET status = 'FINISHED', state_json = ?1, updated_at = ?2 WHERE id = ?3").bind(JSON.stringify(room.state), now(), room.id)
  ]);
}

async function api(request, env) {
  await cleanup(env);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (path === "/api/health" && method === "GET") return response({ ok: true, service: "catworld-copy", time: now() });

  if (path === "/api/auth/register" && method === "POST") {
    const body = await readBody(request);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,20}$/.test(username)) return fail("用户名需为 2-20 位中文、字母、数字或下划线");
    if (password.length < 6) return fail("密码至少 6 位");
    const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?1 COLLATE NOCASE").bind(username).first();
    if (existing) return fail("用户名已存在", 409);
    const id = crypto.randomUUID();
    const salt = randomToken(16);
    const hash = await passwordHash(password, salt);
    const timestamp = now();
    const state = baseState(username);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, username, password_hash, password_salt, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(id, username, hash, salt, timestamp),
      env.DB.prepare("INSERT INTO player_state (user_id, state_json, updated_at) VALUES (?1, ?2, ?3)").bind(id, JSON.stringify(state), timestamp),
      env.DB.prepare("INSERT INTO presence (user_id, scene, status, last_seen, updated_at) VALUES (?1, '/', '在线', ?2, ?2)").bind(id, timestamp)
    ]);
    const token = await createSession(id, env);
    return response({ user: { id, username }, state }, 201, setSessionCookie(token));
  }

  if (path === "/api/auth/login" && method === "POST") {
    const body = await readBody(request);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const row = await env.DB.prepare("SELECT id, username, password_hash, password_salt FROM users WHERE username = ?1 COLLATE NOCASE").bind(username).first();
    if (!row || await passwordHash(password, row.password_salt) !== row.password_hash) return fail("用户名或密码错误", 401);
    const token = await createSession(row.id, env);
    return response({ user: { id: row.id, username: row.username }, state: await stateFor({ id: row.id, username: row.username }, env) }, 200, setSessionCookie(token));
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const token = cookie(request, "cw_session");
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?1").bind(token).run();
    return response({ ok: true }, 200, clearSessionCookie());
  }

  const user = await requireUser(request, env);
  if (user.error) return user.error;

  if (path === "/api/me" && method === "GET") return response({ user: { id: user.id, username: user.username }, state: await stateFor(user, env) });

  if (path === "/api/state" && method === "PUT") {
    const body = await readBody(request);
    const state = mergeState(await stateFor(user, env), body.state || body, user.username);
    await env.DB.prepare("INSERT INTO player_state (user_id, state_json, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at").bind(user.id, JSON.stringify(state), now()).run();
    return response({ state });
  }

  if (path === "/api/presence" && method === "POST") {
    const body = await readBody(request);
    const scene = String(body.scene || "/").slice(0, 32);
    const status = String(body.status || "在线").slice(0, 32);
    await env.DB.prepare("INSERT INTO presence (user_id, scene, status, last_seen, updated_at) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT(user_id) DO UPDATE SET scene=excluded.scene, status=excluded.status, last_seen=excluded.last_seen, updated_at=excluded.updated_at").bind(user.id, scene, status, now()).run();
    return response({ ok: true });
  }

  if (path === "/api/players" && method === "GET") {
    const rows = await env.DB.prepare("SELECT u.id, u.username, p.scene, p.status, p.last_seen FROM users u LEFT JOIN presence p ON p.user_id = u.id WHERE u.id != ?1 AND p.last_seen > ?2 ORDER BY p.last_seen DESC LIMIT 50").bind(user.id, now() - PRESENCE_TTL).all();
    return response({ players: (rows.results || []).map(row => ({ id: row.id, username: row.username, scene: row.scene || "/", status: row.status || "在线", lastSeen: row.last_seen })) });
  }

  const roomMatch = path.match(/^\/api\/rooms\/([^/]+)(?:\/(accept|decline|pick|ready|action))?$/);
  if (path === "/api/rooms" && method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM rooms WHERE (challenger_id = ?1 OR opponent_id = ?1) AND status != 'CANCELLED' ORDER BY updated_at DESC LIMIT 30").bind(user.id).all();
    return response({ rooms: (rows.results || []).map(row => { let state = {}; try { state = JSON.parse(row.state_json); } catch {} return publicRoom({ ...row, state }, user); }) });
  }

  if (path === "/api/rooms" && method === "POST") {
    const body = await readBody(request);
    const mode = body.mode === "shoot" ? "shoot" : body.mode === "ft" ? "ft" : null;
    const opponentId = String(body.opponentId || "");
    if (!mode || !opponentId || opponentId === user.id) return fail("房间参数无效");
    const opponent = await env.DB.prepare("SELECT id, username FROM users WHERE id = ?1").bind(opponentId).first();
    if (!opponent) return fail("对手不存在", 404);
    const id = `${mode.toUpperCase()}-${randomToken(5).toUpperCase()}`;
    const timestamp = now();
    const state = { picks: {}, ready: {}, game: null, log: [`${user.username} 向 ${opponent.username} 发起挑战。`] };
    await env.DB.prepare("INSERT INTO rooms (id, mode, challenger_id, opponent_id, status, state_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'INVITED', ?5, ?6, ?6)").bind(id, mode, user.id, opponentId, JSON.stringify(state), timestamp).run();
    return response({ room: { id, mode, status: "INVITED" } }, 201);
  }

  if (roomMatch && method === "POST") {
    const room = await roomFor(roomMatch[1], user, env);
    if (!room) return fail("房间不存在或无权访问", 404);
    const action = roomMatch[2];
    if (action === "accept") {
      if (room.opponent_id !== user.id || room.status !== "INVITED") return fail("当前不能接受此房间", 409);
      room.status = "PICKS"; room.state.log = [`${user.username} 已接受挑战，进入 PICKS。`, ...(room.state.log || [])];
    } else if (action === "decline") {
      if (room.challenger_id !== user.id && room.opponent_id !== user.id) return fail("无权操作", 403);
      room.status = "CANCELLED";
    } else if (action === "pick") {
      if (room.status !== "PICKS") return fail("当前不在 PICKS 阶段", 409);
      const body = await readBody(request);
      room.state.picks[user.id] = { catId: String(body.catId || "luna"), weapon: String(body.weapon || "星尘爪"), armor: String(body.armor || "云朵护甲") };
    } else if (action === "ready") {
      if (room.status !== "PICKS") return fail("当前不在 PICKS 阶段", 409);
      room.state.ready[user.id] = true;
      const bothReady = room.state.ready[room.challenger_id] && room.state.ready[room.opponent_id];
      if (bothReady) {
        room.status = "BATTLE";
        room.seed = randomToken(16);
        room.state.game = { turn: room.challenger_id, step: 0, hp: { [room.challenger_id]: 100, [room.opponent_id]: 100 }, guard: {}, log: [`共享 seed ${room.seed} 已生成，战斗开始。`] };
      }
    } else if (action === "action") {
      if (room.status !== "BATTLE" || !room.state.game || room.state.game.turn !== user.id) return fail("还没轮到你行动", 409);
      const body = await readBody(request);
      const allowed = room.mode === "ft" ? ["attack", "skill", "defend"] : ["fire", "reload", "shield"];
      const move = allowed.includes(body.action) ? body.action : allowed[0];
      const opponentId = room.challenger_id === user.id ? room.opponent_id : room.challenger_id;
      const hit = damage(room.seed, room.state.game.step, move, user.id);
      const guardFactor = Number(room.state.game.guard[opponentId] || 0);
      const actual = Math.max(0, Math.floor(hit.amount * (1 - guardFactor)));
      room.state.game.hp[opponentId] = Math.max(0, room.state.game.hp[opponentId] - actual);
      room.state.game.guard[user.id] = hit.guard;
      room.state.game.log.unshift(`${user.username} ${hit.label}，造成 ${actual} 点伤害。`);
      room.state.game.step += 1;
      if (room.state.game.hp[opponentId] <= 0) {
        await settle(env, room, room.state.game, user.id, opponentId);
        return response({ room: publicRoom(room, user) });
      }
      room.state.game.turn = opponentId;
    }
    await env.DB.prepare("UPDATE rooms SET status = ?1, seed = ?2, state_json = ?3, updated_at = ?4 WHERE id = ?5").bind(room.status, room.seed || null, JSON.stringify(room.state), now(), room.id).run();
    return response({ room: publicRoom(room, user) });
  }

  return fail("接口不存在", 404);
}

export default {
  async fetch(request, env) {
    try {
      if (new URL(request.url).pathname.startsWith("/api/")) return await api(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return fail("服务器错误", 500);
    }
  }
};
