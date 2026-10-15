// Draws bot messages as HTML that looks like a chat client's dark theme:
// embeds, buttons, select menus, modals and autocomplete, from the exact JSON
// the bot sent (recorded by the fake Discord). scripts/shots.ts turns the
// pages into PNGs. It's an approximation for checking layout and wording, not
// a pixel copy of Discord: check real colors and wrapping in Discord itself.
// Times (<t:…> and "Today at") are drawn in the bot's time zone (BOT.timezone),
// as a member in that zone would see them.
import type { FakeDiscord, FakeMessage, Raw } from '../../tests/fake/discord.ts';

export type Shown =
  | { kind: 'message'; message: FakeMessage; label?: string; ephemeral?: boolean }
  | { kind: 'modal'; modal: Raw }
  | { kind: 'autocomplete'; typed: string; choices: { name: string; value: string | number }[] }
  | { kind: 'note'; text: string };

export interface Scene {
  name: string;
  title: string;
  channel: string;
  items: Shown[];
}

const COLORS = ['#e8a33d', '#3fb27f', '#5b8def', '#d55fae', '#e5534b', '#7f8c99'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class Renderer {
  readonly discord: FakeDiscord;
  readonly botAvatar: string;
  readonly zone: string;
  constructor(discord: FakeDiscord, botAvatar: string, zone = 'UTC') {
    this.discord = discord;
    this.botAvatar = botAvatar;
    this.zone = zone;
  }

  userName(id: string): string {
    const u = this.discord.users.get(id);
    if (!u) return 'unknown';
    for (const g of this.discord.guilds.values()) {
      const nick = g.members.get(id)?.nick;
      if (nick) return nick;
    }
    return u.global_name ?? u.username;
  }

  avatar(id: string): string {
    if (id === this.discord.botUser.id) return this.botAvatar;
    const name = this.userName(id);
    const color = COLORS[Number(BigInt(id) % BigInt(COLORS.length))]!;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${color}"/><text x="40" y="53" font-family="Arial,sans-serif" font-size="36" font-weight="700" fill="#fff" text-anchor="middle">${esc(name[0]!.toUpperCase())}</text></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  roleColor(id: string): string {
    for (const g of this.discord.guilds.values()) {
      const r = g.roles.find((x) => x.id === id);
      if (r) return r.color ? `#${r.color.toString(16).padStart(6, '0')}` : '#c9cdfb';
    }
    return '#c9cdfb';
  }

  // Relative times ("in 2 hours") are drawn as they read when the message was sent.
  now = 0;

  // Discord's Markdown, the parts bots use.
  markdown(text: string): string {
    const now = this.now || this.discord.clock.now();
    let s = esc(text);
    s = s.replace(/```(?:\w+\n)?([\s\S]*?)```/g, (_m, code: string) => `<pre>${code}</pre>`);
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/__([^_]+)__/g, '<u>$1</u>');
    s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    s = s.replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoiler">$1</span>');
    // Bars made of block characters (poll results): drawn without seams between glyphs.
    s = s.replace(/[█▉▊▋▌▍▎▏▓▒░]+/g, (run) => `<span class="blocks">${run}</span>`);
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a>$1</a>');
    s = s.replace(/&lt;@!?(\d+)&gt;/g, (_m, id: string) => `<span class="mention">@${esc(this.userName(id))}</span>`);
    s = s.replace(/&lt;@&amp;(\d+)&gt;/g, (_m, id: string) => {
      const g = [...this.discord.guilds.values()][0];
      const r = g?.roles.find((x) => x.id === id);
      const c = this.roleColor(id);
      return `<span class="mention" style="color:${c};background:${c}22">@${esc(r?.name ?? 'role')}</span>`;
    });
    s = s.replace(/&lt;#(\d+)&gt;/g, (_m, id: string) => `<span class="mention"># ${esc(this.discord.channels.get(id)?.name ?? 'channel')}</span>`);
    s = s.replace(/&lt;t:(\d+)(?::([tTdDfFR]))?&gt;/g, (_m, secs: string, style = 'f') => `<span class="time">${esc(timeText(Number(secs) * 1000, style, now, this.zone))}</span>`);
    // Block quotes: lines starting with "> ".
    s = s
      .split('\n')
      .map((line) => (line.startsWith('&gt; ') ? `<span class="quote">${line.slice(5)}</span>` : line))
      .join('\n');
    return s.replace(/\n/g, '<br>');
  }

  embed(e: Raw): string {
    const color = e.color !== undefined ? `#${Number(e.color).toString(16).padStart(6, '0')}` : '#1e1f22';
    const fields = (e.fields ?? []) as Raw[];
    let fieldsHtml = '';
    if (fields.length) {
      fieldsHtml = '<div class="fields">';
      let inlineRun = 0;
      for (const f of fields) {
        inlineRun = f.inline ? inlineRun + 1 : 0;
        const span = f.inline ? '' : ' style="grid-column:1/-1"';
        fieldsHtml += `<div class="field"${span}><div class="fname">${this.markdown(f.name)}</div><div class="fvalue">${this.markdown(f.value)}</div></div>`;
      }
      fieldsHtml += '</div>';
    }
    const footerParts = [e.footer?.text ? esc(e.footer.text) : '', e.timestamp ? esc(new Intl.DateTimeFormat('en-CA', { timeZone: this.zone }).format(Date.parse(e.timestamp))) : ''].filter(Boolean);
    return `<div class="embed" style="border-left-color:${color}">
      <div class="ebody">
        ${e.author ? `<div class="eauthor">${e.author.icon_url ? `<img src="${this.avatarFromUrl(e.author.icon_url)}">` : ''}${esc(e.author.name)}</div>` : ''}
        ${e.title ? `<div class="etitle${e.url ? ' link' : ''}">${this.markdown(e.title)}</div>` : ''}
        ${e.description ? `<div class="edesc">${this.markdown(e.description)}</div>` : ''}
        ${fieldsHtml}
        ${footerParts.length ? `<div class="efooter">${footerParts.join(' • ')}</div>` : ''}
      </div>
      ${e.thumbnail?.url ? `<img class="thumb" src="${this.avatarFromUrl(e.thumbnail.url)}">` : ''}
    </div>`;
  }

  // Avatars in embeds point at Discord's CDN; draw the user's placeholder instead.
  avatarFromUrl(url: string): string {
    const id = /avatars\/(\d+)|embed\/avatars\/(\d+)/.exec(url);
    const user = [...this.discord.users.values()].find((u) => url.includes(u.id));
    if (user) return this.avatar(user.id);
    return id ? this.avatar(this.discord.botUser.id) : this.botAvatar; // default avatars: drawn as the bot's
  }

  components(rows: Raw[]): string {
    return rows
      .map((row) => {
        const parts = (row.components ?? []).map((c: Raw) => {
          if (c.type === 2) {
            const style = ['', 'primary', 'secondary', 'success', 'danger', 'link'][c.style] ?? 'secondary';
            return `<span class="btn ${style}${c.disabled ? ' disabled' : ''}">${c.emoji?.name ? `${esc(c.emoji.name)} ` : ''}${esc(c.label ?? '')}${c.style === 5 ? ' <span class="ext">↗</span>' : ''}</span>`;
          }
          const defaults = (c.default_values ?? []) as Raw[];
          const shown = defaults.length
            ? defaults
                .map((d) =>
                  d.type === 'channel'
                    ? `<span class="chip"># ${esc(this.discord.channels.get(d.id)?.name ?? '?')}</span>`
                    : d.type === 'role'
                      ? `<span class="chip" style="color:${this.roleColor(d.id)}">@${esc([...this.discord.guilds.values()][0]?.roles.find((r) => r.id === d.id)?.name ?? '?')}</span>`
                      : `<span class="chip">@${esc(this.userName(d.id))}</span>`,
                )
                .join(' ')
            : `<span class="ph">${esc(c.placeholder ?? 'Make a selection')}</span>`;
          return `<span class="select">${shown}<span class="chev">⌄</span></span>`;
        });
        return `<div class="row">${parts.join('')}</div>`;
      })
      .join('');
  }

  message(m: FakeMessage, opts: { label?: string; ephemeral?: boolean } = {}): string {
    this.now = Date.parse((m.edited_timestamp ?? m.timestamp) as string);
    const authorId = m.author.id as string;
    const isBot = authorId === this.discord.botUser.id;
    const name = this.userName(authorId);
    const time = timeText(Date.parse(m.timestamp as string), 't', 0, this.zone);
    const ephemeral = opts.ephemeral ?? ((m.flags ?? 0) & 64) === 64;
    const via = m.interaction_metadata ? this.userName(m.interaction_metadata.user.id) : null;
    const nameColor = isBot ? '#f2f3f5' : this.roleColor([...this.discord.guilds.values()][0]?.members.get(authorId)?.roles.at(-1) ?? '');
    return `<div class="msg${ephemeral ? ' eph' : ''}">
      ${via && opts.label ? `<div class="replyline"><span class="curve"></span><img src="${this.avatar(m.interaction_metadata.user.id)}"><b>${esc(via)}</b>&nbsp;used <span class="cmd">${esc(opts.label)}</span></div>` : ''}
      <div class="mrow">
        <img class="av" src="${this.avatar(authorId)}">
        <div class="mbody">
          <div class="mhead"><span class="name" style="color:${nameColor}">${esc(name)}</span>${isBot ? '<span class="app">APP</span>' : ''}<span class="ts">Today at ${time}</span>${m.edited_timestamp ? '<span class="ts">(edited)</span>' : ''}</div>
          ${m.content ? `<div class="content">${this.markdown(m.content)}</div>` : ''}
          ${(m.embeds ?? []).map((e: Raw) => this.embed(e)).join('')}
          ${m.components?.length ? `<div class="comps">${this.components(m.components)}</div>` : ''}
          ${ephemeral ? '<div class="ephnote">👁 Only you can see this • <a>Dismiss message</a></div>' : ''}
        </div>
      </div>
    </div>`;
  }

  modal(modal: Raw): string {
    const fields = (modal.components as Raw[])
      .map((row) => {
        const label = row.type === 18 ? row : null;
        const input = label ? row.component : row.components?.[0];
        const title = label?.label ?? input?.label ?? '';
        const value = input?.value ?? '';
        const area = input?.style === 2;
        return `<div class="mfield"><div class="mlabel">${esc(title)}${input?.required === false ? '' : ' <span class="req">*</span>'}</div>${label?.description ? `<div class="mdesc">${esc(label.description)}</div>` : ''}<div class="minput${area ? ' area' : ''}">${value ? esc(value) : `<span class="ph">${esc(input?.placeholder ?? '')}</span>`}</div></div>`;
      })
      .join('');
    return `<div class="overlay"><div class="modal"><div class="mtitle">${this.markdown(modal.title)}</div>${fields}<div class="mfoot"><span class="btn plain">Cancel</span><span class="btn primary">Submit</span></div></div></div>`;
  }

  autocomplete(typed: string, choices: { name: string }[]): string {
    return `<div class="ac"><div class="aclist"><div class="achead">OPTIONS MATCHING <b>${esc(typed)}</b></div>${choices.map((c, i) => `<div class="acitem${i === 0 ? ' sel' : ''}">${esc(c.name)}</div>`).join('') || '<div class="acitem ph">No matches</div>'}</div><div class="acinput">${esc(typed)}<span class="caret"></span></div></div>`;
  }

  page(scene: Scene): string {
    const body = scene.items
      .map((it) => {
        if (it.kind === 'message') return this.message(it.message, it);
        this.now = 0;
        if (it.kind === 'modal') return this.modal(it.modal);
        if (it.kind === 'autocomplete') return this.autocomplete(it.typed, it.choices);
        return `<div class="note">${this.markdown(it.text)}</div>`;
      })
      .join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(scene.title)}</title><style>${CSS}</style></head>
<body><div class="scene" data-scene="${esc(scene.name)}"><div class="chan"><span class="hash">#</span> ${esc(scene.channel)}<span class="sub">${esc(scene.title)}</span></div><div class="log">${body}</div></div></body></html>`;
  }
}

