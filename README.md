# Envoy

**Live chat translation for Age of Empires I–IV and Age of Mythology.**

Envoy reads the in-game chat off your screen, translates it, and shows it in a sleek overlay styled after the games' own UI.
Press a hotkey to reply. You type in your language, and Envoy types the translation into the game's chat for you.

```
 [All] 龙骑士: 你好，再来一局吗？        ← what the game shows
 ┌──────────────────────────────────────┐
 │ 中  龙骑士: Hello, another round?     │ ← Envoy's overlay
 │      你好，再来一局吗？                │
 └──────────────────────────────────────┘
 Ctrl+Shift+T → "gg wp, sure!" → 好局，打得漂亮！当然！ → sent to game chat
```

It works like [Translumo](https://github.com/ramjke/Translumo), but it's built for the Age games: it understands their chat format,
knows RTS slang, has a phrasebook for common moments and can reply for you.

---

## Features

**Reading chat**
- Reads the screen with the OCR built into Windows. It's free, works offline and is fast. No game files or memory are touched.
- Runs several OCR languages at once and keeps the best reading of each line, so mixed Chinese/Korean/Russian/English chat all comes through.
- Tidies up common OCR quirks. It removes the stray spaces Windows OCR puts between Chinese and Japanese characters, and it reads each line only once even when the next capture reads it slightly differently.
- Picks out the channel and the player name in `[All] Name: msg`, `Name (Team): msg`, `12:04 Name：消息` and similar formats.
- Remembers a separate chat area for each game. It auto-detects AoE IV, AoE II DE, AoE III DE, AoM Retold and AoE DE.
- Includes a live view of what Envoy sees and reads, for tuning contrast, enlargement and colour inversion.

**Translating**
- Free with no key: Google Translate, with Microsoft Translator as an automatic fallback.
- Bring your own key: DeepL, Claude (Anthropic), Amazon Translate, or a self-hosted LibreTranslate.
- A slang glossary handles `666`, `2333`, `88`, `ㅋㅋㅋ`, `ㅈㅈ`, `изи`, `jajaja`, `kkkk` and more instantly and offline.
- Skips messages already in your language and ignores your own messages.
- A daily character cap for paid providers. Once it's reached, Envoy falls back to the free provider until the next day.
- Caches recent translations, so repeated "gg" messages cost nothing.

**Replying**
- A hotkey opens a reply box over the game. It defaults to the language your opponent last wrote in.
- Shows a live preview plus a back-translation ("Means: …"), so you know what you're about to say.
- 16 hand-translated quick phrases in 13 languages (gl hf, gg wp, rematch?, "I'm using a translator", …). You can add your own.
- Sends the reply by typing it into game chat (Unicode keystrokes or paste), or just copies it to the clipboard.

**Looks**
- Five themes, one per game: *Imperial* (AoE IV), *Parchment* (AoE II), *Frontier* (AoE III), *Olympian* (AoM) and
  *Classic* (AoE I). The *Match the game* option switches between them automatically.
- Gilded rules, diamond studs and engraved Cinzel capitals. Everything re-skins live, including the overlay and the reply box.
- Overlay controls: position (anchored to the chat area or free-floating), width, text size, opacity, fade time, maximum message count, whether to show the original text, and sounds.

**Deployment**
- A single portable `Envoy.exe`. Nothing to install and no .NET runtime needed. It starts from the tray and can launch with Windows.

---

## Getting started

1. Download `Envoy.exe` from the latest [release](../../releases), or from the latest *Build* run's artifacts. Run it.
2. In the game, set **Display mode → Borderless window** (or Windowed). Exclusive fullscreen hides overlays and captures as black.
3. In Envoy's **War Room**, click **Select chat area** and drag a box around where chat appears.
4. Choose your language. You're done. Chat is translated as it arrives.
5. In game, press **Ctrl+Shift+T** to reply.

**OCR language packs.** Windows can only read scripts it has OCR data for. Under **Reading Chat → Languages to
recognise**, Envoy shows which are installed. Click **Install**, which asks for admin, or add the language in
*Settings → Time & language → Language & region*. Chinese, Korean, Japanese and Russian are the useful ones for ranked matchmaking.

| Hotkey | Action |
| --- | --- |
| `Ctrl+Shift+T` | Open the reply box |
| `Ctrl+Shift+O` | Show / hide the overlay |
| `Ctrl+Shift+P` | Pause / resume reading chat |
| `Ctrl+Shift+R` | Select the chat area |
| `Ctrl+Shift+E` | Move / resize the overlay |

All of these can be changed under **Hotkeys**.

---

## Translation providers, and who pays

Envoy has **no server**. Every request goes straight from your PC to the provider you pick, with your own credentials.
That means you can share the exe freely: nobody who downloads it can ever spend your credits, and you can't spend theirs.

| Provider | Cost | Notes |
| --- | --- | --- |
| **Google Translate (free)** | Free, no account | Default. Uses the public endpoint the Translate website widget uses. Unofficial, so it may rate-limit during very heavy use. |
| **Microsoft Translator (free)** | Free, no account | The endpoint Edge's built-in page translation uses. The default fallback. |
| **DeepL** | 500k chars/month free | Needs a free DeepL API account (a card is required at sign-up). |
| **Claude** | ~$0.0001 per message with Haiku | Best with slang and tone. Uses your Anthropic API key. Opus is the default; Haiku is far cheaper and plenty for chat. |
| **Amazon Translate** | $15 per million chars (free-tier / credits apply) | Good if you have AWS credits. Create an IAM user with only `translate:TranslateText`. |
| **LibreTranslate** | Free, self-hosted | Fully offline if you run the server yourself. |

A busy match is roughly 2,000–5,000 characters, so the free tiers go a long way. Paid providers have a daily cap
(50,000 characters by default). After that, Envoy uses the free provider until midnight.

API keys are stored encrypted with Windows DPAPI in `%APPDATA%\Envoy\settings.json`, readable only by your Windows account.

---

## Is it safe to use with online play?

Envoy was designed to stay well clear of anti-cheat:

- It **never** opens the game's process, reads or writes its memory, injects DLLs or modifies game files.
- **Reading:** it copies pixels from the screen with the same Windows API that screenshot and streaming tools use.
- **Writing:** it sends keystrokes through `SendInput`, the API on-screen keyboards and IMEs use. To the game, it looks like you typed fast.
- It runs as a normal user (it never asks for admin) and works entirely outside the game.

It's the same category of tool as Discord's overlay, OBS or a screen reader. That said, it's an unofficial tool and
not endorsed by Microsoft or the game studios, so use your own judgement.

---

## Building from source

Requirements: the .NET 8 SDK on Windows 10 (19041) or later.

```powershell
dotnet test tests/Envoy.Core.Tests
dotnet run --project src/Envoy.App
dotnet publish src/Envoy.App -c Release -o publish   # → publish/Envoy.exe (single file, self-contained)
```

Pushing a tag like `v0.2.0` makes the GitHub Actions workflow build, test and smoke-test the exe, then attach it to a release.

### Layout

```
src/Envoy.Core/     Platform-independent logic (unit-tested on any OS)
  Chat/             Chat line parser, OCR-tolerant de-duplication
  Ocr/              Multi-engine OCR merging and CJK clean-up
  Languages/        Language catalogue, offline script detection
  Translation/      Providers, fallback chain, cache, daily budget, slang glossary
  Pipeline/         OCR lines → translated messages; outgoing translation
  Phrases/          Built-in phrasebook (phrases.json)
  Settings/         Settings model and store (encrypted secrets)
src/Envoy.App/      Windows app (WPF)
  Services/         Screen capture, Windows OCR, hotkeys, SendInput, game detection
  Windows/          Settings, overlay, reply box, region picker
  Themes/           Palettes (one per game) + shared control styles
tests/              xUnit tests for Envoy.Core
```

### Adding a game theme

Copy `src/Envoy.App/Themes/Palette.imperial.xaml`, change the colours, add it to `ThemeManager.Themes`, and set it on the
game in `GameCatalog`. Every palette must define the same keys; CI checks that each theme loads.

---

## Known limitations / roadmap

- Exclusive fullscreen isn't supported (use borderless, which looks the same).
- OCR accuracy depends on chat font size. Raise **Enlarge before reading** for small text, and try **Invert** on light-on-dark chat.
- Planned: an offline translation model option, per-player language memory, a chat log export and an installer with auto-update.

---

Envoy is an unofficial fan project. It is not affiliated with or endorsed by Microsoft, Xbox Game Studios, World's Edge,
Relic Entertainment or Forgotten Empires. *Age of Empires* and *Age of Mythology* are trademarks of Microsoft.
Cinzel fonts © The Cinzel Project Authors, SIL Open Font License 1.1.
