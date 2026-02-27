const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActivityType } = require('discord.js');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');

let config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const { TOKEN, WSS_PORT, ADMIN_IDS } = config;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let wss = null;
let mcConnection = null;
let currentPlayers = [];
let maxPlayers = "0";
let worldName = "Minecraft World";
let isInitialSync = true;

const getMemos = () => JSON.parse(fs.readFileSync('./memos.json', 'utf8'));
const saveMemos = (m) => fs.writeFileSync('./memos.json', JSON.stringify(m, null, 2), 'utf8');
if (!fs.existsSync('./memos.json')) fs.writeFileSync('./memos.json', '[]', 'utf8');

function saveLog(text) {
    const now = new Date();
    const timeStr = `[${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}]`;
    fs.appendFileSync('./log.txt', `${timeStr} ${text}\n`, 'utf8');
}

const commands = [
    new SlashCommandBuilder().setName('start').setDescription('WebSocket Start'),
    new SlashCommandBuilder().setName('stop').setDescription('WebSocket Stop'),
    new SlashCommandBuilder().setName('list').setDescription('Player List'),
    new SlashCommandBuilder()
        .setName('channel')
        .setDescription('Channel Config')
        .addStringOption(o => o.setName('action').setDescription('select action').setRequired(true) 
            .addChoices({ name: 'set', value: 'set' }, { name: 'remove', value: 'remove' })),
    new SlashCommandBuilder()
        .setName('memo')
        .setDescription('Memo Management')
        .addSubcommand(sub => sub.setName('add').setDescription('Add Memo')
            .addStringOption(o => o.setName('title').setDescription('memo title').setRequired(true)) 
            .addStringOption(o => o.setName('coords').setDescription('x y z').setRequired(true)) 
            .addStringOption(o => o.setName('dim').setDescription('dimension').setRequired(true) 
                .addChoices({ name: 'Overworld', value: 'Overworld' }, { name: 'Nether', value: 'Nether' }, { name: 'The End', value: 'The End' })))
        .addSubcommand(sub => sub.setName('view').setDescription('View Memos'))
        .addSubcommand(sub => sub.setName('delete').setDescription('Delete Memo')
            .addIntegerOption(o => o.setName('id').setDescription('memo id').setRequired(true))),
    new SlashCommandBuilder()
        .setName('log')
        .setDescription('Log Management')
        .addStringOption(o => o.setName('action').setDescription('select action').setRequired(true)
            .addChoices({ name: 'view', value: 'view' }, { name: 'clear', value: 'clear' })),
    new SlashCommandBuilder()
        .setName('command')
        .setDescription('Send MC Command')
        .addStringOption(o => o.setName('cmd').setDescription('minecraft command').setRequired(true)),
].map(c => c.toJSON());

client.once('ready', async () => {
    console.log(`Log in: ${client.user.tag}`);
    let updated = false;
    if (config.CLIENT_ID !== client.user.id) { config.CLIENT_ID = client.user.id; updated = true; }
    if (!config.GUILD_ID && client.guilds.cache.size === 1) { config.GUILD_ID = client.guilds.cache.first().id; updated = true; }
    if (updated) { fs.writeFileSync('./config.json', JSON.stringify(config, null, 2)); }
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try { await rest.put(Routes.applicationGuildCommands(config.CLIENT_ID, config.GUILD_ID), { body: commands }); } catch (e) { }
    updateStatus();
});

function updateStatus() {
    client.user.setActivity(mcConnection ? `${worldName} (${currentPlayers.length}/${maxPlayers})` : 'Offline', { type: ActivityType.Playing });
}

