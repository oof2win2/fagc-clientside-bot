import { WebSocketEvents } from "fagc-api-wrapper/dist/WebsocketListener"
import FAGCBot from "./FAGCBot.js"
import { MessageEmbed } from "discord.js"
import { GuildConfig, Report, Revocation } from "fagc-api-types"
import { arrayToChunks, hashGuildConfigFilters } from "../utils/functions.js"

interface HandlerOpts<T extends keyof WebSocketEvents> {
	event: Parameters<WebSocketEvents[T]>[0]
	client: FAGCBot
}

export const communityCreated = ({ client,event }: HandlerOpts<"communityCreated">) => {
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

	let shouldPerformActions = false
	const guildConfigs: GuildConfig[] = []

	client.guilds.cache.forEach((guild) => {
		const guildConfig = client.guildConfigs.get(guild.id)
		if (!guildConfig) return
		const infochannels = client.infochannels.get(guild.id)
		if (
			guildConfig.ruleFilters?.includes(event.report.brokenRule) &&
			guildConfig.trustedCommunities?.includes(event.report.communityId)
		) {
			if (infochannels) {
				infochannels.forEach(c => {
					const channel = client.channels.cache.get(c.channelID)
					if (!channel || !channel.isNotDMChannel()) return
					client.addEmbedToQueue(channel.id, embed)
				})
			}
			shouldPerformActions = true
			guildConfigs.push(guildConfig)
		}
	})

	if (!shouldPerformActions) return // did not match any filters so return
	
	reportHandler(client, guildConfigs, event.report)

}
/**
 * @param guildConfigs array of guild configs that are affected by the revocation, i.e. it matches their community and rule filters
 */
const reportHandler = async (client: FAGCBot, guildConfigs: GuildConfig[], report: Report) => {
	const isWhitelisted = await client.db.whitelist.findFirst({
		where: {
			playername: report.playername
		}
	})
	if (isWhitelisted) return // if the player is whitelisted, don't do anything

	// create the record for future safekeeping
	await client.db.fagcBan.create({
		data: {
			id: report.id,
			playername: report.playername,
			brokenRule: report.brokenRule,
			communityID: report.communityId,
		}
	})

	// ban in guilds that its supposed to
	guildConfigs.map((guildConfig) => {
		const command = client.createBanCommand(report, guildConfig.guildId)
		if (!command) return // if it is not supposed to do anything in this guild, then it won't do anything
		client.rcon.rconCommandGuild(`/sc ${command}; rcon.print(true)`, guildConfig.guildId)
	})
}

export const revocation = async ({ client, event }: HandlerOpts<"revocation">) => {
	const embed = new MessageEmbed({ ...event.embed, type: undefined })

	let shouldPerformActions = false
	const guildConfigs: GuildConfig[] = []

	client.guilds.cache.forEach((guild) => {
		const guildConfig = client.guildConfigs.get(guild.id)
		if (!guildConfig) return
		const infochannels = client.infochannels.get(guild.id)
		if (
			guildConfig.ruleFilters?.includes(event.revocation.brokenRule) &&
			guildConfig.trustedCommunities?.includes(event.revocation.communityId)
		) {
			if (infochannels) {
				infochannels.forEach(c => {
					const channel = client.channels.cache.get(c.channelID)
					if (!channel || !channel.isNotDMChannel()) return
					client.addEmbedToQueue(channel.id, embed)
				})
			}
			shouldPerformActions = true
			guildConfigs.push(guildConfig)
		}
	})

	if (!shouldPerformActions) return // did not match any filters so return

	revocationHandler(client, guildConfigs, event.revocation)
}
/**
 * @param guildConfigs array of guild configs that are affected by the revocation, i.e. it matches their community and rule filters
 */
const revocationHandler = async (client: FAGCBot, guildConfigs: GuildConfig[], revocation: Revocation) => {
	// remove the report record
	await client.db.fagcBan.delete({
		where: {
			id: revocation.reportId
		},
	}).catch(() => null)

	const isPrivateBanned = await client.db.privatebans.findFirst({
		where: {
			playername: revocation.playername
		}
	})
	if (isPrivateBanned) return // if the player is blacklisted, don't do anything

	const otherBan = await client.db.fagcBan.findFirst({
		where: {
			playername: revocation.playername
		}
	})

	// unban the player where it is wanted
	await Promise.allSettled(
		guildConfigs.map((guildConfig) => {
			const command = client.createUnbanCommand(revocation.playername, guildConfig.guildId)
			if (!command) return // if it is not supposed to do anything in this guild, then it won't do anything
			client.rcon.rconCommandGuild(`/sc ${command}; rcon.print(true)`, guildConfig.guildId)
		})
	)

	// if there is another FAGC report that conforms to the rules + communities, perform desired actions with it
	if (otherBan) {
		// there are other reports that the player is still banned for
		const report = await client.fagc.reports.fetchReport({ reportid: otherBan.id })
		if (!report) return
		// unban in guilds that its supposed to
		guildConfigs.map((guildConfig) => {
			const command = client.createBanCommand(report, guildConfig.guildId)
			if (!command) return // if it is not supposed to do anything in this guild, then it won't do anything
			client.rcon.rconCommandGuild(`/sc ${command}; rcon.print(true)`, guildConfig.guildId)
		})
		
	}
}

