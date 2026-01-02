import { useState, useEffect } from "react";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { FloppyDisk, Plus, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { RedisKeyDetails } from "@/lib/tauri";

export type RedisKeyType = "string" | "list" | "set" | "hash" | "zset";

interface RedisKeySheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mode: "add" | "edit";
	keyDetails?: RedisKeyDetails | null;
	onSave: (data: {
		key: string;
		type: RedisKeyType;
		value: unknown;
		ttl?: number;
	}) => Promise<void>;
	saving?: boolean;
}

export function RedisKeySheet({
	open,
	onOpenChange,
	mode,
	keyDetails,
	onSave,
	saving = false,
}: RedisKeySheetProps) {
	const [key, setKey] = useState("");
	const [keyType, setKeyType] = useState<RedisKeyType>("string");
	const [ttl, setTtl] = useState<string>("");
	const [ttlEnabled, setTtlEnabled] = useState(false);

	// String value
	const [stringValue, setStringValue] = useState("");

	// List/Set values
	const [listValues, setListValues] = useState<string[]>([]);
	const [newListItem, setNewListItem] = useState("");

	// Hash values
	const [hashFields, setHashFields] = useState<Array<{ key: string; value: string }>>([]);
	const [newHashKey, setNewHashKey] = useState("");
	const [newHashValue, setNewHashValue] = useState("");

	// ZSet values
	const [zsetMembers, setZsetMembers] = useState<Array<{ member: string; score: number }>>([]);
	const [newZsetMember, setNewZsetMember] = useState("");
	const [newZsetScore, setNewZsetScore] = useState("");

	// Initialize form when opening or keyDetails changes
	useEffect(() => {
		if (open) {
			if (mode === "edit" && keyDetails) {
				setKey(keyDetails.key);
				setKeyType(keyDetails.key_type as RedisKeyType);
				setTtlEnabled(keyDetails.ttl !== -1);
				setTtl(keyDetails.ttl !== -1 ? String(keyDetails.ttl) : "");

				// Initialize values based on type
				const value = keyDetails.value;
				if (keyDetails.key_type === "string") {
					setStringValue(typeof value === "string" ? value : JSON.stringify(value));
				} else if (keyDetails.key_type === "list" || keyDetails.key_type === "set") {
					setListValues(Array.isArray(value) ? value.map(String) : []);
				} else if (keyDetails.key_type === "hash") {
					if (typeof value === "object" && value !== null) {
						const hash = value as Record<string, string>;
						setHashFields(
							Object.entries(hash).map(([k, v]) => ({ key: k, value: String(v) })),
						);
					} else {
						setHashFields([]);
					}
				} else if (keyDetails.key_type === "zset") {
					if (Array.isArray(value)) {
						setZsetMembers(
							value.map((item) => {
								if (Array.isArray(item) && item.length === 2) {
									return { member: String(item[0]), score: Number(item[1]) };
								}
								return { member: String(item), score: 0 };
							}),
						);
					} else {
						setZsetMembers([]);
					}
				} else {
					console.warn("Unexpected Redis key type in edit mode:", keyDetails.key_type);
					setStringValue("");
					setListValues([]);
					setHashFields([]);
					setZsetMembers([]);
				}
			} else {
				// Reset for add mode
				setKey("");
				setKeyType("string");
				setTtl("");
				setTtlEnabled(false);
				setStringValue("");
				setListValues([]);
				setNewListItem("");
				setHashFields([]);
				setNewHashKey("");
				setNewHashValue("");
				setZsetMembers([]);
				setNewZsetMember("");
				setNewZsetScore("");
			}
		}
	}, [open, mode, keyDetails]);

	const handleAddListItem = () => {
		const value = newListItem.trim();
		if (!value) {
			return;
		}

		if (keyType === "set" && listValues.includes(value)) {
			toast.error("This set already contains that value");
			return;
		}

		setListValues([...listValues, value]);
		setNewListItem("");
	};

	const handleRemoveListItem = (index: number) => {
		setListValues(listValues.filter((_, i) => i !== index));
	};

	const handleAddHashField = () => {
		const trimmedKey = newHashKey.trim();
		if (!trimmedKey) {
			return;
		}

		if (hashFields.some((field) => field.key === trimmedKey)) {
			toast.error("This hash field key already exists");
			return;
		}

		setHashFields([...hashFields, { key: trimmedKey, value: newHashValue }]);
		setNewHashKey("");
		setNewHashValue("");
	};

	const handleRemoveHashField = (index: number) => {
		setHashFields(hashFields.filter((_, i) => i !== index));
	};

	const handleUpdateHashField = (index: number, field: "key" | "value", value: string) => {
		const updatedHashFields = [...hashFields];
		updatedHashFields[index] = { ...updatedHashFields[index], [field]: value };
		setHashFields(updatedHashFields);
	};

	const handleAddZsetMember = () => {
		const trimmedMember = newZsetMember.trim();
		if (!trimmedMember) {
			return;
		}

		if (zsetMembers.some((item) => item.member === trimmedMember)) {
			toast.error("Sorted set member already exists. Members must be unique");
			return;
		}

		const score = parseFloat(newZsetScore) || 0;
		setZsetMembers([...zsetMembers, { member: trimmedMember, score }]);
		setNewZsetMember("");
		setNewZsetScore("");
	};

	const handleRemoveZsetMember = (index: number) => {
		setZsetMembers(zsetMembers.filter((_, i) => i !== index));
	};

	const handleUpdateZsetMember = (
		index: number,
		field: "member" | "score",
		value: string | number,
	) => {
		const updatedZsetMembers = [...zsetMembers];
		updatedZsetMembers[index] = { ...updatedZsetMembers[index], [field]: value };
		setZsetMembers(updatedZsetMembers);
	};

	const handleSave = async () => {
		if (!key.trim()) {
			toast.error("Key is required");
			return;
		}

		let value: unknown;
		const ttlValue = ttlEnabled && ttl.trim() ? parseInt(ttl, 10) : undefined;

		if (ttlEnabled && ttl.trim() && Number.isNaN(ttlValue)) {
			toast.error("TTL must be a valid number");
			return;
		}

		if (ttlEnabled && ttl.trim() && ttlValue !== undefined && ttlValue <= 0) {
			toast.error("TTL must be a positive number");
			return;
		}

		try {
			switch (keyType) {
				case "string":
					value = stringValue;
					break;
				case "list":
				case "set":
					if (listValues.length === 0) {
						toast.error(`Cannot create a ${keyType} key with empty values`);
						return;
					}
					value = listValues;
					break;
				case "hash": {
					const hash: Record<string, string> = {};
					for (const field of hashFields) {
						if (field.key.trim()) {
							hash[field.key.trim()] = field.value;
						}
					}
					if (Object.keys(hash).length === 0) {
						toast.error("Cannot create a hash key with empty fields");
						return;
					}
					value = hash;
					break;
				}
				case "zset":
					if (zsetMembers.length === 0) {
						toast.error("Cannot create a sorted set with empty members");
						return;
					}
					value = zsetMembers.map((m) => [m.member, m.score] as [string, number]);
					break;
				default: {
					console.error("Unsupported Redis key type encountered in handleSave:", keyType);
					toast.error("Unsupported key type. Please refresh the page and try again.");
					return;
				}
			}

			await onSave({
				key: key.trim(),
				type: keyType,
				value,
				ttl: ttlValue,
			});
		} catch (error) {
			console.error("Failed to save Redis key:", error);
			toast.error(
				error instanceof Error ? error.message : "Failed to save Redis key",
			);
		}
	};

	const renderValueEditor = () => {
		switch (keyType) {
			case "string":
				return (
					<div className="space-y-2">
						<Label>Value</Label>
						<Textarea
							value={stringValue}
							onChange={(e) => setStringValue(e.target.value)}
							placeholder="Enter string value"
							className="font-mono min-h-[100px]"
						/>
					</div>
				);

			case "list":
			case "set":
				return (
					<div className="space-y-2">
						<Label>Values</Label>
						<div className="space-y-2">
							{listValues.map((item, index) => (
								<div key={index} className="flex items-center gap-2">
									<Input
										value={item}
										onChange={(e) => {
											const updatedListValues = [...listValues];
											updatedListValues[index] = e.target.value;
											setListValues(updatedListValues);
										}}
										className="flex-1 font-mono"
									/>
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={() => handleRemoveListItem(index)}
									>
										<Trash className="w-4 h-4" />
									</Button>
								</div>
							))}
							<div className="flex items-center gap-2">
								<Input
									value={newListItem}
									onChange={(e) => setNewListItem(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											handleAddListItem();
										}
									}}
									placeholder="Add new item"
									className="flex-1 font-mono"
								/>
								<Button variant="outline" size="icon-sm" onClick={handleAddListItem}>
									<Plus className="w-4 h-4" />
								</Button>
							</div>
						</div>
					</div>
				);

			case "hash":
				return (
					<div className="space-y-2">
						<Label>Fields</Label>
						<div className="space-y-2">
							{hashFields.map((field, index) => (
								<div key={index} className="flex items-center gap-2">
									<Input
										value={field.key}
										onChange={(e) => handleUpdateHashField(index, "key", e.target.value)}
										placeholder="Field name"
										className="flex-1 font-mono"
									/>
									<Input
										value={field.value}
										onChange={(e) => handleUpdateHashField(index, "value", e.target.value)}
										placeholder="Field value"
										className="flex-1 font-mono"
									/>
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={() => handleRemoveHashField(index)}
									>
										<Trash className="w-4 h-4" />
									</Button>
								</div>
							))}
							<div className="flex items-center gap-2">
								<Input
									value={newHashKey}
									onChange={(e) => setNewHashKey(e.target.value)}
									placeholder="Field name"
									className="flex-1 font-mono"
								/>
								<Input
									value={newHashValue}
									onChange={(e) => setNewHashValue(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											handleAddHashField();
										}
									}}
									placeholder="Field value"
									className="flex-1 font-mono"
								/>
								<Button variant="outline" size="icon-sm" onClick={handleAddHashField}>
									<Plus className="w-4 h-4" />
								</Button>
							</div>
						</div>
					</div>
				);

			case "zset":
				return (
					<div className="space-y-2">
						<Label>Members (Score, Value)</Label>
						<div className="space-y-2">
							{zsetMembers.map((member, index) => (
								<div key={index} className="flex items-center gap-2">
									<Input
										type="number"
										step="any"
										value={member.score}
										onChange={(e) =>
											handleUpdateZsetMember(index, "score", parseFloat(e.target.value) || 0)
										}
										placeholder="Score"
										className="w-24 font-mono"
									/>
									<Input
										value={member.member}
										onChange={(e) => handleUpdateZsetMember(index, "member", e.target.value)}
										placeholder="Member value"
										className="flex-1 font-mono"
									/>
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={() => handleRemoveZsetMember(index)}
									>
										<Trash className="w-4 h-4" />
									</Button>
								</div>
							))}
							<div className="flex items-center gap-2">
								<Input
									type="number"
									step="any"
									value={newZsetScore}
									onChange={(e) => setNewZsetScore(e.target.value)}
									placeholder="Score"
									className="w-24 font-mono"
								/>
								<Input
									value={newZsetMember}
									onChange={(e) => setNewZsetMember(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											handleAddZsetMember();
										}
									}}
									placeholder="Member value"
									className="flex-1 font-mono"
								/>
								<Button variant="outline" size="icon-sm" onClick={handleAddZsetMember}>
									<Plus className="w-4 h-4" />
								</Button>
							</div>
						</div>
					</div>
				);

			default:
				console.warn("Unexpected Redis key type:", keyType);
				return (
					<div className="space-y-2">
						<Label>Value</Label>
						<p className="text-sm text-muted-foreground">
							Unsupported key type: {keyType}
						</p>
					</div>
				);
		}
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						{mode === "add" ? "Add New Key" : "Edit Key"}
					</SheetTitle>
					<SheetDescription>
						{mode === "add"
							? "Create a new Redis key with the specified type and value."
							: "Modify the Redis key value and settings."}
					</SheetDescription>
				</SheetHeader>

				<div className="py-6 px-4 space-y-4">
					<div className="space-y-2">
						<Label>Key</Label>
						<Input
							value={key}
							onChange={(e) => setKey(e.target.value)}
							placeholder="Enter key name"
							className="font-mono"
							disabled={mode === "edit"}
						/>
					</div>

					<div className="space-y-2">
						<Label>Type</Label>
						<Select
							value={keyType}
							onValueChange={(value) => setKeyType(value as RedisKeyType)}
							disabled={mode === "edit"}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="string">String</SelectItem>
								<SelectItem value="list">List</SelectItem>
								<SelectItem value="set">Set</SelectItem>
								<SelectItem value="hash">Hash</SelectItem>
								<SelectItem value="zset">Sorted Set</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{renderValueEditor()}

					<div className="space-y-2">
						<div className="flex items-center gap-2">
							<input
								type="checkbox"
								id="ttl-enabled"
								checked={ttlEnabled}
								onChange={(e) => {
									setTtlEnabled(e.target.checked);
									if (!e.target.checked) {
										setTtl("");
									}
								}}
								className="w-4 h-4"
							/>
							<Label htmlFor="ttl-enabled" className="cursor-pointer">
								Set TTL (Time To Live)
							</Label>
						</div>
						{ttlEnabled && (
							<Input
								type="number"
								value={ttl}
								onChange={(e) => setTtl(e.target.value)}
								placeholder="TTL in seconds"
								className="font-mono"
							/>
						)}
						{!ttlEnabled && (
							<p className="text-xs text-muted-foreground">No expiration</p>
						)}
					</div>
				</div>

				<SheetFooter className="flex-row gap-2 justify-end px-4">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={saving}>
						{saving ? <Spinner /> : <FloppyDisk className="w-4 h-4" />}
						{mode === "add" ? "Add Key" : "Save Changes"}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