function sendMCCommand(ws, command, requestId) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ header: { version: 1, requestId: requestId, messageType: "commandRequest", messagePurpose: "commandRequest" }, body: { commandLine: command, version: 1 } }));
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'channel') {
        if (!ADMIN_IDS.includes(interaction.user.id)) return interaction.reply({ content: 'No permission', ephemeral: true });
        const action = interaction.options.getString('action');
        if (action === 'set') {
            config.CHANNEL_ID = interaction.channelId;
            fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
            await interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Channel <#${interaction.channelId}> set.`)] });
        } else if (action === 'remove') {
            config.CHANNEL_ID = "";
            fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
            await interaction.reply({ embeds: [new EmbedBuilder().setDescription('Channel setting removed.')] });
        }
    }

    if (interaction.commandName === 'start') {
        if (!config.CHANNEL_ID) return interaction.reply({ content: 'Channel not set.', ephemeral: true });
        if (wss) return interaction.reply({ content: 'Already running', ephemeral: true });
        wss = new WebSocketServer({ port: WSS_PORT });
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Server started').setColor(0x3498db)] });

        wss.on('connection', (ws) => {
            mcConnection = ws; isInitialSync = true;
            const channel = client.channels.cache.get(config.CHANNEL_ID);
            channel?.send({ embeds: [new EmbedBuilder().setTitle('World connected').setColor(0x2ecc71)] });
            saveLog("World connected");

            ["PlayerMessage", "ChatMessage"].forEach(ev => ws.send(JSON.stringify({ header: { version: 1, requestId: crypto.randomUUID(), messageType: "commandRequest", messagePurpose: "subscribe" }, body: { eventName: ev } })));

            const monitor = setInterval(() => {
                if (ws.readyState !== 1) return clearInterval(monitor);
                sendMCCommand(ws, "list", "sync-list");
                sendMCCommand(ws, "geteduclientinfo", "sync-world");
            }, 500);

            ws.on('message', (data) => {
                try {
                    const { header, body } = JSON.parse(data);
                
                    if ((header.eventName === 'PlayerMessage' || header.eventName === 'ChatMessage') && body.type === 'chat' && body.sender && body.sender !== '外部' && body.sender !== 'Server') {
                        if (!body.message?.includes('Join:') && !body.message?.includes('確認してください')) {
                            const channel = client.channels.cache.get(config.CHANNEL_ID);
                            
                            channel?.send(`<${body.sender}> ${body.message}`);
                            saveLog(`[MC] <${body.sender}> ${body.message}`);
                        }
                    }

                    if (header.requestId === "sync-list") {
                        const match = body.statusMessage?.match(/(\d+)\/(\d+)/);
                        if (match) maxPlayers = match[2];
                        const newP = body.statusMessage?.split(/:\s*/)[1]?.split(', ').map(n => n.trim()).filter(n => n !== "") || [];
                        
                        if (!isInitialSync) {
                            const channel = client.channels.cache.get(config.CHANNEL_ID);
                            newP.forEach(p => { 
                                if (!currentPlayers.includes(p)) {
                                    channel?.send({ embeds: [new EmbedBuilder().setDescription(`**${p}** joined (${newP.length}/${maxPlayers})`).setColor(0x57f287)] });
                                    saveLog(`[JOIN] ${p}`);
                                }
                            });
                            currentPlayers.forEach(p => { 
                                if (!newP.includes(p)) {
                                    const countAfter = newP.length;
                                    channel?.send({ embeds: [new EmbedBuilder().setDescription(`**${p}** left (${countAfter}/${maxPlayers})`).setColor(0xed4245)] });
                                    saveLog(`[LEFT] ${p}`);
                                }
                            });
                        }
                        currentPlayers = newP; isInitialSync = false; updateStatus();
                    }
                } catch (e) { }
            });
            ws.on('close', () => { 
                const channel = client.channels.cache.get(config.CHANNEL_ID);
                mcConnection = null; updateStatus(); 
                channel?.send({ embeds: [new EmbedBuilder().setTitle('Disconnected').setColor(0xe74c3c)] }); 
            });
        });
    }

    if (interaction.commandName === 'stop') {
        if (mcConnection) { mcConnection.terminate(); mcConnection = null; }
        wss?.close(() => { wss = null; updateStatus(); });
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Stopped').setColor(0x34495e)] });
    }

    if (interaction.commandName === 'list') {
        if (!mcConnection) return interaction.reply('Not connected');
        await interaction.deferReply();
        sendMCCommand(mcConnection, "list", "sync-list");
        setTimeout(async () => {
            await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`Online: (${currentPlayers.length}/${maxPlayers})`).setDescription(currentPlayers.join('\n') || 'None')] });
        }, 800);
    }
    
    if (interaction.commandName === 'memo') {
        const sub = interaction.options.getSubcommand();
        let memos = getMemos();
        if (sub === 'add') {
            const m = { title: interaction.options.getString('title'), coords: interaction.options.getString('coords'), dim: interaction.options.getString('dim'), author: interaction.user.username, date: new Date().toLocaleDateString('ja-JP') };
            memos.push(m); saveMemos(memos);
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Saved').setDescription(`${m.title} | ${m.coords} (${m.dim})`).setColor(0x2ecc71)] });
        } else if (sub === 'view') {
            if (memos.length === 0) return interaction.reply('No memos');
            const embed = new EmbedBuilder().setTitle('Memos');
            memos.forEach((m, i) => embed.addFields({ name: `ID: ${i} | ${m.title}`, value: `${m.coords} (${m.dim})` }));
            await interaction.reply({ embeds: [embed] });
        } else if (sub === 'delete') {
            const id = interaction.options.getInteger('id');
            if (id < 0 || id >= memos.length) return interaction.reply('Invalid ID');
            memos.splice(id, 1); saveMemos(memos);
            await interaction.reply({ embeds: [new EmbedBuilder().setDescription('Deleted.')] });
        }
    }

    if (interaction.commandName === 'log') {
        if (!ADMIN_IDS.includes(interaction.user.id)) return interaction.reply('No permission');
        const action = interaction.options.getString('action');
        if (action === 'view') {
            if (!fs.existsSync('./log.txt')) return interaction.reply('No logs');
            const data = fs.readFileSync('./log.txt', 'utf8').split('\n').filter(l => l.length > 0);
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Logs').setDescription(`\`\`\`\n${data.slice(-15).join('\n')}\n\`\`\``)] });
        } else if (action === 'clear') {
            fs.writeFileSync('./log.txt', '', 'utf8');
            await interaction.reply({ embeds: [new EmbedBuilder().setDescription('Logs cleared.')] });
        }
    }

    if (interaction.commandName === 'command') {
        if (!ADMIN_IDS.includes(interaction.user.id)) return interaction.reply('No permission');
        if (!mcConnection) return interaction.reply('Not connected');
        const cmd = interaction.options.getString('cmd');
        sendMCCommand(mcConnection, cmd, crypto.randomUUID());
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Command Sent').setDescription(`/${cmd}`).setColor(0xf1c40f)] });
    }
});

client.on('messageCreate', (msg) => {
    if (msg.author.bot || msg.channel.id !== config.CHANNEL_ID || !mcConnection || msg.content.startsWith('/')) return;
    saveLog(`[DISCORD] <${msg.author.username}> ${msg.content}`);
    mcConnection.send(JSON.stringify({ header: { version: 1, requestId: crypto.randomUUID(), messageType: "commandRequest", messagePurpose: "commandRequest" }, body: { commandLine: `tellraw @a {"rawtext":[{"text":"§b[Discord] §r<${msg.author.username}> ${msg.content}"}]}`, version: 1 } }));
});

client.login(TOKEN);