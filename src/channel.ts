import type {
  ChannelPlugin,
  ChannelConfigAdapter,
  ChannelStatusAdapter,
  ChannelCapabilities,
  ChannelMessageActionAdapter,
  ChannelMeta,
  ChannelOutboundAdapter,
  ChannelGatewayAdapter,
  ChannelGatewayContext,
  ChannelAccountSnapshot,
  OpenClawConfig,
  PluginRuntime,
} from "openclaw/plugin-sdk";
import {
  DEFAULT_ACCOUNT_ID,
  jsonResult,
  registerPluginHttpRoute,
} from "openclaw/plugin-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AppServer, AppSession, TranscriptionData, PhotoData, PhotoTaken } from "@mentra/sdk";
import { getMentraOSRuntime } from "./runtime.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MentraOSResolvedAccount {
  accountId: string;
  enabled: boolean;
  apiKey?: string;
  apiUrl?: string;
  webhookPort?: number;
  config: {
    enabled: boolean;
    apiKey?: string;
    apiUrl: string;
    webhookPort: number;
    dmPolicy?: string;
    allowFrom?: Array<string | number>;
  };
}

// ---------------------------------------------------------------------------
// Session registry – maps userId → AppSession for outbound TTS
// ---------------------------------------------------------------------------

const activeSessions = new Map<string, AppSession>();

// ---------------------------------------------------------------------------
// Channel metadata
// ---------------------------------------------------------------------------

const meta: ChannelMeta = {
  id: "mentraos",
  label: "MentraOS",
  selectionLabel: "MentraOS Smart Glasses",
  docsPath: "/channels/mentraos",
  blurb: "Smart glasses with voice and AR capabilities",
};

// ---------------------------------------------------------------------------
// Config adapter
// ---------------------------------------------------------------------------

function resolveMentraOSAccount(
  cfg: OpenClawConfig,
  _accountId?: string | null,
): MentraOSResolvedAccount {
  const mentraConfig = (cfg.channels as any)?.mentraos as Record<string, any> | undefined;
  const enabled = mentraConfig?.enabled === true;
  const apiKey = mentraConfig?.apiKey as string | undefined;
  const apiUrl = (mentraConfig?.apiUrl as string) || "https://api.mentra.glass";
  const webhookPort = (mentraConfig?.webhookPort as number) || 3335;

  return {
    accountId: DEFAULT_ACCOUNT_ID,
    enabled,
    apiKey,
    apiUrl,
    webhookPort,
    config: {
      enabled,
      apiKey,
      apiUrl,
      webhookPort,
      dmPolicy: "open",
      allowFrom: ["*"],
    },
  };
}

const mentraosConfig: ChannelConfigAdapter<MentraOSResolvedAccount> = {
  listAccountIds: () => [DEFAULT_ACCOUNT_ID],
  resolveAccount: (cfg, accountId) => resolveMentraOSAccount(cfg, accountId),
  defaultAccountId: () => DEFAULT_ACCOUNT_ID,
  setAccountEnabled: ({ cfg, enabled }) => {
    if (!cfg.channels) cfg.channels = {};
    if (!(cfg.channels as any).mentraos) (cfg.channels as any).mentraos = {};
    (cfg.channels as any).mentraos.enabled = enabled;
    return cfg;
  },
  deleteAccount: ({ cfg }) => {
    if ((cfg.channels as any)?.mentraos) {
      delete (cfg.channels as any).mentraos;
    }
    return cfg;
  },
  isConfigured: (account) => Boolean(account.enabled && account.apiKey),
  describeAccount: (account) => ({
    accountId: account.accountId,
    name: "MentraOS",
    enabled: account.enabled,
    configured: Boolean(account.apiKey),
  }),
  resolveAllowFrom: () => ["*"],
  formatAllowFrom: ({ allowFrom }) => allowFrom.map(String),
};

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

const mentraosCapabilities: ChannelCapabilities = {
  chatTypes: ["direct"],
  reactions: false,
  threads: false,
  media: true,
  nativeCommands: false,
  blockStreaming: false,
};

// ---------------------------------------------------------------------------
// Message actions
// ---------------------------------------------------------------------------

