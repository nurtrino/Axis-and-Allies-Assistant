# Deploying War Ledger to Render

This app is configured to deploy on [Render](https://render.com) as a Node web
service backed by Render's managed PostgreSQL. The repo includes a
[`render.yaml`](./render.yaml) Blueprint that provisions both in one step.

> **What changed for hosting:** the app previously used a local SQLite file
> (`dev.db`). Render's filesystem is ephemeral, so it now targets PostgreSQL
> (Prisma driver adapter `@prisma/adapter-pg`). Local development therefore also
> needs a Postgres now — see [Local development](#local-development).

---

## 1. Push this folder to GitHub

The repo root **is this project folder** (the one containing `package.json` and
`render.yaml`). Secrets are safe: `.env` and `dev.db` are git-ignored.

```bash
# from inside this folder
git add .
git commit -m "War Ledger: Render-ready (Postgres)"
git branch -M main
git remote add origin <your-private-repo-url>
git push -u origin main
```

Use a **private** repo.

## 2. Create the Blueprint on Render

1. Render Dashboard → **New** → **Blueprint**.
2. Connect your GitHub account and pick this repository.
3. Render reads `render.yaml` and shows two resources to create:
   - **aa-anniversary-db** — managed PostgreSQL
   - **aa-anniversary-companion** — the Node web service
4. Click **Apply**. Render provisions the database, then builds the web service.

The build command runs migrations against the database before building Next.js:

```
npm install && npx prisma migrate deploy && npm run build
```

so the schema is created automatically on the first deploy.

## 3. Add your Anthropic API key

The AI assistant key is **not** in the repo (it's a secret). After the service
is created:

1. Open the **aa-anniversary-companion** service → **Environment**.
2. `ANTHROPIC_API_KEY` is already listed (value blank). Paste your key and save.
3. Render redeploys automatically.

The rest of the app works without the key; only the Rulebook/Ask assistant needs
it.

## 4. Open it

When the deploy is green, your app is at
`https://aa-anniversary-companion.onrender.com` (your exact subdomain is shown in
the dashboard). The health check is `/api/health`.

---

## Things to know about the free tier

- **Free Postgres is deleted after ~30 days.** To keep your campaigns long-term,
  edit `render.yaml` → `databases[0].plan` to `basic` (or higher) and re-apply,
  or upgrade the database in the dashboard.
- **Free web instances sleep** after ~15 minutes of inactivity and cold-start
  (a few seconds) on the next visit. Set `services[0].plan` to `starter` for an
  always-on instance.
- **No login.** This deployment has no authentication, and the AI assistant
  spends your Anthropic API key. Anyone with the URL can use it. If that becomes
  a concern, add an auth gate (HTTP Basic in middleware is the quick option) or
  remove `ANTHROPIC_API_KEY` to disable the assistant.

## Updating after the first deploy

`autoDeploy` is on, so pushing to your `main` branch redeploys automatically. If
you change the Prisma schema, create a migration locally (`npx prisma migrate
dev --name <change>`), commit it, and push — `prisma migrate deploy` in the
build applies it.

## Resetting the production database

In the Render dashboard, open the database and use its shell/connection info, or
simply delete and re-create the database resource (the next deploy re-runs
migrations into the empty DB).

---

## Local development

Because the app now uses Postgres, local dev needs a Postgres too. The simplest
way is the bundled Docker Compose:

```bash
docker compose up -d        # starts Postgres on localhost:5432
cp .env.example .env        # then edit .env if needed
# .env DATABASE_URL is already set for this local Postgres:
#   postgresql://postgres:postgres@localhost:5432/aa_anniversary?schema=public
npx prisma migrate deploy   # create the tables
npm run dev                 # http://localhost:3000
```

No Docker? Point `DATABASE_URL` at any Postgres you have (a local install, or
even your Render database's **External** connection string — that one already
includes `sslmode=require`).