export const guildConfigChanged = async ({ client, event }: HandlerOpts<"guildConfigChanged">) => {
	// TODO: handle the command perms changing if the roles change
	client.guildConfigs.set(event.config.guildId, event.config) // set the new config
	const currentBotConfig = await client.getBotConfig(event.config.guildId)
	const newBotConfig = await client.setBotConfig({
		...currentBotConfig,
		guildConfigFiltersHash: hashGuildConfigFilters(event.config),
	})

	// unban everyone if no filtered rules on the new config
	if (!event.config.ruleFilters.length) {
		const currentReports = await client.db.fagcBan.findMany()
		const playernames: Set<string> = new Set()
		currentReports.map((record) => playernames.add(record.playername))
		await client.db.fagcBan.deleteMany() // delete all the records in the db as they are useless now
		
		// transform playernames into an array and split into chunks of 500, so factorio is not spammed
		// iterate over the chunks with a for loop and unban the players
		for (const players of arrayToChunks(playernames, 500)) {
		// map over the players and create an unban command for each
			const command = players
				.map((playername) => client.createUnbanCommand(playername, event.config.guildId))
				.join(";")
			await client.rcon.rconCommandGuild(`/sc ${command}; rcon.print(true)`, event.config.guildId)
			// sleep for 25ms to prevent servers from getting stuck
			await new Promise((resolve) => setTimeout(resolve, 25))
		}
		return
	}
	
	// this type is to assert the existence of ruleFilters and trustedCommunities on the config
	const newConfig = event.config as typeof event.config & Pick<Required<typeof event.config>, "ruleFilters" | "trustedCommunities">
	// run multiple queries once and then wait for all to finish so no extra time is spent waiting around for individual ones
	const [ newReports, currentReports, whitelistRecords, privatebanRecords ] = await Promise.all([
		client.fagc.reports.listFiltered({
			ruleIDs: newConfig.ruleFilters,
			communityIDs: newConfig.trustedCommunities
		}),
		client.db.fagcBan.findMany(),
		client.db.whitelist.findMany(),
		client.db.privatebans.findMany(),
	])

	const playersToUnban: Set<string> = new Set()

	// array of report IDs that can be removed
	const toRemoveIDs = currentReports
		.map((record) => {
			// if the brokenRule or communityID of the report is no longer trusted, it can be forgiven
			// if all reports against a player are forgiven, they are unbanned
			if (!newConfig.ruleFilters.includes(record.brokenRule)) {
				playersToUnban.add(record.playername)
				return record.id
			}
			if (!newConfig.trustedCommunities.includes(record.communityID)) {
				playersToUnban.add(record.playername)
				return record.id
			}
			// the record is now deemed appicable and still should still be banned by
			return false
		})
		.filter((id): id is string => Boolean(id))
	
	// remove the records of reports that are no longer deemed valid for this community - array created above
	await client.db.fagcBan.deleteMany({
		where: {
			id: {
				in: toRemoveIDs
			}
		}
	})

	const whitelistedPlayers = new Set(whitelistRecords.map((w) => w.playername))
	const privatebannedPlayers = new Set(privatebanRecords.map((p) => p.playername))

	const toBanReports = newReports
		.map((report) => {
			// if a player is whitelisted or privatebanned (blacklisted), ignore the report
			// this player is handled externally
			if (whitelistedPlayers.has(report.playername)) return // player is whitelisted, do nothing
			if (privatebannedPlayers.has(report.playername)) return // player is privately banned, don't store useless data

			// this player will not be unbanned, as there is a valid report against them
			playersToUnban.delete(report.playername)
			return report
		})
		.filter((r): r is Report => Boolean(r))
	
	// transform playersToUnban into an array and split into chunks of 500, so that the servers are not bombarded
	// with large amounts of players to ban at once
	// this is done again later with banned players
	// iterate over the chunks with a for loop and unban the players
	for (const players of arrayToChunks(playersToUnban, 500)) {
		// map over the players and create an unban command for each
		const command = players
			.map((playername) => client.createUnbanCommand(playername, event.config.guildId))
			.filter((x): x is string => Boolean(x)) // if the guilds action is to not do anything, then the command will be false
			.join(";")
		// run the command
		if (command) await client.rcon.rconCommandGuild(`/sc ${command}; rcon.print(true)`, event.config.guildId)
		// sleep for 25ms to prevent servers from getting stuck
		await new Promise((resolve) => setTimeout(resolve, 25))
	}

	// transform toBanReports into an array and split into chunks of 500 to not overload servers
	// iterate over the chunks with a for loop and ban the players
	for (const reports of arrayToChunks(toBanReports, 500)) {
		// map over the players and create a ban command for each
		const command = reports
			.map((report) => client.createBanCommand(report, event.config.guildId))
			.filter((x): x is string => Boolean(x)) // if the guilds action is to not do anything, then the command will be false
			.join(";")
		await client.rcon.rconCommandGuild(`/sc ${command}; rcon.print(true)`, event.config.guildId)
		// sleep for 25ms to prevent servers from getting stuck
		await new Promise((resolve) => setTimeout(resolve, 25))
	}

	// create the records of the reports in the db

	const newRecords = toBanReports
		.map((report) => `('${report.id}', '${report.playername}', '${report.brokenRule}', '${report.communityId}')`)
	// split newRecords into arrays of 500 and join them with a comma
	// iterate over the chunks with a for loop and insert the records into the db
	for (const records of arrayToChunks(newRecords, 500)) {
		await client.db.$executeRawUnsafe(`INSERT OR IGNORE INTO \`main\`.\`fagcban\` (id, playername, brokenRule, communityID) VALUES ${records.join(",")};`)
		// wait for 50ms to allow other queries to run
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
}