const mentraosMessageActions: ChannelMessageActionAdapter = {
  listActions: () => ["send"],
  extractToolSend: ({ args }) => {
    const { action, target, message } = args as Record<string, unknown>;
    if (
      action === "send" &&
      typeof target === "string" &&
      typeof message === "string"
    ) {
      return { to: target, accountId: DEFAULT_ACCOUNT_ID };
    }
    return null;
  },
  handleAction: async (context) => {
    return jsonResult({
      status: "not-implemented",
      error: "Message action not yet implemented for MentraOS",
    });
  },
};

// ---------------------------------------------------------------------------
// Status adapter
// ---------------------------------------------------------------------------

let accountRuntimeStatus: ChannelAccountSnapshot = {
  accountId: DEFAULT_ACCOUNT_ID,
  running: false,
  lastStartAt: null,
  lastStopAt: null,
  lastError: null,
};

const mentraosStatus: ChannelStatusAdapter<MentraOSResolvedAccount> = {
  defaultRuntime: {
    accountId: DEFAULT_ACCOUNT_ID,
    running: false,
    lastStartAt: null,
    lastStopAt: null,
    lastError: null,
  },
  collectStatusIssues: (accounts) => {
    const issues: any[] = [];
    const account = accounts.find((a) => a.accountId === DEFAULT_ACCOUNT_ID);
    if (!account) return issues;

    if (!account.configured) {
      issues.push({
        channel: "mentraos",
        accountId: DEFAULT_ACCOUNT_ID,
        kind: "config",
        level: "error",
        message: "MentraOS API key not configured",
        fix: "Add apiKey to channels.mentraos config",
      });
    }

    if (!account.enabled) {
      issues.push({
        channel: "mentraos",
        accountId: DEFAULT_ACCOUNT_ID,
        kind: "config",
        level: "info",
        message: "MentraOS channel is disabled",
        fix: "Set channels.mentraos.enabled = true",
      });
    }

    return issues;
  },
  buildAccountSnapshot: ({ account, runtime }) => {
    return {
      accountId: account.accountId,
      name: "MentraOS",
      enabled: account.enabled,
      configured: Boolean(account.apiKey),
      running: runtime?.running ?? accountRuntimeStatus.running,
      lastStartAt: runtime?.lastStartAt ?? accountRuntimeStatus.lastStartAt,
      lastStopAt: runtime?.lastStopAt ?? accountRuntimeStatus.lastStopAt,
      lastError: runtime?.lastError ?? accountRuntimeStatus.lastError,
      lastInboundAt: (runtime as any)?.lastInboundAt ?? null,
      lastOutboundAt: (runtime as any)?.lastOutboundAt ?? null,
    };
  },
};

// ---------------------------------------------------------------------------
// Outbound adapter – sends responses via AppSession TTS
// ---------------------------------------------------------------------------

const mentraosOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) =>
    getMentraOSRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,

  sendText: async ({ to, text, accountId }) => {
    const runtime = getMentraOSRuntime();
    const messageId = `mentra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Try to send via active AppSession first (preferred path)
    const session = activeSessions.get(to);
    if (session) {
      try {
        console.log(`[MentraOS] 🔊 Speaking to user ${to} via AppSession TTS`);
        await session.audio.speak(text, {
          trackId: 2,
          stopOtherAudio: true,
        });
        console.log(`[MentraOS] ✅ TTS sent to ${to}`);
      } catch (error) {
        console.error(`[MentraOS] ❌ TTS error for ${to}:`, error);
      }
    } else {
      console.warn(`[MentraOS] ⚠️ No active session for user ${to} – cannot send TTS`);
    }

    // Record outbound activity
    runtime.channel.activity.record({
      channel: "mentraos",
      accountId: accountId ?? DEFAULT_ACCOUNT_ID,
      direction: "outbound",
    });

    return { channel: "mentraos", messageId };
  },

  sendMedia: async ({ to, text, mediaUrl, accountId }) => {
    const runtime = getMentraOSRuntime();
    const messageId = `mentra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Send text portion via TTS if available
    const session = activeSessions.get(to);
    if (session && text) {
      try {
        await session.audio.speak(text, {
          trackId: 2,
          stopOtherAudio: true,
        });
      } catch (error) {
        console.error(`[MentraOS] ❌ TTS media error for ${to}:`, error);
      }
    }

    runtime.channel.activity.record({
      channel: "mentraos",
      accountId: accountId ?? DEFAULT_ACCOUNT_ID,
      direction: "outbound",
    });

    return { channel: "mentraos", messageId };
  },
};

