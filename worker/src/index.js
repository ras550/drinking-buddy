export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const json = (data, status = 200) => Response.json(data, { status, headers: cors });
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const country = request.cf?.country || '??';

    async function incr(key, by = 1) {
      const cur = parseInt(await env.WAITLIST.get(key) || '0');
      await env.WAITLIST.put(key, String(cur + by));
      return cur + by;
    }
    async function getNum(key) {
      return parseInt(await env.WAITLIST.get(key) || '0');
    }

    // ── POST /api/track ──────────────────────────────────────────────────
    if (url.pathname === '/api/track' && request.method === 'POST') {
      const { type = 'view' } = await request.json().catch(() => ({}));
      const views = await incr('stats:views');
      const visitorKey = `visitor:${ip}`;
      const isNew = !(await env.WAITLIST.get(visitorKey));
      let visitors = await getNum('stats:visitors');
      if (isNew) {
        await env.WAITLIST.put(visitorKey, '1', { expirationTtl: 86400 });
        visitors = await incr('stats:visitors');
      }
      await incr(`stats:country:${country}`);
      if (type === 'video_play') await incr('stats:video_plays');
      return json({ views, visitors });
    }

    // ── GET /api/stats ───────────────────────────────────────────────────
    if (url.pathname === '/api/stats' && request.method === 'GET') {
      const [views, visitors, videoPlays] = await Promise.all([
        getNum('stats:views'),
        getNum('stats:visitors'),
        getNum('stats:video_plays'),
      ]);
      const signups  = (await env.WAITLIST.list({ prefix: 'waitlist:' })).keys.length;
      const comments = (await env.WAITLIST.list({ prefix: 'comment:' })).keys.length;
      const allKeys  = await env.WAITLIST.list({ prefix: 'stats:country:' });
      const countries = await Promise.all(
        allKeys.keys.slice(0, 10).map(async k => ({
          country: k.name.replace('stats:country:', ''),
          count: await getNum(k.name),
        }))
      );
      countries.sort((a, b) => b.count - a.count);
      return json({ views, visitors, signups, comments, videoPlays, countries });
    }

    // ── POST /api/waitlist ───────────────────────────────────────────────
    if (url.pathname === '/api/waitlist' && request.method === 'POST') {
      const { email } = await request.json().catch(() => ({}));
      if (!email?.includes('@')) return json({ error: 'Invalid email' }, 400);
      const key = `waitlist:${email.toLowerCase().trim()}`;
      if (!(await env.WAITLIST.get(key))) {
        await env.WAITLIST.put(key, JSON.stringify({
          email: email.toLowerCase().trim(),
          signedUpAt: new Date().toISOString(),
          ip, country,
        }));
      }
      const total = (await env.WAITLIST.list({ prefix: 'waitlist:' })).keys.length;
      return json({ ok: true, total });
    }

    // ── GET /api/waitlist/count ──────────────────────────────────────────
    if (url.pathname === '/api/waitlist/count' && request.method === 'GET') {
      const list = await env.WAITLIST.list({ prefix: 'waitlist:' });
      return json({ count: list.keys.length });
    }

    // ── GET /api/waitlist/list (admin) ───────────────────────────────────
    if (url.pathname === '/api/waitlist/list' && request.method === 'GET') {
      const { keys } = await env.WAITLIST.list({ prefix: 'waitlist:' });
      const entries = await Promise.all(
        keys.slice(-100).map(k => env.WAITLIST.get(k.name).then(v => {
          try { return JSON.parse(v); }
          catch { return { email: k.name.replace('waitlist:', '') }; }
        }))
      );
      entries.sort((a, b) => new Date(b.signedUpAt || 0) - new Date(a.signedUpAt || 0));
      return json({ keys: entries });
    }

    // ── POST /api/comments ───────────────────────────────────────────────
    if (url.pathname === '/api/comments' && request.method === 'POST') {
      const { name, message } = await request.json().catch(() => ({}));
      if (!message?.trim()) return json({ error: 'Empty message' }, 400);
      const id = `comment:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
      const comment = {
        id, country, ts: new Date().toISOString(), likes: 0,
        name: (name?.trim() || 'Anonymous').slice(0, 40),
        message: message.trim().slice(0, 280),
      };
      await env.WAITLIST.put(id, JSON.stringify(comment));
      return json({ ok: true, comment });
    }

    // ── GET /api/comments ────────────────────────────────────────────────
    if (url.pathname === '/api/comments' && request.method === 'GET') {
      const { keys } = await env.WAITLIST.list({ prefix: 'comment:' });
      const comments = await Promise.all(
        keys.slice(-50).map(k => env.WAITLIST.get(k.name).then(v => JSON.parse(v)))
      );
      comments.sort((a, b) => new Date(b.ts) - new Date(a.ts));
      return json({ comments });
    }

    // ── POST /api/comments/:id/like ──────────────────────────────────────
    if (url.pathname.startsWith('/api/comments/') && url.pathname.endsWith('/like') && request.method === 'POST') {
      const rawId = url.pathname.replace('/api/comments/', '').replace('/like', '');
      const key   = rawId.startsWith('comment:') ? rawId : `comment:${rawId}`;
      const raw   = await env.WAITLIST.get(key);
      if (!raw) return json({ error: 'Not found' }, 404);
      const comment = JSON.parse(raw);
      comment.likes = (comment.likes || 0) + 1;
      await env.WAITLIST.put(key, JSON.stringify(comment));
      return json({ likes: comment.likes });
    }

    return new Response('Not found', { status: 404, headers: cors });
  }
};
