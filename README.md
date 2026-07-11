# Drinking Buddy 🍺

> Describe a friend. Share a link. They click it and a voice that sounds and acts just like them is already talking. Real-time. Interruptable. No signup.

**Built at the World's Largest Hermes Buildathon · San Francisco 2026**

🌐 **Live:** https://drinking-buddy.pages.dev  
📊 **Admin:** https://drinking-buddy.pages.dev/admin.html (PIN: 1234)  
⚡ **API:** https://drinking-buddy-api.drinkingbuddy.workers.dev

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Vanilla HTML/CSS/JS → Cloudflare Pages |
| Voice | ElevenLabs Conversational AI (real-time, interruptable) |
| Buddy brain | Claude Sonnet via Cloudflare Worker webhook |
| Session state | Convex |
| API | Cloudflare Workers + KV |
| Images | Amazon Bedrock (Stability AI SDXL) |

---

## Project Structure

```
drinking-buddy-landing/
├── public/              # Landing page (Cloudflare Pages)
│   ├── index.html       # Landing page + waitlist + comments
│   ├── admin.html       # Private admin dashboard
│   ├── demo.mp4         # Concept demo video
│   ├── marcus.png       # Buddy portrait
│   └── screen*.png      # App screenshots
│
└── worker/              # Cloudflare Worker (API)
    ├── src/index.js     # All API routes
    └── wrangler.toml    # Worker config
```

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/track` | Track page view / video play |
| GET | `/api/stats` | Get all stats (views, visitors, signups, etc.) |
| POST | `/api/waitlist` | Add email to waitlist |
| GET | `/api/waitlist/count` | Get signup count |
| GET | `/api/waitlist/list` | List all signups (admin) |
| POST | `/api/comments` | Post a comment |
| GET | `/api/comments` | List all comments |
| POST | `/api/comments/:id/like` | Like a comment |

---

## Local Dev

```bash
# Worker
cd worker
npm install -g wrangler
wrangler dev

# Landing page
cd public
open index.html
```

## Deploy

```bash
# Worker
cd worker && wrangler deploy

# Pages
cd worker && wrangler pages deploy ../public --project-name drinking-buddy
```

---

## What's Tracked

- 👀 Page views (all time)
- 🧑 Unique visitors (deduped by IP, 24h window)
- ✉️ Email signups
- ▶️ Video plays
- 💬 Comments + likes
- 🌍 Top countries
- 📊 Conversion rate (visitors → signups)

---

## Coming Next (the actual app)

- [ ] Setup page: describe your buddy, pick a voice, get a link
- [ ] Session page: real-time ElevenLabs voice conversation
- [ ] End card: bar scene image + best quotes + share button
- [ ] Claude as buddy brain via webhook
- [ ] Amazon Bedrock buddy portrait generation

---

*Made with 🍺 at the Hermes Buildathon SF 2026*
