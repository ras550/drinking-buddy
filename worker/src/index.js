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
    async function getNum(key) { return parseInt(await env.WAITLIST.get(key) || '0'); }

    // ── LANDING PAGE TRACKING ─────────────────────────────────────────────
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

    if (url.pathname === '/api/stats' && request.method === 'GET') {
      const [views, visitors, videoPlays] = await Promise.all([
        getNum('stats:views'), getNum('stats:visitors'), getNum('stats:video_plays'),
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

    if (url.pathname === '/api/waitlist' && request.method === 'POST') {
      const { email } = await request.json().catch(() => ({}));
      if (!email?.includes('@')) return json({ error: 'Invalid email' }, 400);
      const key = `waitlist:${email.toLowerCase().trim()}`;
      if (!(await env.WAITLIST.get(key))) {
        await env.WAITLIST.put(key, JSON.stringify({ email: email.toLowerCase().trim(), signedUpAt: new Date().toISOString(), ip, country }));
      }
      const total = (await env.WAITLIST.list({ prefix: 'waitlist:' })).keys.length;
      return json({ ok: true, total });
    }

    if (url.pathname === '/api/waitlist/count' && request.method === 'GET') {
      const list = await env.WAITLIST.list({ prefix: 'waitlist:' });
      return json({ count: list.keys.length });
    }

    if (url.pathname === '/api/waitlist/list' && request.method === 'GET') {
      const { keys } = await env.WAITLIST.list({ prefix: 'waitlist:' });
      const entries = await Promise.all(
        keys.slice(-100).map(k => env.WAITLIST.get(k.name).then(v => { try { return JSON.parse(v); } catch { return { email: k.name.replace('waitlist:', '') }; } }))
      );
      entries.sort((a, b) => new Date(b.signedUpAt || 0) - new Date(a.signedUpAt || 0));
      return json({ keys: entries });
    }

    if (url.pathname === '/api/comments' && request.method === 'POST') {
      const { name, message } = await request.json().catch(() => ({}));
      if (!message?.trim()) return json({ error: 'Empty message' }, 400);
      const id = `comment:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
      const comment = { id, country, ts: new Date().toISOString(), likes: 0, name: (name?.trim() || 'Anonymous').slice(0, 40), message: message.trim().slice(0, 280) };
      await env.WAITLIST.put(id, JSON.stringify(comment));
      return json({ ok: true, comment });
    }

    if (url.pathname === '/api/comments' && request.method === 'GET') {
      const { keys } = await env.WAITLIST.list({ prefix: 'comment:' });
      const comments = await Promise.all(keys.slice(-50).map(k => env.WAITLIST.get(k.name).then(v => JSON.parse(v))));
      comments.sort((a, b) => new Date(b.ts) - new Date(a.ts));
      return json({ comments });
    }

    if (url.pathname.startsWith('/api/comments/') && url.pathname.endsWith('/like') && request.method === 'POST') {
      const rawId = url.pathname.replace('/api/comments/', '').replace('/like', '');
      const key = rawId.startsWith('comment:') ? rawId : `comment:${rawId}`;
      const raw = await env.WAITLIST.get(key);
      if (!raw) return json({ error: 'Not found' }, 404);
      const comment = JSON.parse(raw);
      comment.likes = (comment.likes || 0) + 1;
      await env.WAITLIST.put(key, JSON.stringify(comment));
      return json({ likes: comment.likes });
    }

    // ── SESSION: CREATE ────────────────────────────────────────────────────
    if (url.pathname === '/api/session/new' && request.method === 'POST') {
      const { buddyName, personalityDescription, voiceId } = await request.json().catch(() => ({}));
      if (!buddyName || !personalityDescription) return json({ error: 'Missing fields' }, 400);

      const sessionId = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

      // Fast default — good enough without Claude
      let systemPrompt = `You are ${buddyName}, a real human at a bar with an old friend. ${personalityDescription}. Be yourself — funny, warm, real. Keep turns to 2-3 punchy sentences. Ask about their life. Remember everything they say and bring it back up. Never say you're an AI.`;

      // Try Claude with a hard 6s timeout — skip if slow
      if (env.ANTHROPIC_API_KEY) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            signal: controller.signal,
            headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-haiku-4-5',
              max_tokens: 400,
              messages: [{
                role: 'user',
                content: `Write a 3-paragraph character brief (second person, "You are...") for "${buddyName}": ${personalityDescription}\n\nParagraph 1: Who they are + worldview. Paragraph 2: How they talk, their verbal tics, humour style. Paragraph 3: One sentence — they're curious, ask one question at a time, remember everything said and weave it back in naturally, keep turns to 2-4 sentences packed with personality. No AI admission ever.`
              }]
            })
          });
          clearTimeout(timeout);
          const d = await claudeRes.json();
          if (d.content?.[0]?.text) systemPrompt = d.content[0].text;
        } catch (e) { /* timeout or error — use default */ }
      }

      // Create ElevenLabs agent
      let elevenLabsAgentId = null;
      let elevenLabsError = null;
      const selectedVoiceId = voiceId || 'JBFqnCBsd6RMkjVDRZzb'; // George — Warm Storyteller

      if (env.ELEVENLABS_API_KEY) {
        try {
          const elController = new AbortController();
          const elTimeout = setTimeout(() => elController.abort(), 10000);
          const elRes = await fetch('https://api.elevenlabs.io/v1/convai/agents/create', {
            method: 'POST',
            signal: elController.signal,
            headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `db-${sessionId}`,
              conversation_config: {
                agent: {
                  prompt: { prompt: systemPrompt },
                  first_message: `${buddyName}! You actually showed up. Get in here — I just ordered a round. What are you drinking?`,
                  language: 'en',
                },
                tts: { voice_id: selectedVoiceId, model_id: 'eleven_turbo_v2' },
                stt: { provider: 'elevenlabs' },
                turn: { mode: 'silence', silence_end_duration_ms: 1200 },
              },
            })
          });
          clearTimeout(elTimeout);
          const elData = await elRes.json();
          if (!elRes.ok || !elData.agent_id) {
            throw new Error(elData?.detail?.message || `ElevenLabs returned ${elRes.status}`);
          }
          elevenLabsAgentId = elData.agent_id;
        } catch (e) {
          elevenLabsError = e?.name === 'AbortError'
            ? 'Voice setup timed out. Please try again.'
            : (e?.message || 'Voice setup failed. Please try again.');
        }
      }

      if (!elevenLabsAgentId) {
        return json({ error: elevenLabsError || 'Voice service is not configured.' }, 502);
      }

      // Avatar URL
      const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(buddyName)}&background=f59e0b&color=0a0705&size=200&bold=true&format=png&rounded=true`;

      // Store session
      const session = {
        id: sessionId,
        buddyName,
        personalityDescription,
        systemPrompt,
        elevenLabsAgentId,
        voiceId: selectedVoiceId,
        avatarUrl,
        transcript: [],
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      await env.WAITLIST.put(`session:${sessionId}`, JSON.stringify(session));

      return json({
        sessionId,
        shareUrl: `https://drinking-buddy.pages.dev/session.html?id=${sessionId}`,
        elevenLabsAgentId,
        avatarUrl,
        buddyName,
      });
    }

    // ── SESSION: GET ───────────────────────────────────────────────────────
    if (url.pathname.startsWith('/api/session/') && !url.pathname.endsWith('/llm') && !url.pathname.endsWith('/end') && !url.pathname.endsWith('/transcript') && request.method === 'GET') {
      const sessionId = url.pathname.replace('/api/session/', '');
      const raw = await env.WAITLIST.get(`session:${sessionId}`);
      if (!raw) return json({ error: 'Session not found' }, 404);
      return json(JSON.parse(raw));
    }

    // ── SESSION: LLM WEBHOOK (ElevenLabs → Claude) ─────────────────────────
    if (url.pathname.startsWith('/api/session/') && url.pathname.endsWith('/llm') && request.method === 'POST') {
      const sessionId = url.pathname.replace('/api/session/', '').replace('/llm', '');
      const body = await request.json().catch(() => ({}));

      // Get session for system prompt
      const raw = await env.WAITLIST.get(`session:${sessionId}`);
      const session = raw ? JSON.parse(raw) : null;
      const systemPrompt = session?.systemPrompt || 'You are a fun drinking buddy at a bar. Keep it short and casual.';

      // Call Claude with full conversation context
      let replyText = "Ha, yeah — so what's been going on with you lately?";
      if (env.ANTHROPIC_API_KEY) {
        try {
          const messages = (body.messages || []).map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          }));
          const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-5',
              max_tokens: 250,
              system: systemPrompt,
              messages: messages.length ? messages : [{ role: 'user', content: 'Hey!' }],
            })
          });
          const claudeData = await claudeRes.json();
          if (claudeData.content?.[0]?.text) replyText = claudeData.content[0].text;
        } catch (e) { /* use fallback */ }
      }

      // OpenAI-compatible response for ElevenLabs
      return json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: replyText },
          finish_reason: 'stop',
        }],
      });
    }

    // ── SESSION: SAVE TRANSCRIPT ────────────────────────────────────────────
    if (url.pathname.startsWith('/api/session/') && url.pathname.endsWith('/transcript') && request.method === 'POST') {
      const sessionId = url.pathname.replace('/api/session/', '').replace('/transcript', '');
      const { role, text } = await request.json().catch(() => ({}));
      const raw = await env.WAITLIST.get(`session:${sessionId}`);
      if (!raw) return json({ error: 'Not found' }, 404);
      const session = JSON.parse(raw);
      session.transcript = session.transcript || [];
      session.transcript.push({ role, text, ts: new Date().toISOString() });
      // keep last 100 turns
      if (session.transcript.length > 100) session.transcript = session.transcript.slice(-100);
      await env.WAITLIST.put(`session:${sessionId}`, JSON.stringify(session));
      return json({ ok: true });
    }

    // ── SESSION: END ───────────────────────────────────────────────────────
    if (url.pathname.startsWith('/api/session/') && url.pathname.endsWith('/end') && request.method === 'POST') {
      const sessionId = url.pathname.replace('/api/session/', '').replace('/end', '');
      const raw = await env.WAITLIST.get(`session:${sessionId}`);
      if (!raw) return json({ error: 'Not found' }, 404);
      const session = JSON.parse(raw);

      const transcriptText = (session.transcript || []).map(t => `${t.role === 'user' ? 'Friend' : session.buddyName}: ${t.text}`).join('\n');

      // Default end card
      let endCard = {
        quotes: [
          `"The night's still young — one more round won't hurt."`,
          `"You know what your problem is? You're too sensible."`,
          `"Cheers. To bad decisions and great stories."`,
        ],
        summary: `A great night with ${session.buddyName}. Good stories, better company.`,
      };

      // Extract quotes via Claude if we have transcript
      if (env.ANTHROPIC_API_KEY && transcriptText.length > 50) {
        try {
          const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-5',
              max_tokens: 400,
              messages: [{
                role: 'user',
                content: `From this conversation transcript, extract the 3 funniest or most memorable things ${session.buddyName} said. Also write a one-line summary of the night (funny, warm tone).

Transcript:
${transcriptText.slice(0, 2000)}

Return ONLY valid JSON in this format:
{"quotes": ["quote1", "quote2", "quote3"], "summary": "one line summary"}`
              }]
            })
          });
          const claudeData = await claudeRes.json();
          const text = claudeData.content?.[0]?.text || '';
          const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
          if (parsed.quotes?.length >= 3) endCard = parsed;
        } catch (e) { /* use defaults */ }
      }

      session.endCard = endCard;
      session.status = 'ended';
      await env.WAITLIST.put(`session:${sessionId}`, JSON.stringify(session));
      return json({ ok: true, endCard, buddyName: session.buddyName, avatarUrl: session.avatarUrl });
    }

    return new Response('Not found', { status: 404, headers: cors });
  }
};
