# My Day

A personal daily dashboard: to-do list, habit tracker with a monthly heatmap, calendar,
`#`-tagged notes, mood & energy check-in, 3 × 789 ml water bottles, a three-a-day photo
journal, a countdown card, and a Pomodoro timer.

It is a plain HTML/CSS/JS app plus a tiny Node server. The server does one job: keep
your data in a single JSON file and serve it to every device you sign in from. It works
offline (service worker) and falls back to browser storage automatically.

**Sign in once.** You get a login screen, and a signed cookie keeps you signed in for a
year per device.

---

## Contents

1. [Run it locally](#1-run-it-locally)
2. [Put it on GitHub](#2-put-it-on-github)
3. [Install on Unraid](#3-install-on-unraid)
4. [How the login works](#4-how-the-login-works)
5. [Backups and updates](#5-backups-and-updates)
6. [Optional: GitHub Pages](#6-optional-github-pages-static-no-login)

---

## 1. Run it locally

```sh
node server.js
```

Then open <http://localhost:8080>. No password is set by default, so there is no login.
To turn the login on:

```sh
# macOS / Linux
APP_USER=you APP_PASSWORD=hunter2 node server.js

# Windows PowerShell
$env:APP_USER="you"; $env:APP_PASSWORD="hunter2"; node server.js
```

You can also just double-click `index.html`. Everything works, but the data then lives in
that one browser only (no sync between devices).

---

## 2. Put it on GitHub

This folder is already its own git repository, separate from the rest of your projects.
So there is nothing to `git init`.

### 2a. Create an empty repository

1. Go to <https://github.com/new>.
2. **Repository name:** `my-day` — use exactly this, it keeps the Unraid template simple.
3. Leave it **Public** if you want the container image to be pullable without credentials.
   Private works too, see step 3d.
4. **Do not** tick "Add a README file", "Add .gitignore" or "Choose a license". The repo
   must start empty or the push below will be rejected.

### 2b. Commit and push

From `D:\Vibecoding\DailyDashboard`, replacing `YOURUSER` with your GitHub username:

```sh
git add -A
git commit -m "Daily dashboard with login, photo journal and countdown"
git branch -M main
git remote add origin https://github.com/YOURUSER/my-day.git
git push -u origin main
```

If `origin` already exists, use `git remote set-url origin https://github.com/YOURUSER/my-day.git`.

If git asks for a password, it wants a **Personal Access Token**, not your GitHub
password: create one at <https://github.com/settings/tokens> (classic, `repo` scope) and
paste it as the password.

### 2c. Watch the image build

Pushing triggers `.github/workflows/docker-publish.yml`, which builds the container and
publishes it to GitHub's container registry.

1. Open your repo on GitHub → **Actions** tab.
2. The "Build and publish image" run should go green in about a minute.
3. Your image now lives at:

   ```
   ghcr.io/YOURUSER/my-day:latest
   ```

   It is also listed under your profile → **Packages**.

---

## 3. Install on Unraid

### 3a. Make the image pullable (skip if your repo is public)

If your repository is **private**, the container image starts out private too, and Unraid
cannot pull it without credentials.

Profile picture → **Packages** → **my-day** → **Package settings** → **Change visibility**
→ **Public**.

(If you would rather keep it private, log in to the registry on the Unraid terminal first
with a Personal Access Token:

```sh
docker login ghcr.io -u YOURUSER
```

and repeat it whenever the token expires.)

### 3b. Put the template on the server

The template is `unraid/my-day.xml`. Replace `YOURUSER` with your GitHub username, then
copy it into Unraid's user-templates folder.

**From Windows PowerShell** (put *your* GitHub username where `octocat` is, and your
server's name where `TOWER` is):

```powershell
(Get-Content unraid\my-day.xml -Raw).Replace('YOURUSER', 'octocat') |
  Set-Content -NoNewline '\\TOWER\flash\config\plugins\dockerMan\templates-user\my-my-day.xml'
```

**Or on the Unraid terminal** (again, `octocat` is the placeholder for your username):

```sh
sed 's/YOURUSER/octocat/g' my-day.xml > /boot/config/plugins/dockerMan/templates-user/my-my-day.xml
```

### 3c. Add the container

1. Unraid → **Docker** tab → **Add Container**.
2. **Template:** pick **MyDay** from the dropdown.
3. Fill in the fields:

   | Field | Value |
   |---|---|
   | WebUI Port | `8585` (or anything free) |
   | Appdata | `/mnt/user/appdata/my-day` |
   | Username | whatever you like, e.g. `admin` |
   | **Password** | **set this — it is what turns the login on** |

4. **Apply**.

Open `http://TOWER-IP:8585` and sign in. You will not be asked again on that device.

### 3d. If you prefer the console

```sh
docker run -d \
  --name myday \
  --restart unless-stopped \
  -p 8585:8080 \
  -v /mnt/user/appdata/my-day:/data \
  -e APP_USER=admin \
  -e APP_PASSWORD=your-password-here \
  ghcr.io/YOURUSER/my-day:latest
```

### Environment variables

| Variable | Default | What it does |
|---|---|---|
| `APP_USER` | `admin` | Login username |
| `APP_PASSWORD` | *(empty)* | Login password. **Empty means no login at all.** |
| `SESSION_DAYS` | `365` | How long a device stays signed in |
| `SESSION_SECRET` | auto | Override the auto-generated session key (optional) |
| `COOKIE_SECURE` | `false` | Set `true` only when serving over HTTPS, otherwise the browser rejects the login cookie |
| `PORT` | `8080` | Internal port |
| `DATA_DIR` | `./data` | Folder holding `state.json` |

---

## 4. How the login works

- Visiting any page without a valid session bounces you to `/login`.
- Signing in sets one `HttpOnly` cookie, signed with HMAC-SHA256 and valid for
  `SESSION_DAYS` (a year by default). Because it is `HttpOnly`, page scripts cannot read
  it.
- The signing key is stored in your appdata folder (`.session-secret`), so restarting the
  container — or updating the image — does **not** sign you out.
- The key is mixed with your username and password, so **changing the password
  immediately signs out every device.**
- `/logout` clears the cookie. (Offline caching means a logged-out browser that is
  completely offline may still show its last cached copy — clear site data if that
  matters to you.)
- HTTP Basic auth still works for scripts:

  ```sh
  curl -u admin:your-password https://your-host/api/state
  ```

- `/healthz` is open and returns `ok`, for uptime checks.

**If you put this behind a reverse proxy / HTTPS**, set `COOKIE_SECURE=true`, otherwise
the browser will refuse to store the login cookie.

---

## 5. Backups and updates

**Your data** is one file: `/mnt/user/appdata/my-day/state.json`. It is included in
Unraid's standard appdata backups. The dashboard can also export/import a JSON backup
from **Settings**.

**Updates:** push to GitHub, wait for the Action to go green, then on Unraid either hit
**Force Update** on the container, or:

```sh
docker pull ghcr.io/YOURUSER/my-day:latest
```

---

## 6. Optional: GitHub Pages (static, no login)

GitHub Pages can host the app for free, but it serves **files only** — it cannot run
`server.js`. That means no login, and each browser keeps its own data in `localStorage`
with no sync. Useful for a quick look on your phone; use Unraid for the real thing.

1. Repo → **Settings** → **Pages**.
2. **Source:** Deploy from a branch. **Branch:** `main`, folder `/ (root)`. **Save**.
3. Wait a minute, then open `https://YOURUSER.github.io/my-day/`.

---

## Project layout

```
index.html          dashboard markup + the SVG icon sprite
styles.css          design system and layout
app.js              all app logic and state
login.html          sign-in page
server.js           static file server + login + JSON storage
sw.js               service worker (offline)
manifest.json       PWA metadata
icon.svg            app icon
Dockerfile          container image
docker-compose.yml  compose file for non-Unraid docker hosts
unraid/my-day.xml   Unraid container template
.github/workflows/  builds and publishes the image to GHCR
```