// Discord's timestamp styles, in English, in `zone`.
function timeText(ms: number, style: string, now: number, zone: string): string {
  if (style === 'R') {
    const diff = Math.round((ms - now) / 1000);
    const abs = Math.abs(diff);
    const [n, unit] = abs < 60 ? [abs, 'second'] : abs < 3600 ? [Math.round(abs / 60), 'minute'] : abs < 86400 ? [Math.round(abs / 3600), 'hour'] : [Math.round(abs / 86400), 'day'];
    const words = `${n} ${unit}${n === 1 ? '' : 's'}`;
    return diff >= 0 ? `in ${words}` : `${words} ago`;
  }
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', ...o }).format(ms);
  const time = f({ hour: '2-digit', minute: '2-digit' });
  const date = f({ day: 'numeric', month: 'long', year: 'numeric' });
  if (style === 't') return time;
  if (style === 'T') return f({ hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (style === 'd') return f({ day: '2-digit', month: '2-digit', year: 'numeric' });
  if (style === 'D') return date;
  if (style === 'F') return `${f({ weekday: 'long' })}, ${date} at ${time}`;
  return `${date} at ${time}`;
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#313338;color:#dbdee1;font:16px/1.375 "Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.scene{width:var(--w,760px);background:#313338;position:relative;min-height:120px}
.chan{height:48px;display:flex;align-items:center;gap:8px;padding:0 16px;border-bottom:1px solid #26272b;font-weight:600;color:#f2f3f5}
.chan .hash{color:#80848e;font-size:22px;font-weight:400}
.chan .sub{margin-left:12px;padding-left:12px;border-left:1px solid #3f4147;color:#949ba4;font-weight:400;font-size:14px}
.log{padding:8px 0 16px}
.msg{padding:6px 16px 6px 16px;margin-top:10px}
.msg.eph{background:#3a3c42aa}
.replyline{display:flex;align-items:center;gap:4px;font-size:14px;color:#b5bac1;margin-left:20px;margin-bottom:2px;position:relative}
.replyline .curve{width:30px;height:12px;border-left:2px solid #4e5058;border-top:2px solid #4e5058;border-top-left-radius:6px;margin-top:10px;margin-right:4px}
.replyline img{width:16px;height:16px;border-radius:50%}
.replyline .cmd{color:#949cf7}
.mrow{display:flex;gap:16px}
.av{width:40px;height:40px;border-radius:50%;flex:none;margin-top:2px}
.mbody{min-width:0;flex:1}
.mhead{display:flex;align-items:center;gap:6px}
.name{font-weight:600}
.app{background:#5865f2;color:#fff;font-size:10px;font-weight:700;padding:1px 4px;border-radius:3px;line-height:14px}
.ts{color:#949ba4;font-size:12px;margin-left:2px}
.content{white-space:normal;word-wrap:break-word}
.mention{background:#5865f24d;color:#c9cdfb;border-radius:3px;padding:0 2px;font-weight:500}
.time{background:#ffffff0f;border-radius:3px;padding:0 2px}
code{background:#2b2d31;border:1px solid #1e1f22;border-radius:4px;padding:0 3px;font-size:0.85em;font-family:"DejaVu Sans Mono",Menlo,"Cascadia Mono",Consolas,monospace;line-height:1.2}
.blocks{font-family:"DejaVu Sans Mono",Menlo,"Cascadia Mono","Segoe UI Symbol","Noto Sans Mono",monospace;display:inline-block;line-height:1;letter-spacing:-0.5px;transform:translateZ(0)}
s{text-decoration:line-through}
.spoiler{background:#1e1f22;color:#1e1f22;border-radius:3px}
pre{background:#2b2d31;border:1px solid #1e1f22;border-radius:4px;padding:8px;font:14px Consolas,monospace;white-space:pre-wrap}
.quote{display:inline-block;border-left:4px solid #4e5058;padding-left:10px}
a{color:#00a8fc;text-decoration:none}
.embed{display:flex;max-width:520px;margin-top:6px;background:#2b2d31;border-left:4px solid;border-radius:4px;padding:8px 16px 16px 12px;gap:16px}
.ebody{min-width:0;flex:1}
.eauthor{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:#f2f3f5;margin-top:8px}
.eauthor img{width:24px;height:24px;border-radius:50%}
.etitle{font-weight:600;color:#f2f3f5;margin-top:8px}
.etitle.link{color:#00a8fc}
.edesc{font-size:14px;margin-top:8px;line-height:1.3}
.fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 12px;margin-top:8px}
.fname{font-size:14px;font-weight:600;color:#f2f3f5;margin-bottom:2px}
.fvalue{font-size:14px}
.efooter{font-size:12px;color:#b5bac1;margin-top:8px}
.thumb{width:80px;height:80px;border-radius:4px;margin-top:8px;flex:none}
.comps{margin-top:4px}
.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.btn{display:inline-flex;align-items:center;height:32px;padding:0 16px;border-radius:8px;font-size:14px;font-weight:500;color:#fff;white-space:nowrap}
.btn.primary{background:#5865f2}.btn.secondary{background:#4e5058}.btn.success{background:#248046}.btn.danger{background:#da373c}.btn.link{background:#4e5058}.btn.plain{background:transparent}
.btn.disabled{opacity:.5}
.ext{margin-left:6px;opacity:.8}
.select{display:flex;align-items:center;justify-content:space-between;width:400px;max-width:100%;min-height:40px;padding:6px 8px 6px 12px;background:#1e1f22;border:1px solid #1e1f22;border-radius:8px;font-size:14px}
.select .chip{background:#383a40;border-radius:4px;padding:2px 6px;margin-right:4px}
.ph{color:#949ba4}
.chev{color:#b5bac1;font-size:18px;line-height:1}
.ephnote{font-size:12px;color:#949ba4;margin-top:6px}
.note{margin:12px 16px 0 72px;color:#949ba4;font-size:13px;font-style:italic}
.overlay{margin:12px 16px;padding:24px;background:#00000099;border-radius:8px;display:flex;justify-content:center}
.modal{width:440px;background:#313338;border-radius:8px;padding:16px;box-shadow:0 8px 24px #0006}
.mtitle{font-size:20px;font-weight:600;color:#f2f3f5;margin-bottom:12px}
.mfield{margin-bottom:16px}
.mlabel{font-size:12px;font-weight:700;text-transform:uppercase;color:#b5bac1;letter-spacing:.02em}
.req{color:#f23f43}
.mdesc{font-size:12px;color:#949ba4;margin:2px 0 6px}
.minput{background:#1e1f22;border-radius:4px;padding:10px;font-size:15px;min-height:40px;margin-top:6px;white-space:pre-wrap}
.minput.area{min-height:96px}
.mfoot{display:flex;justify-content:flex-end;gap:8px;background:#2b2d31;margin:0 -16px -16px;padding:16px;border-radius:0 0 8px 8px}
.ac{margin:12px 16px 0}
.aclist{background:#2b2d31;border-radius:8px 8px 0 0;padding:8px}
.achead{font-size:12px;font-weight:700;color:#b5bac1;padding:4px 8px}
.acitem{padding:8px;border-radius:4px;font-size:15px}
.acitem.sel{background:#404249}
.acinput{background:#383a40;border-radius:0 0 8px 8px;padding:12px 16px;font-size:15px}
.caret{display:inline-block;width:1px;height:18px;background:#dbdee1;vertical-align:middle;margin-left:1px}
`;
