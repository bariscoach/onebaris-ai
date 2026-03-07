# OneBaris AI

Your personal interactive AI page — powered by Claude.

## Project structure

```
onebaris-ai/
├── public/
│   └── index.html       # The website
├── api/
│   └── chat.js          # Serverless proxy (keeps your API key safe)
├── vercel.json          # Vercel config
└── README.md
```

## Deploy in 5 steps

### 1. Get your Anthropic API key
- Go to https://console.anthropic.com
- Create an API key and copy it

### 2. Push to GitHub
```bash
git init
git add .
git commit -m "initial"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/onebaris-ai.git
git push -u origin main
```

### 3. Deploy on Vercel
- Go to https://vercel.com
- Sign in with GitHub
- Click "Add New Project" → select your repo
- Leave all settings as default
- Click Deploy

### 4. Add your API key
- In Vercel, go to your project → Settings → Environment Variables
- Add: `ANTHROPIC_API_KEY` = your key from step 1
- Click Save, then go to Deployments → Redeploy

### 5. You're live
Your site will be at `https://onebaris-ai.vercel.app` (or whatever Vercel assigns).

## Custom domain (optional)
- In Vercel → Settings → Domains
- Add your domain (e.g. `onebaris.ai` or `baris.nordcx.com`)
- Follow the DNS instructions — takes about 5 minutes

## Making changes
Edit `public/index.html`, commit and push — Vercel auto-deploys in ~20 seconds.
