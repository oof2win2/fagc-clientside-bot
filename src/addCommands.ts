import path from "node:path"
const __dirname = path.dirname(new URL(import.meta.url).pathname)
process.chdir(__dirname)

import { REST } from "@discordjs/rest"
import { Routes, RESTGetAPIUserResult, RESTAPIPartialCurrentUserGuild, APIApplicationCommand } from "discord-api-types/v9"
import ENV from "./utils/env.js"
import fs from "fs/promises"
import { PrismaClient } from ".prisma/client/index.js"
import { Command } from "./base/Commands.js"
import { Collection } from "discord.js"
import { Required } from "utility-types"
import { FAGCWrapper } from "fagc-api-wrapper"
import { GuildConfig } from "fagc-api-types"
import { ApplicationCommandPermissionTypes } from "discord.js/typings/enums"

const commandCategories = (await fs.readdir("./commands")).filter(command => command.endsWith(".js"))
const toPushCommands = await Promise.all(commandCategories.map(async (commandFile) => {
	return import(`./commands/${commandFile}`).then(r => r.default as Command)
}))

const prisma = new PrismaClient({
	log: [ "error", "query" ]
})
const rest = new REST({ version: "9" }).setToken(ENV.DISCORD_BOTTOKEN)

const FAGC = new FAGCWrapper({
	apiurl: ENV.APIURL,
	socketurl: ENV.WSURL,
	enableWebSocket: false
})

await prisma.$connect()

try {
	const self = await rest.get(Routes.user()) as RESTGetAPIUserResult
	const guildIDs = (await rest.get(Routes.userGuilds()) as RESTAPIPartialCurrentUserGuild[])
		.map(guild => guild.id)
	const guildConfigs = new Map<string, GuildConfig>()
	await Promise.all(
		guildIDs.map(async (guildID) => {
			const config = await FAGC.communities.fetchGuildConfig({ guildId: guildID })
			if (config) guildConfigs.set(guildID, config)
		})
	)
	console.log("Started refreshing application (/) commands.")
	const commands: Collection<string, APIApplicationCommand[]> = new Collection()
	
	console.log("Removing old commands from DB")
	// delete old commands from db
	await prisma.command.deleteMany()

	console.log("Replacing commands")
	for (const guildID of guildIDs) {
		console.log(`Replacing commands in guild ${guildID}`)
		const newCommands = await rest.put(
			Routes.applicationGuildCommands(self.id, guildID),
			{ body: toPushCommands.map(c => c.data.toJSON()) }
		) as APIApplicationCommand[]
		commands.set(guildID, newCommands)
	}

	console.log("Saving new commands to DB")
	const toSaveCommands = commands.map(guildCommands => {
		return guildCommands.map(guildCommand => {
			return {
				id: guildCommand.id,
				guildID: guildCommand.guild_id!,
				name: guildCommand.name,
			}
		})
	}).flat()


	// current createMany alternative
	// https://github.com/prisma/prisma/issues/10710
	const createCommandQueryValues = toSaveCommands
		.map(command => `('${command.id}', '${command.guildID}', '${command.name}')`)
		.join(",\n\t")
		.concat(";")
	await prisma.$executeRawUnsafe(`INSERT INTO \`main\`.\`Command\` (id, guildID, name) VALUES \n\t${createCommandQueryValues}`)
	console.log("Saved new commands to DB")

	console.log("Setting permission overrides")
	for (const guildID of guildIDs) {
		console.log(`Setting permission overrides in guild ${guildID}`)
		const guildConfig = guildConfigs.get(guildID)
		const guildCommands = commands.get(guildID)
		if (!guildCommands) {
			console.log(`Guild ${guildID} does not have any commands`)
			continue
		}

		type CommandWithPerms = Required<Command, "permissionOverrides" | "permissionType">

		const commandData: CommandWithPerms[] = guildCommands
			.map(command => toPushCommands.find(c => c.data.name === command.name))
			.filter((c): c is CommandWithPerms => Boolean(c?.permissionType) || Boolean(c?.permissionOverrides?.length))
			.map(c=> {
				if (!c.permissionOverrides) c.permissionOverrides = []
				if (!c.permissionType) c.permissionType = "configrole"
				return c
			})
		const toSetPermissions = commandData.map((command) => {
			const guildCommand = guildCommands.find(c => c.name === command.data.name)!
			const perms = command.permissionOverrides
			perms.push({
				type: ApplicationCommandPermissionTypes.USER,
				id: ENV.OWNERID,
				permission: true,
			})

			if (guildConfig?.roles) {
				switch (command.permissionType) {
				case "banrole": {
					if (guildConfig.roles.reports)
						perms.push({
							type: ApplicationCommandPermissionTypes.ROLE,
							id: guildConfig.roles.reports,
							permission: true
						})
					break
				}
				case "configrole": {
					if (guildConfig.roles.setConfig)
						perms.push({
							type: ApplicationCommandPermissionTypes.ROLE,
							id: guildConfig.roles.setConfig,
							permission: true
						})
					break
				}
				case "notificationsrole": {
					if (guildConfig.roles.webhooks)
						perms.push({
							type: ApplicationCommandPermissionTypes.ROLE,
							id: guildConfig.roles.webhooks,
							permission: true
						})
					break
				}
				}
			}
			return {
				id: guildCommand.id,
				type: command.permissionType,
				permissions: perms,
			}
		})

		if (toSetPermissions.length)
			await rest.put(
				Routes.guildApplicationCommandsPermissions(self.id, guildID),
				{ body: toSetPermissions }
			)
	}
} catch (error) {
	console.error(error)
}
await prisma.$disconnect()
FAGC.destroy()