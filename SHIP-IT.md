# How to ship this to GitHub

You've never done this — that's fine. Follow these once and you'll never need them again.
Pick **Option A** (easiest, all clicks) or **Option B** (Claude Code / terminal).

---

## GitHub repo settings (copy-paste these)

When GitHub asks for repo details:

- **Repository name:** `glyph-grid-studio`
- **Description:** `Browser tool for generative typographic + ASCII visuals on a 1920×1080 canvas, with SVG / PNG / After Effects export.`
- **Visibility:** Public
- **Topics / tags** (add these after creating, under the ⚙ next to "About"):
  `generative-art`, `ascii-art`, `motion-design`, `svg`, `after-effects`, `figma`, `creative-coding`, `canvas`, `typography`, `design-tools`

---

## Option A — no terminal, all in the browser

1. Go to <https://github.com/new>. Enter the name and description above, set **Public**, click **Create repository**.
2. On the new repo page, click **"uploading an existing file"**.
3. Drag in **every file and folder** from this project (`index.html`, `README.md`,
   `LICENSE`, `.gitignore`, `CLAUDE.md`, the `docs/` folder, and the `.github/` folder).
   - GitHub's uploader can be fussy about folders — if `.github/workflows/deploy.yml`
     won't drag, you can add it after: **Add file → Create new file**, type the path
     `.github/workflows/deploy.yml`, and paste its contents.
4. Click **Commit changes**.
5. Turn on the live site: **Settings → Pages →** under "Build and deployment", set
   **Source: GitHub Actions**. (The included workflow does the rest.)
6. Wait ~1 minute. Your live link appears at **Settings → Pages**, and will be:
   `https://YOUR-USERNAME.github.io/glyph-grid-studio/`
7. Edit `README.md` and replace `YOUR-USERNAME` with your actual username so the links work.

**Share that link with your colleagues.** That's the whole thing.

---

## Option B — Claude Code / terminal

You need [Git](https://git-scm.com/downloads) installed. Then, inside this folder:

```bash
git init
git add .
git commit -m "Initial commit: Glyph Grid Studio"
```

Create an empty repo on GitHub (<https://github.com/new>, name `glyph-grid-studio`,
Public, don't add a README). Then connect and push:

```bash
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/glyph-grid-studio.git
git push -u origin main
```

Then do step 5 above (Settings → Pages → Source: GitHub Actions) once.

---

## Deploying changes later ("deploy changes")

This is the part you'll use constantly. After the first push, updating the live site is:

**In Claude Code / terminal:**
```bash
git add .
git commit -m "Describe what you changed"
git push
```

**Or in the browser:** open the file on GitHub, click the ✏️ pencil, edit, **Commit changes**.

Either way, the GitHub Action redeploys automatically in about a minute. Colleagues just
refresh the same link.

---

## Letting colleagues contribute

- **Just view/use it:** send the Pages link. Nothing else needed.
- **Suggest changes:** they fork the repo, edit, and open a Pull Request. You review and
  merge — merging to `main` auto-deploys.
- **Edit directly:** add them under **Settings → Collaborators**.

---

## FAQ

**Do I need to "build" anything?** No. It's one HTML file. GitHub Pages serves it as-is.

**Will the fonts work for colleagues?** Only if they have ABC Diatype installed locally
(it's a licensed font, so it can't ship in the repo). Without it they see the fallback
font — everything still works, it just looks slightly different. See README for details.

**Can I keep it private instead?** Yes — set the repo to Private. GitHub Pages still works
on private repos on paid plans; on free, Pages requires Public. If you must stay private,
colleagues can download `index.html` and open it locally.
