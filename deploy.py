#!/usr/bin/env python3
"""
One-shot deploy: KV namespace + Worker + Pages → live URL
"""
import subprocess, json, sys, os, re

def run(cmd, capture=False, cwd=None):
    print(f"\n  ⚙  {cmd[:80]}")
    r = subprocess.run(cmd, shell=True, capture_output=capture, text=True, cwd=cwd)
    if capture:
        return r.stdout.strip(), r.returncode
    return r.returncode == 0

BASE = os.path.expanduser("~/drinking-buddy-landing")
WORKER = f"{BASE}/worker"
PUBLIC = f"{BASE}/public"

print("\n🍺 Drinking Buddy — Cloudflare Deploy\n")

# ── 1. Login check ─────────────────────────────────────────────────────────
print("Step 1: Checking Cloudflare auth...")
out, code = run("wrangler whoami 2>&1", capture=True)
if "You are not authenticated" in out or code != 0:
    print("  → Not logged in. Opening browser for Cloudflare login...")
    subprocess.run("wrangler login", shell=True)
else:
    # Extract account name
    match = re.search(r'Account Name: (.+)', out)
    name = match.group(1).strip() if match else "your account"
    print(f"  ✓ Logged in as: {name}")

# ── 2. Create KV namespace ─────────────────────────────────────────────────
print("\nStep 2: Creating KV namespace for waitlist emails...")
out, code = run("wrangler kv namespace create WAITLIST 2>&1", capture=True, cwd=WORKER)
print(f"  Output: {out[:200]}")

# Extract KV id from output
kv_match = re.search(r'id\s*=\s*"([a-f0-9]{32})"', out)
if kv_match:
    kv_id = kv_match.group(1)
    print(f"  ✓ KV namespace created: {kv_id}")
    # Patch wrangler.toml with real ID
    toml_path = f"{WORKER}/wrangler.toml"
    with open(toml_path) as f:
        toml = f.read()
    toml = toml.replace("PLACEHOLDER_KV_ID", kv_id)
    with open(toml_path, "w") as f:
        f.write(toml)
    print("  ✓ wrangler.toml updated with KV id")
else:
    # KV might already exist — try to list
    out2, _ = run("wrangler kv namespace list 2>&1", capture=True, cwd=WORKER)
    existing = re.search(r'"id":\s*"([a-f0-9]{32})"', out2)
    if existing:
        kv_id = existing.group(1)
        toml_path = f"{WORKER}/wrangler.toml"
        with open(toml_path) as f:
            toml = f.read()
        toml = toml.replace("PLACEHOLDER_KV_ID", kv_id)
        with open(toml_path, "w") as f:
            f.write(toml)
        print(f"  ✓ Using existing KV namespace: {kv_id}")
    else:
        print("  ⚠  Could not get KV id — continuing anyway")

# ── 3. Deploy Worker ───────────────────────────────────────────────────────
print("\nStep 3: Deploying Cloudflare Worker (waitlist API)...")
out, code = run("wrangler deploy 2>&1", capture=True, cwd=WORKER)
print(f"  {out[:300]}")

worker_url = None
url_match = re.search(r'https://[a-z0-9\-]+\.workers\.dev', out)
if url_match:
    worker_url = url_match.group(0)
    print(f"  ✓ Worker live: {worker_url}")

# ── 4. Patch index.html with worker URL ───────────────────────────────────
if worker_url:
    print(f"\nStep 4: Patching landing page with Worker URL...")
    idx = f"{PUBLIC}/index.html"
    with open(idx) as f:
        html = f.read()
    # The fetch in JS uses relative /api/waitlist — Pages will proxy it
    # but we also set a data attr so JS can use absolute if needed
    html = html.replace(
        "<body>",
        f"<body data-api='{worker_url}'>"
    )
    with open(idx, "w") as f:
        f.write(html)
    print(f"  ✓ API URL embedded")

# ── 5. Deploy Pages ────────────────────────────────────────────────────────
print("\nStep 5: Deploying landing page to Cloudflare Pages...")
out, code = run(
    f'wrangler pages deploy "{PUBLIC}" --project-name drinking-buddy --commit-dirty=true 2>&1',
    capture=True, cwd=WORKER
)
print(f"  {out[:500]}")

pages_url = None
pages_match = re.search(r'https://[a-z0-9\-]+\.pages\.dev', out)
if pages_match:
    pages_url = pages_match.group(0)

# ── Done ───────────────────────────────────────────────────────────────────
print("\n" + "="*50)
print("✅  DEPLOYED!\n")
if pages_url:
    print(f"  🌐 Landing page:  {pages_url}")
if worker_url:
    print(f"  ⚡ Waitlist API:  {worker_url}/api/waitlist")
    print(f"  📊 Email count:   {worker_url}/api/waitlist/count")
print("\n  Share the landing page link everywhere. 🍺")
print("="*50 + "\n")

if pages_url:
    subprocess.run(f'open "{pages_url}"', shell=True)
