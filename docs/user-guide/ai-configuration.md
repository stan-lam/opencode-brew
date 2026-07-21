# AI Configuration

OpenCodeBrew supports multiple AI providers. This guide covers how to configure each one.

## Supported Providers

| Provider | Type | Best For |
|----------|------|----------|
| **Ollama** | Local | Privacy, offline use, no API costs |
| **OpenAI** | Cloud | GPT-4o, most capable models |
| **Anthropic** | Cloud | Claude, long context, coding |
| **GitHub Copilot** | Cloud | Code completion, GitHub integration |
| **Custom** | Any | Self-hosted or other OpenAI-compatible APIs |

## Ollama (Local)

### Installation
1. Download Ollama from [ollama.ai](https://ollama.ai)
2. Install and run the application
3. Pull a model:
   ```bash
   ollama pull llama3
   # or for coding:
   ollama pull codellama
   # or for a larger model:
   ollama pull llama3:70b
   ```

### Configuration
1. Open Settings (⚙️)
2. Select **Ollama** as provider
3. Set URL to `http://localhost:11434` (default)
4. Select your model from the dropdown

### Recommended Models
| Model | Size | Best For |
|-------|------|----------|
| `llama3` | 8B | General use, fast responses |
| `llama3:70b` | 70B | Higher quality, slower |
| `codellama` | 7B | Code generation |
| `mistral` | 7B | Good balance of speed/quality |

## OpenAI

### Getting an API Key
1. Go to [platform.openai.com](https://platform.openai.com)
2. Sign up or log in
3. Navigate to API Keys
4. Create a new secret key
5. Copy the key (you won't see it again!)

### Configuration
1. Open Settings (⚙️)
2. Select **OpenAI** as provider
3. Paste your API key
4. Select a model (gpt-4o recommended)

### Available Models
| Model | Context | Best For |
|-------|---------|----------|
| `gpt-4o` | 128K | Best overall performance |
| `gpt-4o-mini` | 128K | Faster, cheaper |
| `gpt-4-turbo` | 128K | Previous generation |
| `o1-preview` | 128K | Complex reasoning |

## Anthropic (Claude)

### Getting an API Key
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Navigate to API Keys
4. Create a new key

### Configuration
1. Open Settings (⚙️)
2. Select **Anthropic** as provider
3. Paste your API key
4. Select a model (claude-3-5-sonnet recommended)

### Available Models
| Model | Context | Best For |
|-------|---------|----------|
| `claude-3-5-sonnet` | 200K | Best coding, fast |
| `claude-3-opus` | 200K | Most capable |
| `claude-3-sonnet` | 200K | Balanced |
| `claude-3-haiku` | 200K | Fastest, cheapest |

## GitHub Copilot

### Prerequisites
- Active GitHub Copilot subscription (Individual, Business, or Enterprise)

### Configuration
1. Open Settings (⚙️)
2. Select **Copilot** as provider
3. Choose **GitHub.com** or **Enterprise**
4. Click **Select account** to open the account picker
5. **GitHub.com**: use **Add account** to start device login, enter the code on the verification page, and the account is cached locally
6. **Enterprise**: click **Open login**, pick **GHE.com** or **GHES**, enter your instance, and complete login in the browser. Then click **Reload accounts** to detect the signed-in account
7. **Developer OAuth login** (GitHub.com only): enable **Use developer OAuth client ID + secret**, enter credentials, then click **Select account**
8. Return to the app - you're connected!

**Notes**
- Device login opens a verification page and caches accounts per host.
- Enterprise login opens your instance login page and reuses local editor sessions.
- OAuth app login requires the callback URL `http://127.0.0.1:1717/callback`.

### Features
- Uses your existing Copilot subscription
- No separate API key needed
- Access to Copilot models

## Custom Provider

For self-hosted or other OpenAI-compatible APIs:

### Configuration
1. Open Settings (⚙️)
2. Select **Custom** as provider
3. Enter your API base URL
4. Enter your API key (if required)
5. Enter the model name

### Compatible APIs
- LocalAI
- Text Generation WebUI
- vLLM
- LMStudio
- Any OpenAI-compatible endpoint

## Model Settings

### Temperature
Controls randomness in responses:
- **0.0** - Deterministic, same output for same input
- **0.7** - Balanced (recommended)
- **1.0+** - More creative, varied responses

### Max Tokens
Maximum length of AI responses:
- **1024** - Short responses
- **4096** - Standard (recommended)
- **16000+** - Very long responses

### System Prompt
Custom instructions for the AI. Use this to:
- Set a persona or role
- Define response format
- Add domain-specific context

## Per-App Settings

Each app (IDE, Notes, Assistant) can have different AI settings:

1. Open the app
2. Access its settings (usually ⚙️ icon)
3. Override global AI settings as needed

## Troubleshooting

### "Connection refused" (Ollama)
- Ensure Ollama is running: `ollama serve`
- Check the URL is correct: `http://localhost:11434`

### "Invalid API key" (OpenAI/Anthropic)
- Verify the key is correct (no extra spaces)
- Check the key hasn't been revoked
- Ensure you have API credits

### "Authentication failed" (Copilot)
- Sign out and sign back in
- Verify your Copilot subscription is active
- Check GitHub status for outages