// ---------------------------------------------------------------------------
// Inbound pipeline – processes messages through the OpenClaw agent
// ---------------------------------------------------------------------------

/**
 * Process an inbound message through the OpenClaw agent pipeline.
 * Returns the collected agent response text.
 */
async function processInboundMessage(params: {
  userId: string;
  sessionId: string;
  text: string;
  mediaPath?: string;
  mediaType?: string;
  runtime: PluginRuntime;
  cfg: OpenClawConfig;
  account: MentraOSResolvedAccount;
  session: AppSession;
}): Promise<string | undefined> {
  const { userId, sessionId, text, mediaPath, mediaType, runtime, cfg, account, session } = params;

  // 1. Resolve agent route
  const route = runtime.channel.routing.resolveAgentRoute({
    cfg,
    channel: "mentraos",
    accountId: DEFAULT_ACCOUNT_ID,
    peer: { kind: "dm" as any, id: userId },
  });

  // 2. Resolve store path
  const storePath = runtime.channel.session.resolveStorePath(undefined, {
    agentId: route.agentId,
  });

  // 3. Format the inbound envelope
  const envelopeOpts = runtime.channel.reply.resolveEnvelopeFormatOptions(cfg);
  const bodyForAgent = runtime.channel.reply.formatInboundEnvelope({
    channel: "mentraos",
    from: userId,
    body: text,
    timestamp: Date.now(),
    chatType: "direct",
    senderLabel: userId,
    sender: { name: userId, id: userId },
    envelope: envelopeOpts,
  });

  // 4. Build MsgContext
  const ctx: Record<string, unknown> = {
    Body: text,
    BodyForAgent: bodyForAgent,
    RawBody: text,
    CommandBody: text,
    BodyForCommands: text,
    From: userId,
    To: DEFAULT_ACCOUNT_ID,
    AccountId: DEFAULT_ACCOUNT_ID,
    SessionKey: route.sessionKey,
    SenderName: userId,
    SenderId: userId,
    ChatType: "direct",
    Provider: "mentraos",
    Surface: "mentraos",
    OriginatingChannel: "mentraos",
    OriginatingTo: userId,
    Timestamp: Date.now(),
    MessageSid: `mentra-in-${Date.now()}`,
    ...(mediaPath ? { MediaPath: mediaPath, MediaType: mediaType } : {}),
  };

  // 5. Finalize the inbound context
  const finalizedCtx = runtime.channel.reply.finalizeInboundContext(ctx);

  // 6. Record inbound session
  await runtime.channel.session.recordInboundSession({
    storePath,
    sessionKey: route.sessionKey,
    ctx: finalizedCtx,
    createIfMissing: true,
    updateLastRoute: {
      sessionKey: route.sessionKey,
      channel: "mentraos",
      to: userId,
      accountId: DEFAULT_ACCOUNT_ID,
    },
    onRecordError: (err) => {
      console.error(`[MentraOS] Error recording session:`, err);
    },
  });

  // 7. Record session metadata
  await runtime.channel.session.recordSessionMetaFromInbound({
    storePath,
    sessionKey: route.sessionKey,
    ctx: finalizedCtx,
    createIfMissing: true,
  });

  // 8. Record inbound activity
  runtime.channel.activity.record({
    channel: "mentraos",
    accountId: DEFAULT_ACCOUNT_ID,
    direction: "inbound",
  });

  // 9. Dispatch through the reply pipeline
  let collectedReply = "";

  const resolveMessagesConfig = runtime.channel.reply.resolveEffectiveMessagesConfig;
  const messagesConfig = resolveMessagesConfig(cfg, route.agentId, {
    channel: "mentraos",
    accountId: DEFAULT_ACCOUNT_ID,
  });

  const humanDelay = runtime.channel.reply.resolveHumanDelayConfig(cfg, route.agentId);

  const dispatchResult =
    await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: finalizedCtx,
      cfg,
      dispatcherOptions: {
        deliver: async (payload) => {
          const replyText = payload.text?.trim();
          if (replyText) {
            collectedReply += (collectedReply ? "\n" : "") + replyText;
          }
        },
        responsePrefix: messagesConfig.responsePrefix,
        humanDelay,
        onError: (err, info) => {
          console.error(
            `[MentraOS] Reply dispatch error (${info.kind}):`,
            err,
          );
        },
      },
    });

  console.log(
    `[MentraOS] Reply dispatched: final=${dispatchResult.queuedFinal}, counts=${JSON.stringify(dispatchResult.counts)}`,
  );

  return collectedReply || undefined;
}

