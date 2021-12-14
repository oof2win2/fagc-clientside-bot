import { FAGCWrapper } from "fagc-api-wrapper"
import { GuildConfig, Community } from "fagc-api-types"
import ENV from "../utils/env.js"
import { Client, ClientOptions, Collection, MessageEmbed, TextBasedChannels, TextChannel } from "discord.js"
import { Command } from "./Commands.js"
import { InfoChannel, PrismaClient } from ".prisma/client/index.js"
import * as database from "./database.js"
import * as wshandler from "./wshandler.js"
import { Report, Revocation } from "fagc-api-types"
import RCONInterface from "./rcon.js"
import fs from "fs"
import { z } from "zod"

function getServers(): database.FactorioServerType[] {
	const serverJSON = fs.readFileSync(ENV.SERVERFILEPATH, "utf8")
	const servers = z.array(database.FactorioServer).parse(JSON.parse(serverJSON))
	return servers
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface BotOptions extends ClientOptions {

}
export default class FAGCBot extends Client {
	fagc: FAGCWrapper
	db: PrismaClient
	commands: Collection<string, Command>
	/**
	 * Info channels, grouped by guild ID
	 */
	infochannels: Collection<string, InfoChannel[]>
	/**
	 * Guild configs, by guild ID
	 */
	guildConfigs: Collection<string, GuildConfig>
	configuredActions: Collection<string, database.ActionType>
	community?: Community
	botconfig: Collection<string, database.BotConfigType>
	embedQueue: Collection<string, MessageEmbed[]>
	servers: Collection<string, database.FactorioServerType[]>
	readonly rcon: RCONInterface

	constructor(options: BotOptions) {
		super(options)
		this.guildConfigs = new Collection()
		this.fagc = new FAGCWrapper({
			apiurl: ENV.APIURL,
			socketurl: ENV.WSURL,
			enableWebSocket: true
		})
		this.commands = new Collection()

		this.infochannels = new Collection()
		this.configuredActions = new Collection()
		this.embedQueue = new Collection()
		this.servers = new Collection()

		this.botconfig = new Collection()

		const rawServers = getServers()

		rawServers.map((server) => {
			const existing = this.servers.get(server.discordGuildID)
			if (existing) {
				this.servers.set(server.discordGuildID, [ ...existing, server ])
			} else {
				this.servers.set(server.discordGuildID, [ server ])
			}
		})

		

		this.rcon = new RCONInterface(this, rawServers)

		this.db = new PrismaClient()
		this.db.$connect()

		// load info channels
		this.db.infoChannel.findMany().then(channels => {
			channels.forEach(channel => {
				const existing = this.infochannels.get(channel.guildID)
				if (existing) {
					this.infochannels.set(channel.guildID, [ ...existing, channel ])
				} else {
					this.infochannels.set(channel.guildID, [ channel ])
				}
			})
		})

		this.getBotConfigs().then(configs => {
			configs.forEach(config => {
				this.botconfig.set(config.guildID, config)
			})
		})
		
		this.fagc.websocket.on("communityCreated", (event) => wshandler.communityCreated({ event, client: this }))
		this.fagc.websocket.on("communityRemoved", (event) => wshandler.communityRemoved({ event, client: this }))
		this.fagc.websocket.on("ruleCreated", (event) => wshandler.ruleCreated({ event, client: this }))
		this.fagc.websocket.on("ruleRemoved", (event) => wshandler.ruleRemoved({ event, client: this }))
		this.fagc.websocket.on("report", (event) => wshandler.report({ event, client: this }))
		this.fagc.websocket.on("revocation", (event) => wshandler.revocation({ event, client: this }))
		this.fagc.websocket.on("guildConfigChanged", (event) => wshandler.guildConfigChanged({ event, client: this }))

		setInterval(() => this.sendEmbeds(), 10*1000) // send embeds every 10 seconds
	}
	async getBotConfigs(): Promise<database.BotConfigType[]> {
		const record = await this.db.botConfig.findMany({
			include: {
				actions: true
			}
		})
		return z.array(database.BotConfig).parse(record)
	}
	async getBotConfig(guildID: string): Promise<database.BotConfigType> {
		const existing = this.botconfig.get(guildID)
		if (existing) return existing
		const record = await this.db.botConfig.findFirst({
			where: {
				guildID: guildID,
			},
			include: {
				actions: true
			}
		})
		const created = database.BotConfig.parse(record ?? { guildID: guildID })
		if (!record) await this.setBotConfig(created)
		return created
	}
	async setBotConfig(config: Partial<database.BotConfigType> & Pick<database.BotConfigType, "guildID">) {
		await this.db.botConfig.upsert({
			where: { guildID: config.guildID },
			create: {
				...database.BotConfig.parse(config),
				actions: undefined,
				guildID: config.guildID,
			},
			update: {
				...database.BotConfig.parse(config),
				actions: undefined,
			}
		})
		if (config.actions) await Promise.all(config.actions.map(action => this.setGuildAction(action)))
		const newConfig = await this.db.botConfig.findFirst({
			include: {
				actions: true
			}
		})
		this.botconfig.set(config.guildID, database.BotConfig.parse(newConfig))
	}
	async setGuildAction(action: database.PickPartial<database.BotConfigType["actions"][0], "report"|"revocation">) {
		await this.db.actions.upsert({
			create: {
				...action,
				botConfigID: action.guildID,
			},
			update: {
				...action,
				guildID: action.guildID,
			},
			where: {
				guildID: action.guildID
			}
		})
		const existing = this.configuredActions.get(action.guildID)
		if (existing) {
			this.configuredActions.set(action.guildID, {
				...existing,
				...action
			})
		} else {
			this.configuredActions.set(action.guildID, database.Action.parse(action))
		}
	}

	private sendEmbeds() {
		for (const [ channelID ] of this.embedQueue) {
			const embeds = this.embedQueue.get(channelID)?.splice(0, 10) ?? []
			if (!embeds.length) continue
			const channel = this.channels.resolve(channelID)
			if (!channel || !channel.isNotDMChannel()) continue
			const infoChannels = this.infochannels.get(channel.guild.id)
			if (!infoChannels) continue
			channel.send({ embeds: embeds })
		}
	}

	async getGuildActions() {
		const currentConfig = { actions: this.configuredActions } || await this.getBotConfigs()
		return currentConfig.actions
	}
	async getGuildAction(guildID: string): Promise<database.ActionType | null> {
		const action = this.configuredActions.get(guildID) || await this.db.actions.findFirst({
			where: {
				guildID: guildID
			}
		})
		const parsed = database.Action.safeParse(action)
		return parsed.success ? parsed.data : null
	}
	addEmbedToQueue(channelID: string, embed: MessageEmbed) {
		const channel = this.channels.resolve(channelID)
		if (!channel || !channel.isNotDMChannel()) return false
		if (this.embedQueue.has(channelID)) {
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			this.embedQueue.set(channelID, [ ...this.embedQueue.get(channelID)!, embed ])
		} else {
			this.embedQueue.set(channelID, [ embed ])
		}
	}

	async ban(report: Report, guildID: string) {
		const servers = this.servers.get(guildID)
		if (!servers || !servers.length) return
		const guildAction = await this.getGuildAction(guildID)
		if (!guildAction || guildAction.report === "none") return

		const rawBanMessage = guildAction.report === "ban" ? ENV.BANMESSAGE : ENV.CUSTOMBAN

		const command = rawBanMessage
			.replace("{ADMINID}", report.adminId)
			.replace("{AUTOMATED}", report.automated ? "true" : "false")
			.replace("{BROKENRULE}", report.brokenRule)
			.replace("{COMMUNITYID}", report.communityId)
			.replace("{REPORTID}", report.id)
			.replace("{DESCRIPTION}", report.description)
			.replace("{PLAYERNAME}", report.playername)
			.replace("{PROOF}", report.proof)
			.replace("{REPORTEDTIME}", report.reportedTime.toTimeString())
		
		this.rcon.rconCommandGuild(command, guildID)
	}

	async unban(revocation: Revocation, guildID: string) {
		const servers = this.servers.get(guildID)
		if (!servers || !servers.length) return
		const guildAction = await this.getGuildAction(guildID)
		if (!guildAction || guildAction.report === "none") return

		const rawUnbanMessage = guildAction.revocation === "unban" ? ENV.UNBANMESSAGE : ENV.CUSTOMUNBAN

		const command = rawUnbanMessage
			.replace("{ADMINID}", revocation.adminId)
			.replace("{AUTOMATED}", revocation.automated ? "true" : "false")
			.replace("{BROKENRULE}", revocation.brokenRule)
			.replace("{COMMUNITYID}", revocation.communityId)
			.replace("{REPORTID}", revocation.id)
			.replace("{DESCRIPTION}", revocation.description)
			.replace("{PLAYERNAME}", revocation.playername)
			.replace("{PROOF}", revocation.proof)
			.replace("{REPORTEDTIME}", revocation.reportedTime.toTimeString())
		
		this.rcon.rconCommandGuild(command, guildID)
	}

	async checkBans() {
		const playercommands = (await this.rcon.rconCommandAll("/p o")).filter(r=>r)
		const players = playercommands.filter(x => x !== false) as Exclude<typeof playercommands[0], false>[]
		players.forEach((playeroutput) => {
			const playerlist = playeroutput.response
				.split("\n")
				.slice(1)
				.map((line) => line.slice(0, line.indexOf(" (online)")))
			const guildConfig = this.guildConfigs.get(playeroutput.server.discordGuildID)
			if (!guildConfig) return
			if (!guildConfig.ruleFilters || !guildConfig.trustedCommunities) return
			playerlist.forEach(async (player) => {
				if (!guildConfig.ruleFilters || !guildConfig.trustedCommunities) return // TS requires this
				const whitelist = await this.db.whitelist.findFirst({
					where: {
						playername: player
					}
				})
				if (whitelist) return // ignore whatever if a whielist for that player exists
				const allreports = await this.fagc.reports.fetchFilteredReports(player, guildConfig.ruleFilters, guildConfig.trustedCommunities)
				if (allreports.length) this.ban(allreports[0], guildConfig.guildId)
			})
		})
	}
	
	async syncCommands() {
		return
	}
}