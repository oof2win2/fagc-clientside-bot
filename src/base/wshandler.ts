import { WebSocketEvents } from "fagc-api-wrapper/dist/WebsocketListener"
import FAGCBot from "./FAGCBot"
import { MessageEmbed } from "discord.js"
import RCONInterface from "./rcon"

interface HandlerOpts<T extends keyof WebSocketEvents> {
	event: Parameters<WebSocketEvents[T]>[0]
	client: FAGCBot
}

export const communityCreated = ({
	client,
	event,
}: HandlerOpts<"communityCreated">) => {
	const embed = new MessageEmbed({ ...event.embed, type: undefined })
	client.infochannels.forEach((guildChannels) => {
		guildChannels.forEach(c => {
			const channel = client.channels.cache.get(c.channelID)
			if (!channel || !channel.isNotDMChannel()) return
			client.addEmbedToQueue(channel.id, embed)
		})
	})
}

export const communityRemoved = ({ client, event }: HandlerOpts<"communityRemoved">) => {
	const embed = new MessageEmbed({ ...event.embed, type: undefined })
	client.infochannels.forEach((guildChannels) => {
		guildChannels.forEach(c => {
			const channel = client.channels.cache.get(c.channelID)
			if (!channel || !channel.isNotDMChannel()) return
			client.addEmbedToQueue(channel.id, embed)
		})
	})
}

export const ruleCreated = ({ client, event }: HandlerOpts<"ruleCreated">) => {
	const embed = new MessageEmbed({ ...event.embed, type: undefined })
	client.infochannels.forEach((guildChannels) => {
		guildChannels.forEach(c => {
			const channel = client.channels.cache.get(c.channelID)
			if (!channel || !channel.isNotDMChannel()) return
			client.addEmbedToQueue(channel.id, embed)
		})
	})
}

export const ruleRemoved = async ({ client, event }: HandlerOpts<"ruleRemoved">) => {
	const embed = new MessageEmbed({ ...event.embed, type: undefined })
	client.infochannels.forEach((guildChannels) => {
		guildChannels.forEach(c => {
			const channel = client.channels.cache.get(c.channelID)
			if (!channel || !channel.isNotDMChannel()) return
			client.addEmbedToQueue(channel.id, embed)
		})
	})
}

export const report = async ({ client, event }: HandlerOpts<"report">) => {
	const embed = new MessageEmbed({ ...event.embed, type: undefined })
	client.infochannels.forEach((guildChannels, guildID) => {
		const guildConfig = client.guildConfigs.get(guildID)
		if (!guildConfig) return
		if (
			guildConfig.ruleFilters?.includes(event.report.brokenRule) &&
			guildConfig.trustedCommunities?.includes(event.report.communityId)
		) {
			guildChannels.forEach(c => {
				const channel = client.channels.cache.get(c.channelID)
				if (!channel || !channel.isNotDMChannel()) return
				client.addEmbedToQueue(channel.id, embed)
			})
			client.ban(event.report, guildConfig.guildId)
		}
	})
}
export const revocation = async ({ client, event }: HandlerOpts<"revocation">) => {
	const embed = new MessageEmbed({ ...event.embed, type: undefined })
	await Promise.all(client.infochannels.map(async(guildChannels, guildID) => {
		const guildConfig = client.guildConfigs.get(guildID)
		if (!guildConfig) return
		if (
			guildConfig.ruleFilters?.includes(event.revocation.brokenRule) &&
			guildConfig.trustedCommunities?.includes(event.revocation.communityId)
		) {
			guildChannels.forEach(c => {
				const channel = client.channels.cache.get(c.channelID)
				if (!channel || !channel.isNotDMChannel()) return
				client.addEmbedToQueue(channel.id, embed)
			})
			await client.unban(event.revocation, guildID)
			
			
			const privateBans = await client.db.privatebans.findMany({
				where: {
					playername: event.revocation.playername,
				}
			})
			if (privateBans.length) {
				const command = `/ban ${event.revocation.playername} ${privateBans[0].reason}`
				await client.rcon.rconCommandGuild(command, guildID)
			} else {
				const otherBans = await client.fagc.reports.fetchFilteredReports(
					event.revocation.playername, 
					guildConfig.ruleFilters ?? [],
					guildConfig.trustedCommunities ?? []
				)
				if (otherBans.length) client.ban(otherBans[0], guildID)
			}
		}
	}))
}

export const guildConfigChanged = async ({ client, event }: HandlerOpts<"guildConfigChanged">) => {
	client.guildConfigs.set(event.guildId, event)
	
	// ban players that are online and are banned with the new rules
	const playercommands = (await client.rcon.rconCommandAll("/p o")).filter(r=>r)
	const players = playercommands.filter(x => x !== false) as Exclude<typeof playercommands[0], false>[]
	players.forEach((playeroutput) => {
		const playerlist = playeroutput.response
			.split("\n")
			.slice(1)
			.map((line) => line.slice(0, line.indexOf(" (online)")))
		const guildConfig = client.guildConfigs.get(playeroutput.server.discordGuildID)
		if (!guildConfig) return
		if (!guildConfig.ruleFilters || !guildConfig.trustedCommunities) return
		playerlist.forEach(async (player) => {
			if (!guildConfig.ruleFilters || !guildConfig.trustedCommunities) return // TS requires this
			const whitelist = await client.db.whitelist.findFirst({
				where: {
					playername: player
				}
			})
			if (whitelist) return // ignore whatever if a whielist for that player exists
			const allreports = await client.fagc.reports.fetchFilteredReports(player, guildConfig.ruleFilters, guildConfig.trustedCommunities)
			if (allreports.length) client.ban(allreports[0], guildConfig.guildId)
		})
	})
}