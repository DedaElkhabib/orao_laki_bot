require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActivityType,
  PermissionsBitField: P,
  EmbedBuilder,
} = require('discord.js');
const Parser = require('rss-parser');
const express = require('express');

// ---------- PODEŠAVANJA ----------
const PREFIX = '!';
const YT_CHANNEL_ID = 'UC_6qH954JnzF5-Ggj4jba0g'; // BalkanGamingCulture
const YT_URL = 'https://www.youtube.com/@BalkanGamingCulture';
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL_ID}`;
const CHECK_EVERY_MS = 5 * 60 * 1000; // proverava YouTube na 5 min

const {
  DISCORD_TOKEN,
  NOTIFY_CHANNEL_ID, // ID Discord kanala gde idu obaveštenja
  PING_ROLE_ID, // opciono: ID role koja se pinguje
  TIKTOK_URL, // opciono: npr. https://www.tiktok.com/@tvojnalog
  PORT = 3000,
} = process.env;

if (!DISCORD_TOKEN) {
  console.error('Nedostaje DISCORD_TOKEN u environment varijablama!');
  process.exit(1);
}

// ---------- KEEP-ALIVE WEB SERVER (za Render + UptimeRobot) ----------
const app = express();
app.get('/', (_, res) => res.send('BGC bot je online ✅'));
app.listen(PORT, () => console.log(`Web server radi na portu ${PORT}`));

// ---------- DISCORD KLIJENT ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ---------- STATUS ----------
const statuses = [
  { name: 'BalkanGamingCulture', type: ActivityType.Playing },
  { name: 'youtube.com/@BalkanGamingCulture', type: ActivityType.Watching },
  { name: '!help za komande', type: ActivityType.Listening },
];
if (TIKTOK_URL) {
  statuses.push({
    name: TIKTOK_URL.replace('https://www.', '').replace('https://', ''),
    type: ActivityType.Watching,
  });
}
let statusIndex = 0;
function rotateStatus() {
  client.user.setPresence({
    status: 'online',
    activities: [statuses[statusIndex % statuses.length]],
  });
  statusIndex++;
}

// ---------- YOUTUBE OBAVEŠTENJA ----------
const parser = new Parser();
const seen = new Set();

async function fetchFeed() {
  const feed = await parser.parseURL(FEED);
  return feed.items || [];
}

async function initYoutube() {
  try {
    const items = await fetchFeed();
    items.forEach((i) => seen.add(i.id));
    console.log(`YouTube: učitano ${items.length} postojećih videa (neće se objavljivati).`);
  } catch (e) {
    console.error('YouTube init greška:', e.message);
  }
}

async function checkYoutube() {
  if (!NOTIFY_CHANNEL_ID) return;
  try {
    const items = await fetchFeed();
    const fresh = items.filter((i) => !seen.has(i.id)).reverse(); // najstariji prvo
    if (!fresh.length) return;
    const channel = await client.channels.fetch(NOTIFY_CHANNEL_ID);
    for (const v of fresh) {
      seen.add(v.id);
      const ping = PING_ROLE_ID ? `<@&${PING_ROLE_ID}> ` : '';
      await channel.send({
        content: `${ping}🎬 **Novi video na BalkanGamingCulture!**\n${v.link}`,
        allowedMentions: { roles: PING_ROLE_ID ? [PING_ROLE_ID] : [] },
      });
    }
  } catch (e) {
    console.error('YouTube provera greška:', e.message);
  }
}

// ---------- POMOĆNE FUNKCIJE ----------
function parseDuration(str) {
  const m = /^(\d+)(s|m|h|d)$/i.exec(str || '');
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase()];
  const ms = n * mult;
  return ms > 0 && ms <= 28 * 86400000 ? ms : null; // Discord max 28 dana
}

const need = (msg, perm, label) => {
  if (!msg.member.permissions.has(perm)) {
    msg.reply(`❌ Treba ti dozvola: **${label}**.`);
    return false;
  }
  return true;
};

async function getTarget(msg) {
  const user = msg.mentions.users.first();
  if (!user) {
    await msg.reply('❌ Moraš da označiš korisnika (@korisnik).');
    return null;
  }
  const member = await msg.guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    await msg.reply('❌ Korisnik nije na serveru.');
    return null;
  }
  return member;
}

// ---------- KOMANDE ----------
const commands = {
  async help(msg) {
    const e = new EmbedBuilder()
      .setColor(0xe62117)
      .setTitle('📖 BGC Bot – komande')
      .setDescription(
        [
          '**Opšte**',
          '`!help` `!ping` `!social` `!latest`',
          '',
          '**Moderacija**',
          '`!kick @user [razlog]`',
          '`!ban @user [razlog]`',
          '`!unban <userID>`',
          '`!timeout @user <10m|1h|1d> [razlog]`',
          '`!untimeout @user`',
          '`!clear <1-99>`',
          '`!slowmode <sekunde>` (0 gasi)',
          '`!lock` / `!unlock`',
        ].join('\n')
      );
    msg.reply({ embeds: [e] });
  },

  async ping(msg) {
    msg.reply(`🏓 Pong! ${client.ws.ping}ms`);
  },

  async social(msg) {
    let text = `▶️ YouTube: ${YT_URL}`;
    if (TIKTOK_URL) text += `\n🎵 TikTok: ${TIKTOK_URL}`;
    msg.reply(text);
  },

  async latest(msg) {
    try {
      const items = await fetchFeed();
      if (!items.length) return msg.reply('Nema videa.');
      msg.reply(`🎬 Najnoviji video:\n${items[0].link}`);
    } catch {
      msg.reply('❌ Ne mogu da učitam YouTube trenutno.');
    }
  },

  async kick(msg, args) {
    if (!need(msg, P.Flags.KickMembers, 'Kick Members')) return;
    const t = await getTarget(msg);
    if (!t) return;
    if (!t.kickable) return msg.reply('❌ Ne mogu da kickujem tog korisnika (viša rola?).');
    const reason = args.slice(1).join(' ') || 'Bez razloga';
    await t.kick(`${msg.author.tag}: ${reason}`);
    msg.reply(`👢 **${t.user.tag}** je kickovan. Razlog: ${reason}`);
  },

  async ban(msg, args) {
    if (!need(msg, P.Flags.BanMembers, 'Ban Members')) return;
    const t = await getTarget(msg);
    if (!t) return;
    if (!t.bannable) return msg.reply('❌ Ne mogu da banujem tog korisnika (viša rola?).');
    const reason = args.slice(1).join(' ') || 'Bez razloga';
    await t.ban({ reason: `${msg.author.tag}: ${reason}` });
    msg.reply(`🔨 **${t.user.tag}** je banovan. Razlog: ${reason}`);
  },

  async unban(msg, args) {
    if (!need(msg, P.Flags.BanMembers, 'Ban Members')) return;
    const id = args[0];
    if (!id) return msg.reply('❌ Upotreba: `!unban <userID>`');
    try {
      await msg.guild.members.unban(id);
      msg.reply(`✅ Korisnik \`${id}\` je unbanovan.`);
    } catch {
      msg.reply('❌ Ne mogu da unbanujem – proveri ID.');
    }
  },

  async timeout(msg, args) {
    if (!need(msg, P.Flags.ModerateMembers, 'Moderate Members')) return;
    const t = await getTarget(msg);
    if (!t) return;
    const ms = parseDuration(args[1]);
    if (!ms) return msg.reply('❌ Upotreba: `!timeout @user 10m [razlog]` (s/m/h/d, max 28d)');
    if (!t.moderatable) return msg.reply('❌ Ne mogu da stavim timeout tom korisniku.');
    const reason = args.slice(2).join(' ') || 'Bez razloga';
    await t.timeout(ms, `${msg.author.tag}: ${reason}`);
    msg.reply(`🔇 **${t.user.tag}** ima timeout **${args[1]}**. Razlog: ${reason}`);
  },

  async untimeout(msg) {
    if (!need(msg, P.Flags.ModerateMembers, 'Moderate Members')) return;
    const t = await getTarget(msg);
    if (!t) return;
    await t.timeout(null);
    msg.reply(`🔊 Timeout skinut za **${t.user.tag}**.`);
  },

  async clear(msg, args) {
    if (!need(msg, P.Flags.ManageMessages, 'Manage Messages')) return;
    const n = parseInt(args[0], 10);
    if (!n || n < 1 || n > 99) return msg.reply('❌ Upotreba: `!clear <1-99>`');
    const deleted = await msg.channel.bulkDelete(n + 1, true);
    const info = await msg.channel.send(`🧹 Obrisano **${deleted.size - 1}** poruka.`);
    setTimeout(() => info.delete().catch(() => {}), 4000);
  },

  async slowmode(msg, args) {
    if (!need(msg, P.Flags.ManageChannels, 'Manage Channels')) return;
    const s = parseInt(args[0], 10);
    if (isNaN(s) || s < 0 || s > 21600) return msg.reply('❌ Upotreba: `!slowmode <0-21600>`');
    await msg.channel.setRateLimitPerUser(s);
    msg.reply(s === 0 ? '⏱️ Slowmode isključen.' : `⏱️ Slowmode: **${s}s**`);
  },

  async lock(msg) {
    if (!need(msg, P.Flags.ManageChannels, 'Manage Channels')) return;
    await msg.channel.permissionOverwrites.edit(msg.guild.roles.everyone, { SendMessages: false });
    msg.reply('🔒 Kanal zaključan.');
  },

  async unlock(msg) {
    if (!need(msg, P.Flags.ManageChannels, 'Manage Channels')) return;
    await msg.channel.permissionOverwrites.edit(msg.guild.roles.everyone, { SendMessages: null });
    msg.reply('🔓 Kanal otključan.');
  },
};

// ---------- EVENTI ----------
client.once('clientReady', async () => {
  console.log(`✅ Ulogovan kao ${client.user.tag}`);
  rotateStatus();
  setInterval(rotateStatus, 30 * 1000);
  await initYoutube();
  setInterval(checkYoutube, CHECK_EVERY_MS);
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.guild || !msg.content.startsWith(PREFIX)) return;
  const args = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const name = args.shift().toLowerCase();
  const cmd = commands[name];
  if (!cmd) return;
  try {
    await cmd(msg, args);
  } catch (e) {
    console.error(`Greška u komandi ${name}:`, e);
    msg.reply('❌ Došlo je do greške (proveri da li bot ima potrebne dozvole).').catch(() => {});
  }
});

client.login(DISCORD_TOKEN);
