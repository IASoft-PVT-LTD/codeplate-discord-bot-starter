# AI replies

Use this when the user wants the bot to answer questions with an AI model: an `/ask` command, a summary of a discussion, or replies when someone mentions the bot. It needs a provider account and API key (Anthropic is the example; others work the same way) and costs money per use, so it ships off by default and limited.

## Steps

1. **Agree on the details** and write them in `docs/project.md`: which provider and model, who may use it (everyone, a role), a daily limit per member and per server, what it must never do (pretend to be staff, give medical advice…), and whether it may read channel messages (that needs the privileged Message Content intent; `/ask` doesn't).

2. **Add the key as an environment variable.** In `src/config.ts`, add `ANTHROPIC_API_KEY: z.string().optional()` (and `AI_MODEL: z.string().default('<model id the user chose>')`) to `EnvSchema`; document both in `.env.example` with empty values. The user puts the key in `.env`; never in code or chat.

3. **Install the SDK** pinned: `npm install --save-exact @anthropic-ai/sdk` (check its license is permissive). Read its README in `node_modules/@anthropic-ai/sdk/` for the current call shape.

4. **Wrap the provider** in `src/core/ai.ts` with a small interface, so tests never call the real API:

   ```ts
   export interface AiClient { answer(input: { system: string; question: string; maxTokens: number }): Promise<string> }
   export function createAi(env: Env): AiClient | null { /* null when no key: the command says AI is not set up */ }
   export function fakeAi(reply = 'A short fake answer.'): AiClient { return { answer: async () => reply }; }
   ```

   Pass it into `createBot` (add `ai: AiClient | null` to `Bot` in `src/core/command.ts` and to `createBot`'s options; `src/index.ts` passes `createAi(env)`, the test harness passes `fakeAi()`).

5. **Write the command** `src/commands/ask.ts`:
   - `await interaction.deferReply()` first: models take longer than Discord's 3-second limit.
   - Keep the system prompt in a constant at the top of the file (the bot's role, voice and rules from `docs/project.md`).
   - Limits: a `cooldown`, plus a daily count per member stored in a table (`add-a-database-table.md`); refuse with a `UserError` past the limit.
   - Reply with `editReply`, truncated to 2,000 characters (`truncate` in `src/core/text.ts`), with `allowedMentions: { parse: [] }` so the model can't ping anyone.
   - Catch provider errors: log them (`log.warn('ai failed', { err })`, never the key) and tell the user to try later.

6. **Replies when mentioned** (optional): needs `GatewayIntentBits.GuildMessages` and the privileged `MessageContent` intent in `INTENTS` (`src/bot.ts`) and in the Developer Portal; add `src/events/message-create.ts` that ignores bots, answers only when the bot is mentioned, and shares the same limits. Prefer `/ask` when possible: fewer intents, clearer consent.

7. **Test it** with `fakeAi()`: the reply appears via `editReply` (`r.callbackType === 5`, then `textOf(r.reply)`), the limit refuses the next call, a provider error gives the friendly message, and no request contains a mention parse. Add a scenario.

## Verify

1. `npm run check` ends with `CODEPLATE CHECKS: PASS` with no key set (the fake AI is used; the `env` step sees the new variables documented).
2. `npm run shots -- ask` shows the "thinking" deferral replaced by the answer.
3. Tell the user the real answers can only be judged in Discord with their key, and what each answer costs roughly with the chosen model.
