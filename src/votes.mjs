// The blind vote: a visitor sees two designs of one comparison side by side, without knowing which was made with
// Qloo, and says which the audience would rather have. A ballot is sealed (AES-GCM under a key from SITE_SECRET), so
// neither the page nor the picture URLs say which side is which; it expires, and it can be cast once. Votes are kept
// with a keyed hash of the visitor's address for the day, never the address, and limited per hour and per pair per
// day. Results give each pair's share for the Qloo arm with a 95% Wilson interval.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const VOTES_DIR = 'votes';
export const VOTE_LIMITS = Object.freeze({ ballotMs: 2 * 60 * 60 * 1000, perHour: 30, ballotsPerHour: 240, perPairPerDay: 1 });
export const CHOICES = Object.freeze(['left', 'right', 'same']);
const DAY = 24 * 60 * 60 * 1000, HOUR = 60 * 60 * 1000;

export class VoteError extends Error { constructor(status, message) { super(message); this.name = 'VoteError'; this.status = status; } }

/** The 95% Wilson score interval of `wins` in `n`, as [low, high], or null with no votes. */
export function wilson(wins, n, z = 1.96) {
  if (!n) return null;
  const p = wins / n, denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator, half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/**
 * The address a vote or a try is limited by, behind `hops` trusted proxies (TRUST_PROXY): each proxy appends the
 * address it saw to X-Forwarded-For, as CloudFront and Caddy do, so the client is that many entries from the end. The
 * entries before it came from the client itself and are not trusted. Without a trusted proxy, the socket's own.
 */
export function voterAddress(req, hops = 0) {
  const trusted = hops === true ? 1 : Number.isInteger(hops) && hops > 0 ? hops : 0;
  const forwarded = trusted ? String(req.headers['x-forwarded-for'] || '').split(',').map(item => item.trim()).filter(Boolean) : [];
  const client = forwarded.length >= trusted ? forwarded[forwarded.length - trusted] : forwarded[0];
  return client || req.socket?.remoteAddress || 'unknown';
}

/**
 * The vote box for `pairs` ([{id, arms: [{taste}, {taste}]}]), keeping its record in DATA_DIR/votes/votes.jsonl.
 * `secret` seals ballots and keys the address hashes; without one, a random secret serves this process only.
 */
export async function createVoteBox({ dataDir, secret = '', pairs = [], now = Date.now, random = crypto.randomBytes } = {}) {
  const key = crypto.createHash('sha256').update(`mousa-vote:${secret || random(32).toString('hex')}`).digest();
  const file = path.join(dataDir, VOTES_DIR, 'votes.jsonl');
  const votes = [];
  for (const line of (await fs.readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean)) {
    try { const vote = JSON.parse(line); if (vote && typeof vote.pair === 'string') votes.push(vote); } catch { /* A torn line is skipped. */ }
  }
  const used = new Set(votes.map(vote => vote.nonce).filter(Boolean));
  const issued = new Map();
  const byPair = new Map(pairs.map(pair => [pair.id, pair]));
  const addressHash = address => crypto.createHmac('sha256', key).update(`${new Date(now()).toISOString().slice(0, 10)}:${address}`).digest('base64url').slice(0, 22);

  const seal = payload => {
    const iv = random(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  };
  /** A ballot's sealed payload, or null for one that was altered, sealed under another key or expired. */
  function open(token) {
    if (typeof token !== 'string' || token.length > 400 || !/^[A-Za-z0-9_-]+$/u.test(token)) return null;
    try {
      const bytes = Buffer.from(token, 'base64url'), decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
      return payload && byPair.has(payload.pair) && now() - payload.at <= VOTE_LIMITS.ballotMs && payload.at <= now() + 60000 ? payload : null;
    } catch { return null; }
  }
  const recent = (list, since) => list.filter(at => at > since);

  /** A ballot for the pair with the fewest votes, its sides in random order; `address` limits how many a visitor draws. */
  function issue(address, { pair: wanted } = {}) {
    const hash = addressHash(address), drawn = recent(issued.get(hash) || [], now() - HOUR);
    if (drawn.length >= VOTE_LIMITS.ballotsPerHour) throw new VoteError(429, 'Too many ballots from this address in the last hour. Try again later.');
    issued.set(hash, [...drawn, now()]);
    if (issued.size > 50000) issued.delete(issued.keys().next().value);
    const counts = new Map(pairs.map(pair => [pair.id, votes.filter(vote => vote.pair === pair.id).length]));
    const fewest = Math.min(...counts.values());
    const pool = wanted && byPair.has(wanted) ? [wanted] : pairs.filter(pair => counts.get(pair.id) === fewest).map(pair => pair.id);
    if (!pool.length) throw new VoteError(404, 'There is no pair to vote on yet.');
    const pair = pool[random(1)[0] % pool.length];
    const flip = random(1)[0] % 2 === 1;
    return { pair, flip, token: seal({ pair, flip, nonce: random(16).toString('base64url'), at: now() }) };
  }

  /** Which arm a side of a ballot shows: 0 or 1, as the pair lists its arms. */
  function side(token, which) {
    const payload = open(token);
    if (!payload || !['left', 'right'].includes(which)) return null;
    return { pair: payload.pair, arm: (which === 'left') === !payload.flip ? 0 : 1 };
  }

  /** Record a vote; returns the pair, which side held the Qloo arm and the choice as an arm. */
  async function cast({ token, choice, address }) {
    if (!CHOICES.includes(choice)) throw new VoteError(400, 'Choose left, right or no preference.');
    const payload = open(token);
    if (!payload) throw new VoteError(400, 'This ballot has expired or is not valid. Take a new one.');
    if (used.has(payload.nonce)) throw new VoteError(409, 'This ballot was already cast.');
    const hash = addressHash(address);
    const mine = votes.filter(vote => vote.voter === hash);
    if (recent(mine.map(vote => Date.parse(vote.at)), now() - HOUR).length >= VOTE_LIMITS.perHour) throw new VoteError(429, 'Too many votes from this address in the last hour. Try again later.');
    if (mine.filter(vote => vote.pair === payload.pair && Date.parse(vote.at) > now() - DAY).length >= VOTE_LIMITS.perPairPerDay) throw new VoteError(409, 'You have already voted on this pair today. Try another pair.');
    const arms = byPair.get(payload.pair).arms;
    const left = payload.flip ? 1 : 0;
    const picked = choice === 'same' ? null : choice === 'left' ? left : 1 - left;
    const taste = picked === null ? 'same' : arms[picked]?.taste === 'qloo' ? 'qloo' : 'baseline';
    const vote = { at: new Date(now()).toISOString(), pair: payload.pair, choice: taste, side: choice, nonce: payload.nonce, voter: hash };
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(vote)}\n`);
    votes.push(vote);
    used.add(payload.nonce);
    return { pair: payload.pair, choice: taste, qlooSide: arms[left]?.taste === 'qloo' ? 'left' : 'right' };
  }

  /** Each pair's votes: for the Qloo arm, for the baseline, no preference, and the Qloo share with its interval. */
  function results() {
    return pairs.map(pair => {
      const mine = votes.filter(vote => vote.pair === pair.id);
      const qloo = mine.filter(vote => vote.choice === 'qloo').length, baseline = mine.filter(vote => vote.choice === 'baseline').length;
      const n = qloo + baseline, interval = wilson(qloo, n);
      return { pair: pair.id, votes: mine.length, qloo, baseline, same: mine.length - n, ...(n ? { share: qloo / n, interval } : {}) };
    });
  }

  return { issue, side, cast, results, open };
}
