// Slash command options, declared once: each `opt.*` makes both the JSON that
// Discord receives (name, type, description, limits, choices) and the zod
// schema the router uses to validate what comes back. The handler gets a typed
// object:
//
//   options: {
//     question: opt.string('What to ask').max(200),
//     minutes: opt.integer('Close after this many minutes').min(1).max(10080).optional(),
//   },
//   run: async (ctx, { question, minutes }) => { ... }   // string, number | undefined
//
// Options are required unless you call .optional(). Discord lists required
// options first; keep them first in the object too (the definition check
// enforces it). `.zod(s => ...)` adds your own rule or transform, e.g.
// `opt.string('When').zod((s) => s.transform(...))`. Call .zod() and
// .optional() last, after the type-specific modifiers (.max, .choices…).
import { ApplicationCommandOptionType, ChannelType } from 'discord.js';
import type { Attachment, CommandInteractionOption, GuildBasedChannel, GuildMember, Role, User } from 'discord.js';
import { z } from 'zod';

export type OptionJson = {
  type: ApplicationCommandOptionType;
  name: string;
  description: string;
  required?: boolean;
  choices?: { name: string; value: string | number }[];
  min_length?: number;
  max_length?: number;
  min_value?: number;
  max_value?: number;
  autocomplete?: boolean;
  channel_types?: ChannelType[];
};

type Extra = Omit<OptionJson, 'type' | 'name' | 'description' | 'required'>;

interface OptInit<T> {
  type: ApplicationCommandOptionType;
  description: string;
  schema: z.ZodType<T>;
  extra?: Extra;
  required?: boolean;
  member?: boolean; // a User option whose handler wants the GuildMember
}

// Any option, after its modifiers. T is what the handler receives.
export class Opt<T> {
  readonly type: ApplicationCommandOptionType;
  readonly description: string;
  readonly schema: z.ZodType<T>;
  readonly extra: Extra;
  readonly required: boolean;
  readonly member: boolean;

  constructor(init: OptInit<T>) {
    this.type = init.type;
    this.description = init.description;
    this.schema = init.schema;
    this.extra = init.extra ?? {};
    this.required = init.required ?? true;
    this.member = init.member ?? false;
  }

  optional(): Opt<T | undefined> {
    return new Opt<T | undefined>({ ...this, schema: this.schema.optional(), required: false });
  }

  // Your own validation or transform on top of the built-in one.
  zod<U>(fn: (schema: z.ZodType<T>) => z.ZodType<U>): Opt<U> {
    return new Opt<U>({ ...this, schema: fn(this.schema) });
  }

  toJson(name: string): OptionJson {
    return { type: this.type, name, description: this.description, ...(this.required ? { required: true } : {}), ...this.extra };
  }
}

function stringSchema(extra: Extra): z.ZodType<string> {
  let s = z.string();
  if (extra.min_length !== undefined) s = s.min(extra.min_length);
  if (extra.max_length !== undefined) s = s.max(extra.max_length);
  const allowed = extra.choices?.map((c) => String(c.value));
  return allowed ? s.refine((v) => allowed.includes(v), { message: `must be one of: ${allowed.join(', ')}` }) : s;
}

class StringOpt extends Opt<string> {
  constructor(description: string, extra: Extra = {}) {
    super({ type: ApplicationCommandOptionType.String, description, schema: stringSchema(extra), extra });
  }
  max(n: number): StringOpt {
    return new StringOpt(this.description, { ...this.extra, max_length: n });
  }
  min(n: number): StringOpt {
    return new StringOpt(this.description, { ...this.extra, min_length: n });
  }
  // Fixed choices: Discord shows a menu and only accepts these (up to 25).
  choices(...values: (string | { name: string; value: string })[]): StringOpt {
    return new StringOpt(this.description, { ...this.extra, choices: values.map((v) => (typeof v === 'string' ? { name: v, value: v } : v)) });
  }
  // Suggestions while typing: add a handler for this option under `autocomplete` in the command.
  autocomplete(): StringOpt {
    return new StringOpt(this.description, { ...this.extra, autocomplete: true });
  }
}

