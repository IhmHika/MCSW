// create by hika0908

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActivityType } = require('discord.js');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const { TOKEN, CHANNEL_ID, CLIENT_ID, GUILD_ID, WSS_PORT, ADMIN_IDS } = config;

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

const commands = [
    new SlashCommandBuilder().setName('start').setDescription('WebSocketサーバーを起動'),
    new SlashCommandBuilder().setName('stop').setDescription('WebSocketサーバーを停止'),
    new SlashCommandBuilder()
        .setName('command')
        .setDescription('【管理者限定】コマンド送信')
        .addStringOption(option => 
            option.setName('cmd').setDescription('実行するコマンド').setRequired(true)),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
    try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('✅ Commands Synced');
    } catch (e) { console.error(e); }
})();

function updateStatus() {
    if (mcConnection) {
        client.user.setActivity(`${worldName} (${currentPlayers.length}/${maxPlayers})`, { type: ActivityType.Playing });
    } else {
        client.user.setActivity('Offline', { type: ActivityType.Playing });
    }
}

function sendMCCommand(ws, command, requestId) {
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({
        header: { version: 1, requestId: requestId, messageType: "commandRequest", messagePurpose: "commandRequest" },
        body: { commandLine: command, version: 1 }
    }));
}

client.on('ready', () => {
    console.log(`✅ Log in: ${client.user.tag}`);
    updateStatus();
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'command') {
        if (!ADMIN_IDS.includes(interaction.user.id)) return interaction.reply({ content: '❌ 権限がありません', ephemeral: true });
        if (!mcConnection) return interaction.reply({ content: '❌ マイクラが未接続です', ephemeral: true });
        const cmdText = interaction.options.getString('cmd');
        sendMCCommand(mcConnection, cmdText, crypto.randomUUID());
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Command Sent').setDescription(`\`/${cmdText}\``).setColor(0xf1c40f)] });
    }

    if (interaction.commandName === 'start') {
        if (wss) return interaction.reply({ content: '既に起動しています', ephemeral: true });
        wss = new WebSocketServer({ port: WSS_PORT });
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('サーバーが起動しました').setColor(0x3498db)] });

        wss.on('connection', (ws) => {
            mcConnection = ws;
            isInitialSync = true; 
            const channel = client.channels.cache.get(CHANNEL_ID);
            channel?.send({ embeds: [new EmbedBuilder().setTitle('ワールドと接続しました').setColor(0x2ecc71)] });

            const events = ["PlayerMessage", "ChatMessage"];
            events.forEach(ev => {
                ws.send(JSON.stringify({
                    header: { version: 1, requestId: crypto.randomUUID(), messageType: "commandRequest", messagePurpose: "subscribe" },
                    body: { eventName: ev }
                }));
            });

            let idleCounter = 0;
            const monitorInterval = setInterval(() => {
                if (ws.readyState !== 1) return clearInterval(monitorInterval);
                idleCounter++;
                const checkInterval = currentPlayers.length > 0 ? 1 : 20; 
                if (idleCounter >= checkInterval) {
                    sendMCCommand(ws, "list", "sync-list");
                    sendMCCommand(ws, "geteduclientinfo", "sync-world");
                    idleCounter = 0;
                }
            }, 500); 

            ws.on('message', (data) => {
                try {
                    const res = JSON.parse(data);
                    const { header, body } = res;

                    if (header.eventName === 'PlayerMessage' || header.eventName === 'ChatMessage') {
                        const isChatType = body.type === 'chat';
                        const hasSender = body.sender && body.sender !== '外部' && body.sender !== 'Server';
                        const isNotSystem = !body.message?.includes('Join:');

                        if (isChatType && hasSender && isNotSystem) {
                            channel?.send(`<${body.sender}> ${body.message}`);
                        }
                    }

                    if (header.requestId === "sync-world") {
                        if (body.statusMessage?.includes("World:")) worldName = body.statusMessage.split("World:")[1].trim();
                    }

                    if (header.requestId === "sync-list") {
                        const statusMsg = body.statusMessage;
                        if (!statusMsg) return;
                        const match = statusMsg.match(/(\d+)\/(\d+)/);
                        if (match) maxPlayers = match[2];
                        const parts = statusMsg.split(/:\s*/);
                        const newPlayers = parts[1] ? parts[1].split(', ').map(n => n.trim()).filter(n => n !== "") : [];

                        if (!isInitialSync) {
                            newPlayers.forEach(p => {
                                if (!currentPlayers.includes(p)) channel?.send({ embeds: [new EmbedBuilder().setDescription(`**${p}** joined (${newPlayers.length}/${maxPlayers})`).setColor(0x57F287)] });
                            });
                            currentPlayers.forEach(p => {
                                if (!newPlayers.includes(p)) channel?.send({ embeds: [new EmbedBuilder().setDescription(`**${p}** left (${newPlayers.length}/${maxPlayers})`).setColor(0xED4245)] });
                            });
                        }
                        currentPlayers = newPlayers;
                        isInitialSync = false;
                        updateStatus();
                    }
                } catch (e) { }
            });

            ws.on('close', () => {
                mcConnection = null; currentPlayers = []; updateStatus();
                channel?.send({ embeds: [new EmbedBuilder().setTitle('切断されました').setColor(0xe74c3c)] });
            });
        });
    }

    if (interaction.commandName === 'stop') {
        if (!wss) return interaction.reply({ content: '未起動', ephemeral: true });
        wss.close(() => { wss = null; mcConnection = null; updateStatus(); });
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('停止しました').setColor(0x34495e)] });
    }
});

client.on('messageCreate', (msg) => {
    if (msg.author.bot || msg.channel.id !== CHANNEL_ID || !mcConnection) return;
    if (msg.content.startsWith('/')) return;
    mcConnection.send(JSON.stringify({
        header: { version: 1, requestId: crypto.randomUUID(), messageType: "commandRequest", messagePurpose: "commandRequest" },
        body: {
            commandLine: `tellraw @a {"rawtext":[{"text":"§b[Discord] §r<${msg.author.username}> ${msg.content}"}]}`,
            version: 1
        }
    }));
});

client.login(TOKEN);

// create by hika0908