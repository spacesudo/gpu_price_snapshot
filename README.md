# GPU Index

Fetch GPU rental prices from [RunPod](https://www.runpod.io/), [Vast.ai](https://vast.ai/) and [Runcrate](https://www.runcrate.ai/), normalize them, and store time-series snapshots in a [Neon](https://neon.tech/) PostgreSQL database.

## Features

- **RunPod**: GraphQL `gpuTypes` query for secure, community, and spot pricing
- **Vast.ai**: REST marketplace search with per-GPU minimum on-demand and interruptible prices
- **Runcrate**: public pricing feed with the lowest on-demand price per GPU type that is in stock (no API key needed)
- **Neon PostgreSQL**: GPU catalog + timestamped price snapshots with JSONB raw payloads
- **Scheduler**: Built-in interval fetching (default every 1 hour)

## Setup

### 1. Install dependencies

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
```

### 2. Configure environment

Copy the example env file and add your keys:

```bash
cp .env.example .env
```

| Variable | Where to get it |
|----------|-----------------|
| `RUNPOD_API_KEY` | [RunPod console settings](https://www.runpod.io/console/user/settings) |
| `VAST_API_KEY` | [Vast.ai keys page](https://cloud.vast.ai/manage-keys/) |
| `DATABASE_URL` | [Neon console](https://console.neon.tech/) — connection string with `?sslmode=require` |

Optional settings:

```
FETCH_INTERVAL_HOURS=1
```

Example Neon connection string:

```
DATABASE_URL=postgresql://user:password@ep-example.us-east-1.aws.neon.tech/neondb?sslmode=require
```

### 3. Initialize the database

```bash
python -m gpu_index init-db
```

This creates the `gpu_models` and `price_snapshots` tables in your Neon database.

## Usage

```bash
# One-shot fetch
python -m gpu_index fetch

# View latest prices
python -m gpu_index list --latest

# Start scheduled fetching (immediate fetch + repeat every N hours)
python -m gpu_index run
```

Or use the installed script:

```bash
gpu-index fetch
gpu-index list --latest
gpu-index run
```

## Web Dashboard

A React-based web dashboard is available to browse the latest verified GPU prices.

### Starting the Dashboard

1. Start the FastAPI backend server:
```bash
python -m gpu_index serve
```

2. In a separate terminal, start the React frontend:
```bash
cd index-fe
npm install
npm run dev
```

3. Open your browser to `http://localhost:5173`

### Dashboard Features

- **Single-page price table**: All verified GPU prices from RunPod, Vast.ai and Runcrate
- **Historical ranges**: Each row shows the all-time low and all-time high price for that GPU and instance type
- **Search and filters**: Search by GPU model or filter by provider
- **Sortable columns**: Sort by GPU, provider, price, VRAM, price type, and historical ranges

### Verified GPU List

The dashboard focuses on these verified GPU models:
- NVIDIA: H100, A100, A6000, A5000, A4000, A40, RTX 4090/4080/4070, RTX 3090/3080/3070, RTX 6000, L40, L40S, V100
- AMD: MI300X, MI250X, MI210, MI200

## Database schema

**gpu_models** — GPU catalog per provider

| Column | Type | Description |
|--------|------|-------------|
| provider | TEXT | `runpod`, `vast` or `runcrate` |
| gpu_id | TEXT | Provider GPU identifier |
| display_name | TEXT | Human-readable name |
| memory_gb | DOUBLE PRECISION | VRAM in GB |

**price_snapshots** — Time-series price records

| Column | Type | Description |
|--------|------|-------------|
| instance_type | TEXT | `secure`, `community`, `secure_spot`, `community_spot` (RunPod) or `ondemand`, `bid` (Vast.ai), `ondemand` (Runcrate) |
| price_per_hour | DOUBLE PRECISION | USD per hour |
| stock_status | TEXT | RunPod availability, Vast.ai offer count, or `in_stock` (Runcrate) |
| fetched_at | TIMESTAMPTZ | UTC timestamp |
| raw_json | JSONB | Full provider payload for debugging |

## Price normalization

| Provider | Instance types | Source |
|----------|---------------|--------|
| RunPod | secure, community, secure_spot, community_spot | Catalog list prices from `gpuTypes` |
| Vast.ai | ondemand, bid | Minimum `dph_total` per `gpu_name` across rentable offers |
| Runcrate | ondemand | `min_price_hr` per GPU type from `https://www.runcrate.ai/api/gpu-pricing`, skipped when `available_options` is below 1 |

## Error handling

Each provider is fetched independently — if one API fails, the other's data is still saved. Transient HTTP errors are retried once with a 30s timeout.

## Deployment

The project uses a hybrid deployment: **backend on AWS EC2** (FastAPI + scheduled fetcher) and **frontend on Vercel** (static CDN-hosted React app).

```
┌─────────────────┐     HTTPS     ┌──────────────────┐
│  Vercel (CDN)   │ ────────────▶ │  AWS EC2         │
│  React frontend │  /api/* calls │  FastAPI backend │
│  gpu.your.site  │               │  api.your.site   │
└─────────────────┘               │  + fetcher cron  │
                                  │  + Neon/RDS DB   │
                                  └──────────────────┘
```

### Part 1 — Backend on AWS EC2

#### 1. Launch an EC2 instance

- **AMI**: Ubuntu Server 24.04 LTS (or 22.04 LTS)
- **Instance type**: `t3.small` is enough to start
- **Storage**: at least 20 GB gp3
- **Security group**: allow inbound
  - SSH (port 22) from your IP
  - HTTP (port 80) from `0.0.0.0/0` — for Let's Encrypt
  - HTTPS (port 443) from `0.0.0.0/0` — for API access from Vercel

#### 2. Connect and install base packages

```bash
ssh -i your-key.pem ubuntu@<your-ec2-public-ip>

sudo apt update && sudo apt upgrade -y
sudo apt install -y python3-pip python3-venv nginx certbot python3-certbot-nginx git
```

#### 3. Choose a database

**Option A — External managed PostgreSQL (recommended)**

Use [Neon](https://neon.tech/), [AWS RDS](https://aws.amazon.com/rds/), or any managed PostgreSQL. Set `DATABASE_URL` in your `.env`:

```
DATABASE_URL=postgresql://user:password@your-db-host/dbname?sslmode=require
```

**Option B — Local PostgreSQL on the instance**

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
sudo -u postgres psql -c "CREATE USER gpuindex WITH PASSWORD 'change-me';"
sudo -u postgres psql -c "CREATE DATABASE gpuindex OWNER gpuindex;"
```

Set `.env` to:

```
DATABASE_URL=postgresql://gpuindex:change-me@localhost:5432/gpuindex
```

#### 4. Clone and set up the project

```bash
git clone https://github.com/<your-org>/gpu_price_snapshot.git
cd gpu_price_snapshot

python3 -m venv .venv
source .venv/bin/activate
pip install -e .

cp .env.example .env
nano .env
# Add RUNPOD_API_KEY, VAST_API_KEY, DATABASE_URL, and FETCH_INTERVAL_HOURS

python -m gpu_index init-db
```

#### 5. Create systemd services

`/etc/systemd/system/gpu-index-backend.service`:

```ini
[Unit]
Description=GPU Index FastAPI backend
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/gpu_price_snapshot
Environment=PATH=/home/ubuntu/gpu_price_snapshot/.venv/bin
EnvironmentFile=/home/ubuntu/gpu_price_snapshot/.env
ExecStart=/home/ubuntu/gpu_price_snapshot/.venv/bin/python -m gpu_index serve --host 127.0.0.1 --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/gpu-index-fetcher.service`:

```ini
[Unit]
Description=GPU Index scheduled fetcher
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/gpu_price_snapshot
Environment=PATH=/home/ubuntu/gpu_price_snapshot/.venv/bin
EnvironmentFile=/home/ubuntu/gpu_price_snapshot/.env
ExecStart=/home/ubuntu/gpu_price_snapshot/.venv/bin/python -m gpu_index run
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gpu-index-backend
sudo systemctl enable --now gpu-index-fetcher
```

#### 6. Configure Nginx as API reverse proxy

The backend only serves `/api/*` — the frontend is on Vercel, so Nginx proxies API requests only.

`/etc/nginx/sites-available/gpu-index-api`:

```nginx
server {
    listen 80;
    server_name api.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Activate:

```bash
sudo ln -s /etc/nginx/sites-available/gpu-index-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 7. Add HTTPS with Let's Encrypt

```bash
sudo certbot --nginx -d api.your-domain.com
```

Certbot will update the Nginx config and auto-renew the certificate.

After this, your backend is reachable at `https://api.your-domain.com/api/`.

#### 8. Backend environment

```bash
# .env on the EC2 instance
RUNPOD_API_KEY=...
VAST_API_KEY=...
DATABASE_URL=...
FETCH_INTERVAL_HOURS=1
```

The backend already has CORS configured to allow all origins, so Vercel frontend requests will work.

#### 9. Redeploy backend after changes

```bash
ssh -i your-key.pem ubuntu@<your-ec2-public-ip>
cd ~/gpu_price_snapshot
git pull
source .venv/bin/activate
pip install -e .  # if pyproject.toml changed
sudo systemctl restart gpu-index-backend gpu-index-fetcher
```

#### Useful backend commands

```bash
sudo journalctl -u gpu-index-backend -f      # backend logs
sudo journalctl -u gpu-index-fetcher -f      # fetcher logs
sudo systemctl restart gpu-index-backend gpu-index-fetcher
```

---

### Part 2 — Frontend on Vercel

#### 1. Push to GitHub

Make sure your `gpu_price_snapshot` repo (including the `index-fe/` directory) is on GitHub.

#### 2. Create a Vercel project

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New → Project**
3. Import your `gpu_price_snapshot` repository
4. Configure the project:
   - **Root Directory**: `index-fe`
   - **Framework Preset**: Vite (auto-detected from `vercel.json`)
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `dist` (auto-detected)
5. Under **Environment Variables**, add:
   - `VITE_API_BASE_URL` = `https://api.your-domain.com`
   - This tells the frontend where the EC2 backend lives
6. Click **Deploy**

Vercel will run `npm run build` and serve `dist/` on a global CDN. The `vercel.json` in `index-fe/` handles SPA routing (all paths fall back to `index.html`).

#### 3. Add a custom domain (optional)

1. In Vercel → Project → Settings → Domains
2. Add `gpu.your-domain.com` (or whatever subdomain you prefer)
3. Add the CNAME record Vercel shows you in your DNS provider
4. Vercel provisions HTTPS automatically

#### 4. Redeploy frontend after changes

Push to your `main` branch on GitHub — Vercel auto-deploys on every push. No manual steps needed.

To deploy from the CLI instead:

```bash
cd index-fe
npx vercel --prod
```

#### 5. Local development

For local dev, the Vite dev server proxies `/api` to `localhost:8000` (configured in `vite.config.ts`). No `VITE_API_BASE_URL` is needed locally.

```bash
# Terminal 1 — backend
python -m gpu_index serve

# Terminal 2 — frontend
cd index-fe
npm run dev
```

Open `http://localhost:5173`.