// ---------------------------------------------------------------------------
// FaceClaw AppServer – extends @mentra/sdk AppServer
// ---------------------------------------------------------------------------

class FaceClawAppServer extends AppServer {
  private runtime: PluginRuntime;
  private gatewayLog: ((msg: string) => void) | undefined;

  constructor(config: {
    packageName: string;
    apiKey: string;
    port: number;
    runtime: PluginRuntime;
    log?: (msg: string) => void;
  }) {
    super({
      packageName: config.packageName,
      apiKey: config.apiKey,
      port: config.port,
      publicDir: false, // No static file serving needed
      healthCheck: true,
    });
    this.runtime = config.runtime;
    this.gatewayLog = config.log;
  }

  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    console.log(`[MentraOS] 🔗 New session: userId=${userId} sessionId=${sessionId}`);
    this.gatewayLog?.(`🔗 New MentraOS session: userId=${userId}`);

    // Register session for outbound TTS
    activeSessions.set(userId, session);

    const cfg = this.runtime.config.loadConfig();
    const account = resolveMentraOSAccount(cfg);

    // Conversational listen window — stays active for 30s after last interaction
    const LISTEN_WINDOW_MS = 30_000;
    let listenWindowUntil = 0;

    // Echo suppression — ignore transcriptions while TTS is playing
    let speakingUntil = 0;
    let recentTtsText = "";

    // Estimate TTS duration: ~130ms per word + 1s buffer
    const estimateTtsDurationMs = (text: string) =>
      Math.max(2000, text.split(/\s+/).length * 130 + 1000);

    // Check if transcription is an echo of recent TTS
    const isEcho = (text: string): boolean => {
      if (!recentTtsText) return false;
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
      const ttsNorm = norm(recentTtsText);
      const textNorm = norm(text);
      // Check if the transcription is a substring of what we just said
      if (ttsNorm.includes(textNorm) || textNorm.includes(ttsNorm)) return true;
      // Check word overlap — if 60%+ of words match, it's likely echo
      const ttsWords = new Set(ttsNorm.split(/\s+/));
      const textWords = textNorm.split(/\s+/);
      if (textWords.length === 0) return false;
      const overlap = textWords.filter(w => ttsWords.has(w)).length;
      return overlap / textWords.length > 0.6;
    };

