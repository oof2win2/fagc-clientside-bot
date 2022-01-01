import FAGCBot from "../base/FAGCBot"

export default function handler(client: FAGCBot) {
	console.log(`${client.user?.tag} is online since ${new Date().toUTCString()}`)

	client.guilds.cache.map((guild => {
		// tell backend to send an event when a guild config for this guild is changed
		// also sends one event with the current config immediately
		if (!client.guildConfigs.has(guild.id)) client.fagc.websocket.addGuildID(guild.id)

		// create bot configs if they dont exist. these are local only with API key, actions etc.
		const config = client.getBotConfig(guild.id)
		if (!config) client.setBotConfig({
			guildID: guild.id,
			owner: guild.ownerId,
		})
	}))
}