import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface UpdateChannelSettingProps {
	enabled: boolean;
	onEnabledChange: (enabled: boolean) => void;
	compact?: boolean;
}

export function UpdateChannelSetting({
	enabled,
	onEnabledChange,
	compact,
}: UpdateChannelSettingProps) {
	return (
		<div className="flex items-center justify-between rounded-md border bg-card px-3 py-2.5">
			<div>
				<Label htmlFor="canary-updates" className={compact ? "text-sm" : ""}>
					Canary updates
				</Label>
				<p className="mt-0.5 text-xs text-muted-foreground">
					{enabled
						? "Get early builds from every merge. Canary builds may be unstable."
						: "Receive stable releases only."}
				</p>
			</div>
			<Switch
				id="canary-updates"
				checked={enabled}
				onCheckedChange={onEnabledChange}
			/>
		</div>
	);
}
