import { invoke } from "@tauri-apps/api/core";
import { Update } from "@tauri-apps/plugin-updater";
import type { UpdateChannel } from "@/lib/updateChannel";

type UpdateMetadata = ConstructorParameters<typeof Update>[0];

export async function checkForUpdate(
	channel: UpdateChannel,
): Promise<Update | null> {
	const metadata = await invoke<UpdateMetadata | null>("check_for_update", {
		channel,
	});
	return metadata ? new Update(metadata) : null;
}
