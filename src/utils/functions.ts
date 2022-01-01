import { Guild, TextChannel } from "discord.js"

export type ArgumentTypes<F> = F extends (...args: infer A) => any ? A : never;

export async function sendGuildMessage(guild: Guild, message: ArgumentTypes<TextChannel["send"]>[0]) {
	const owner = () => {
		guild.fetchOwner()
			.then((owner) => owner.send(message))
			.catch(() => {
				console.log(`Could not send message to guild ${guild.name} (${guild.id})`)
			})
	}
	
	const systemChannel = () => {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		guild.systemChannel!.send(message)
			.catch(() => owner())
	}
	
	const publicUpdatesChannel = () => {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		guild.publicUpdatesChannel!.send(message)
			.catch(() => systemChannel())
	}
	if (guild.publicUpdatesChannel) {
		publicUpdatesChannel()
	} else if (guild.systemChannel) {
		systemChannel()
	} else {
		owner()
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