    // Subscribe to voice transcription
    session.events.onTranscriptionForLanguage(
      "en-US",
      async (data: TranscriptionData) => {
        if (!data.isFinal || !data.text?.trim()) return;

        const raw = data.text.trim();

        // Stop command — always allow, interrupt TTS
        if (/^stop\.?$/i.test(raw)) {
          console.log(`[MentraOS] 🛑 Stop command from ${userId}`);
          session.audio.stopAudio();
          listenWindowUntil = 0;
          speakingUntil = 0;
          recentTtsText = "";
          return;
        }

        // Echo suppression — ignore if we're still speaking or text matches TTS
        if (Date.now() < speakingUntil) {
          console.log(`[MentraOS] 🔇 Suppressed (TTS playing): "${raw.substring(0, 50)}..."`);
          return;
        }
        if (isEcho(raw)) {
          console.log(`[MentraOS] 🔇 Suppressed (echo): "${raw.substring(0, 50)}..."`);
          recentTtsText = ""; // Clear after catching echo
          return;
        }

        // Wake word filter — check for "Hey Mentra" or active listen window
        // Flexible matching: allow leading filler, punctuation, and common mistranscriptions
        const wakePattern = /(?:^|[\s,.])\s*(?:hey|hay|a|eh)\s+(?:mentra|menta|mentor|mencia|mantra|menorah)\b/i;
        const inListenWindow = Date.now() < listenWindowUntil;
        const hasWakeWord = wakePattern.test(raw);

        if (!hasWakeWord && !inListenWindow) {
          console.log(`[MentraOS] 🔇 No wake word, no listen window: "${raw.substring(0, 60)}"`);
          return;
        }

        // Strip the wake word if present
        const text = hasWakeWord
          ? (raw.replace(wakePattern, "").replace(/^[,.\s]+/, "").trim() || "Hey")
          : raw;
        console.log(`[MentraOS] 🎤 Transcription from ${userId}${inListenWindow && !hasWakeWord ? " (follow-up)" : ""}: "${text}"`);

        try {
          // Quick audio ack so user knows they were heard
          session.audio.speak("Hmm", {
            trackId: 1, // Different track so it doesn't block
            stopOtherAudio: false,
          });

          const reply = await processInboundMessage({
            userId,
            sessionId,
            text,
            runtime: this.runtime,
            cfg: this.runtime.config.loadConfig(),
            account: resolveMentraOSAccount(this.runtime.config.loadConfig()),
            session,
          });

          if (reply) {
            console.log(`[MentraOS] 🤖 Sending TTS reply to ${userId}: "${reply.substring(0, 80)}..."`);
            // Set echo suppression before speaking
            recentTtsText = reply;
            speakingUntil = Date.now() + estimateTtsDurationMs(reply);
            await session.audio.speak(reply, {
              trackId: 2,
              stopOtherAudio: true,
            });
            // Extend listen window after response so user can follow up
            listenWindowUntil = Date.now() + LISTEN_WINDOW_MS;
          }
        } catch (error) {
          console.error(`[MentraOS] ❌ Error processing transcription:`, error);
          try {
            await session.audio.speak("Sorry, I encountered an error processing your request.", {
              trackId: 2,
              stopOtherAudio: true,
            });
          } catch (speakErr) {
            console.error(`[MentraOS] ❌ Error sending error TTS:`, speakErr);
          }
        }
      },
    );

    // Subscribe to photo events
    session.events.onPhotoTaken(async (data: PhotoTaken) => {
      const photoBuffer = Buffer.from(data.photoData);
      console.log(`[MentraOS] 📷 Photo from ${userId}: ${photoBuffer.length} bytes`);

      try {
        // Save the image to media store
        const mimeType = data.mimeType || "image/jpeg";
        const saved = await this.runtime.channel.media.saveMediaBuffer(
          photoBuffer,
          mimeType,
          "mentraos",
        );

        const reply = await processInboundMessage({
          userId,
          sessionId,
          text: "[Photo from smart glasses]",
          mediaPath: saved.path,
          mediaType: mimeType,
          runtime: this.runtime,
          cfg: this.runtime.config.loadConfig(),
          account: resolveMentraOSAccount(this.runtime.config.loadConfig()),
          session,
        });

        if (reply) {
          await session.audio.speak(reply, {
            trackId: 2,
            stopOtherAudio: true,
          });
        }
      } catch (error) {
        console.error(`[MentraOS] ❌ Error processing photo:`, error);
        try {
          await session.audio.speak("Sorry, I couldn't analyze that photo.", {
            trackId: 2,
            stopOtherAudio: true,
          });
        } catch (speakErr) {
          console.error(`[MentraOS] ❌ Error sending photo error TTS:`, speakErr);
        }
      }
    });

    console.log(`[MentraOS] ✅ Session initialized for ${userId}`);
  }

  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    console.log(`[MentraOS] 🔗 Session stopped: userId=${userId} reason=${reason}`);
    this.gatewayLog?.(`🔗 MentraOS session stopped: userId=${userId}`);

    // Remove from active sessions
    activeSessions.delete(userId);
  }
}

// ---------------------------------------------------------------------------
// Gateway adapter – starts AppServer and registers health endpoint
// ---------------------------------------------------------------------------

let appServerInstance: FaceClawAppServer | null = null;

