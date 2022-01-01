import { Guild, TextChannel } from "discord.js"

/**
 * Attempt to contact a guild by sending them a message
 * @param guild Guild to attempt to send a message to
 * @param message Message to send
 */
export async function sendGuildMessage(guild: Guild, message: Parameters<TextChannel["send"]>[0]): Promise<boolean> {
	const owner = async() => {
		// try sending to owner. if it fails, return false
		try {
			const owner = await guild.fetchOwner()
			owner.send(message)
			return true
		} catch {
			return false
		}
	}
	
	const systemChannel = async () => {
		// try to send to system channel if it exists. if it doesnt or fails, send to owner
		try {
			if (guild.systemChannel) {
				guild.systemChannel.send(message)
				return true
			}
			return owner()
		} catch {
			return owner()
		}
	}
	
	const publicUpdatesChannel = async () => {
		// try to send to public updates channel if it exists. if it doesnt or fails, send to system channel
		try {
			if (guild.publicUpdatesChannel) {
				await guild.publicUpdatesChannel.send(message)
				return true
			}
			return systemChannel()
		} catch {
			return systemChannel()
		}
	}

	if (guild.publicUpdatesChannel) {
		return publicUpdatesChannel()
	} else if (guild.systemChannel) {
		return systemChannel()
	} else {
		return owner()
	}
}

/**
 * Split a long array into multiple, smaller arrays with a set maximum length
 * @param data - The data to split
 * @param [chunkSize=250] - the size of chunks to split the data into. Defaults to 250
 */
export const arrayToChunks = <T>(data: Iterable<T> | ArrayLike<T>, chunkSize = 250): T[][] => {
	const array = Array.from(data)
	const chunks = array.reduce<T[][]>((acc, record) => {
		const last = acc[acc.length - 1]
		if (!last || last.length >= chunkSize) {
			acc.push([])
		}
		acc[acc.length - 1].push(record)
		return acc
	}, [])
	return chunks
}