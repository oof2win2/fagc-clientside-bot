import { Guild } from "discord.js"
import FAGCBot from "../base/FAGCBot.js"

export default async (client: FAGCBot, [ guild ]: [Guild]) => {
	console.log(`Bot has now left guild ${guild.name}, removing their config`)

	client.guildConfigs.delete(guild.id)
	client.fagc.websocket.removeGuildID(guild.id)

	// TODO: remove all reports that were made in this guild and don't apply to any other guilds
	// TODO: unban all players in servers in this guild
}