const mentraosGateway: ChannelGatewayAdapter<MentraOSResolvedAccount> = {
  startAccount: async (ctx: ChannelGatewayContext<MentraOSResolvedAccount>) => {
    const { account, cfg } = ctx;
    const runtime = getMentraOSRuntime();

    if (!account.apiKey) {
      const msg = "MentraOS API key not configured – skipping startup";
      ctx.log?.warn(msg);
      accountRuntimeStatus = {
        ...accountRuntimeStatus,
        running: false,
        lastError: msg,
      };
      return;
    }

    const port = account.config.webhookPort || 3335;

    ctx.log?.info(
      `[${account.accountId}] Starting MentraOS AppServer on port ${port}`,
    );

    // Register a health-check HTTP route on the gateway's existing port
    const unregisterHealth = registerPluginHttpRoute({
      path: "/webhook",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        // Health check only – actual communication is via AppServer WebSocket
        if (req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            status: "ok",
            timestamp: Date.now(),
            service: "mentraos-openclaw-plugin",
            appServer: appServerInstance ? "running" : "stopped",
            activeSessions: activeSessions.size,
          }));
          return;
        }
        // POST still accepted for backward compat – but just acknowledge
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          message: "MentraOS plugin now uses AppServer WebSocket. This HTTP endpoint is for health checks only.",
        }));
      },
      pluginId: "mentraos-plugin",
      source: "mentraos",
      accountId: account.accountId,
      log: (msg) => ctx.log?.info(msg),
    });

    // Create and start the AppServer
    try {
      appServerInstance = new FaceClawAppServer({
        packageName: "com.openclaw.faceclaw",
        apiKey: account.apiKey,
        port,
        runtime,
        log: (msg) => ctx.log?.info(msg),
      });

      await appServerInstance.start();

      ctx.log?.info(
        `[${account.accountId}] ✅ MentraOS AppServer running on port ${port}`,
      );
      ctx.log?.info(
        `[${account.accountId}] 📡 Webhook: http://localhost:${port}/webhook`,
      );
      ctx.log?.info(
        `[${account.accountId}] ❤️ Health: http://localhost:${port}/health`,
      );

      accountRuntimeStatus = {
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
        lastStopAt: null,
        lastError: null,
      };
      ctx.setStatus(accountRuntimeStatus);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      ctx.log?.error(`[${account.accountId}] ❌ Failed to start AppServer: ${errMsg}`);
      accountRuntimeStatus = {
        ...accountRuntimeStatus,
        running: false,
        lastError: errMsg,
      };
      ctx.setStatus(accountRuntimeStatus);
      return;
    }

    // Handle abort signal for cleanup
    ctx.abortSignal.addEventListener(
      "abort",
      async () => {
        ctx.log?.info(`[${account.accountId}] Stopping MentraOS AppServer`);
        unregisterHealth();

        if (appServerInstance) {
          try {
            await appServerInstance.stop();
          } catch (err) {
            console.error("[MentraOS] Error stopping AppServer:", err);
          }
          appServerInstance = null;
        }

        // Clear all active sessions
        activeSessions.clear();

        accountRuntimeStatus = {
          ...accountRuntimeStatus,
          running: false,
          lastStopAt: Date.now(),
        };
        ctx.setStatus(accountRuntimeStatus);
      },
      { once: true },
    );

    // Return a promise that resolves when aborted (keeps the provider "alive")
    return new Promise<void>((resolve) => {
      ctx.abortSignal.addEventListener("abort", () => resolve(), {
        once: true,
      });
    });
  },
};

// ---------------------------------------------------------------------------
// Export the channel plugin
// ---------------------------------------------------------------------------

export const mentraosPlugin: ChannelPlugin<MentraOSResolvedAccount> = {
  id: "mentraos",
  meta,
  capabilities: mentraosCapabilities,
  reload: { configPrefixes: ["channels.mentraos"] },
  config: mentraosConfig,
  outbound: mentraosOutbound,
  status: mentraosStatus,
  actions: mentraosMessageActions,
  gateway: mentraosGateway,
  security: {
    resolveDmPolicy: () => ({
      policy: "open",
      allowFrom: ["*"],
      allowFromPath: "channels.mentraos.",
      approveHint:
        "MentraOS uses open DM policy – all glasses users are allowed.",
    }),
  },
};
