// Generated from OmniRoute's provider catalog by scripts/omniroute/sync-provider-catalog.mjs.
// Do not edit provider entries by hand; regenerate them from the pinned upstream source.

export type OmniProviderCategory =
  | 'no-auth'
  | 'oauth'
  | 'web-cookie'
  | 'local'
  | 'search'
  | 'audio'
  | 'upstream-proxy'
  | 'cloud-agent'
  | 'apikey'

export interface OmniProviderCatalogEntry {
  id: string
  name: string
  category: OmniProviderCategory
  color?: string
  textIcon?: string
  website?: string
  authHint?: string
  apiHint?: string
  freeNote?: string
  baseUrl?: string
  localDefault?: string
  hasFree?: boolean
  noAuth?: boolean
  subscriptionRisk?: boolean
  deprecated?: boolean
  deprecationReason?: string
  passthroughModels?: boolean
  apiType?: string
  serviceKinds: string[]
  logo?: string
}

export const OMNI_PROVIDER_CATALOG: OmniProviderCatalogEntry[] = [
  {
    "id": "devin-cli-agentic",
    "name": "Devin CLI Agentic Bridge",
    "category": "no-auth",
    "color": "#635BFF",
    "textIcon": "DV",
    "website": "https://docs.devin.ai/work-with-devin/devin-cli",
    "authHint": "Authentication is owned by the official Devin CLI in its isolated bridge volume.",
    "hasFree": false,
    "noAuth": true,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "duckduckgo-web",
    "name": "DuckDuckGo AI Chat",
    "category": "no-auth",
    "color": "#DE5833",
    "textIcon": "DDG",
    "website": "https://duckduckgo.com/duckchat",
    "authHint": "No credentials required — DuckDuckGo AI Chat is anonymous and free.",
    "freeNote": "Free — anonymous access to multiple AI models via DuckDuckGo.",
    "hasFree": true,
    "noAuth": true,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "cloudflare-playground",
    "name": "Cloudflare AI Playground",
    "category": "no-auth",
    "color": "#F38020",
    "textIcon": "CF",
    "website": "https://playground.ai.cloudflare.com",
    "authHint": "No credentials required — anonymous browser sessions over a reverse-engineered cf_agent WebSocket protocol (Playwright transport).",
    "freeNote": "Free — Cloudflare's AI Playground: GLM 5.2, Kimi K2.7 Code, DeepSeek V4 Pro, gpt-oss-120B and 16 more. No account, no API key.",
    "hasFree": true,
    "noAuth": true,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "veoaifree-web",
    "name": "Veo AI Free",
    "category": "no-auth",
    "color": "#8B5CF6",
    "textIcon": "VF",
    "website": "https://veoaifree.com",
    "authHint": "No auth required. Rate limited to 6 requests/hour per IP.",
    "freeNote": "Free video generation — VEO 3.1, Seedance. 6 requests/hour.",
    "hasFree": true,
    "noAuth": true,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "video"
    ],
    "logo": "./providers/veoaifree-web.svg"
  },
  {
    "id": "auggie",
    "name": "Augment (Auggie CLI)",
    "category": "no-auth",
    "color": "#7C3AED",
    "textIcon": "AU",
    "website": "https://augmentcode.com",
    "authHint": "No API key stored by OmniRoute. Install the Auggie CLI and run `auggie login` on this machine, then OmniRoute spawns it locally for each request.",
    "freeNote": "Local passthrough — runs the Augment CLI (`auggie`) on this machine. Auth is handled by `auggie login`, not OmniRoute.",
    "hasFree": false,
    "noAuth": true,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/auggie.svg"
  },
  {
    "id": "zcode",
    "name": "ZCode (GLM Coding Plan)",
    "category": "no-auth",
    "color": "#3B82F6",
    "textIcon": "ZC",
    "website": "https://zcode.z.ai",
    "authHint": "No API key stored by OmniRoute. The local ZCode app-server uses the existing builtin:zai-coding-plan login.",
    "hasFree": false,
    "noAuth": true,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "minimax-code",
    "name": "MiniMax Code",
    "category": "no-auth",
    "color": "#F97316",
    "textIcon": "MC",
    "website": "https://www.minimax.io",
    "authHint": "No API key stored by OmniRoute. The provider reads the local MiniMax Code profile to authenticate a run. You can also sign in to your MiniMax account from this page (device code) — the credential is written into that same local profile.",
    "hasFree": false,
    "noAuth": true,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "codex-app-server",
    "name": "OpenAI Codex (App-Server)",
    "category": "no-auth",
    "color": "#10A37F",
    "textIcon": "CA",
    "website": "https://developers.openai.com/codex/cli",
    "authHint": "No token stored by OmniRoute. The Codex CLI app-server manages its own ChatGPT sign-in (~/.codex/auth.json, auto-refreshed). Use “Sign in with ChatGPT” if the CLI is not yet authenticated.",
    "hasFree": false,
    "noAuth": true,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "uncloseai",
    "name": "UncloseAI",
    "category": "no-auth",
    "color": "#8B5CF6",
    "textIcon": "UN",
    "website": "https://uncloseai.com",
    "authHint": "No auth required. API accepts any non-empty string as key for identification. If older built-in models return 404, use Available Models → Import from /models or Auto-Sync; verified live model: turboderp/Qwen3.8-27B-exl3.",
    "freeNote": "Free forever — no signup, no credit card. OpenAI-compatible endpoints.",
    "hasFree": true,
    "noAuth": true,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/uncloseai.svg"
  },
  {
    "id": "aihorde",
    "name": "AI Horde",
    "category": "no-auth",
    "color": "#8B5CF6",
    "textIcon": "AH",
    "website": "https://aihorde.net",
    "authHint": "No API key required — uses AI Horde's documented anonymous key. Adding a free aihorde.net key is optional and only buys higher queue priority (kudos).",
    "freeNote": "Crowdsourced inference from volunteer GPUs. Throughput is a shared queue, not a quota: there is no RPM/RPD cap, but waits grow when the network is busy.",
    "hasFree": true,
    "noAuth": true,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm",
      "image"
    ]
  },
  {
    "id": "chatgpt",
    "name": "ChatGPT",
    "category": "oauth",
    "color": "#10A37F",
    "authHint": "Sign in with ChatGPT to authorize eligible requests using your ChatGPT plan. Separate from Codex and ChatGPT Web. Preview limitations apply.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "ghe-copilot",
    "name": "GitHub Enterprise Copilot",
    "category": "oauth",
    "color": "#10B981",
    "authHint": "Enter your GHE instance URL (e.g., https://ghe.company.com) in provider settings, then authenticate via device flow.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "xai-oauth",
    "name": "xAI OAuth (Grok)",
    "category": "oauth",
    "color": "#1DA1F2",
    "textIcon": "XA",
    "website": "https://x.ai",
    "authHint": "Sign in with xAI to use api.x.ai models such as Grok 4.5. This is separate from Grok Build JWT sessions, which use cli-chat-proxy.grok.com and grok-build model aliases.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "openference",
    "name": "Openference",
    "category": "oauth",
    "color": "#6366F1",
    "textIcon": "OF",
    "website": "https://openference.com",
    "authHint": "Sign in with your Openference account to route requests through api.openference.com. Includes free-tier access to Qwen3.8 27b and Llama 3.2 3B — see openference.com/pricing for current plan terms.",
    "freeNote": "Free tier: includes Qwen3.8 27b and Llama 3.2 3B — see openference.com/pricing for current terms",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "renderhour",
    "name": "RenderHour",
    "category": "oauth",
    "color": "#FF5A1F",
    "textIcon": "RH",
    "website": "https://renderhour.com",
    "authHint": "Sign in with your RenderHour account to spend its subscription credits on images (Nano Banana Pro, GPT Image 2, Seedream), video (Seedance, Kling, Veo) and speech, or paste an rh_… API key from renderhour.com/developers to pay from the API's dollar balance. Address models as renderhour/<model>.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "image",
      "video",
      "tts"
    ]
  },
  {
    "id": "grok-cli",
    "name": "Grok Build",
    "category": "oauth",
    "color": "#000000",
    "authHint": "Sign in with your browser, or paste your ~/.grok/auth.json (or the JWT access token) from the Grok Build CLI; refresh_token is rotated automatically either way. Imagine image/video and TTS/STT reuse this login where your account is entitled.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "image",
      "video",
      "tts",
      "stt"
    ]
  },
  {
    "id": "qoder",
    "name": "Qoder",
    "category": "oauth",
    "color": "#6366F1",
    "authHint": "PAT (pt-): requires local qodercli; plain chat only, no caller tools, buffered streaming and a 45-second chat limit. HTTP keys use DashScope; browser OAuth requires administrator configuration.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "agy",
    "name": "Antigravity CLI",
    "category": "oauth",
    "color": "#F59E0B",
    "textIcon": "AGY",
    "website": "https://antigravity.google",
    "authHint": "Import your Antigravity CLI (`agy`) login (paste/upload its token file), auto-detect a local CLI login, or sign in with Google. Shares the Antigravity backend (incl. Claude models).",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "kiro",
    "name": "Kiro AI",
    "category": "oauth",
    "color": "#FF6B35",
    "freeNote": "Free tier: 50 credits/month (~25K–100K tokens). ⚠️ Kiro ToS prohibits third-party proxy/harness use.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/kiro.svg"
  },
  {
    "id": "amazon-q",
    "name": "Amazon Q",
    "category": "oauth",
    "color": "#FF9900",
    "textIcon": "AQ",
    "website": "https://aws.amazon.com/q/developer/",
    "authHint": "Uses the same AWS Builder ID or imported refresh-token flow as Kiro, but keeps Amazon Q connections separate.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "claude",
    "name": "Claude Code",
    "category": "oauth",
    "color": "#D97757",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/claude.svg"
  },
  {
    "id": "antigravity",
    "name": "Antigravity",
    "category": "oauth",
    "color": "#F59E0B",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "image"
    ]
  },
  {
    "id": "codex",
    "name": "OpenAI Codex",
    "category": "oauth",
    "color": "#3B82F6",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "image"
    ],
    "logo": "./providers/codex.svg"
  },
  {
    "id": "github",
    "name": "GitHub Copilot",
    "category": "oauth",
    "color": "#333333",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "embedding"
    ]
  },
  {
    "id": "gitlab-duo",
    "name": "GitLab Duo",
    "category": "oauth",
    "color": "#FC6D26",
    "textIcon": "GL",
    "website": "https://docs.gitlab.com/user/duo_agent_platform/code_suggestions/",
    "authHint": "GitLab Duo OAuth is not configured. Register an OAuth application at https://gitlab.com/-/profile/applications with redirect URI http://localhost:20128/callback and scopes \"ai_features read_user\", then set GITLAB_DUO_OAUTH_CLIENT_ID (and optionally GITLAB_DUO_OAUTH_CLIENT_SECRET) and restart.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "cursor",
    "name": "Cursor IDE",
    "category": "oauth",
    "color": "#00D4AA",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "image"
    ],
    "logo": "./providers/cursor.svg"
  },
  {
    "id": "zed",
    "name": "Zed IDE",
    "category": "oauth",
    "color": "#084CCF",
    "textIcon": "ZD",
    "website": "https://zed.dev",
    "authHint": "Zed stores LLM provider credentials (OpenAI, Anthropic, Google, Mistral, xAI) in the OS keychain. Use the Import button below to discover and import them automatically.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "zed-hosted",
    "name": "Zed Hosted Models",
    "category": "oauth",
    "color": "#101010",
    "textIcon": "ZH",
    "website": "https://zed.dev",
    "authHint": "Sign in with your Zed account (native-app sign-in). OmniRoute generates a one-time RSA keypair and opens zed.dev to authorize it — on a remote/headless install, copy the resulting 127.0.0.1 callback URL from your browser's address bar and paste it back here. Distinct from the 'Zed IDE' credential-import entry above: this proxies chat completions through Zed's own hosted model aggregator (cloud.zed.dev), fronting Anthropic/OpenAI/Google/xAI models under your Zed plan.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/zed-hosted.svg"
  },
  {
    "id": "trae",
    "name": "Trae",
    "category": "oauth",
    "color": "#FF7849",
    "textIcon": "TR",
    "website": "https://trae.ai",
    "authHint": "Trae is an AI-native IDE by ByteDance (SOLO remote agent). Authorize via trae.ai in the popup, or sign in at solo.trae.ai and paste the Cloud-IDE-JWT (sent as 'Authorization: Cloud-IDE-JWT <token>', ~14-day lifetime) as the access token; web_id/biz_user_id/user_unique_id/scope/tenant/region propagate via providerSpecificData. No headless refresh for pasted tokens — re-paste on expiry.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/trae.svg"
  },
  {
    "id": "kimi-coding",
    "name": "Kimi Code CLI",
    "category": "oauth",
    "color": "#1E40AF",
    "textIcon": "KC",
    "website": "https://www.kimi.ai/code?aff=omniroute",
    "authHint": "Sign in with the same Kimi account used by Kimi Code CLI. OmniRoute uses the CLI OAuth flow and Kimi Coding Plan endpoints.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "kilocode",
    "name": "Kilo Code",
    "category": "oauth",
    "color": "#FF6B35",
    "textIcon": "KC",
    "authHint": "Sign in with your Kilo Code account (device-code OAuth), or paste a direct API key from app.kilo.ai → Settings → API Keys. Multiple API keys are supported and rotated automatically — add each as a separate connection. Without any connection, free anonymous models are available via the anonymousFallback.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "megabrain",
    "name": "MegaBrain",
    "category": "oauth",
    "color": "#6D5DF6",
    "textIcon": "MB",
    "website": "https://getmegabrain.com",
    "authHint": "Sign in with your MegaBrain account (device code), or paste an mb-v1-… MegaBrain API key (add each key as a separate connection to rotate them). A paid plan covers the included models (Auto, GLM, Kimi, MiniMax, Grok, DeepSeek, Qwen) within its session and weekly limits; Claude, GPT and Gemini are paid from the account's credits, from Pro up or with Extra Usage turned on. Address models as mb/<model> or megabrain/<model>.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "cline",
    "name": "Cline",
    "category": "oauth",
    "color": "#5B9BD5",
    "textIcon": "CL",
    "authHint": "Sign in with your Cline account (OAuth), or paste a direct API key from app.cline.bot → Settings → API Keys. Multiple API keys are supported and rotated automatically — add each as a separate connection.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/cline.svg"
  },
  {
    "id": "clinepass",
    "name": "ClinePass",
    "category": "oauth",
    "color": "#9D4EDD",
    "textIcon": "CP",
    "website": "https://cline.bot/cline-pass",
    "authHint": "ClinePass is Cline's $9.99/mo subscription bundling 10 open coding models. Sign in with your Cline account (same login as the Cline CLI/IDE), or paste a direct ClinePass API key (app.cline.bot → Settings → API Keys). A ClinePass subscription unlocks the cline-pass/* models. Reuses the Cline WorkOS OAuth flow.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "devin-desktop",
    "name": "Devin Desktop",
    "category": "oauth",
    "color": "#6366F1",
    "textIcon": "DD",
    "website": "https://devin.ai",
    "authHint": "Paste an existing Devin API key from an authenticated Devin session. Key export availability and steps vary by Devin version and account.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "devin-cli",
    "name": "Devin CLI",
    "category": "oauth",
    "color": "#6366F1",
    "textIcon": "DV",
    "website": "https://cli.devin.ai",
    "authHint": "Requires the Devin CLI binary. Run `devin auth login` to authenticate, or provide your WINDSURF_API_KEY. Install: https://cli.devin.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "codebuddy-cn",
    "name": "CodeBuddy CN",
    "category": "oauth",
    "color": "#006EFF",
    "textIcon": "CB",
    "website": "https://copilot.tencent.com",
    "authHint": "Tencent CodeBuddy CN (copilot.tencent.com). Sign in via the official CLI device-code flow, or paste a direct API key (sent as Authorization: Bearer). Catalog: GLM / Kimi / MiniMax / DeepSeek / Hunyuan.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "codebuddy-intl",
    "name": "CodeBuddy Intl",
    "category": "oauth",
    "color": "#006EFF",
    "textIcon": "CB",
    "website": "https://www.codebuddy.ai",
    "authHint": "CodeBuddy International (codebuddy.ai). Sign in via the device-code flow, or paste a direct API key (sent as Authorization: Bearer). Catalog: GLM / Kimi / MiniMax / DeepSeek / Hunyuan.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "workbuddy",
    "name": "WorkBuddy",
    "category": "oauth",
    "color": "#1A73E8",
    "textIcon": "WB",
    "website": "https://www.workbuddy.ai",
    "authHint": "Tencent WorkBuddy (www.workbuddy.ai). Authorize the CLI device flow in the popup; OmniRoute then polls for the token and attaches the required X-Product: SaaS header. The model roster is served by the authenticated catalogue, so it is discovered live rather than listed here. WorkBuddy only accepts streaming requests, which OmniRoute accumulates back into a JSON response for non-streaming callers.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "muse-code",
    "name": "Muse Code (Meta)",
    "category": "oauth",
    "color": "#0866FF",
    "textIcon": "MC",
    "website": "https://ai.developer.meta.com/docs/muse-code/auth",
    "authHint": "Sign in with the Muse Code device flow (same as `muse login` / CLIProxyAPI `-meta-login`) to use a Muse subscription, or paste a META_API_KEY. Device login keeps the durable dca token and mints the inference key; a 401 remints that key. Wire format is OpenAI Responses (POST /responses).",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm",
      "image"
    ]
  },
  {
    "id": "freebuff",
    "name": "Freebuff",
    "category": "oauth",
    "color": "#10B981",
    "textIcon": "FB",
    "website": "https://freebuff.com",
    "authHint": "Sign in with the Freebuff browser login (same as `freebuff login`), or paste an existing Freebuff / Codebuff auth token. The token has no refresh grant — when it expires, sign in again.",
    "freeNote": "Free Freebuff models (official client only); paid API: freebuff.com/account/api.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "chatgpt-web",
    "name": "ChatGPT Web (Clean Room)",
    "category": "web-cookie",
    "color": "#10A37F",
    "textIcon": "CG",
    "website": "https://chatgpt.com",
    "authHint": "Paste Playwright-compatible storage-state JSON exported from a logged-in chatgpt.com browser context. Cookie headers and individual token values are not accepted.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "chatgpt-web-codex",
    "name": "ChatGPT Web (Codex)",
    "category": "web-cookie",
    "color": "#10A37F",
    "textIcon": "CC",
    "website": "https://chatgpt.com",
    "authHint": "Paste the full ChatGPT Cookie header. OmniRoute verifies it in an isolated headless browser profile.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "grok-web",
    "name": "Grok Web (Subscription)",
    "category": "web-cookie",
    "color": "#1DA1F2",
    "textIcon": "GW",
    "website": "https://grok.com",
    "authHint": "Paste the full grok.com cookie line from DevTools → Application → Cookies. Include both `sso` and `sso-rw` (e.g. `sso=...; sso-rw=...`) — Grok's anti-bot rejects `sso` on its own.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "gemini-web",
    "name": "Gemini Web (Free)",
    "category": "web-cookie",
    "color": "#4285F4",
    "textIcon": "GWeb",
    "website": "https://gemini.google.com",
    "authHint": "Paste the full cookie header, the __Secure-1PSID value, or the JSON export containing cookies from gemini.google.com. Include __Secure-1PSIDTS and __Secure-1PSIDCC when available.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "perplexity-web",
    "name": "Perplexity Web (Pro/Max)",
    "category": "web-cookie",
    "color": "#20808D",
    "textIcon": "PW",
    "website": "https://www.perplexity.ai",
    "authHint": "Paste your __Secure-next-auth.session-token cookie value from perplexity.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "blackbox-web",
    "name": "Blackbox Web (Subscription)",
    "category": "web-cookie",
    "color": "#1A1A2E",
    "textIcon": "BW",
    "website": "https://app.blackbox.ai",
    "authHint": "Paste your __Secure-authjs.session-token value or full cookie header from app.blackbox.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "muse-spark-web",
    "name": "Muse Spark Web (Meta AI)",
    "category": "web-cookie",
    "color": "#0866FF",
    "textIcon": "MS",
    "website": "https://www.meta.ai",
    "authHint": "Paste your ecto_1_sess cookie AND the ecto1:... WS auth token from meta.ai. Capture the ecto1: token in DevTools → Network → WS → the clippy request's Authorization query param. Example: ecto_1_sess=4240a308...NVDg0; ecto1:ABCD...",
    "freeNote": "Free with login — Meta AI platform with Llama models.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "claude-web",
    "name": "Claude Web",
    "category": "web-cookie",
    "color": "#D97757",
    "textIcon": "CW",
    "website": "https://claude.ai",
    "authHint": "Paste your session cookie from claude.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/claude-web.svg"
  },
  {
    "id": "deepseek-web",
    "name": "DeepSeek Web",
    "category": "web-cookie",
    "color": "#4D6BFE",
    "textIcon": "DS",
    "website": "https://chat.deepseek.com",
    "authHint": "Paste your userToken from chat.deepseek.com — DevTools → Application → Local Storage → userToken",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "copilot-web",
    "name": "Microsoft Copilot Web",
    "category": "web-cookie",
    "color": "#0078D4",
    "textIcon": "CP",
    "website": "https://copilot.microsoft.com",
    "authHint": "Paste the access_token from an authenticated copilot.microsoft.com request (DevTools → Network → Authorization), or export a HAR while logged in",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "copilot-m365-web",
    "name": "Microsoft 365 Copilot",
    "category": "web-cookie",
    "color": "#0078D4",
    "textIcon": "M365",
    "website": "https://m365.cloud.microsoft/chat",
    "authHint": "Use native Microsoft sign-in to connect your work or school account. Legacy HAR import remains available for captured Chathub sessions; manually imported credentials may expire. Model availability depends on your account and license. This is an unofficial integration.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "image"
    ]
  },
  {
    "id": "t3-web",
    "name": "t3.chat (Pro/Free)",
    "category": "web-cookie",
    "color": "#7C3AED",
    "textIcon": "T3",
    "website": "https://t3.chat",
    "authHint": "Open t3.chat in your browser, log in, then open DevTools → Application → Local Storage → https://t3.chat. Copy the value of 'convex-session-id'. Also open DevTools → Network, copy the Cookie header from any request. Paste both values here. See provider setup docs for a step-by-step guide.",
    "freeNote": "Free tier gives limited model access. Pro ($8/month) unlocks 50+ models.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/t3-web.svg"
  },
  {
    "id": "inner-ai",
    "name": "Inner.ai (Subscription)",
    "category": "web-cookie",
    "color": "#1A56DB",
    "textIcon": "IA",
    "website": "https://app.innerai.com",
    "authHint": "Paste your token cookie and email separated by a space: open DevTools → Application → Cookies → .innerai.com, copy the token value, then append a space and your Inner.ai login email. Example: eyJhbG... user@example.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "adapta-web",
    "name": "Adapta.org (Adapta One Web)",
    "category": "web-cookie",
    "color": "#6E3AD3",
    "textIcon": "AW",
    "website": "https://agent.adapta.one",
    "authHint": "Paste your __client cookie value from .clerk.agent.adapta.one (DevTools → Application → Cookies)",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "lmarena",
    "name": "Arena (Free)",
    "category": "web-cookie",
    "color": "#FF6B6B",
    "textIcon": "AR",
    "website": "https://arena.ai",
    "authHint": "Paste the full Cookie header from arena.ai (DevTools → Network → request → Cookie). Include arena-auth-prod-v1.0/.1… and cf_clearance/__cf_bm when present. OmniRoute uses Chrome TLS impersonation; if Arena still 403s, set providerSpecificData.recaptchaV3Token from a live browser session.",
    "freeNote": "Free model comparison platform (formerly LMArena) at arena.ai — Direct-chat catalog of chat models (GPT, Claude, Gemini, Llama, …). No subscription required.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "image"
    ]
  },
  {
    "id": "yuanbao-web",
    "name": "Tencent Yuanbao (Free)",
    "category": "web-cookie",
    "color": "#0052D9",
    "textIcon": "YB",
    "website": "https://yuanbao.tencent.com",
    "authHint": "Log in to yuanbao.tencent.com, then paste the full Cookie header (DevTools → Network → any /api request → Request Headers → Cookie). It must contain hy_user and hy_token.",
    "freeNote": "Free consumer web session — DeepSeek V3/R1 and Hunyuan / Hunyuan-T1, optional web search. No subscription required. Rate limits apply.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/yuanbao-web.svg"
  },
  {
    "id": "tencent-aistudio-web",
    "name": "Tencent AI Studio (Free)",
    "category": "web-cookie",
    "color": "#0052D9",
    "textIcon": "TAS",
    "website": "https://aistudio.tencent.ai",
    "authHint": "Log in to aistudio.tencent.ai, open DevTools -> Network, copy any request Cookie header containing session tokens.",
    "freeNote": "Free web session on Tencent AI Studio (aistudio.tencent.ai) — Direct chat with Hunyuan models (hy3-g, HunyuanDefault, Hunyuan3D). Cookie authentication.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "huggingchat",
    "name": "HuggingChat (Free)",
    "category": "web-cookie",
    "color": "#FFD21E",
    "textIcon": "HC",
    "website": "https://huggingface.co/chat",
    "authHint": "Paste the full Cookie header from huggingface.co/chat (DevTools → Network → /chat/conversation → Request Headers → Cookie). It should include hf-chat and may also include token / aws-waf-token.",
    "freeNote": "Free LLM chat — no subscription required. Rate limits apply.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/huggingchat.svg"
  },
  {
    "id": "poe-web",
    "name": "Poe Web (Subscription)",
    "category": "web-cookie",
    "color": "#6C3AED",
    "textIcon": "PW",
    "website": "https://poe.com",
    "authHint": "Paste your p-b cookie value from poe.com (DevTools → Application → Cookies → p-b)",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "venice-web",
    "name": "Venice Web (Privacy)",
    "category": "web-cookie",
    "color": "#22C55E",
    "textIcon": "VW",
    "website": "https://venice.ai",
    "authHint": "Paste your __client cookie value from .clerk.venice.ai (DevTools → Application → Cookies)",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "v0-vercel-web",
    "name": "v0 Vercel Web (Code Gen)",
    "category": "web-cookie",
    "color": "#000000",
    "textIcon": "V0",
    "website": "https://v0.dev",
    "authHint": "Paste your session cookie from v0.dev (DevTools → Application → Cookies)",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "kimi-web",
    "name": "Kimi Web",
    "category": "web-cookie",
    "color": "#2563EB",
    "textIcon": "KW",
    "website": "https://www.kimi.ai",
    "authHint": "Paste access_token from www.kimi.ai DevTools → Application → Local Storage. A legacy kimi-auth cookie is also accepted.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "doubao-web",
    "name": "Dola Web (ByteDance)",
    "category": "web-cookie",
    "color": "#3B82F6",
    "textIcon": "DA",
    "website": "https://www.dola.com",
    "authHint": "Paste the full Cookie header from www.dola.com. It should include sessionid, ttwid, and s_v_web_id. If s_v_web_id is unavailable, fp=verify_... from a chat/completion request URL can be used as a fallback.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "zenmux-free",
    "name": "ZenMux Free (Web)",
    "category": "web-cookie",
    "color": "#667eea",
    "textIcon": "ZF",
    "website": "https://zenmux.ai",
    "authHint": "Login at zenmux.ai, then export all cookies using EditThisCookie or Cookie-Editor and paste the full Cookie header string here. Refresh every ~30 days.",
    "freeNote": "Free tier (5 Flows/5h, 38.64 Flows/week) — DeepSeek V3.2, GLM 4.7 Flash Free and more. No subscription required.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/zenmux-free.svg"
  },
  {
    "id": "tinycms-web",
    "name": "TinyCMS Web (Free/Sub)",
    "category": "web-cookie",
    "color": "#ED8936",
    "textIcon": "TC",
    "website": "https://site.tinycms.xyz",
    "authHint": "Go to site.tinycms.xyz, open DevTools → Application → Local Storage, copy the value of 'app-config-uuid' (starts with 'R'), and paste it here.",
    "freeNote": "Free tier has access to GPT 5.4, Gemini 3.5, and Grok 4.20 models. No login required. Subscription grants 300 requests/day for advanced models.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "zai-web",
    "name": "Z.ai Web",
    "category": "web-cookie",
    "color": "#2563EB",
    "textIcon": "ZW",
    "website": "https://chat.z.ai",
    "authHint": "Copy the \"token\" value from chat.z.ai → DevTools → Application → Local Storage. Do not copy cookies; OmniRoute handles the per-request CAPTCHA through its browser transport.",
    "freeNote": "Consumer web session for the four models currently visible in chat.z.ai. Distinct from the API-key zai/glm providers.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "promptql",
    "name": "PromptQL (Unofficial/Experimental)",
    "category": "web-cookie",
    "color": "#5B21B6",
    "textIcon": "PQL",
    "website": "https://prompt.ql.app",
    "authHint": "Paste the Bearer JWT from prompt.ql.app DevTools → Network → graphql → Authorization (token only). Optional projectId + session Cookie for refresh.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "notion-web",
    "name": "Notion AI Web (Unofficial/Experimental)",
    "category": "web-cookie",
    "color": "#000000",
    "textIcon": "NW",
    "website": "https://www.notion.so",
    "authHint": "Paste only the token_v2 cookie VALUE from app.notion.com (DevTools → Application → Cookies → token_v2). Do not paste token_v2= or the full Cookie header. Workspace is auto-detected; space_id / notion_user_id are optional.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "adobe-firefly",
    "name": "Adobe Firefly (Image/Video)",
    "category": "web-cookie",
    "color": "#EB1000",
    "textIcon": "FF",
    "website": "https://firefly.adobe.com",
    "authHint": "RECOMMENDED: firefly.adobe.com signed-in → F12 → Network → click firefly-3p.ff.adobe.io (generate-async or models/discovery) → Request Headers → Authorization → copy the token AFTER 'Bearer ' (starts with eyJ…). Cookie-only from firefly.adobe.com mints a GUEST token → 401/403; only multi-domain IMS cookies (adobelogin.com) or that Bearer JWT work. Unofficial/experimental media + Limits.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "video",
      "image"
    ]
  },
  {
    "id": "hyperagent",
    "name": "HyperAgent (Unofficial/Experimental)",
    "category": "web-cookie",
    "color": "#6C5CE7",
    "textIcon": "HA",
    "website": "https://hyperagent.com",
    "authHint": "Paste the full Cookie header from hyperagent.com (DevTools → Network → any request → Request Headers → Cookie). Session cookies power chat + billing usage.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "notrack-web",
    "name": "NoTrack Web (Free)",
    "category": "web-cookie",
    "color": "#0EA5E9",
    "textIcon": "NT",
    "website": "https://notrack.ai",
    "authHint": "Log in to notrack.ai, then paste the full Cookie header (DevTools → Network → any /api request → Request Headers → Cookie). It must contain uid, si_usr_id, and si_ses_id.",
    "freeNote": "Free consumer chat session on notrack.ai — Direct chat with the notrack C assistant. No subscription required; rate limits apply.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/notrack-web.svg"
  },
  {
    "id": "conol-web",
    "name": "Conol (Unofficial/Experimental)",
    "category": "web-cookie",
    "color": "#F6C945",
    "textIcon": "CO",
    "website": "https://conol.ai",
    "authHint": "Use browser sign-in, or paste the full Cookie header from conol.ai. The __Secure-better-auth.session_token cookie is required.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "twinmind",
    "name": "Twinmind (Unofficial/Experimental)",
    "category": "web-cookie",
    "color": "#4F46E5",
    "textIcon": "TM",
    "website": "https://app.twinmind.com",
    "authHint": "Paste the stsTokenManager JSON from app.twinmind.com IndexedDB (accessToken + refreshToken). Chat uses accessToken; refreshToken mints a new JWT when it expires.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "syntx",
    "name": "SYNTX.ai (Unofficial/Experimental)",
    "category": "web-cookie",
    "color": "#FF4D00",
    "textIcon": "SX",
    "website": "https://syntx.ai",
    "authHint": "Paste the Authorization Bearer JWT from syntx.ai (DevTools → Network → api.syntx.ai → Request Headers). Chat, models, Limits, and media use this token.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "stt",
      "tts",
      "video",
      "music",
      "image"
    ]
  },
  {
    "id": "maxai",
    "name": "MaxAI",
    "category": "web-cookie",
    "color": "#6D28D9",
    "textIcon": "MX",
    "website": "https://www.maxai.co",
    "authHint": "Sign in once (email code or browser) to mint a MaxAI access token. OmniRoute signs each request, routes it through residential egress, and refreshes the token browserlessly, so a connection stays valid for about a year without re-login.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "image"
    ]
  },
  {
    "id": "uc",
    "name": "UC (uncensored.com)",
    "category": "web-cookie",
    "color": "#111827",
    "textIcon": "UC",
    "website": "https://uncensored.com",
    "authHint": "Sign in once with an email code to bootstrap a UC (uncensored.com) subscription session. OmniRoute mints a fresh short-lived token per request browserlessly, so the connection renews on its own; you only re-run the email login about once a month when the subscription session rolls over.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "tts",
      "video",
      "image"
    ]
  },
  {
    "id": "chatplayground",
    "name": "ChatPlayground",
    "category": "web-cookie",
    "color": "#7C3AED",
    "textIcon": "CP",
    "website": "https://web.chatplayground.ai",
    "authHint": "Paste your Clerk session token or full cookie export containing __client and __session from web.chatplayground.ai. OmniRoute auto-mints fresh short-lived Clerk session JWTs.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "mlx-gemma",
    "name": "MLX Gemma 26B",
    "category": "local",
    "color": "#8B5CF6",
    "textIcon": "MG",
    "website": "https://github.com/ml-explore/mlx",
    "authHint": "No API key required. Runs mlx-lm server locally on port 11435. Requires uv and mlx-lm installed. Model: mlx-community/gemma-4-26B-A4B-it-qat-q4_0-mlx-aligned (~15.9GB peak memory).",
    "localDefault": "http://localhost:11435/v1",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "mlx-qwen",
    "name": "MLX Qwen 3.8 27B",
    "category": "local",
    "color": "#EC4899",
    "textIcon": "MQ",
    "website": "https://github.com/ml-explore/mlx",
    "authHint": "No API key required. Runs mlx-lm server locally on port 11436. Requires uv and mlx-lm installed. Model: maglun/Qwen3.8-27B-MLX-Mixed-3.80bpw (~13.1GB peak memory).",
    "localDefault": "http://localhost:11436/v1",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "ollama-local",
    "name": "Ollama",
    "category": "local",
    "color": "#58A6FF",
    "textIcon": "OL",
    "website": "https://ollama.com",
    "authHint": "No API key required. Ollama runs locally — configure its OpenAI-compatible base URL (default: http://localhost:11434/v1) and make sure Ollama is running before connecting.",
    "localDefault": "http://localhost:11434/v1",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm",
      "embedding"
    ]
  },
  {
    "id": "lm-studio",
    "name": "LM Studio",
    "category": "local",
    "color": "#4A148C",
    "textIcon": "LM",
    "website": "https://lmstudio.ai",
    "authHint": "API key optional. Configure the local LM Studio OpenAI-compatible base URL (default: http://localhost:1234/v1).",
    "localDefault": "http://localhost:1234/v1",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "opencode-server",
    "name": "OpenCode CLI Server",
    "category": "local",
    "color": "#F59E0B",
    "textIcon": "OC",
    "website": "https://opencode.ai/docs/server/",
    "authHint": "No API key required. Uses the opencode CLI's own headless server (`opencode serve`), which holds the opencode credential and talks to the opencode upstream. Set the server URL in the provider settings and start the server from Providers > Services > OpenCode (loopback URLs only, binary from OPENCODE_SERVER_BIN or the usual install locations) or run `opencode serve` yourself; requests never start it.",
    "localDefault": "http://127.0.0.1:4096",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "vllm",
    "name": "vLLM",
    "category": "local",
    "color": "#0F766E",
    "textIcon": "VL",
    "website": "https://github.com/vllm-project/vllm",
    "authHint": "API key optional. Configure the local vLLM OpenAI-compatible base URL (default: http://localhost:8000/v1).",
    "localDefault": "http://localhost:8000/v1",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/vllm.svg"
  },
  {
    "id": "lemonade",
    "name": "Lemonade Server",
    "category": "local",
    "color": "#F59E0B",
    "textIcon": "LM",
    "website": "https://lemonade-server.ai",
    "authHint": "API key optional. Configure the local Lemonade OpenAI-compatible base URL (default: http://localhost:13305/api/v1).",
    "localDefault": "http://localhost:13305/api/v1",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm",
      "embedding"
    ]
  },
  {
    "id": "llamafile",
    "name": "Llamafile",
    "category": "local",
    "color": "#EA580C",
    "textIcon": "LF",
    "website": "https://github.com/Mozilla-Ocho/llamafile",
    "authHint": "API key optional. Configure the local Llamafile OpenAI-compatible base URL (default: http://127.0.0.1:8080/v1).",
    "localDefault": "http://127.0.0.1:8080/v1",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "llama-cpp",
    "name": "llama.cpp",
    "category": "local",
    "color": "#795548",
    "textIcon": "LC",
    "website": "https://github.com/ggml-org/llama.cpp",
    "authHint": "API key optional (use any value, e.g. sk-no-key-required). Configure the llama-server OpenAI-compatible base URL (default: http://127.0.0.1:8080/v1). Note: if Llamafile is also installed, both default to port 8080 — run only one at a time or override the port.",
    "localDefault": "http://127.0.0.1:8080/v1",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm",
      "embedding"
    ]
  },
  {
    "id": "triton",
    "name": "NVIDIA Triton",
    "category": "local",
    "color": "#76B900",
    "textIcon": "TR",
    "website": "https://developer.nvidia.com/triton-inference-server",
    "authHint": "API key optional. Configure the Triton OpenAI-compatible base URL (default: http://localhost:8000/v1).",
    "localDefault": "http://localhost:8000/v1",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "docker-model-runner",
    "name": "Docker Model Runner",
    "category": "local",
    "color": "#2496ED",
    "textIcon": "DM",
    "website": "https://docs.docker.com/ai/model-runner/",
    "authHint": "API key optional. Configure the local Docker Model Runner OpenAI-compatible base URL (default: http://localhost:12434/engines/v1).",
    "localDefault": "http://localhost:12434/engines/v1",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "xinference",
    "name": "XInference",
    "category": "local",
    "color": "#DC2626",
    "textIcon": "XI",
    "website": "https://inference.readthedocs.io",
    "authHint": "API key optional. Configure the local XInference OpenAI-compatible base URL (default: http://localhost:9997/v1).",
    "localDefault": "http://localhost:9997/v1",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/xinference.svg"
  },
  {
    "id": "oobabooga",
    "name": "oobabooga",
    "category": "local",
    "color": "#8B5CF6",
    "textIcon": "OO",
    "website": "https://github.com/oobabooga/text-generation-webui",
    "authHint": "API key optional. Configure the local oobabooga OpenAI-compatible base URL (default: http://localhost:5000/v1).",
    "localDefault": "http://localhost:5000/v1",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "sdwebui",
    "name": "SD WebUI",
    "category": "local",
    "color": "#FF7043",
    "textIcon": "SD",
    "website": "https://github.com/AUTOMATIC1111/stable-diffusion-webui",
    "authHint": "No API key required. Configure the local WebUI base URL (default: http://localhost:7860).",
    "localDefault": "http://localhost:7860",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "video",
      "image"
    ]
  },
  {
    "id": "comfyui",
    "name": "ComfyUI",
    "category": "local",
    "color": "#4CAF50",
    "textIcon": "CF",
    "website": "https://github.com/comfyanonymous/ComfyUI",
    "authHint": "No API key required. Configure the local ComfyUI base URL (default: http://localhost:8188).",
    "localDefault": "http://localhost:8188",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "video",
      "music",
      "image"
    ],
    "logo": "./providers/comfyui.svg"
  },
  {
    "id": "codex-search",
    "name": "Codex Web Search (ChatGPT)",
    "category": "search",
    "color": "#10A37F",
    "textIcon": "CS",
    "website": "https://chatgpt.com",
    "authHint": "Uses your connected OpenAI Codex (ChatGPT) accounts — no separate key. Each search spends Codex subscription quota (~10k input tokens) and takes ~10–40 s.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch"
    ]
  },
  {
    "id": "perplexity-search",
    "name": "Perplexity Search",
    "category": "search",
    "color": "#20808D",
    "textIcon": "PS",
    "website": "https://docs.perplexity.ai/guides/search-quickstart",
    "authHint": "Same API key as Perplexity (pplx-...)",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch"
    ]
  },
  {
    "id": "serper-search",
    "name": "Serper Search",
    "category": "search",
    "color": "#4285F4",
    "textIcon": "SP",
    "website": "https://serper.dev",
    "authHint": "API key from serper.dev dashboard",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch"
    ]
  },
  {
    "id": "brave-search",
    "name": "Brave Search",
    "category": "search",
    "color": "#FB542B",
    "textIcon": "BR",
    "website": "https://brave.com/search/api",
    "authHint": "Subscription token from Brave Search API dashboard",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch"
    ]
  },
  {
    "id": "exa-search",
    "name": "Exa Search",
    "category": "search",
    "color": "#1E40AF",
    "textIcon": "EX",
    "website": "https://exa.ai",
    "authHint": "API key from dashboard.exa.ai",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch",
      "webFetch"
    ]
  },
  {
    "id": "tavily-search",
    "name": "Tavily Search",
    "category": "search",
    "color": "#5B4FDB",
    "textIcon": "TV",
    "website": "https://tavily.com",
    "authHint": "API key from app.tavily.com (format: tvly-...)",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch",
      "webFetch"
    ]
  },
  {
    "id": "anysearch-search",
    "name": "AnySearch",
    "category": "search",
    "color": "#0D9488",
    "textIcon": "AS",
    "website": "https://anysearch.com",
    "authHint": "Optional API key from anysearch.com (as_sk_...) - free 1000/day; keyless tier has lower limits",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch",
      "webFetch"
    ]
  },
  {
    "id": "firecrawl",
    "name": "Firecrawl",
    "category": "search",
    "color": "#FB923C",
    "textIcon": "FC",
    "website": "https://firecrawl.dev",
    "authHint": "API key from firecrawl.dev/app/api-keys (or set your self-hosted Firecrawl base URL)",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch",
      "webFetch"
    ]
  },
  {
    "id": "google-pse-search",
    "name": "Google Programmable Search",
    "category": "search",
    "color": "#4285F4",
    "textIcon": "GP",
    "website": "https://developers.google.com/custom-search/v1/overview",
    "authHint": "Requires a Google API key and your Programmable Search Engine ID (cx)",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch"
    ]
  },
  {
    "id": "nimble-search",
    "name": "Nimble Search",
    "category": "search",
    "color": "#6D28D9",
    "textIcon": "NB",
    "website": "https://docs.nimbleway.com/nimble-sdk/web-tools/search",
    "authHint": "Bearer API key from the Nimble dashboard",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch",
      "webFetch"
    ]
  },
  {
    "id": "parallel-search",
    "name": "Parallel Search",
    "category": "search",
    "color": "#0F172A",
    "textIcon": "PA",
    "website": "https://parallel.ai",
    "authHint": "API key from platform.parallel.ai (sent as x-api-key)",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch",
      "webFetch"
    ]
  },
  {
    "id": "keenable-search",
    "name": "Keenable Search",
    "category": "search",
    "color": "#005CFF",
    "textIcon": "KE",
    "website": "https://keenable.ai",
    "authHint": "API key optional (keen_...) - keyless works at 10 req/s and 1000 req/hour per IP; a key from keenable.ai lifts the limits",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch",
      "webFetch"
    ]
  },
  {
    "id": "linkup-search",
    "name": "Linkup Search",
    "category": "search",
    "color": "#0F766E",
    "textIcon": "LU",
    "website": "https://docs.linkup.so",
    "authHint": "Bearer API key from the Linkup dashboard",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch"
    ]
  },
  {
    "id": "searchapi-search",
    "name": "SearchAPI",
    "category": "search",
    "color": "#2563EB",
    "textIcon": "SA",
    "website": "https://www.searchapi.io/docs/google",
    "authHint": "API key from SearchAPI (query param or Bearer auth)",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch"
    ]
  },
  {
    "id": "youcom-search",
    "name": "You.com Search",
    "category": "search",
    "color": "#2563EB",
    "textIcon": "YOU",
    "website": "https://you.com/business/api/",
    "authHint": "X-API-Key from the You.com platform dashboard",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch"
    ]
  },
  {
    "id": "searxng-search",
    "name": "SearXNG Search",
    "category": "search",
    "color": "#1A237E",
    "textIcon": "SX",
    "website": "https://docs.searxng.org",
    "authHint": "API key is optional. Set your SearXNG base URL. Some instances may require a bearer token for access.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch"
    ]
  },
  {
    "id": "x-search",
    "name": "X Search (Grok)",
    "category": "search",
    "color": "#000000",
    "textIcon": "X",
    "website": "https://docs.x.ai/developers/tools/x-search",
    "authHint": "SuperGrok OAuth (xai-oauth) or xAI API key. This is Grok X Search, not the X Developer MCP.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch"
    ]
  },
  {
    "id": "xquik-search",
    "name": "Xquik X Search",
    "category": "search",
    "color": "#111827",
    "textIcon": "XQ",
    "website": "https://docs.xquik.com",
    "authHint": "Xquik API key (xq_...). Search is metered per returned post; the catalog estimate uses 5 results.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch"
    ]
  },
  {
    "id": "ollama-search",
    "name": "Ollama Search",
    "category": "search",
    "color": "#58A6FF",
    "textIcon": "OS",
    "website": "https://ollama.com/settings/keys",
    "authHint": "Same API key as Ollama Cloud (from ollama.com/settings/keys)",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch"
    ]
  },
  {
    "id": "kimi-search",
    "name": "Kimi Search",
    "category": "search",
    "color": "#2563EB",
    "textIcon": "KM",
    "website": "https://platform.kimi.ai/docs/api/tools-search",
    "authHint": "Moonshot AI API key (MOONSHOT_API_KEY) from platform.kimi.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch"
    ]
  },
  {
    "id": "context7",
    "name": "Context7 (library docs)",
    "category": "search",
    "color": "#6B4FBB",
    "textIcon": "C7",
    "website": "https://context7.com",
    "authHint": "API key optional (ctx7sk-...) — anonymous tier works without a key; a key raises the rate limit",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webSearch",
      "webFetch"
    ]
  },
  {
    "id": "deepgram",
    "name": "Deepgram",
    "category": "audio",
    "color": "#13EF93",
    "textIcon": "DG",
    "website": "https://deepgram.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "stt",
      "tts"
    ],
    "logo": "./providers/deepgram.svg"
  },
  {
    "id": "assemblyai",
    "name": "AssemblyAI",
    "category": "audio",
    "color": "#0062FF",
    "textIcon": "AA",
    "website": "https://assemblyai.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "stt"
    ],
    "logo": "./providers/assemblyai.svg"
  },
  {
    "id": "soniox",
    "name": "Soniox",
    "category": "audio",
    "color": "#5B5BD6",
    "textIcon": "SX",
    "website": "https://soniox.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "stt",
      "tts"
    ]
  },
  {
    "id": "elevenlabs",
    "name": "ElevenLabs",
    "category": "audio",
    "color": "#6C47FF",
    "textIcon": "EL",
    "website": "https://elevenlabs.io",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "tts",
      "music"
    ],
    "logo": "./providers/elevenlabs.svg"
  },
  {
    "id": "cartesia",
    "name": "Cartesia",
    "category": "audio",
    "color": "#FF4F8B",
    "textIcon": "CA",
    "website": "https://cartesia.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "tts"
    ]
  },
  {
    "id": "fishaudio",
    "name": "Fish Audio",
    "category": "audio",
    "color": "#3B82F6",
    "textIcon": "FA",
    "website": "https://fish.audio",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "tts"
    ]
  },
  {
    "id": "playht",
    "name": "PlayHT",
    "category": "audio",
    "color": "#00B4D8",
    "textIcon": "PH",
    "website": "https://play.ht",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "tts"
    ]
  },
  {
    "id": "inworld",
    "name": "Inworld",
    "category": "audio",
    "color": "#7B2EF2",
    "textIcon": "IW",
    "website": "https://inworld.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "tts"
    ]
  },
  {
    "id": "aws-polly",
    "name": "AWS Polly",
    "category": "audio",
    "color": "#FF9900",
    "textIcon": "PL",
    "website": "https://aws.amazon.com/polly/",
    "authHint": "Use AWS Secret Access Key as API key; set providerSpecificData.accessKeyId and optional region.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "tts"
    ]
  },
  {
    "id": "gladia",
    "name": "Gladia",
    "category": "audio",
    "color": "#6425FE",
    "textIcon": "GL",
    "website": "https://gladia.io",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "stt"
    ]
  },
  {
    "id": "rev-ai",
    "name": "Rev AI",
    "category": "audio",
    "color": "#FF5C35",
    "textIcon": "RV",
    "website": "https://www.rev.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "stt"
    ]
  },
  {
    "id": "speechmatics",
    "name": "Speechmatics",
    "category": "audio",
    "color": "#0A2540",
    "textIcon": "SM",
    "website": "https://www.speechmatics.com",
    "freeNote": "Free tier — 8 hours/month, no credit card required. Batch (async) mode only.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "stt"
    ]
  },
  {
    "id": "cliproxyapi",
    "name": "CLIProxyAPI",
    "category": "upstream-proxy",
    "color": "#6366F1",
    "textIcon": "CPA",
    "website": "https://github.com/router-for-me/CLIProxyAPI",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": []
  },
  {
    "id": "9router",
    "name": "9router",
    "category": "upstream-proxy",
    "color": "#0EA5E9",
    "textIcon": "9R",
    "website": "https://www.npmjs.com/package/9router",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": []
  },
  {
    "id": "jules",
    "name": "Google Jules",
    "category": "cloud-agent",
    "color": "#4285F4",
    "textIcon": "JL",
    "website": "https://jules.google",
    "authHint": "Jules API key for creating and managing cloud coding tasks.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": []
  },
  {
    "id": "devin",
    "name": "Devin",
    "category": "cloud-agent",
    "color": "#111827",
    "textIcon": "DV",
    "website": "https://devin.ai",
    "authHint": "Devin API key for cloud agent sessions.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": []
  },
  {
    "id": "codex-cloud",
    "name": "Codex Cloud",
    "category": "cloud-agent",
    "color": "#10A37F",
    "textIcon": "CC",
    "website": "https://openai.com/codex",
    "authHint": "OpenAI API key with Codex Cloud task access.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": []
  },
  {
    "id": "ainetcafe",
    "name": "ainetcafe",
    "category": "apikey",
    "color": "#32FEA5",
    "textIcon": "AIN",
    "website": "https://ainetcafe.com/k3/",
    "apiHint": "Create an API key in the ainetcafe console (Token Management), then use https://microquickjs.com/v1 as the OpenAI-compatible base URL. Kimi K3 is served as model ID Kimi-K3.",
    "freeNote": "Sign-up credit toward available models; amount and eligibility are set by ainetcafe, not OmniRoute.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "onomeo",
    "name": "onomeo",
    "category": "apikey",
    "color": "#C2410C",
    "textIcon": "ONO",
    "website": "https://onomeo.com",
    "apiHint": "Create an API key on the onomeo dashboard, then use https://onomeo.com/v1 as the OpenAI-compatible base URL. Models are served by third-party upstreams, some of which may train on prompts; each model page on onomeo.com states this. onomeo is in public beta: not every feature is guaranteed to work, and feedback is welcome at https://onomeo.com/feedback.",
    "freeNote": "Sign in (email code, Google or GitHub, no card). About 30 free models are metered by calls: 30 calls per 5 hours per account and 12 requests/min per key, within a site-wide pool shared by all accounts. Claude, GPT and other large models are paid from a USD balance at per-model prices; during the beta an account can spend at most $0.50/day on them. Optional top-up from $5 (balance never expires, no auto-renewal) raises the free-model limit to 90 calls per 5 hours for 35 days.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "unifically",
    "name": "Unifically",
    "category": "apikey",
    "color": "#10B981",
    "textIcon": "UNI",
    "website": "https://unifically.com",
    "apiHint": "Create a Unifically API key at https://unifically.com/api-keys, then use https://api.unifically.com/v1 as the OpenAI-compatible base URL. Pay per use, no subscription. Chat models only through this entry; the media models in the same catalog use a separate async task API.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "oneminai",
    "name": "1min.AI",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "1M",
    "website": "https://1min.ai",
    "authHint": "Create an API key at https://docs.1min.ai/docs/api/create-api-key, then paste it here.",
    "apiHint": "1min.ai uses a proprietary chat API (single prompt string + SSE) instead of OpenAI chat/completions. OmniRoute flattens OpenAI messages into a labeled prompt and translates the SSE stream.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "cheaperinference",
    "name": "Cheaper Inference",
    "category": "apikey",
    "color": "#31f889",
    "textIcon": "CI",
    "website": "https://cheaperinference.com/?utm_source=omniroute",
    "apiHint": "Create an API key at https://cheaperinference.com/?utm_source=omniroute (needs the `inference` scope), then paste the ir_live_… token here.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm",
      "image"
    ]
  },
  {
    "id": "charm-hyper",
    "name": "Charm Hyper",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "CH",
    "website": "https://hyper.charm.land",
    "apiHint": "Create an API key at https://hyper.charm.land, then paste it here as a Bearer token.",
    "freeNote": "100 free monthly Hypercredits on signup",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/charm-hyper.svg"
  },
  {
    "id": "agentrouter",
    "name": "AgentRouter",
    "category": "apikey",
    "color": "#10B981",
    "textIcon": "AR",
    "website": "https://agentrouter.org",
    "apiHint": "Get $200 free credits at https://agentrouter.org/register — no credit card required.",
    "freeNote": "$200 free credits on signup - multi-model routing gateway",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "unorouter",
    "name": "UnoRouter",
    "category": "apikey",
    "color": "#8B5CF6",
    "textIcon": "UR",
    "website": "https://unorouter.ai",
    "apiHint": "Create an API key at https://unorouter.ai, then paste it here as a Bearer token.",
    "freeNote": "Models with the :free suffix do not debit balance; limit is 1 request/minute per free model per user.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "command-code",
    "name": "Command Code",
    "category": "apikey",
    "color": "#111827",
    "textIcon": "CC",
    "website": "https://commandcode.ai/",
    "authHint": "Use a Command Code API key. Requests are sent to Command Code's /provider/v1/chat/completions endpoint.",
    "apiHint": "Create or copy an API key from Command Code, then paste it here as a Bearer token.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "openrouter",
    "name": "OpenRouter",
    "category": "apikey",
    "color": "#F97316",
    "textIcon": "OR",
    "website": "https://openrouter.ai",
    "freeNote": "Free models at $0/token with :free suffix - 20 RPM / 200 RPD",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm",
      "imageToText",
      "stt",
      "video",
      "image",
      "embedding"
    ],
    "logo": "./providers/openrouter.svg"
  },
  {
    "id": "opper",
    "name": "Opper",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "OP",
    "website": "https://opper.ai",
    "apiHint": "Create an API key at https://platform.opper.ai, then paste it here as a Bearer token. OpenAI-compatible endpoint at https://api.opper.ai/v3/compat, with a live /v3/compat/models catalog. Model ids use provider/model format, e.g. anthropic/claude-sonnet-4-6 or openai/gpt-5.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/opper.svg"
  },
  {
    "id": "requesty",
    "name": "Requesty",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "RQ",
    "website": "https://requesty.ai",
    "apiHint": "Create an API key at https://app.requesty.ai, then paste it here as a Bearer token. OpenAI-compatible endpoint at https://router.requesty.ai/v1, with a live /v1/models catalog.",
    "freeNote": "Free tier ~200 requests/day - multi-model routing gateway (300+ models)",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/requesty.svg"
  },
  {
    "id": "zylo-api",
    "name": "Zylo API",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "ZY",
    "website": "https://zyloai.net",
    "apiHint": "Create a free Zylo API key at https://zyloai.net, then use https://api.zyloai.net/v1 as the OpenAI-compatible base URL.",
    "freeNote": "Basic plan: 10 RPM, 7,200 requests/day and 200,000 tokens/day; limited to Basic text models.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "fastrouter",
    "name": "FastRouter",
    "category": "apikey",
    "color": "#F97316",
    "textIcon": "FR",
    "website": "https://fastrouter.ai",
    "apiHint": "Create a FastRouter API key, then use https://api.fastrouter.ai/api/v1 as the OpenAI-compatible base URL.",
    "freeNote": "Models with the :free suffix allow 10 requests/day per organization and model; availability may change.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "anyapi",
    "name": "AnyAPI AI",
    "category": "apikey",
    "color": "#0EA5E9",
    "textIcon": "AA",
    "website": "https://anyapi.ai",
    "apiHint": "Create and verify an AnyAPI account, then use https://api.anyapi.ai/v1 as the OpenAI-compatible base URL.",
    "freeNote": "Free plan: 100,000 ANY Tokens/day and 100 RPM for eligible Free/Basic models; no credit card required.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "electronhub",
    "name": "Electron Hub",
    "category": "apikey",
    "color": "#22C55E",
    "textIcon": "EH",
    "website": "https://www.electronhub.ai",
    "apiHint": "Create a free API key at https://app.electronhub.ai, then use https://api.electronhub.ai/v1 as the OpenAI-compatible base URL.",
    "freeNote": "Free plan: 5 RPM, $0.25 weekly credits and 10 Neutrinos/day for :free models; family budgets also apply.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "llmgateway",
    "name": "LLM Gateway",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "LG",
    "website": "https://llmgateway.io",
    "apiHint": "Create an LLM Gateway API key, then use https://api.llmgateway.io/v1 as the OpenAI-compatible base URL.",
    "freeNote": "Hosted Free plan: free-priced models are limited to 5 requests per 10 minutes when the account has no credits.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "lyceum",
    "name": "Lyceum",
    "category": "apikey",
    "color": "#4F46E5",
    "textIcon": "LY",
    "website": "https://lyceum.technology",
    "apiHint": "Create a Lyceum API key (lk_…), then use https://api.lyceum.technology/openai/v1 as the OpenAI-compatible base URL.",
    "freeNote": "Includes monthly free credits toward serverless inference usage.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "llm-kiwi",
    "name": "LLM.Kiwi",
    "category": "apikey",
    "color": "#84CC16",
    "textIcon": "LK",
    "website": "https://llm.kiwi",
    "apiHint": "Create a free LLM.Kiwi key, then use https://api.llm.kiwi/v1 as the OpenAI-compatible base URL.",
    "freeNote": "Free plan exposes auto and hrLLM; the published 40 requests/hour limit applies to hrLLM.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "literouter",
    "name": "LiteRouter",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "LR",
    "website": "https://literouter.com",
    "apiHint": "Create a LiteRouter API key, then use https://api.literouter.com/v1 as the OpenAI-compatible base URL.",
    "freeNote": "Free model variants use the :free suffix; daily credit limits vary by model and free input is capped at 5,000 tokens.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "greenpt",
    "name": "GreenPT",
    "category": "apikey",
    "color": "#15803D",
    "textIcon": "GPT",
    "website": "https://greenpt.com",
    "apiHint": "Create a GreenPT API key, then use https://api.greenpt.ai/v1 as the OpenAI-compatible base URL. Review jurisdiction, privacy and regional data-transfer requirements before use.",
    "freeNote": "API subscription is free to create; inference is billed per token. No free inference allowance is published.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "eurouter",
    "name": "EURouter",
    "category": "apikey",
    "color": "#1D4ED8",
    "textIcon": "EUR",
    "website": "https://eurouter.ai",
    "apiHint": "Create an EURouter API key, then use https://api.eurouter.ai/v1 as the OpenAI-compatible base URL. Models are served by third-party upstreams listed per model in the EURouter catalog; check each upstream jurisdiction, privacy and data-transfer terms before use.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "y-api",
    "name": "Y-API",
    "category": "apikey",
    "color": "#0891B2",
    "textIcon": "YA",
    "website": "https://y-api.bestvirtualgoods.com",
    "apiHint": "Create an API key at https://y-api.bestvirtualgoods.com, then use https://api.y-api.bestvirtualgoods.com/v1 as the OpenAI-compatible base URL. Models are served by this gateway from the third-party upstream vendors named per model in its catalog; check each upstream jurisdiction, privacy and data-transfer terms before use.",
    "freeNote": "4 of its 20 catalog models (deepseek/deepseek-v4-flash, minimax/minimax-m2.7, tencent/hy3, xiaomi/mimo-v2.5) are priced at 0 credit in the publisher's 2026-10-04 snapshot; the rest bill against prepaid credit, and signup grants a small credit whose amount is Y-API's to set. Y-API can withdraw a free model at any time — re-check https://y-api.bestvirtualgoods.com/pricing.json.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "mnn-ai",
    "name": "MNN AI",
    "category": "apikey",
    "color": "#0F766E",
    "textIcon": "MNN",
    "website": "https://mnnai.ru",
    "apiHint": "Create an MNN AI API key, then use the primary https://api.mnnai.ru/v1 OpenAI-compatible endpoint. Review jurisdiction, privacy and regional data-transfer requirements before use.",
    "freeNote": "Free plan: $1 monthly credits, 10 RPM and access only to models marked Free.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "meganova-ai",
    "name": "MegaNova AI",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "MN",
    "website": "https://meganova.ai",
    "apiHint": "Create a MegaNova API key, then use https://api.meganova.ai/v1 as the OpenAI-compatible base URL.",
    "freeNote": "Free signup without a card. Published Tier 1 per-model quotas total 550 requests/day; they are not a shared global pool, and paid overage can apply if enabled.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "mixlayer",
    "name": "Mixlayer",
    "category": "apikey",
    "color": "#0EA5E9",
    "textIcon": "MX",
    "website": "https://www.mixlayer.com",
    "apiHint": "Create a Mixlayer API key, then use https://models.mixlayer.ai/v1 as the OpenAI-compatible base URL.",
    "freeNote": "The qwen/qwen3.5-4b-free model is free for prototyping and rate-limited; no fixed public RPM or daily quota is confirmed.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "speka",
    "name": "Speka AI",
    "category": "apikey",
    "color": "#DB2777",
    "textIcon": "SP",
    "website": "https://speka.me",
    "apiHint": "Create a Speka API key, then use https://speka.me/v1 as the OpenAI-compatible base URL. Confirm current model availability and overage settings before use.",
    "freeNote": "Free plan: $1 monthly usage, 10 RPM, one API key and access to open models and the playground; no card required.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "tokenreply",
    "name": "TokenReply",
    "category": "apikey",
    "color": "#3B82F6",
    "textIcon": "TR",
    "website": "https://www.tokenreply.com",
    "apiHint": "Create a TokenReply token, then use https://api.tokenreply.com/v1 as the OpenAI-compatible base URL and confirm the selected model's current limit.",
    "freeNote": "Free-tagged models have model- and campaign-specific daily limits; no fixed global free quota is published.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "yolo-auto",
    "name": "Yolo-Auto",
    "category": "apikey",
    "color": "#F59E0B",
    "textIcon": "YA",
    "website": "https://yolo-auto.com",
    "apiHint": "Create a yolo_ API key, then use https://yolo-auto.com/v1 as the OpenAI-compatible base URL.",
    "freeNote": "Free API access is request-limited and intended for testing; no numeric daily quota is published and free access is not promised indefinitely.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "dxnt",
    "name": "DXNT / DX Token",
    "category": "apikey",
    "color": "#111827",
    "textIcon": "DX",
    "website": "https://www.dxnt.com",
    "apiHint": "Create a DXNT API key, then use https://www.dxnt.com/v1 as the OpenAI-compatible base URL.",
    "freeNote": "Free accounts are documented at 100 calls/day; the quota may increase through invitations and can vary by account.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "cloudcode-one",
    "name": "CloudCode.ONE",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "CC",
    "website": "https://cloudcode.one",
    "apiHint": "Create a CloudCode.ONE key, then use https://api.cloudcode.one/v1 as the OpenAI-compatible base URL. Key issuance may require credit or a coupon.",
    "freeNote": "Published free models include glm-4.7-flash and glm-4.6v-flash; no numeric quota is published, and key creation may require credit or a coupon.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "ofoxai",
    "name": "OfoxAI",
    "category": "apikey",
    "color": "#0F766E",
    "textIcon": "OF",
    "website": "https://ofox.ai",
    "apiHint": "Create an OfoxAI Bearer key, then use https://api.ofox.ai/v1 as the OpenAI-compatible base URL. This integration covers the OpenAI surface only.",
    "freeNote": "The current catalog advertises 10+ free models without a public numeric quota; review upstream provenance, retention and training terms before production use.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "zerolimitai",
    "name": "ZeroLimitAI",
    "category": "apikey",
    "color": "#475569",
    "textIcon": "ZL",
    "website": "https://www.zerolimitai.com",
    "apiHint": "Create a ZeroLimitAI Bearer token, then use https://www.zerolimitai.com/api/v1 as the OpenAI-compatible base URL.",
    "freeNote": "Temporary free trial is advertised, but official pages conflict between 3 and 7 days; a 100-calls/day claim is not treated as permanent.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "chatanywhere",
    "name": "ChatAnywhere",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "CA",
    "website": "https://chatanywhere.tech",
    "apiHint": "Create a ChatAnywhere key linked to GitHub, then use https://api.chatanywhere.org/v1 outside China. Review the non-commercial terms before enabling it.",
    "freeNote": "Personal, educational or research use only: public documentation cites 10,000 points/day and 200 requests/day per IP/key; do not use for commercial traffic.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "helyxai",
    "name": "Helyx AI",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "HX",
    "website": "https://helyxai.space",
    "apiHint": "Create a Helyx AI Bearer key, then use https://helyxai.space/v1 as the OpenAI-compatible base URL. Review terms and data retention first.",
    "freeNote": "Operational Free plan documents 100,000 tokens/day; the site's separate 2M+ marketing claim conflicts and is not treated as a quota guarantee.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "auriko",
    "name": "Auriko",
    "category": "apikey",
    "color": "#0891B2",
    "textIcon": "AU",
    "website": "https://www.auriko.ai",
    "apiHint": "Create an Auriko key with the ak_ prefix, then use https://api.auriko.ai/v1 as the OpenAI-compatible base URL. BYOK and platform credits have different cost semantics.",
    "freeNote": "Free plan publishes 1,000 Platform RPM and 10,000 BYOK RPM. Platform inference still passes through provider cost; this is not a free-token pool or unlimited free inference.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "poixe-ai",
    "name": "Poixe AI",
    "category": "apikey",
    "color": "#EA580C",
    "textIcon": "PX",
    "website": "https://poixe.com",
    "apiHint": "Create a Poixe Bearer key, then use https://api.poixe.com/v1 as the OpenAI-compatible base URL. Treat free model provenance and regional availability as experimental.",
    "freeNote": "Current public free limits are small and model-group specific: 2 RPM/5 RPD for large-cup models and 20 RPM/50 RPD for small-cup models.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "naga-ai",
    "name": "Naga AI",
    "category": "apikey",
    "color": "#059669",
    "textIcon": "NA",
    "website": "https://naga.ac",
    "apiHint": "Create a Naga AI Bearer key, then use https://api.naga.ac/v1 as the OpenAI-compatible base URL. Never send sensitive data to the free tier without accepting its training policy.",
    "freeNote": "Models marked :free are publicly listed, but no numeric quota is confirmed. Naga's policy warns that free-tier prompts and outputs may be collected or used for training.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "chat-oripe",
    "name": "Chat Oripe",
    "category": "apikey",
    "color": "#64748B",
    "textIcon": "CO",
    "website": "https://api.oriper.com",
    "apiHint": "Use https://api.oriper.com/v1 only after confirming the provider's current documentation, terms and key issuance. No quota is guaranteed by this catalog.",
    "freeNote": "Official metadata advertises 2M tokens/month, but the public site and documentation were blocked during audit; treat the quota and brand mapping as unconfirmed.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "freeinference",
    "name": "FreeInference",
    "category": "apikey",
    "color": "#8B5CF6",
    "textIcon": "FI",
    "website": "https://freeinference.org",
    "apiHint": "Apply for a FreeInference key, then use https://freeinference.org/v1 as the OpenAI-compatible base URL. Terms allow prompt/response logging and possible publication of anonymized research data; never send sensitive or production data.",
    "freeNote": "Free research access without a card; non-Harvard applicants require manual approval and no numeric quota is publicly guaranteed.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "free-ai",
    "name": "Free.ai",
    "category": "apikey",
    "color": "#16A34A",
    "textIcon": "FA",
    "website": "https://free.ai",
    "apiHint": "Create an sk-free- key, then use the nonstandard but OpenAI-shaped https://api.free.ai/v1/chat/ endpoint. Select a self-hosted zero-price model to stay within the free pool.",
    "freeNote": "30,000 tokens/day cover self-hosted models after email verification. Usage beyond the pool can bill at raw cost, and premium external models are paid.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "dgrid",
    "name": "DGrid",
    "category": "apikey",
    "color": "#65A30D",
    "textIcon": "DG",
    "website": "https://dgrid.ai",
    "apiHint": "Create a DGrid API key at https://dgrid.ai, then use https://api.dgrid.ai/v1 as the OpenAI-compatible base URL.",
    "freeNote": "DGrid Free Models Router: 10 requests/minute and 100 requests/day. A $5 lifetime top-up unlocks up to 20 requests/minute and 1,000 requests/day.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/dgrid.svg"
  },
  {
    "id": "qiniu",
    "name": "Qiniu",
    "category": "apikey",
    "color": "#1E88E5",
    "textIcon": "QN",
    "website": "https://www.qiniu.com",
    "apiHint": "Create a Qiniu AI inference API key at https://portal.qiniu.com/ai-inference/api-key, then paste it here as a Bearer token. OpenAI-compatible endpoint at https://api.qnaigc.com/v1, proxying DeepSeek, Claude, Kimi and more behind one key.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "orcarouter",
    "name": "OrcaRouter",
    "category": "apikey",
    "color": "#0891B2",
    "textIcon": "ORC",
    "website": "https://www.orcarouter.ai",
    "apiHint": "Create an API key (starts with sk-orca-) at https://www.orcarouter.ai, then paste it as a Bearer token. OpenAI-compatible endpoint at https://api.orcarouter.ai/v1.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/orcarouter.svg"
  },
  {
    "id": "api-airforce",
    "name": "Api.airforce",
    "category": "apikey",
    "color": "#1E3A5F",
    "textIcon": "AF",
    "website": "https://api.airforce",
    "apiHint": "Get your API key from https://panel.api.airforce — OpenAI-compatible endpoint at https://api.airforce/v1",
    "freeNote": "55 free tier models including Grok-3, Claude 3.7, Qwen3, Kimi-K2, Gemini 2.5 Flash, DeepSeek-V3",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "crof",
    "name": "CrofAI",
    "category": "apikey",
    "color": "#0EA5E9",
    "textIcon": "CR",
    "website": "https://crof.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/crof.svg"
  },
  {
    "id": "bazaarlink",
    "name": "BazaarLink",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "BZ",
    "website": "https://bazaarlink.ai",
    "authHint": "Use your BazaarLink API key (starts with sk-bl-) in Authorization: Bearer <key>. OpenAI SDK works with base URL https://bazaarlink.ai/api/v1. Models use provider/model-name format.",
    "apiHint": "Create a free API key at https://bazaarlink.ai — model 'auto:free' routes to zero-cost inference. All models use the provider/model-name format, e.g. xiaomi/mimo-v2.5-pro.",
    "freeNote": "Free tier: 4M tokens/day per account with auto:free routing — zero-cost inference, no credit card required.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "synthetic",
    "name": "Synthetic",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "SY",
    "website": "https://synthetic.new",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "kilo-gateway",
    "name": "Kilo Gateway",
    "category": "apikey",
    "color": "#617A91",
    "textIcon": "KG",
    "website": "https://kilo.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "wafer",
    "name": "Wafer AI",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "WF",
    "website": "https://wafer.ai",
    "apiHint": "API key from https://wafer.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/wafer.svg"
  },
  {
    "id": "opencode-zen",
    "name": "OpenCode Zen",
    "category": "apikey",
    "color": "#6366f1",
    "website": "https://opencode.ai/zen",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "opencode-go",
    "name": "OpenCode Go",
    "category": "apikey",
    "color": "#6366f1",
    "website": "https://opencode.ai/go",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "dahl",
    "name": "Dahl",
    "category": "apikey",
    "color": "#6B7280",
    "textIcon": "DA",
    "website": "https://inference.dahl.global",
    "authHint": "Click 'Add Account' to auto-generate a token, or add a manual API key.",
    "apiHint": "Auto-generate a token or paste your own API key.",
    "freeNote": "Free — MiniMax M2.7, Kimi K2.6. Click 'Add Account' to auto-generate a token, or add your own API key.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "freetheai",
    "name": "FreeTheAi",
    "category": "apikey",
    "color": "#22C55E",
    "textIcon": "FTA",
    "website": "https://freetheai.org",
    "authHint": "Sign up at https://freetheai.org/signup for a free API key. A daily check-in unlocks the free models; linking Discord is optional and only raises the daily limit.",
    "freeNote": "Free OpenAI-compatible gateway — sign up at freetheai.org for a free API key; a daily check-in unlocks the free models.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "g4f-groq",
    "name": "g4f.space — Groq",
    "category": "apikey",
    "color": "#F97316",
    "textIcon": "G4F",
    "website": "https://g4f.space",
    "authHint": "Bake anonymous cake credits at g4f.dev/chat, or use a g4f.dev member key (create one at g4f.dev/members.html).",
    "freeNote": "Anonymous access to Groq requires proof-of-work cake credits from g4f.dev/chat; alternatively, use a g4f.dev member API key. Limits vary.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "g4f-gemini",
    "name": "g4f.space — Gemini",
    "category": "apikey",
    "color": "#F97316",
    "textIcon": "G4F",
    "website": "https://g4f.space",
    "authHint": "Bake anonymous cake credits at g4f.dev/chat, or use a g4f.dev member key (create one at g4f.dev/members.html).",
    "freeNote": "Anonymous access to Gemini requires proof-of-work cake credits from g4f.dev/chat; alternatively, use a g4f.dev member API key. Limits vary.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "g4f-pollinations",
    "name": "g4f.space — Pollinations",
    "category": "apikey",
    "color": "#F97316",
    "textIcon": "G4F",
    "website": "https://g4f.space",
    "authHint": "Bake anonymous cake credits at g4f.dev/chat, or use a g4f.dev member key (create one at g4f.dev/members.html).",
    "freeNote": "Anonymous access to Pollinations requires proof-of-work cake credits from g4f.dev/chat; alternatively, use a g4f.dev member API key. Limits vary.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "g4f-ollama",
    "name": "g4f.space — Ollama",
    "category": "apikey",
    "color": "#F97316",
    "textIcon": "G4F",
    "website": "https://g4f.space",
    "authHint": "Bake anonymous cake credits at g4f.dev/chat, or use a g4f.dev member key (create one at g4f.dev/members.html).",
    "freeNote": "Anonymous access to hosted Ollama requires proof-of-work cake credits from g4f.dev/chat; alternatively, use a g4f.dev member API key. Limits vary.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "g4f-nvidia",
    "name": "g4f.space — NVIDIA",
    "category": "apikey",
    "color": "#F97316",
    "textIcon": "G4F",
    "website": "https://g4f.space",
    "authHint": "Bake anonymous cake credits at g4f.dev/chat, or use a g4f.dev member key (create one at g4f.dev/members.html).",
    "freeNote": "Anonymous access to NVIDIA NIM requires proof-of-work cake credits from g4f.dev/chat; alternatively, use a g4f.dev member API key. Limits vary.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "vercel-ai-gateway",
    "name": "Vercel AI Gateway",
    "category": "apikey",
    "color": "#111827",
    "textIcon": "VAI",
    "website": "https://vercel.com/docs/ai-gateway",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm",
      "image",
      "embedding"
    ]
  },
  {
    "id": "llm7",
    "name": "LLM7.io",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "LM",
    "website": "https://llm7.io",
    "authHint": "Use any non-empty key (for example 'unused'). If older built-in models return model_unavailable, use Available Models → Import from /models or Auto-Sync; verified live model: gemini-3.1-flash-lite.",
    "apiHint": "Works without API key (use 'unused' as key). Get free token at token.llm7.io for higher limits.",
    "freeNote": "No signup required - 2 req/s, 20 RPM, 100 req/hr free tier",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/llm7.svg"
  },
  {
    "id": "llamagate",
    "name": "LlamaGate",
    "category": "apikey",
    "color": "#16A34A",
    "textIcon": "LG",
    "website": "https://llamagate.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "gitlawb",
    "name": "Gitlawb Opengateway (MiMo)",
    "category": "apikey",
    "color": "#10B981",
    "textIcon": "GLB",
    "website": "https://opengateway.gitlawb.com",
    "apiHint": "Get your API key from Gitlawb Opengateway dashboard.",
    "freeNote": "Free MiMo (xiaomi/mimo-v2.5) revoked 2026-05 — Opengateway is now a pay-as-you-go credit gateway; no recurring free model.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/gitlawb.svg"
  },
  {
    "id": "gitlawb-gmi",
    "name": "Gitlawb Opengateway (GMI Cloud)",
    "category": "apikey",
    "color": "#10B981",
    "textIcon": "GMI",
    "website": "https://opengateway.gitlawb.com",
    "apiHint": "Get your API key from Gitlawb Opengateway dashboard.",
    "freeNote": "Free Nemotron promo ended 2026-06 — the GMI Cloud route is now pay-as-you-go credit only.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/gitlawb-gmi.svg"
  },
  {
    "id": "nanogpt",
    "name": "NanoGPT",
    "category": "apikey",
    "color": "#4F46E5",
    "textIcon": "NG",
    "website": "https://nano-gpt.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "stt",
      "tts",
      "video",
      "image",
      "embedding"
    ]
  },
  {
    "id": "nan",
    "name": "NaN.Builders",
    "category": "apikey",
    "color": "#6D5EF3",
    "textIcon": "NaN",
    "website": "https://nan.builders",
    "apiHint": "Create an API key at https://cloud.nan.builders, then paste it here as a Bearer token. OpenAI-compatible base URL: https://api.nan.builders/v1.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "imageToText",
      "embedding",
      "stt",
      "tts",
      "image"
    ]
  },
  {
    "id": "aimlapi",
    "name": "AI/ML API",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "AI",
    "website": "https://aimlapi.com",
    "freeNote": "Free tier paused (2026) — AI/ML API is now pay-as-you-go only (min $20 top-up); no recurring free credits.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "novita",
    "name": "Novita AI",
    "category": "apikey",
    "color": "#FF4081",
    "textIcon": "NV",
    "website": "https://novita.ai",
    "freeNote": "$0.50 trial credits on signup (valid about 1 year)",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm",
      "video"
    ],
    "logo": "./providers/novita.svg"
  },
  {
    "id": "piapi",
    "name": "PiAPI",
    "category": "apikey",
    "color": "#7C4DFF",
    "textIcon": "PI",
    "website": "https://piapi.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "getgoapi",
    "name": "GoAPI",
    "category": "apikey",
    "color": "#FF6D00",
    "textIcon": "GO",
    "website": "https://api.getgoapi.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "laozhang",
    "name": "LaoZhang AI",
    "category": "apikey",
    "color": "#FF1744",
    "textIcon": "LZ",
    "website": "https://api.laozhang.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "thebai",
    "name": "TheB.AI",
    "category": "apikey",
    "color": "#3B82F6",
    "textIcon": "TB",
    "website": "https://theb.ai",
    "authHint": "Bearer API key for the TheB.AI OpenAI-compatible gateway.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "bai",
    "name": "b.ai",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "BA",
    "website": "https://b.ai",
    "authHint": "Bearer API key for the b.ai OpenAI-compatible LLM gateway (distinct from TheB.AI). Create a key at https://docs.b.ai, then use https://api.b.ai/v1 as the OpenAI-compatible base URL.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "fenayai",
    "name": "FenayAI",
    "category": "apikey",
    "color": "#FF9800",
    "textIcon": "FN",
    "website": "https://fenayai.com",
    "authHint": "Bearer API key for the FenayAI OpenAI-compatible gateway.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "empower",
    "name": "Empower",
    "category": "apikey",
    "color": "#14B8A6",
    "textIcon": "EM",
    "website": "https://docs.empower.dev",
    "authHint": "Bearer API key for the Empower OpenAI-compatible endpoint.",
    "apiHint": "Empower exposes OpenAI-compatible chat on https://app.empower.dev/api/v1 with tool-calling support on empower-functions.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "poe",
    "name": "Poe",
    "category": "apikey",
    "color": "#F97316",
    "textIcon": "PO",
    "website": "https://creator.poe.com/api-reference",
    "authHint": "Bearer API key for the Poe OpenAI-compatible API.",
    "apiHint": "Poe exposes OpenAI-compatible chat and responses on https://api.poe.com/v1, with authenticated balance checks on /usage/current_balance.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/poe.svg"
  },
  {
    "id": "chutes",
    "name": "Chutes.ai",
    "category": "apikey",
    "color": "#06B6D4",
    "textIcon": "CH",
    "website": "https://chutes.ai",
    "authHint": "Bearer API key for the Chutes OpenAI-compatible gateway.",
    "freeNote": "No free tier as of 2026 — Chutes moved to pay-as-you-go (free Early Access ended 2026-03).",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm",
      "imageToText"
    ],
    "logo": "./providers/chutes.svg"
  },
  {
    "id": "factory",
    "name": "Factory",
    "category": "apikey",
    "color": "#0F172A",
    "textIcon": "FA",
    "website": "https://factory.ai",
    "authHint": "Bearer API key for the Factory OpenAI-compatible gateway.",
    "apiHint": "Get your Factory API key at https://app.factory.ai/settings/api-keys, then paste it as a Bearer token. OpenAI-compatible endpoint at https://api.factory.ai/v1.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/factory.svg"
  },
  {
    "id": "bluesminds",
    "name": "BluesMinds",
    "category": "apikey",
    "color": "#3B82F6",
    "textIcon": "BM",
    "website": "https://www.bluesminds.com",
    "apiHint": "Get your API key at https://www.bluesminds.com — OpenAI-compatible endpoint at https://api.bluesminds.com/v1 with free daily credits. VIP models (Claude Opus 4.5, Gemini 2.5 Pro) consume pi credits.",
    "freeNote": "Free daily pi credits — supports 200+ models including GPT-4o, GPT-4.1, Claude Sonnet 4.5, Gemini 2.0 Flash, DeepSeek V4, Qwen, Kimi K2",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/bluesminds.svg"
  },
  {
    "id": "freemodel-dev",
    "name": "FreeModel.dev",
    "category": "apikey",
    "color": "#8B5CF6",
    "textIcon": "FM",
    "website": "https://freemodel.dev",
    "apiHint": "Get $300 free API credits at https://freemodel.dev — no payment info required. OpenAI-compatible endpoint. GPT-5.4 and GPT-5.5 models available.",
    "freeNote": "$300 free credits on signup — no credit card required. Access GPT-5.4 and GPT-5.5 (OpenAI's latest flagship models) through an OpenAI-compatible API.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/freemodel-dev.svg"
  },
  {
    "id": "freeaiapikey",
    "name": "FreeAIAPIKey",
    "category": "apikey",
    "color": "#F59E0B",
    "textIcon": "FK",
    "website": "https://freeaiapikey.com",
    "apiHint": "Discounted API proxy for 40+ models including GPT-5, Claude Opus 4.6, Claude Sonnet 4.6, Qwen 3.5. Get your API key at https://freeaiapikey.com/dashboard. Base URL: https://freeaiapikey.com/v1.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/freeaiapikey.svg"
  },
  {
    "id": "zenmux",
    "name": "ZenMux",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "ZM",
    "website": "https://zenmux.ai",
    "authHint": "Use your ZenMux API key in Authorization: Bearer <key>. ZenMux is fully OpenAI-compatible. Base URL: https://zenmux.ai/api/v1.",
    "apiHint": "ZenMux exposes an OpenAI-compatible chat completions endpoint at /api/v1/chat/completions, plus Anthropic Messages (/api/anthropic/v1/messages) and Google Gemini (/api/vertex-ai) protocol surfaces. OmniRoute uses the OpenAI protocol.",
    "freeNote": "Free tier includes access to Gemini 3 Flash, DeepSeek V3.2, Grok 4.1 Fast, Mistral Large, and more. Get your API key at https://zenmux.ai.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "image"
    ],
    "logo": "./providers/zenmux.svg"
  },
  {
    "id": "openadapter",
    "name": "OpenAdapter",
    "category": "apikey",
    "color": "#10B981",
    "textIcon": "OD",
    "website": "https://openadapter.dev",
    "authHint": "Use your OpenAdapter API key in Authorization: Bearer sk-cv-<key>. Fully OpenAI-compatible. API base URL: https://api.openadapter.in/v1.",
    "apiHint": "OpenAdapter exposes an OpenAI-compatible chat completions endpoint at https://api.openadapter.in/v1/chat/completions, aggregating 70+ open-source models (DeepSeek, Qwen, Kimi, MiniMax, GLM, Llama, Mistral, …). OmniRoute uses the OpenAI protocol.",
    "freeNote": "Free tier with a generous quota and no credit card — 15+ open-source models with daily quota. Get your API key at https://dashboard.openadapter.in.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/openadapter.svg"
  },
  {
    "id": "dit",
    "name": "DIT.ai",
    "category": "apikey",
    "color": "#0EA5E9",
    "textIcon": "DT",
    "website": "https://dit.ai",
    "authHint": "Use your dit.ai API key in Authorization: Bearer <key>. Fully OpenAI-compatible — a drop-in replacement, just change the base URL to https://api.dit.ai/v1.",
    "apiHint": "dit.ai (Distributed Intelligence Trade) is an OpenAI-compatible router/gateway with dynamic per-request pricing, exposing /v1/chat/completions at https://api.dit.ai/v1. OmniRoute uses the OpenAI protocol; spend/savings analytics live in the dit.ai dashboard.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/dit.svg"
  },
  {
    "id": "tokenrouter",
    "name": "TokenRouter",
    "category": "apikey",
    "color": "#F59E0B",
    "textIcon": "TK",
    "website": "https://tokenrouter.com",
    "authHint": "Use your TokenRouter API key in Authorization: Bearer <key>. Fully OpenAI-compatible. API base URL: https://api.tokenrouter.com/v1.",
    "apiHint": "TokenRouter exposes an OpenAI-compatible chat completions endpoint at https://api.tokenrouter.com/v1/chat/completions, plus a working /v1/models catalog. OmniRoute uses the OpenAI protocol.",
    "freeNote": "Free tier includes the MiniMax 3 model. Get your API key at https://tokenrouter.com.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/tokenrouter.svg"
  },
  {
    "id": "token-kiosk",
    "name": "Token Kiosk",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "TKI",
    "website": "https://agent-router.gaib.ai",
    "authHint": "Use your Token Kiosk API key in Authorization: Bearer <key>. Fully OpenAI-compatible gateway. API base URL: https://agent-router.gaib.ai/v1.",
    "apiHint": "Token Kiosk is a multi-provider agent LLM routing infrastructure exposing an OpenAI-compatible endpoint at https://agent-router.gaib.ai/v1/chat/completions with auto-fallback and latency routing.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "sumopod",
    "name": "SumoPod",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "SP",
    "website": "https://ai.sumopod.com",
    "authHint": "Use your SumoPod API key (sk-...) in Authorization: Bearer <key>. Fully OpenAI-compatible. API base URL: https://ai.sumopod.com/v1.",
    "apiHint": "SumoPod exposes an OpenAI-compatible chat completions endpoint at https://ai.sumopod.com/v1/chat/completions, plus a live /v1/models catalog. OmniRoute uses the OpenAI protocol and lists models via passthrough.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/sumopod.svg"
  },
  {
    "id": "x5lab",
    "name": "X5Lab",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "X5",
    "website": "https://x5lab.dev",
    "authHint": "Use your X5Lab API key (x5-...) in Authorization: Bearer <key>. Fully OpenAI-compatible. API base URL: https://api.x5lab.dev/v1.",
    "apiHint": "X5Lab exposes an OpenAI-compatible chat completions endpoint at https://api.x5lab.dev/v1/chat/completions, plus a live /v1/models catalog. OmniRoute uses the OpenAI protocol and lists models via passthrough.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/x5lab.svg"
  },
  {
    "id": "chenzk",
    "name": "Chenzk API",
    "category": "apikey",
    "color": "#10B981",
    "textIcon": "CZ",
    "website": "https://chenzk.top",
    "apiHint": "Create an API key at https://chenzk.top/token, then paste it here as a Bearer token. OpenAI-compatible endpoint at https://chenzk.top/v1, with a live /v1/models catalog.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "kenari",
    "name": "Kenari",
    "category": "apikey",
    "color": "#B5362A",
    "textIcon": "KN",
    "website": "https://kenari.id",
    "authHint": "Use your Kenari API key (kn-...) in Authorization: Bearer <key>. Fully OpenAI-compatible. API base URL: https://kenari.id/v1.",
    "apiHint": "Kenari exposes an OpenAI-compatible chat completions endpoint at https://kenari.id/v1/chat/completions, plus a live /v1/models catalog covering Claude, GPT, DeepSeek, GLM, Kimi and more. OmniRoute uses the OpenAI protocol and lists models via passthrough.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/kenari.svg"
  },
  {
    "id": "tokenmarket",
    "name": "Token Market",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "TM",
    "website": "https://www.tokensmarket.ai",
    "authHint": "Create an API key in the Token Market console, then paste it here as a Bearer token.",
    "apiHint": "Token Market provides an OpenAI-compatible API at https://api.tokensmarket.ai/v1 and discovers its current model catalog from /v1/models.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "tokenharbor",
    "name": "Token Harbor",
    "category": "apikey",
    "color": "#0EA5E9",
    "textIcon": "TH",
    "website": "https://tokenharbor.ai",
    "authHint": "Create a Token Harbor account and copy your Universal Key from https://tokenharbor.ai/dashboard.",
    "apiHint": "Token Harbor is OpenAI-compatible. Use the tokenharbor provider prefix with the exact model ID from its live /v1/models catalog; API base URL: https://tokenharbor.ai/v1.",
    "freeNote": "Selected :free model IDs listed at https://tokenharbor.ai/models?category=free use a personal rolling 7-day list-price allowance and never charge the wallet; free routes have 60 RPM and 1,800 requests/hour per account. Enable free routes first; prompts and responses may be retained after opting in. Model availability can change.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "navy",
    "name": "NavyAI",
    "category": "apikey",
    "color": "#1E3A8A",
    "textIcon": "NV",
    "website": "https://api.navy",
    "authHint": "Create a free API key from the NavyAI dashboard, then paste it here as a Bearer token.",
    "apiHint": "OpenAI-compatible endpoint at https://api.navy/v1 with a live /v1/models catalog that exposes per-model token_multiplier and premium flags. Upstream requires an explicit User-Agent header.",
    "freeNote": "Free plan is one shared 150K tokens/day pool at 20 RPM. Each model carries a token multiplier, so heavier models drain the pool faster (grok-4 at 10x is ~15K real tokens/day).",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "ainative",
    "name": "AINative Studio",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "AN",
    "website": "https://ainative.studio",
    "authHint": "Create a free API key at ainative.studio (no card), then paste it here as a Bearer token.",
    "apiHint": "OpenAI-compatible endpoint at https://api.ainative.studio/api/v1 with a public /models catalog (84 models). OmniRoute lists models via passthrough.",
    "freeNote": "Free tier ~10M tokens/month (claimed) across Qwen3, Llama 4, DeepSeek R1 and more.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "aion",
    "name": "Aion Labs",
    "category": "apikey",
    "color": "#0EA5E9",
    "textIcon": "AI",
    "website": "https://www.aionlabs.ai",
    "authHint": "Create a free API key at aionlabs.ai (no card), then paste it here as a Bearer token.",
    "apiHint": "OpenAI-compatible endpoint at https://api.aionlabs.ai/v1 with a public /models catalog carrying context and pricing.",
    "freeNote": "Free tier ~20k tokens/day across the Aion reasoning models.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "routeway",
    "name": "Routeway",
    "category": "apikey",
    "color": "#F59E0B",
    "textIcon": "RW",
    "website": "https://routeway.ai",
    "authHint": "Create a free API key at routeway.ai, then paste it here as a Bearer token.",
    "apiHint": "OpenAI-compatible endpoint at https://api.routeway.ai/v1 with a public /models catalog (236 models). Cloudflare fronts the API and requires a browser-style User-Agent.",
    "freeNote": "Free models (:free suffix) at ~5 RPM / 200 RPD across Llama, Nemotron, Step and Laguna.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "nara",
    "name": "NaraRouter",
    "category": "apikey",
    "color": "#EC4899",
    "textIcon": "NA",
    "website": "https://bynara.id",
    "authHint": "Create a free NaraRouter account, link your Telegram (required before /v1 answers), then paste the key here as a Bearer token.",
    "apiHint": "OpenAI-compatible endpoint at https://router.bynara.id/v1. Free-tier models are pinned; others need credit.",
    "freeNote": "Free plan: one 7M tokens/day bucket per account (15 req/min) across the plan's 8 models; others need credit.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "xkiro",
    "name": "xKiro",
    "category": "apikey",
    "color": "#0EA5E9",
    "textIcon": "XK",
    "website": "https://xkiro.com",
    "authHint": "Create a free account at xkiro.com and paste the key here (Bearer; x-api-key also accepted).",
    "apiHint": "OpenAI-compatible endpoint at https://api.xkiro.com/v1. Public /v1/models tags free rows with access_tier=free; paid models are rejected on the free plan.",
    "freeNote": "Free plan: 5M tokens/day per account across 40 upstream free models — 39 pinned here (Qwen, MiniMax, DeepSeek, Mistral, SenseNova) — no card; past the daily allowance free requests get a 429 until the reset. RPM not published.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "regolo",
    "name": "Regolo AI",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "RG",
    "website": "https://regolo.ai",
    "authHint": "Get your Regolo API key from regolo.ai, then paste it here as a Bearer token.",
    "apiHint": "OpenAI-compatible endpoint at https://api.regolo.ai/v1 with dynamic model discovery (19 models).",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "naga-ac",
    "name": "Naga.ac",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "NA",
    "website": "https://naga.ac",
    "authHint": "Get API key at naga.ac — Google/GitHub/Discord signup available.",
    "freeNote": "Free models include Nemotron 3 Ultra (free) and Llama 3.3 70B Instruct (Free). Paid models require credits. Google/GitHub/Discord signup.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "void-ai",
    "name": "Void AI",
    "category": "apikey",
    "color": "#111827",
    "textIcon": "VA",
    "website": "https://voidai.app",
    "apiHint": "Use https://api.voidai.app/v1 only after confirming authentication, account eligibility and terms. Treat this integration as experimental until the blocked documentation becomes public.",
    "freeNote": "The public model catalog marks some models with a free plan requirement, but access is conditional and no numeric quota is confirmed.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "helixmind",
    "name": "HelixMind",
    "category": "apikey",
    "color": "#4F46E5",
    "textIcon": "HM",
    "website": "https://helixmind.online",
    "apiHint": "Create a helix- key and use https://helixmind.online/v1. OpenAI requests use Bearer authentication; the Anthropic-compatible messages endpoint accepts x-api-key.",
    "freeNote": "Previously circulated 3 RPM/50 RPD and no-card claims were not confirmed during the 2026-08-02 audit; current quota and billing require account verification.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "logfare",
    "name": "Logfare",
    "category": "apikey",
    "color": "#22C55E",
    "textIcon": "LF",
    "website": "https://logfare.ai",
    "authHint": "Create a free account at https://logfare.ai/register (username/password, no email verification) to get an instant API key, then paste it here as a Bearer token.",
    "apiHint": "Create a free API key at https://logfare.ai/register, then use https://logfare.ai/v1 as the OpenAI-compatible base URL. Note the request-logging policy: prompts, completions and metadata are logged for research (opt out at https://logfare.ai/consent).",
    "freeNote": "Free OpenAI-compatible inference — no rate limits, no card. Logfare logs every request (prompts, completions, metadata) for internal research; opt out at /consent. Read https://logfare.ai/tos and https://logfare.ai/privacy before use.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "tabitoken",
    "name": "TabiToken",
    "category": "apikey",
    "color": "#F97316",
    "textIcon": "TT",
    "website": "https://tabitoken.com",
    "apiHint": "Create an sk- key at https://tabitoken.com and use https://tabitoken.com. The Anthropic-compatible /v1/messages endpoint (default) takes x-api-key; /v1/chat/completions takes Bearer.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "seekai",
    "name": "SeekAi",
    "category": "apikey",
    "color": "#0D9488",
    "textIcon": "SK",
    "website": "https://seekai.cc",
    "authHint": "Create an API key at https://seekai.cc, then paste it here as a Bearer token.",
    "apiHint": "Create an API key at https://seekai.cc, then paste it here as a Bearer token. OpenAI-compatible base URL: https://seekai.cc/v1.",
    "freeNote": "Signup credit toward available models; amount and eligibility are set by SeekAi, not OmniRoute.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "demonroute",
    "name": "Demon Route",
    "category": "apikey",
    "color": "#6D28D9",
    "textIcon": "DR",
    "website": "https://demonroute.com",
    "apiHint": "Create an API key at https://demonroute.com, then paste it here as a Bearer token. OpenAI-compatible base URL: https://api.demonroute.com/v1.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "daoxe",
    "name": "DaoXE",
    "category": "apikey",
    "color": "#0F766E",
    "textIcon": "DX",
    "website": "https://daoxe.com",
    "apiHint": "Create an API token at https://daoxe.com/token, then paste it here as a Bearer token. OpenAI-compatible base URL: https://api.daoxe.com/v1.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "gisoo",
    "name": "Gisoo",
    "category": "apikey",
    "color": "#FFC700",
    "textIcon": "GS",
    "website": "https://gisoo.pro",
    "apiHint": "Create an API key in your Gisoo account, then paste it here as a Bearer token. OpenAI-compatible base URL: https://gisoo.pro/api/v1. Prepaid credit; no free tier.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/gisoo.svg"
  },
  {
    "id": "beatapi",
    "name": "BeatAPI",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "BA",
    "website": "https://beatapi.io",
    "authHint": "Create an API key at https://beatapi.io/dashboard/apikeys, then paste it here.",
    "apiHint": "OpenAI-compatible base URL: https://api.beatapi.io/v1. Available models depend on your account; check the live model list before selecting one.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "empiriolabs",
    "name": "EmpirioLabs AI",
    "category": "apikey",
    "color": "#0A7CFF",
    "textIcon": "EL",
    "website": "https://empiriolabs.ai",
    "authHint": "Create an API key at https://platform.empiriolabs.ai/dashboard/api-keys, then paste it here.",
    "apiHint": "OpenAI-compatible base URL: https://api.empiriolabs.ai/v1. Prepaid balance with per-model pricing listed at https://docs.empiriolabs.ai/models-pricing. Chat models only through this entry.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "openai",
    "name": "OpenAI",
    "category": "apikey",
    "color": "#10A37F",
    "textIcon": "OA",
    "website": "https://platform.openai.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "imageToText",
      "stt",
      "tts",
      "image",
      "embedding"
    ],
    "logo": "./providers/openai.svg"
  },
  {
    "id": "reka",
    "name": "Reka",
    "category": "apikey",
    "color": "#111827",
    "textIcon": "RK",
    "website": "https://docs.reka.ai/chat/overview",
    "authHint": "Use your Reka API key. OmniRoute supports the OpenAI-compatible base URL https://api.reka.ai/v1 and sends both Authorization and X-Api-Key headers for compatibility.",
    "apiHint": "Reka Chat is OpenAI-compatible on /v1. OmniRoute probes /v1/models and routes chat traffic to /v1/chat/completions.",
    "freeNote": "$10/month recurring free API credits",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "pioneer",
    "name": "Pioneer AI",
    "category": "apikey",
    "color": "#7C5CFF",
    "textIcon": "PN",
    "website": "https://pioneer.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/pioneer.svg"
  },
  {
    "id": "uc-direct",
    "name": "UC Direct (uncensored.com)",
    "category": "apikey",
    "color": "#111827",
    "textIcon": "UD",
    "website": "https://uncensored.com",
    "authHint": "Use your uncensored.com Developer API key (uai_sk_live_...). OmniRoute sends it as the X-api-key header to the OpenAI-compatible https://api.uncensored.com/api/v1 endpoint. The key never expires. This is the metered/credits surface; the un-metered subscription chat is the separate 'uc' provider.",
    "apiHint": "UC Direct is OpenAI-compatible on /api/v1. OmniRoute probes /api/v1/models (public) and routes chat traffic to /api/v1/chat/completions. Errors: 402 out of credits, 403 moderation/scope, 429 rate limit.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "anthropic",
    "name": "Anthropic",
    "category": "apikey",
    "color": "#D97757",
    "textIcon": "AN",
    "website": "https://platform.claude.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "imageToText"
    ],
    "logo": "./providers/anthropic.svg"
  },
  {
    "id": "gemini",
    "name": "Gemini (Google AI Studio)",
    "category": "apikey",
    "color": "#4285F4",
    "textIcon": "GE",
    "website": "https://aistudio.google.com",
    "freeNote": "Free tier available through Google AI Studio; current per-model quotas and regional limits apply",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "imageToText",
      "stt",
      "music",
      "image",
      "embedding"
    ],
    "logo": "./providers/gemini.svg"
  },
  {
    "id": "groq",
    "name": "Groq",
    "category": "apikey",
    "color": "#F55036",
    "textIcon": "GQ",
    "website": "https://groq.com",
    "freeNote": "Free plan: per-model caps (200K tokens/day per chat model; see console.groq.com/docs/rate-limits for RPM/RPD) — no payment method on file.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "imageToText",
      "stt"
    ],
    "logo": "./providers/groq.svg"
  },
  {
    "id": "blackbox",
    "name": "Blackbox AI",
    "category": "apikey",
    "color": "#1A1A2E",
    "textIcon": "BB",
    "website": "https://blackbox.ai",
    "freeNote": "Limited free access is available through Blackbox; model availability and account limits apply",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": true,
    "deprecationReason": "api.blackbox.ai returns HTTP 404 on every path variant (sweep 2026-08-21); the public inference surface has moved to the gated enterprise.blackbox.ai/v1 endpoint.",
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "xai",
    "name": "xAI (Grok)",
    "category": "apikey",
    "color": "#1DA1F2",
    "textIcon": "XA",
    "website": "https://x.ai",
    "authHint": "Use an official xAI API key, or sign in with xAI OAuth. Grok Build JWT sessions remain a separate provider.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "imageToText",
      "video",
      "image"
    ],
    "logo": "./providers/xai.svg"
  },
  {
    "id": "mistral",
    "name": "Mistral",
    "category": "apikey",
    "color": "#FF7000",
    "textIcon": "MI",
    "website": "https://mistral.ai",
    "freeNote": "Free Experiment tier: rate-limited access to all models, no credit card required",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "imageToText",
      "stt",
      "embedding",
      "ocr"
    ],
    "logo": "./providers/mistral.svg"
  },
  {
    "id": "perplexity",
    "name": "Perplexity",
    "category": "apikey",
    "color": "#20808D",
    "textIcon": "PP",
    "website": "https://www.perplexity.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/perplexity.svg"
  },
  {
    "id": "perplexity-agent",
    "name": "Perplexity Agent",
    "category": "apikey",
    "color": "#20808D",
    "textIcon": "PA",
    "website": "https://www.perplexity.ai",
    "authHint": "Use your Perplexity API key. OmniRoute routes Agent API model IDs through Perplexity's Responses-compatible endpoint.",
    "apiHint": "Use Agent API model IDs with the pplx-agent/ prefix, for example pplx-agent/openai/gpt-5.6-sol or pplx-agent/anthropic/claude-opus-4-5.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "cohere",
    "name": "Cohere",
    "category": "apikey",
    "color": "#39594D",
    "textIcon": "CO",
    "website": "https://cohere.com",
    "freeNote": "Free Trial: 1,000 API calls/month for testing, no credit card required",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "stt",
      "embedding"
    ],
    "logo": "./providers/cohere.svg"
  },
  {
    "id": "meta-llama",
    "name": "Meta Llama API",
    "category": "apikey",
    "color": "#0F766E",
    "textIcon": "ML",
    "website": "https://llama.developer.meta.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "morph",
    "name": "Morph",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "MP",
    "website": "https://morphllm.com",
    "freeNote": "Free tier: 250K credits/month, $0",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/morph.svg"
  },
  {
    "id": "galadriel",
    "name": "Galadriel",
    "category": "apikey",
    "color": "#F59E0B",
    "textIcon": "GA",
    "website": "https://galadriel.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": true,
    "deprecationReason": "api.galadriel.ai no longer resolves (sweep 2026-06-19); the inference API appears discontinued.",
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/galadriel.svg"
  },
  {
    "id": "ai21",
    "name": "AI21 Labs",
    "category": "apikey",
    "color": "#0284C7",
    "textIcon": "AI21",
    "website": "https://www.ai21.com",
    "freeNote": "$10 trial credits on signup (valid 3 months), no credit card required",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "venice",
    "name": "Venice.ai",
    "category": "apikey",
    "color": "#0EA5E9",
    "textIcon": "VN",
    "website": "https://venice.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "codestral",
    "name": "Codestral",
    "category": "apikey",
    "color": "#FF7000",
    "textIcon": "CS",
    "website": "https://mistral.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "upstage",
    "name": "Upstage",
    "category": "apikey",
    "color": "#0F766E",
    "textIcon": "UP",
    "website": "https://www.upstage.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "embedding"
    ],
    "logo": "./providers/upstage.svg"
  },
  {
    "id": "maritalk",
    "name": "Maritalk",
    "category": "apikey",
    "color": "#1D4ED8",
    "textIcon": "MT",
    "website": "https://www.maritaca.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "nous-research",
    "name": "Nous Research",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "NO",
    "website": "https://portal.nousresearch.com/help",
    "authHint": "Use your Nous Portal API key. OmniRoute targets the official OpenAI-compatible inference endpoint at https://inference-api.nousresearch.com/v1.",
    "apiHint": "Nous exposes an OpenAI-compatible /v1 surface with a large remote /models catalog. The /chat/completions endpoint requires a valid API key for programmatic inference.",
    "freeNote": "Free tier: 50 RPM, 500,000 TPM — no credit card",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "arcee-ai",
    "name": "Arcee AI",
    "category": "apikey",
    "color": "#8B5CF6",
    "textIcon": "AR",
    "website": "https://arcee.ai",
    "authHint": "Get API key at arcee.ai",
    "freeNote": "Free Trinity Large Thinking model (262K context). No credit card required.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/arcee-ai.svg"
  },
  {
    "id": "liquid",
    "name": "Liquid AI",
    "category": "apikey",
    "color": "#06B6D4",
    "textIcon": "LQ",
    "website": "https://liquid.ai",
    "authHint": "Get API key at liquid.ai",
    "freeNote": "Free LFM2.5-1.2B-Thinking and LFM2.5-1.2B-Instruct models. MIT spinoff, hybrid architecture.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/liquid.svg"
  },
  {
    "id": "inception",
    "name": "Inception",
    "category": "apikey",
    "color": "#F97316",
    "textIcon": "IN",
    "website": "https://docs.inceptionlabs.ai",
    "apiHint": "Inception Labs is OpenAI-compatible at https://api.inceptionlabs.ai/v1. mercury-2 is the first diffusion LLM (dLLM) in the catalog — 5-10x faster generation than comparable autoregressive models, with tool calling, json_mode, and structured outputs.",
    "freeNote": "10M free tokens on signup, no credit card required.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "writer",
    "name": "Writer",
    "category": "apikey",
    "color": "#111827",
    "textIcon": "WR",
    "website": "https://dev.writer.com",
    "apiHint": "Writer Palmyra is OpenAI-compatible at https://api.writer.com/v1. palmyra-x5 offers a 1M-token context window.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "together",
    "name": "Together AI",
    "category": "apikey",
    "color": "#0F6FFF",
    "textIcon": "TG",
    "website": "https://www.together.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "stt",
      "tts",
      "video",
      "image",
      "embedding"
    ]
  },
  {
    "id": "openvecta",
    "name": "OpenVecta",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "OV",
    "website": "https://openvecta.com",
    "freeNote": "Free credits on signup for OpenAI-compatible inference across LLMs, embeddings, and reasoning models",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "openference-api",
    "name": "Openference API",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "OF",
    "website": "https://openference.com",
    "freeNote": "Free tier: includes Qwen3.8 27b and Llama 3.2 3B — see openference.com/pricing for current terms",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "poolside",
    "name": "Poolside",
    "category": "apikey",
    "color": "#111827",
    "textIcon": "PS",
    "website": "https://poolside.ai",
    "apiHint": "Direct Poolside Platform inference shuts down on 2026-10-31; see https://platform.poolside.ai/ for the announcement and self-hosting option. Existing keys use https://inference.poolside.ai/v1.",
    "freeNote": "Preview ending: direct Poolside Platform inference shuts down on 2026-10-31. Laguna S 2.1 and XS 2.1 are free during Preview; no public numeric quota is published.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/poolside.svg"
  },
  {
    "id": "fireworks",
    "name": "Fireworks AI",
    "category": "apikey",
    "color": "#7B2EF2",
    "textIcon": "FW",
    "website": "https://fireworks.ai",
    "freeNote": "$1 free starter credits on signup for API testing",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "image",
      "embedding"
    ],
    "logo": "./providers/fireworks.svg"
  },
  {
    "id": "cerebras",
    "name": "Cerebras",
    "category": "apikey",
    "color": "#FF4F00",
    "textIcon": "CB",
    "website": "https://inference.cerebras.ai",
    "freeNote": "One-time $5 signup credit (30-day validity); a payment method is required. Not a recurring free tier.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/cerebras.svg"
  },
  {
    "id": "nvidia",
    "name": "NVIDIA NIM",
    "category": "apikey",
    "color": "#76B900",
    "textIcon": "NV",
    "website": "https://build.nvidia.com",
    "freeNote": "Free dev access: ~40 RPM, 70+ models (Kimi K2.5, GLM 4.7, DeepSeek V3.2...)",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "stt",
      "tts",
      "image",
      "embedding"
    ],
    "logo": "./providers/nvidia.svg"
  },
  {
    "id": "nebius",
    "name": "Nebius AI",
    "category": "apikey",
    "color": "#6C5CE7",
    "textIcon": "NB",
    "website": "https://nebius.com",
    "freeNote": "~$1 trial credits on signup for API testing",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "image",
      "embedding"
    ],
    "logo": "./providers/nebius.svg"
  },
  {
    "id": "nube",
    "name": "Nube.sh",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "NB",
    "website": "https://nube.sh",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/nube.svg"
  },
  {
    "id": "siliconflow",
    "name": "SiliconFlow",
    "category": "apikey",
    "color": "#5B6EF5",
    "textIcon": "SF",
    "website": "https://cloud.siliconflow.com",
    "freeNote": "$1 free credits plus currently listed $0 models after identity verification; availability and limits may change",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "hyperbolic",
    "name": "Hyperbolic",
    "category": "apikey",
    "color": "#00D4FF",
    "textIcon": "HY",
    "website": "https://hyperbolic.xyz",
    "freeNote": "$1-5 trial credits on signup for serverless inference",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "tts",
      "image"
    ],
    "logo": "./providers/hyperbolic.svg"
  },
  {
    "id": "paraloncloud",
    "name": "ParalonCloud",
    "category": "apikey",
    "color": "#2EE6A6",
    "textIcon": "PC",
    "website": "https://paraloncloud.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "embedding"
    ]
  },
  {
    "id": "ollama-cloud",
    "name": "Ollama Cloud",
    "category": "apikey",
    "color": "#58A6FF",
    "textIcon": "OC",
    "website": "https://ollama.com/settings/keys",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "huggingface",
    "name": "HuggingFace",
    "category": "apikey",
    "color": "#FFD21E",
    "textIcon": "HF",
    "website": "https://huggingface.co",
    "freeNote": "Free Inference API for thousands of models (Whisper, VITS, SDXL…)",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "stt",
      "tts",
      "image"
    ],
    "logo": "./providers/huggingface.svg"
  },
  {
    "id": "deepinfra",
    "name": "DeepInfra",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "DI",
    "website": "https://deepinfra.com",
    "freeNote": "Free signup credits for API testing and model exploration",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "video",
      "embedding"
    ],
    "logo": "./providers/deepinfra.svg"
  },
  {
    "id": "lambda-ai",
    "name": "Lambda AI",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "LA",
    "website": "https://lambda.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "runcrate",
    "name": "Runcrate",
    "category": "apikey",
    "color": "#1A2B79",
    "textIcon": "RC",
    "website": "https://www.runcrate.ai",
    "freeNote": "Open models are free with your GitHub account",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/runcrate.svg"
  },
  {
    "id": "sambanova",
    "name": "SambaNova",
    "category": "apikey",
    "color": "#DC2626",
    "textIcon": "SN",
    "website": "https://sambanova.ai",
    "freeNote": "$5 free credits on signup (30-day validity), no credit card required",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/sambanova.svg"
  },
  {
    "id": "nscale",
    "name": "nScale",
    "category": "apikey",
    "color": "#0891B2",
    "textIcon": "NS",
    "website": "https://nscale.com",
    "freeNote": "$5 free credits on signup for inference testing",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "baseten",
    "name": "Baseten",
    "category": "apikey",
    "color": "#111827",
    "textIcon": "BT",
    "website": "https://baseten.co",
    "freeNote": "$30 free trial credits for GPU inference",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/baseten.svg"
  },
  {
    "id": "publicai",
    "name": "PublicAI",
    "category": "apikey",
    "color": "#059669",
    "textIcon": "PA",
    "website": "https://publicai.co",
    "freeNote": "Requires an API key — one-time signup credit, then paid",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/publicai.svg"
  },
  {
    "id": "featherless-ai",
    "name": "Featherless AI",
    "category": "apikey",
    "color": "#EA580C",
    "textIcon": "FL",
    "website": "https://featherless.ai",
    "freeNote": "Free tier available — no credit card required",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "friendliai",
    "name": "FriendliAI",
    "category": "apikey",
    "color": "#EC4899",
    "textIcon": "FR",
    "website": "https://friendli.ai",
    "freeNote": "Free tier for serverless inference — no credit card required",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "wandb",
    "name": "Weights & Biases Inference",
    "category": "apikey",
    "color": "#FFBE0B",
    "textIcon": "WB",
    "website": "https://wandb.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "inference-net",
    "name": "Inference.net",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "IN",
    "website": "https://inference.net",
    "freeNote": "$25 free credits on signup plus research grants available",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "replicate",
    "name": "Replicate",
    "category": "apikey",
    "color": "#EA2805",
    "textIcon": "RP",
    "website": "https://replicate.com",
    "freeNote": "Pay per use; trial runs may be offered on select models (unverified)",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "video"
    ],
    "logo": "./providers/replicate.svg"
  },
  {
    "id": "cerebrium",
    "name": "Cerebrium",
    "category": "apikey",
    "color": "#EB3A6F",
    "textIcon": "CB",
    "website": "https://www.cerebrium.ai",
    "freeNote": "$30 one-time credit; set Base URL to your deployment's /run endpoint",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "hetzner",
    "name": "Hetzner Inference API",
    "category": "apikey",
    "color": "#D50C2D",
    "textIcon": "HZ",
    "website": "https://experiments.hetzner.com/inference",
    "freeNote": "Free during Hetzner's experimental phase, no billing yet; no SLA",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "grokified",
    "name": "Grokified",
    "category": "apikey",
    "color": "#111827",
    "textIcon": "GK",
    "website": "https://grokified.com",
    "freeNote": "$5 one-time credit on signup",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "predibase",
    "name": "Predibase",
    "category": "apikey",
    "color": "#0F766E",
    "textIcon": "PB",
    "website": "https://predibase.com",
    "freeNote": "$25 free trial credits (30-day validity)",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": true,
    "deprecationReason": "serving.app.predibase.com no longer resolves (sweep 2026-06-19); the managed serving API appears discontinued.",
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "bytez",
    "name": "Bytez",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "BZ",
    "website": "https://bytez.com",
    "freeNote": "$1 free credits, refreshes every 4 weeks",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/bytez.svg"
  },
  {
    "id": "monsterapi",
    "name": "MonsterAPI",
    "category": "apikey",
    "color": "#EF4444",
    "textIcon": "MA",
    "website": "https://monsterapi.ai",
    "authHint": "Get API key at monsterapi.ai",
    "freeNote": "One-time signup trial credits for decentralized GPU inference (no recurring free plan). No credit card required.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": true,
    "deprecationReason": "Monster API shuttered operations on 2026-06-30. Use alternative OpenAI-compatible providers.",
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/monsterapi.svg"
  },
  {
    "id": "modelscope",
    "name": "ModelScope",
    "category": "apikey",
    "color": "#FF6A00",
    "textIcon": "MS",
    "website": "https://modelscope.cn",
    "freeNote": "Free tier via ModelScope API-Inference — Alibaba account required.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "byteplus",
    "name": "BytePlus ModelArk",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "BP",
    "website": "https://console.byteplus.com/ark",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "digitalocean",
    "name": "DigitalOcean",
    "category": "apikey",
    "color": "#0060FF",
    "textIcon": "DO",
    "website": "https://docs.digitalocean.com/products/ai-platform/",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "azure-openai",
    "name": "Azure OpenAI",
    "category": "apikey",
    "color": "#0078D4",
    "textIcon": "AZ",
    "website": "https://azure.microsoft.com/products/ai-services/openai-service",
    "authHint": "Use your Azure OpenAI API key. Base URL should be your resource endpoint, for example https://my-resource.openai.azure.com.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "azure-ai",
    "name": "Azure AI Foundry",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "AF",
    "website": "https://learn.microsoft.com/azure/ai-foundry",
    "authHint": "Use your Azure AI Foundry key. Base URL can be https://<resource>.services.ai.azure.com/openai/v1/ or https://<resource>.openai.azure.com/openai/v1/.",
    "apiHint": "Foundry uses the OpenAI v1 surface with deployment names as models. OmniRoute normalizes root resource URLs to the v1 chat and /models endpoints.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "bedrock",
    "name": "Amazon Bedrock",
    "category": "apikey",
    "color": "#FF9900",
    "textIcon": "BR",
    "website": "https://aws.amazon.com/bedrock",
    "authHint": "Use your Amazon Bedrock API key and configure the AWS region where your models are enabled (for example eu-west-2). OmniRoute calls Bedrock's native Converse API directly.",
    "apiHint": "Native Bedrock integration: model discovery uses Bedrock foundation models and inference profiles, while chat uses the regional Bedrock Runtime Converse/ConverseStream APIs.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm",
      "embedding"
    ]
  },
  {
    "id": "watsonx",
    "name": "IBM watsonx.ai Gateway",
    "category": "apikey",
    "color": "#0F62FE",
    "textIcon": "WX",
    "website": "https://www.ibm.com/products/watsonx-ai",
    "authHint": "Use your watsonx bearer token. Base URL can be https://<region>.ml.cloud.ibm.com/ml/gateway/v1/ or a self-managed /ml/gateway/v1 endpoint.",
    "apiHint": "The watsonx model gateway exposes OpenAI-compatible /chat/completions and /models under /ml/gateway/v1.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "oci",
    "name": "OCI Generative AI",
    "category": "apikey",
    "color": "#C74634",
    "textIcon": "OCI",
    "website": "https://www.oracle.com/artificial-intelligence/generative-ai",
    "authHint": "Use your OCI Generative AI API key or IAM bearer token. Base URL can be https://inference.generativeai.<region>.oci.oraclecloud.com/openai/v1/.",
    "apiHint": "OCI exposes OpenAI-compatible chat and responses endpoints. Project ID is optional in OmniRoute but may be required for Responses and agentic workflows.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "sap",
    "name": "SAP Generative AI Hub",
    "category": "apikey",
    "color": "#0FAAFF",
    "textIcon": "SAP",
    "website": "https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/generative-ai-hub-in-sap-ai-core",
    "authHint": "Use your SAP AI Core bearer token. Base URL can be your AI_API_URL root or a deploymentUrl from Generative AI Hub.",
    "apiHint": "Model discovery uses /v2/lm/scenarios/foundation-models/models on AI_API_URL. Chat requests use deploymentUrl/chat/completions and require AI-Resource-Group.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "modal",
    "name": "Modal",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "MDL",
    "website": "https://modal.com/docs",
    "authHint": "Use the bearer token that protects your Modal deployment, if enabled. Base URL should point to your OpenAI-compatible Modal app, for example https://<workspace>--<app>.modal.run/v1.",
    "apiHint": "Modal commonly serves user-hosted OpenAI-compatible apps on /v1. OmniRoute will probe /v1/models and route chat traffic to /v1/chat/completions.",
    "freeNote": "$30/month free credits for new accounts",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "vertex",
    "name": "Vertex AI",
    "category": "apikey",
    "color": "#4285F4",
    "textIcon": "VA",
    "website": "https://cloud.google.com/vertex-ai",
    "authHint": "Provide Service Account JSON, an OAuth access token, a Vertex Express API key, or a service-account-bound authorization key. Express mode supports Gemini only; partner models require project-scoped credentials.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "stt",
      "tts",
      "video",
      "music"
    ]
  },
  {
    "id": "vertex-partner",
    "name": "Vertex AI Partners",
    "category": "apikey",
    "color": "#34A853",
    "textIcon": "VP",
    "website": "https://cloud.google.com/vertex-ai",
    "authHint": "Provide Service Account JSON or OAuth credentials. A service-account-bound authorization key also supports discovery, but partner inference additionally requires its Google Cloud project ID. Standard Express keys support Gemini only.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "cloudflare-ai",
    "name": "Cloudflare Workers AI",
    "category": "apikey",
    "color": "#F48120",
    "textIcon": "CF",
    "website": "https://developers.cloudflare.com/workers-ai",
    "authHint": "Requires API Token AND Account ID (found at dash.cloudflare.com)",
    "freeNote": "Free 10K Neurons/day: ~150 LLM responses, 500s Whisper audio, or ~500 FLUX.1 Schnell images at 1024x1024 (4.80 Neurons per 512x512 tile) — edge inference globally",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "stt",
      "image"
    ]
  },
  {
    "id": "scaleway",
    "name": "Scaleway AI",
    "category": "apikey",
    "color": "#4F0599",
    "textIcon": "SCW",
    "website": "https://www.scaleway.com/en/docs/ai-data/generative-apis/",
    "freeNote": "1M free tokens for new accounts — EU/GDPR compliant (Paris), Qwen3 235B & Llama 70B",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "ovhcloud",
    "name": "OVHcloud AI",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "OVH",
    "website": "https://www.ovhcloud.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/ovhcloud.svg"
  },
  {
    "id": "heroku",
    "name": "Heroku AI",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "HK",
    "website": "https://www.heroku.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/heroku.svg"
  },
  {
    "id": "databricks",
    "name": "Databricks",
    "category": "apikey",
    "color": "#F97316",
    "textIcon": "DB",
    "website": "https://www.databricks.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "datarobot",
    "name": "DataRobot",
    "category": "apikey",
    "color": "#6D28D9",
    "textIcon": "DR",
    "website": "https://docs.datarobot.com",
    "authHint": "Use your DataRobot API token. Optional Base URL can be the account root (for LLM Gateway) or a deployment URL under /api/v2/deployments/<id>.",
    "apiHint": "The default gateway catalogs active models from /genai/llmgw/catalog/. Deployment URLs are also supported for direct OpenAI-compatible chat requests.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "clarifai",
    "name": "Clarifai",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "CF",
    "website": "https://docs.clarifai.com",
    "authHint": "Use your Clarifai PAT or app-specific API key. OmniRoute targets the OpenAI-compatible endpoint at https://api.clarifai.com/v2/ext/openai/v1 and authenticates with Authorization: Key <token>.",
    "apiHint": "Clarifai exposes OpenAI-compatible chat, responses and /models on /v2/ext/openai/v1. Public/community models typically require a PAT; app-scoped keys only work for resources inside that app.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "snowflake",
    "name": "Snowflake Cortex",
    "category": "apikey",
    "color": "#29B5E8",
    "textIcon": "SF",
    "website": "https://www.snowflake.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/snowflake.svg"
  },
  {
    "id": "qianfan",
    "name": "Baidu Qianfan",
    "category": "apikey",
    "color": "#2468F2",
    "textIcon": "BD",
    "website": "https://cloud.baidu.com/product-s/qianfan_home",
    "apiHint": "Use a Qianfan API key from Baidu AI Cloud. The default endpoint is OpenAI-compatible v2.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "glm",
    "name": "GLM Coding",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "GL",
    "website": "https://z.ai/subscribe",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "glm-cn",
    "name": "GLM Coding (China)",
    "category": "apikey",
    "color": "#DC2626",
    "textIcon": "GC",
    "website": "https://open.bigmodel.cn",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "bigmodel",
    "name": "BigModel.cn (Zhipu)",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "BM",
    "website": "https://open.bigmodel.cn",
    "apiHint": "Create an API key at https://bigmodel.cn/usercenter/proj-mgmt/apikeys. OmniRoute uses BigModel.cn's OpenAI-compatible chat API.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "glmt",
    "name": "GLM Thinking",
    "category": "apikey",
    "color": "#1D4ED8",
    "textIcon": "GT",
    "website": "https://open.bigmodel.cn",
    "apiHint": "Preset GLM profile with higher token budget, thinking enabled, and longer timeout.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "bailian-coding-plan",
    "name": "Alibaba Token Plan",
    "category": "apikey",
    "color": "#FF6A00",
    "textIcon": "BCP",
    "website": "https://www.alibabacloud.com/help/en/model-studio/token-plan-overview",
    "apiHint": "Use an Alibaba Token Plan key and select its Singapore or Beijing region.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "video",
      "image"
    ]
  },
  {
    "id": "qwen-cloud",
    "name": "Qwen Cloud",
    "category": "apikey",
    "color": "#615CED",
    "textIcon": "QC",
    "website": "https://www.qwencloud.com/",
    "apiHint": "Use a Qwen Cloud API key and select its Global or Beijing region.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "video",
      "image"
    ]
  },
  {
    "id": "qwen-cloud-token-plan",
    "name": "Qwen Cloud Token Plan",
    "category": "apikey",
    "color": "#615CED",
    "textIcon": "QCT",
    "website": "https://www.qwencloud.com/pricing/token-plan",
    "apiHint": "Use a Qwen Cloud Token Plan key and select its Singapore or Beijing region.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "tts",
      "video",
      "image"
    ]
  },
  {
    "id": "kimi",
    "name": "Kimi (Legacy Moonshot API)",
    "category": "apikey",
    "color": "#1E3A8A",
    "textIcon": "KM",
    "website": "https://platform.kimi.ai?aff=omniroute",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/kimi.svg"
  },
  {
    "id": "kimi-coding-apikey",
    "name": "Kimi Code API Key",
    "category": "apikey",
    "color": "#1E40AF",
    "textIcon": "KC",
    "website": "https://www.kimi.ai/code?aff=omniroute",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "minimax",
    "name": "Minimax Coding",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "MM",
    "website": "https://www.minimax.io",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "tts",
      "video",
      "music",
      "image"
    ],
    "logo": "./providers/minimax.svg"
  },
  {
    "id": "minimax-cn",
    "name": "Minimax (China)",
    "category": "apikey",
    "color": "#DC2626",
    "textIcon": "MC",
    "website": "https://www.minimaxi.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "deepseek",
    "name": "DeepSeek",
    "category": "apikey",
    "color": "#4D6BFE",
    "textIcon": "DS",
    "website": "https://platform.deepseek.com",
    "freeNote": "5M free tokens on signup - no credit card required",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/deepseek.svg"
  },
  {
    "id": "zai",
    "name": "Z.AI",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "ZA",
    "website": "https://z.ai/model-api",
    "apiHint": "Create an API key at https://z.ai/manage-apikey/apikey-list.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "alibaba",
    "name": "Alibaba Cloud Model Studio",
    "category": "apikey",
    "color": "#FF6600",
    "textIcon": "AL",
    "website": "https://bailian.console.alibabacloud.com/",
    "apiHint": "Use a Model Studio API key and select its Singapore or Beijing region.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "video",
      "image"
    ],
    "logo": "./providers/alibaba.svg"
  },
  {
    "id": "alibaba-cn",
    "name": "Alibaba (China)",
    "category": "apikey",
    "color": "#FF6600",
    "textIcon": "AL",
    "website": "https://dashscope.console.aliyun.com/",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "longcat",
    "name": "LongCat AI",
    "category": "apikey",
    "color": "#FF6B9D",
    "textIcon": "LC",
    "website": "https://longcat.chat/platform/docs",
    "freeNote": "Free: one-time 10M-token grant after account signup + KYC verification (LongCat-2.0). One-time only — not a recurring daily/monthly allowance.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/longcat.svg"
  },
  {
    "id": "moonshot",
    "name": "Kimi",
    "category": "apikey",
    "color": "#1E40AF",
    "textIcon": "MS",
    "website": "https://platform.kimi.ai?aff=omniroute",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/moonshot.svg"
  },
  {
    "id": "volcengine",
    "name": "Volcengine",
    "category": "apikey",
    "color": "#DC2626",
    "textIcon": "VE",
    "website": "https://www.volcengine.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/volcengine.svg"
  },
  {
    "id": "volcengine-agent-plan",
    "name": "Volcengine Ark Agent Plan",
    "category": "apikey",
    "color": "#DC2626",
    "textIcon": "VA",
    "website": "https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan",
    "authHint": "Connect your Volcano Engine account or use an Ark Agent Plan subscription API key.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "volcengine-coding-plan",
    "name": "Volcengine Ark Coding Plan",
    "category": "apikey",
    "color": "#FF6A00",
    "textIcon": "VC",
    "website": "https://console.volcengine.com/ark/region:cn-beijing/subscription/coding-plan",
    "authHint": "Connect your Volcano Engine account or use an Ark Coding Plan subscription API key.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "gigachat",
    "name": "GigaChat (Sber)",
    "category": "apikey",
    "color": "#10B981",
    "textIcon": "GC",
    "website": "https://developers.sber.ru",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "xiaomi-mimo",
    "name": "Xiaomi MiMo",
    "category": "apikey",
    "color": "#EA580C",
    "textIcon": "MM",
    "website": "https://mimo.mi.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "tts"
    ]
  },
  {
    "id": "xiaomi-mimo-token-plan",
    "name": "Xiaomi MiMo Token Plan",
    "category": "apikey",
    "color": "#EA580C",
    "textIcon": "MT",
    "website": "https://mimo.mi.com",
    "apiHint": "Use a Token Plan key (tp-…) and select the cluster (Singapore, Amsterdam, or China) that issued it.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "baidu",
    "name": "Baidu (ERNIE)",
    "category": "apikey",
    "color": "#2932E1",
    "textIcon": "BD",
    "website": "https://ernie.baidu.com/",
    "authHint": "Get API key at console.bce.baidu.com",
    "freeNote": "Free ERNIE Speed/Lite models. China's #2 LLM.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/baidu.svg"
  },
  {
    "id": "tencent",
    "name": "Tencent Hunyuan",
    "category": "apikey",
    "color": "#07C160",
    "textIcon": "TC",
    "website": "https://hunyuan.tencent.com",
    "authHint": "Get API key at console.cloud.tencent.com",
    "freeNote": "Free Hunyuan Lite models. WeChat ecosystem.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/tencent.svg"
  },
  {
    "id": "iflytek",
    "name": "iFlytek Spark",
    "category": "apikey",
    "color": "#0066FF",
    "textIcon": "IF",
    "website": "https://xinghuo.xfyun.cn",
    "authHint": "Get API key at console.xfyun.cn",
    "freeNote": "Spark Lite is free (2 QPS rate-limited), but iFlytek ToS §2.4(3) prohibits programmatic extraction and requires Chinese real-name auth — use with caution.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/iflytek.svg"
  },
  {
    "id": "baichuan",
    "name": "Baichuan",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "BC",
    "website": "https://www.baichuan-ai.com/",
    "authHint": "Get API key at platform.baichuan-ai.com",
    "freeNote": "Free Baichuan models. Popular Chinese LLM startup.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/baichuan.svg"
  },
  {
    "id": "yi",
    "name": "Yi (01.AI)",
    "category": "apikey",
    "color": "#10B981",
    "textIcon": "YI",
    "website": "https://01.ai",
    "authHint": "Get API key at platform.lingyiwanwu.com",
    "freeNote": "No free API tier (2026) — Yi-Light retired; platform.01.ai is pay-as-you-go (Yi-Lightning paid). Open weights are download-only.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/yi.svg"
  },
  {
    "id": "stepfun",
    "name": "StepFun",
    "category": "apikey",
    "color": "#8B5CF6",
    "textIcon": "SF",
    "website": "https://stepfun.com",
    "authHint": "Get API key at platform.stepfun.com",
    "freeNote": "Free Step-2 models. Chinese AI company.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/stepfun.svg"
  },
  {
    "id": "coze",
    "name": "Coze",
    "category": "apikey",
    "color": "#3B82F6",
    "textIcon": "CZ",
    "website": "https://coze.com",
    "authHint": "Get API key at coze.com/open/api",
    "freeNote": "Free ByteDance agent platform. Bot building + LLM access.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/coze.svg"
  },
  {
    "id": "360ai",
    "name": "360 AI",
    "category": "apikey",
    "color": "#00B96B",
    "textIcon": "360",
    "website": "https://ai.360.cn",
    "authHint": "Get API key at ai.360.cn",
    "freeNote": "Free 360 AI Brain models. Major Chinese security company.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/360ai.svg"
  },
  {
    "id": "doubao",
    "name": "Doubao",
    "category": "apikey",
    "color": "#FE2C55",
    "textIcon": "DB",
    "website": "https://doubao.com",
    "authHint": "Get API key at console.volcengine.com",
    "freeNote": "Free Doubao models. ByteDance's chatbot.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/doubao.svg"
  },
  {
    "id": "sensenova",
    "name": "SenseNova",
    "category": "apikey",
    "color": "#0066FF",
    "textIcon": "SN",
    "website": "https://platform.sensenova.cn",
    "authHint": "Get API key at platform.sensenova.cn",
    "freeNote": "Free SenseTime models. Computer vision leader.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm",
      "image"
    ],
    "logo": "./providers/sensenova.svg"
  },
  {
    "id": "sparkdesk",
    "name": "SparkDesk",
    "category": "apikey",
    "color": "#0066FF",
    "textIcon": "SD",
    "website": "https://xinghuo.xfyun.cn",
    "authHint": "Get API key at console.xfyun.cn",
    "freeNote": "Spark Lite free (alias for iflytek), but ToS restricts to personal/non-commercial use and prohibits relaying access to third parties — use with caution.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/sparkdesk.svg"
  },
  {
    "id": "hcnsec",
    "name": "Huancheng Public API",
    "category": "apikey",
    "color": "#0EA5E9",
    "textIcon": "HC",
    "website": "https://api.hcnsec.cn",
    "authHint": "Get API key at api.hcnsec.cn",
    "freeNote": "Xinjiang Huancheng Cybersecurity public LLM API platform: free credits with daily check-ins.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/hcnsec.svg"
  },
  {
    "id": "agnes",
    "name": "Agnes AI",
    "category": "apikey",
    "color": "#10B981",
    "textIcon": "AG",
    "website": "https://agnes-ai.com",
    "authHint": "Get API key at agnes-ai.com",
    "freeNote": "Permanently free API - no credit card required.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "video",
      "image"
    ]
  },
  {
    "id": "agnes-cn",
    "name": "Agnes AI (China)",
    "category": "apikey",
    "color": "#047857",
    "textIcon": "AC",
    "website": "https://api.agnes-ai.cn",
    "authHint": "Get API key from the Agnes CN site.",
    "freeNote": "Permanently free, no API credit card required.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "sealion",
    "name": "SEA-LION",
    "category": "apikey",
    "color": "#0D9488",
    "textIcon": "SL",
    "website": "https://sea-lion.ai",
    "authHint": "Sign in at sea-lion.ai with Google (no card, no region wall), create an API key, then paste it here.",
    "freeNote": "Permanently free at 10 RPM — AI Singapore's Southeast-Asian models (Llama/Qwen/Gemma SEA-LION).",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "clova-studio",
    "name": "Naver CLOVA Studio",
    "category": "apikey",
    "color": "#03C75A",
    "textIcon": "CS",
    "website": "https://api.ncloud-docs.com/docs/en/ai-naver-clovastudio-summary",
    "apiHint": "OmniRoute routes chat traffic to the native Chat Completions v3 API (/v3/chat-completions/{model}), not the OpenAI-compatibility shim. All three v3 models are served: HCX-007 (reasoning, text only), HCX-005 (vision — accepts both public image URLs and inline base64 images), and HCX-DASH-002 (lightweight, text only). Requests stream upstream and are accumulated into a JSON body when the client asks for a non-streaming response.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "embedding"
    ]
  },
  {
    "id": "internlm",
    "name": "InternLM (Intern-S1)",
    "category": "apikey",
    "color": "#4F46E5",
    "textIcon": "IL",
    "website": "https://internlm.intern-ai.org.cn/",
    "freeNote": "Free monthly quota ~1M input / 3M output tokens (~10 RPM)",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "ant-ling",
    "name": "Ant Ling / Ring (inclusionAI)",
    "category": "apikey",
    "color": "#1677FF",
    "textIcon": "AL",
    "website": "https://developer.ant-ling.com/en/docs/",
    "authHint": "Register and create an API key at the Ant Ling API console (https://chat.ant-ling.com/open), then paste it here. OmniRoute routes chat traffic to https://api.ant-ling.com/v1/chat/completions; the provider is OpenAI-compatible and also exposes an Anthropic-compatible surface.",
    "freeNote": "500,000 free tokens per day per account (resets 02:00 UTC+8, no rollover)",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "sarvam",
    "name": "Sarvam AI",
    "category": "apikey",
    "color": "#0EA5E9",
    "textIcon": "SV",
    "website": "https://docs.sarvam.ai",
    "apiHint": "Sarvam AI is OpenAI-compatible on /v1. OmniRoute probes /v1/models and routes chat traffic to /v1/chat/completions. Models are tuned for Indic languages.",
    "freeNote": "₹1,000 in free signup credits — never expire",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "plamo",
    "name": "PLaMo",
    "category": "apikey",
    "color": "#DC2626",
    "textIcon": "PL",
    "website": "https://plamo.preferredai.jp/api",
    "apiHint": "PLaMo is OpenAI-compatible at https://api.platform.preferredai.jp/v1. Built by Preferred Networks and optimized for Japanese. Docs are primarily in Japanese.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "typhoon",
    "name": "Typhoon",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "TY",
    "website": "https://docs.opentyphoon.ai",
    "apiHint": "Typhoon is OpenAI-compatible on /v1. Built by SCB 10X (Thailand); typhoon-v2.5-30b-a3b-instruct is a thai-first, multilingual model.",
    "freeNote": "Free API key with a 5 req/s and 200 req/m rate limit.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "apmix",
    "name": "Apmix",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "AP",
    "website": "https://apmix.ai",
    "apiHint": "Get your API key from the Apmix dashboard (apmix.ai/dashboard).",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "nlpcloud",
    "name": "NLP Cloud",
    "category": "apikey",
    "color": "#2196F3",
    "textIcon": "NLPC",
    "website": "https://docs.nlpcloud.com",
    "authHint": "Use your NLP Cloud API key in Authorization: Token <key>. OmniRoute targets the chatbot endpoint on https://api.nlpcloud.io/v1/gpu/<model>/chatbot by default.",
    "apiHint": "NLP Cloud uses a proprietary chatbot API instead of OpenAI chat/completions. OmniRoute adapts OpenAI messages to input/context/history and exposes a local catalog of supported chatbot models.",
    "freeNote": "Trial credits for new accounts",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "runwayml",
    "name": "Runway",
    "category": "apikey",
    "color": "#111827",
    "textIcon": "RW",
    "website": "https://docs.dev.runwayml.com",
    "authHint": "Use your Runway API key in Authorization: Bearer <key>. OmniRoute targets the current Runway API at https://api.dev.runwayml.com/v1 and sends the required X-Runway-Version header automatically.",
    "apiHint": "Runway video generation is task-based. OmniRoute submits text-to-video or image-to-video jobs, polls /v1/tasks/{id}, and normalizes the finished video outputs back into the OpenAI-like /v1/videos/generations response.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "video"
    ]
  },
  {
    "id": "kie",
    "name": "KIE.AI",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "KIE",
    "website": "https://kie.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "stt",
      "tts",
      "video",
      "music",
      "image"
    ]
  },
  {
    "id": "pollinations",
    "name": "Pollinations AI",
    "category": "apikey",
    "color": "#4CAF50",
    "textIcon": "PO",
    "website": "https://pollinations.ai",
    "authHint": "Anonymous/keyless access to the documented free models is best-effort. Local v3.8.50 verification (2026-07-31) returned 401 via OmniRoute and Cloudflare 1010 on direct upstream probes from the same network. Premium models still require a Pollinations API key from enter.pollinations.ai.",
    "freeNote": "Free keyless tier: openai, openai-fast, openai-large, qwen-coder, mistral, deepseek, grok, gemini-flash-lite-3.1, perplexity-fast, perplexity-reasoning. Premium models (claude, gemini, midijourney) require a Pollinations API key from enter.pollinations.ai.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm",
      "stt",
      "tts",
      "video",
      "image"
    ],
    "logo": "./providers/pollinations.svg"
  },
  {
    "id": "haiper",
    "name": "Haiper",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "HP",
    "website": "https://haiper.ai",
    "authHint": "Get API key at haiper.ai/haiper-api",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "video",
      "image"
    ]
  },
  {
    "id": "leonardo",
    "name": "Leonardo AI",
    "category": "apikey",
    "color": "#8B5CF6",
    "textIcon": "LE",
    "website": "https://leonardo.ai",
    "authHint": "Get API key at leonardo.ai/developer",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "video",
      "image"
    ]
  },
  {
    "id": "ideogram",
    "name": "Ideogram",
    "category": "apikey",
    "color": "#EC4899",
    "textIcon": "ID",
    "website": "https://ideogram.ai",
    "authHint": "Get API key at ideogram.ai/docs/api",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "image"
    ]
  },
  {
    "id": "magnific",
    "name": "Magnific",
    "category": "apikey",
    "color": "#1B9E7F",
    "textIcon": "MG",
    "website": "https://www.magnific.com",
    "authHint": "Get an API key at magnific.com/user/api-keys (header x-magnific-api-key). Legacy Freepik developer keys still work.",
    "freeNote": "One-time ~€5 API credit for new accounts; pay-per-use afterward.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "image"
    ]
  },
  {
    "id": "udio",
    "name": "Udio",
    "category": "apikey",
    "color": "#10B981",
    "textIcon": "UD",
    "website": "https://udio.com",
    "authHint": "Paste session cookie from udio.com (Supabase auth)",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "music"
    ],
    "logo": "./providers/udio.svg"
  },
  {
    "id": "v0-vercel",
    "name": "v0 (Vercel)",
    "category": "apikey",
    "color": "#111827",
    "textIcon": "V0",
    "website": "https://v0.dev",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "gitlab",
    "name": "GitLab Duo PAT",
    "category": "apikey",
    "color": "#FC6D26",
    "textIcon": "GL",
    "website": "https://docs.gitlab.com/user/duo_agent_platform/code_suggestions/",
    "authHint": "GitLab personal access token for the public Code Suggestions API. Configure a self-hosted base URL when not using gitlab.com.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  },
  {
    "id": "voyage-ai",
    "name": "Voyage AI",
    "category": "apikey",
    "color": "#0F766E",
    "textIcon": "VA",
    "website": "https://www.voyageai.com",
    "authHint": "Bearer API key for Voyage AI embeddings and rerank APIs.",
    "freeNote": "200M free tokens for embeddings and reranking",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "embedding"
    ]
  },
  {
    "id": "jina-ai",
    "name": "Jina AI (Foundation API)",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "JA",
    "website": "https://jina.ai",
    "authHint": "Bearer API key for api.jina.ai — embeddings, rerank, classify, segment, and search. Dashboard keys take precedence over JINA_AI_API_KEY. This is not the Reader / r.jina.ai card and does not fetch URLs.",
    "freeNote": "10M free tokens on signup (non-commercial), no credit card required",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "embedding"
    ]
  },
  {
    "id": "typesafe",
    "name": "TypeSafe AI",
    "category": "apikey",
    "color": "#4F46E5",
    "textIcon": "TS",
    "website": "https://docs.typesafe.ai",
    "authHint": "Bearer API key for api.typesafe.ai. OmniRoute uses it for System One evaluation (Jev) — not chat completions. Store the key here; the jev combo strategy reads it at request time.",
    "apiHint": "TypeSafe System One answers typed questions (noul / choice / score) against a state. OmniRoute does not expose TypeSafe models in chat pickers or combos.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": []
  },
  {
    "id": "fal-ai",
    "name": "Fal.ai",
    "category": "apikey",
    "color": "#2563EB",
    "textIcon": "FL",
    "website": "https://fal.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "video",
      "music",
      "image"
    ]
  },
  {
    "id": "stability-ai",
    "name": "Stability AI",
    "category": "apikey",
    "color": "#8B5CF6",
    "textIcon": "SA",
    "website": "https://stability.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "image"
    ]
  },
  {
    "id": "black-forest-labs",
    "name": "Black Forest Labs",
    "category": "apikey",
    "color": "#111827",
    "textIcon": "BF",
    "website": "https://blackforestlabs.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "image"
    ]
  },
  {
    "id": "recraft",
    "name": "Recraft",
    "category": "apikey",
    "color": "#EC4899",
    "textIcon": "RC",
    "website": "https://recraft.ai",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "image"
    ],
    "logo": "./providers/recraft.svg"
  },
  {
    "id": "topaz",
    "name": "Topaz",
    "category": "apikey",
    "color": "#059669",
    "textIcon": "TP",
    "website": "https://topazlabs.com",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "image"
    ]
  },
  {
    "id": "segmind",
    "name": "Segmind",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "SG",
    "website": "https://segmind.com",
    "authHint": "Use your Segmind API key in the x-api-key header. OmniRoute targets https://api.segmind.com/v1/<model> and returns the generated image/video bytes directly.",
    "apiHint": "Segmind exposes 200+ hosted image and video models (Flux, SDXL, SD3, Kandinsky, Wan, Hunyuan, LTX, Kling, ...) under a single POST /v1/<model> REST call per model. OmniRoute ships a curated starter subset for each modality; more models can be routed by using their Segmind slug as the model id.",
    "freeNote": "Free trial credits on signup, no credit card required (per Segmind's public docs).",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "video",
      "image"
    ]
  },
  {
    "id": "dify",
    "name": "Dify",
    "category": "apikey",
    "color": "#6366F1",
    "textIcon": "DF",
    "website": "https://dify.ai",
    "authHint": "Get API key from your Dify instance.",
    "freeNote": "Free open-source AI app builder + RAG platform.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [
      "llm"
    ],
    "logo": "./providers/dify.svg"
  },
  {
    "id": "nomic",
    "name": "Nomic",
    "category": "apikey",
    "color": "#7C3AED",
    "textIcon": "NM",
    "website": "https://nomic.ai",
    "authHint": "Get API key at atlas.nomic.ai",
    "freeNote": "Free Nomic Embed API. Open-source embeddings, no credit card required.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": true,
    "serviceKinds": [],
    "logo": "./providers/nomic.svg"
  },
  {
    "id": "mixedbread",
    "name": "Mixedbread AI",
    "category": "apikey",
    "color": "#F59E0B",
    "textIcon": "MB",
    "website": "https://www.mixedbread.com",
    "authHint": "Bearer API key for the Mixedbread embeddings API.",
    "freeNote": "Free-tier API key via signup, no credit card required.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "embedding"
    ]
  },
  {
    "id": "jina-reader",
    "name": "Jina Reader (r.jina.ai)",
    "category": "apikey",
    "color": "#0EA5E9",
    "textIcon": "JR",
    "website": "https://jina.ai/reader",
    "authHint": "Bearer API key for r.jina.ai URL-to-markdown (/v1/web/fetch only). Does not serve /v1/embeddings or /v1/rerank. The same Jina token as Foundation API works; OmniRoute reuses a jina-ai dashboard key or JINA_AI_API_KEY when this card is empty.",
    "hasFree": true,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webFetch"
    ]
  },
  {
    "id": "tinyfish",
    "name": "TinyFish Fetch",
    "category": "apikey",
    "color": "#0891B2",
    "textIcon": "TF",
    "website": "https://docs.tinyfish.ai/fetch-api",
    "authHint": "X-API-Key from agent.tinyfish.ai/api-keys",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "webFetch"
    ]
  },
  {
    "id": "deepai",
    "name": "DeepAI",
    "category": "apikey",
    "color": "#4A90D9",
    "textIcon": "DA",
    "website": "https://deepai.org",
    "authHint": "Use your DeepAI API key. Get one at deepai.org — requires a Pro subscription ($9.99/mo).",
    "apiHint": "DeepAI uses per-endpoint REST calls (e.g. /api/text2img) instead of OpenAI chat/completions. OmniRoute adapts OpenAI image generation requests to DeepAI's /api/{slug} endpoints.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": []
  },
  {
    "id": "deapi",
    "name": "deAPI",
    "category": "apikey",
    "color": "#18181B",
    "textIcon": "DE",
    "website": "https://deapi.ai",
    "authHint": "Use your deAPI API key (sk-dp-<id>-<secret>) from deapi.ai. OmniRoute sends it as Authorization: Bearer <key>.",
    "apiHint": "deAPI serves images, video, text-to-speech, transcription and embeddings through its OpenAI-compatible gateway at https://oai.deapi.ai/v1 (no chat/completions). Model ids are deAPI's native ids (Flux1schnell, Ltx2_3_22B_Dist_INT8, Kokoro, WhisperLargeV3, Bge_M3_FP16, ...) — there are no dall-e-3 / tts-1 / whisper-1 aliases.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": false,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "stt",
      "tts",
      "video",
      "image",
      "embedding"
    ]
  },
  {
    "id": "cursor-api",
    "name": "Cursor API",
    "category": "apikey",
    "color": "#00D4AA",
    "textIcon": "CA",
    "website": "https://cursor.com/dashboard/api",
    "authHint": "Paste a Cursor user API key (crsr_... or grok_...) from cursor.com/dashboard/api. OmniRoute exchanges it for a session token on demand; no IDE or cursor-agent install is needed. Usage bills to the Cursor plan that owns the key.",
    "apiHint": "Same agent protocol and model catalog as the Cursor IDE provider. The Cursor CLI can also be pointed at /api/cursor-cli on this instance and authenticated with an OmniRoute API key.",
    "hasFree": false,
    "noAuth": false,
    "subscriptionRisk": true,
    "deprecated": false,
    "passthroughModels": false,
    "serviceKinds": [
      "llm"
    ]
  }
]