function numberSchema(integer: boolean, extra: Extra): z.ZodType<number> {
  let s = integer ? z.number().int() : z.number();
  if (extra.min_value !== undefined) s = s.min(extra.min_value);
  if (extra.max_value !== undefined) s = s.max(extra.max_value);
  // Discord only offers the choices, but a stale client or a crafted request
  // can send anything: check it, like string choices.
  const allowed = extra.choices?.map((c) => Number(c.value));
  return allowed ? s.refine((v) => allowed.includes(v), { message: `must be one of: ${allowed.join(', ')}` }) : s;
}

class NumberOpt extends Opt<number> {
  readonly integer: boolean;
  constructor(description: string, integer: boolean, extra: Extra = {}) {
    super({
      type: integer ? ApplicationCommandOptionType.Integer : ApplicationCommandOptionType.Number,
      description,
      schema: numberSchema(integer, extra),
      extra,
    });
    this.integer = integer;
  }
  min(n: number): NumberOpt {
    return new NumberOpt(this.description, this.integer, { ...this.extra, min_value: n });
  }
  max(n: number): NumberOpt {
    return new NumberOpt(this.description, this.integer, { ...this.extra, max_value: n });
  }
  // Fixed choices: Discord shows a menu and only these are accepted (up to 25).
  choices(...values: { name: string; value: number }[]): NumberOpt {
    return new NumberOpt(this.description, this.integer, { ...this.extra, choices: values });
  }
}

const object = <T>() => z.custom<T>((v) => v != null && typeof v === 'object');

class ChannelOpt extends Opt<GuildBasedChannel> {
  constructor(description: string, extra: Extra = {}) {
    super({ type: ApplicationCommandOptionType.Channel, description, schema: object<GuildBasedChannel>(), extra });
  }
  // Limit which channels can be picked, e.g. .types(ChannelType.GuildText).
  types(...types: ChannelType[]): ChannelOpt {
    return new ChannelOpt(this.description, { ...this.extra, channel_types: types });
  }
}

export const opt = {
  string: (description: string) => new StringOpt(description),
  integer: (description: string) => new NumberOpt(description, true),
  number: (description: string) => new NumberOpt(description, false),
  boolean: (description: string) => new Opt<boolean>({ type: ApplicationCommandOptionType.Boolean, description, schema: z.boolean() }),
  user: (description: string) => new Opt<User>({ type: ApplicationCommandOptionType.User, description, schema: object<User>() }),
  // A member of this server: the handler gets the GuildMember (roles, nickname).
  member: (description: string) =>
    new Opt<GuildMember>({
      type: ApplicationCommandOptionType.User,
      description,
      member: true,
      schema: object<GuildMember>().refine((m) => 'guild' in m, { message: 'must be a member of this server' }),
    }),
  channel: (description: string) => new ChannelOpt(description),
  role: (description: string) => new Opt<Role>({ type: ApplicationCommandOptionType.Role, description, schema: object<Role>() }),
  attachment: (description: string) => new Opt<Attachment>({ type: ApplicationCommandOptionType.Attachment, description, schema: object<Attachment>() }),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any option type
export type Options = Record<string, Opt<any>>;
export type Parsed<O extends Options> = { [K in keyof O]: O[K] extends Opt<infer T> ? T : never };

// What Discord sent for one option, as the value its schema checks.
function rawValue(o: CommandInteractionOption | null, spec: Opt<unknown>): unknown {
  if (!o) return undefined;
  switch (spec.type) {
    case ApplicationCommandOptionType.User:
      return spec.member ? (o.member ?? o.user) : o.user;
    case ApplicationCommandOptionType.Channel:
      return o.channel ?? undefined;
    case ApplicationCommandOptionType.Role:
      return o.role ?? undefined;
    case ApplicationCommandOptionType.Attachment:
      return o.attachment ?? undefined;
    default:
      return o.value;
  }
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; problems: string[] };

export function parseOptions<O extends Options>(specs: O, get: (name: string) => CommandInteractionOption | null): ParseResult<Parsed<O>> {
  const raw: Record<string, unknown> = {};
  const shape: Record<string, z.ZodType> = {};
  for (const [name, spec] of Object.entries(specs)) {
    raw[name] = rawValue(get(name), spec);
    shape[name] = spec.schema;
  }
  const result = z.object(shape).safeParse(raw);
  if (result.success) return { ok: true, value: result.data as Parsed<O> };
  return { ok: false, problems: result.error.issues.map((i) => `\`${i.path.join('.')}\`: ${i.message}`) };
}
