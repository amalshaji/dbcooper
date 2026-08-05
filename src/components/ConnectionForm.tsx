import { useState, useEffect } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { ConnectionType, StandardConnection } from "@/types/connection";
import { api, type Connection, type ConnectionFormData } from "@/lib/tauri";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { D1ConnectionFields } from "@/components/connections/D1ConnectionFields";
import { ConnectionTypeSelect } from "@/components/connections/ConnectionTypeSelect";
import { MongoConnectionFields } from "@/components/connections/MongoConnectionFields";
import {
	connectionToFormData,
	DEFAULT_CONNECTION_FORM_DATA,
	mergeD1ConnectionFields,
} from "@/lib/connectionFormState";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { getConnectionCapabilities } from "@/lib/connectionCapabilities";
import {
	prepareDuckDbRuntime,
	type DuckDbHelperProgress as DuckDbHelperProgressValue,
} from "@/lib/duckdbHelper";
import { DuckDbHelperProgress } from "@/components/DuckDbHelperProgress";

interface ConnectionFormProps {
	onSubmit: (data: ConnectionFormData) => Promise<void>;
	onCancel: () => void;
	isOpen: boolean;
	initialData?: Connection | null;
}

function connectionForTest(data: ConnectionFormData): StandardConnection {
	if (data.type === "mongodb") {
		throw new Error("MongoDB connections use URI-based testing");
	}

	return {
		id: 0,
		uuid: "",
		type: data.type,
		name: data.name,
		host: data.host,
		port: data.port,
		database: data.database,
		username: data.username,
		password: data.password,
		ssl: data.ssl ? 1 : 0,
		db_type: data.type,
		file_path: data.file_path || null,
		connection_uri: null,
		ssh_enabled: data.ssh_enabled ? 1 : 0,
		ssh_host: data.ssh_host || "",
		ssh_port: data.ssh_port || 22,
		ssh_user: data.ssh_user || "",
		ssh_password: data.ssh_password || "",
		ssh_key_path: data.ssh_key_path || "",
		ssh_use_key: data.ssh_use_key ? 1 : 0,
		created_at: "",
		updated_at: "",
	};
}

export function ConnectionForm({
	onSubmit,
	onCancel,
	isOpen,
	initialData,
}: ConnectionFormProps) {
	const [formData, setFormData] = useState<ConnectionFormData>(
		DEFAULT_CONNECTION_FORM_DATA,
	);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isTesting, setIsTesting] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [showSshPassword, setShowSshPassword] = useState(false);
	const [duckDbHelperProgress, setDuckDbHelperProgress] =
		useState<DuckDbHelperProgressValue | null>(null);

	const isEditMode = !!initialData;
	const capabilities = getConnectionCapabilities(formData.type);
	const usesFile = capabilities.fileDatabase;
	const usesServerFields = capabilities.form === "server";
	const isBusy = isSubmitting || isTesting;

	useEffect(() => {
		if (initialData) {
			setFormData(connectionToFormData(initialData));
		} else {
			setFormData(DEFAULT_CONNECTION_FORM_DATA);
		}
		setDuckDbHelperProgress(null);
	}, [initialData, isOpen]);

	const handleTypeChange = (type: ConnectionType) => {
		const nextCapabilities = getConnectionCapabilities(type);
		setDuckDbHelperProgress(null);
		setFormData({
			...formData,
			type,
			port: nextCapabilities.defaultPort,
			host:
				type === "d1"
					? "api.cloudflare.com"
					: formData.type === "d1"
						? "localhost"
						: formData.host,
			ssl: type === "d1" ? true : formData.type === "d1" ? false : formData.ssl,
			ssh_enabled:
				nextCapabilities.form === "server" ? formData.ssh_enabled : false,
		});
	};

	const handleTestConnection = async () => {
		setIsTesting(true);
		try {
			await prepareDuckDbRuntime(formData.type, setDuckDbHelperProgress);
			// Use unified test connection for non-Postgres engines; keep the legacy Postgres command.
			const result =
				capabilities.testStrategy === "mongo"
					? await api.mongo.testConnection(formData.connection_uri || "")
					: capabilities.testStrategy === "unified"
						? await api.database.testConnection(connectionForTest(formData))
						: await api.postgres.testConnection({
								host: formData.host,
								port: formData.port,
								database: formData.database,
								username: formData.username,
								password: formData.password,
								ssl: formData.ssl,
								ssh_enabled: formData.ssh_enabled,
								ssh_host: formData.ssh_host,
								ssh_port: formData.ssh_port,
								ssh_user: formData.ssh_user,
								ssh_password: formData.ssh_password,
								ssh_key_path: formData.ssh_key_path,
								ssh_use_key: formData.ssh_use_key,
							});

			if (result.success) {
				toast.success(result.message || "Connection successful!");
			} else {
				toast.error(result.message || "Connection failed");
			}
		} catch (error) {
			toast.error("Failed to test connection", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setIsTesting(false);
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsSubmitting(true);
		try {
			await prepareDuckDbRuntime(formData.type, setDuckDbHelperProgress);
		} catch (error) {
			toast.error("Could not prepare DuckDB support", {
				description: error instanceof Error ? error.message : String(error),
			});
			setIsSubmitting(false);
			return;
		}
		try {
			await onSubmit(formData);
			if (!isEditMode) {
				setFormData(DEFAULT_CONNECTION_FORM_DATA);
			}
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<AlertDialog
			open={isOpen}
			onOpenChange={(open) => !open && !isBusy && onCancel()}
		>
			<AlertDialogContent className="max-h-[85vh] overflow-y-auto">
				<AlertDialogHeader>
					<AlertDialogTitle>
						{isEditMode ? "Edit Connection" : "New Connection"}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{isEditMode
							? "Update your database connection settings"
							: "Create a new database connection"}
					</AlertDialogDescription>
				</AlertDialogHeader>

				<form onSubmit={handleSubmit}>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="connection-type">Database Type</FieldLabel>
							<ConnectionTypeSelect
								value={formData.type}
								onValueChange={handleTypeChange}
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor="connection-name">Name</FieldLabel>
							<Input
								id="connection-name"
								type="text"
								required
								value={formData.name}
								onChange={(e) =>
									setFormData({ ...formData, name: e.target.value })
								}
								placeholder="Production DB"
							/>
						</Field>

						{usesFile && (
							<Field>
								<FieldLabel htmlFor="connection-file-path">
									Database File
								</FieldLabel>
								<div className="flex gap-2">
									<Input
										id="connection-file-path"
										type="text"
										required
										value={formData.file_path || ""}
										onChange={(e) =>
											setFormData({ ...formData, file_path: e.target.value })
										}
										placeholder={
											formData.type === "duckdb"
												? "/path/to/analytics.duckdb"
												: "/path/to/database.db"
										}
										className="flex-1"
									/>
									<Button
										type="button"
										variant="outline"
										onClick={async () => {
											const selected = await open({
												multiple: false,
												filters: [
													{
														name:
															formData.type === "duckdb"
																? "DuckDB Database"
																: "SQLite Database",
														extensions:
															formData.type === "duckdb"
																? ["duckdb", "db"]
																: ["db", "sqlite", "sqlite3"],
													},
												],
											});
											if (selected) {
												setFormData({
													...formData,
													file_path: selected as string,
												});
											}
										}}
									>
										{formData.type === "duckdb" ? "Open existing" : "Browse"}
									</Button>
									{formData.type === "duckdb" && (
										<Button
											type="button"
											variant="outline"
											onClick={async () => {
												const selected = await save({
													defaultPath: "analytics.duckdb",
													filters: [
														{
															name: "DuckDB Database",
															extensions: ["duckdb"],
														},
													],
												});
												if (selected) {
													setFormData({ ...formData, file_path: selected });
												}
											}}
										>
											Create new
										</Button>
									)}
								</div>
							</Field>
						)}

						{formData.type === "d1" && (
							<D1ConnectionFields
								accountId={formData.username}
								apiToken={formData.password}
								databaseId={formData.database}
								onChange={(values) =>
									setFormData((current) =>
										mergeD1ConnectionFields(current, values),
									)
								}
								listDatabases={api.d1.listDatabases}
							/>
						)}

						{formData.type === "mongodb" && (
							<MongoConnectionFields
								connectionUri={formData.connection_uri || ""}
								onChange={(connectionUri) =>
									setFormData({ ...formData, connection_uri: connectionUri })
								}
							/>
						)}

						{/* Postgres/Server-based connection fields */}
						{usesServerFields && (
							<>
								<div className="grid grid-cols-2 gap-4">
									<Field>
										<FieldLabel htmlFor="connection-host">Host</FieldLabel>
										<Input
											id="connection-host"
											type="text"
											required
											value={formData.host}
											onChange={(e) =>
												setFormData({ ...formData, host: e.target.value })
											}
										/>
									</Field>

									<Field>
										<FieldLabel htmlFor="connection-port">Port</FieldLabel>
										<Input
											id="connection-port"
											type="number"
											required
											value={formData.port}
											onChange={(e) =>
												setFormData({
													...formData,
													port: Number(e.target.value),
												})
											}
										/>
									</Field>
								</div>

								{/* Redis uses database index, not database name */}
								{formData.type === "redis" ? (
									<Field>
										<FieldLabel htmlFor="connection-database">
											Database Index (0-15)
										</FieldLabel>
										<Input
											id="connection-database"
											type="number"
											min="0"
											max="15"
											value={formData.database}
											onChange={(e) =>
												setFormData({ ...formData, database: e.target.value })
											}
											placeholder="0"
										/>
									</Field>
								) : (
									<Field>
										<FieldLabel htmlFor="connection-database">
											Database
										</FieldLabel>
										<Input
											id="connection-database"
											type="text"
											required
											value={formData.database}
											onChange={(e) =>
												setFormData({ ...formData, database: e.target.value })
											}
											placeholder="my_database"
										/>
									</Field>
								)}

								<Field>
									<FieldLabel htmlFor="connection-username">
										{formData.type === "redis"
											? "Username (Optional)"
											: "Username"}
									</FieldLabel>
									<Input
										id="connection-username"
										type="text"
										required={formData.type !== "redis"}
										value={formData.username}
										onChange={(e) =>
											setFormData({ ...formData, username: e.target.value })
										}
										placeholder={
											formData.type === "redis"
												? "default"
												: formData.type === "mysql" ||
														formData.type === "mariadb"
													? "root"
													: "postgres"
										}
									/>
								</Field>

								<Field>
									<FieldLabel htmlFor="connection-password">
										{formData.type === "redis"
											? "Password (Optional)"
											: "Password"}
									</FieldLabel>
									<div className="relative">
										<Input
											id="connection-password"
											type={showPassword ? "text" : "password"}
											value={formData.password}
											onChange={(e) =>
												setFormData({ ...formData, password: e.target.value })
											}
											className="pr-10"
										/>
										<button
											type="button"
											onClick={() => setShowPassword(!showPassword)}
											className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
										>
											{showPassword ? (
												<EyeSlash className="w-3 h-3" />
											) : (
												<Eye className="w-3 h-3" />
											)}
										</button>
									</div>
								</Field>

								{/* SSL/TLS toggle - available for all server-based DBs */}
								<Field orientation="horizontal">
									<Switch
										id="connection-ssl"
										size="sm"
										checked={formData.ssl}
										onCheckedChange={(checked) =>
											setFormData({ ...formData, ssl: checked })
										}
									/>
									<FieldLabel htmlFor="connection-ssl">
										{formData.type === "redis" ? "Use TLS" : "Use SSL"}
									</FieldLabel>
								</Field>

								{/* SSH Tunnel Section */}
								<div className="border-t pt-4 mt-2">
									<Field orientation="horizontal">
										<Switch
											id="connection-ssh-enabled"
											size="sm"
											checked={formData.ssh_enabled}
											onCheckedChange={(checked) =>
												setFormData({
													...formData,
													ssh_enabled: checked,
												})
											}
										/>
										<FieldLabel htmlFor="connection-ssh-enabled">
											Connect over SSH
										</FieldLabel>
									</Field>

									{formData.ssh_enabled && (
										<div className="mt-4 space-y-4 pl-6 border-l-2 border-muted">
											<div className="grid grid-cols-2 gap-4">
												<Field>
													<FieldLabel htmlFor="ssh-host">SSH Host</FieldLabel>
													<Input
														id="ssh-host"
														type="text"
														value={formData.ssh_host}
														onChange={(e) =>
															setFormData({
																...formData,
																ssh_host: e.target.value,
															})
														}
														placeholder="jump-server.example.com"
													/>
												</Field>

												<Field>
													<FieldLabel htmlFor="ssh-port">SSH Port</FieldLabel>
													<Input
														id="ssh-port"
														type="number"
														value={formData.ssh_port}
														onChange={(e) =>
															setFormData({
																...formData,
																ssh_port: Number(e.target.value),
															})
														}
													/>
												</Field>
											</div>

											<Field>
												<FieldLabel htmlFor="ssh-user">SSH User</FieldLabel>
												<Input
													id="ssh-user"
													type="text"
													value={formData.ssh_user}
													onChange={(e) =>
														setFormData({
															...formData,
															ssh_user: e.target.value,
														})
													}
													placeholder="ubuntu"
												/>
											</Field>

											<Field orientation="horizontal">
												<Switch
													id="ssh-use-key"
													size="sm"
													checked={formData.ssh_use_key}
													onCheckedChange={(checked) =>
														setFormData({
															...formData,
															ssh_use_key: checked,
															ssh_password: "",
														})
													}
												/>
												<FieldLabel htmlFor="ssh-use-key">
													Use SSH Key
												</FieldLabel>
											</Field>

											{formData.ssh_use_key ? (
												<>
													<Field>
														<FieldLabel htmlFor="ssh-key-path">
															SSH Key Path
														</FieldLabel>
														<div className="flex gap-2">
															<Input
																id="ssh-key-path"
																type="text"
																value={formData.ssh_key_path}
																onChange={(e) =>
																	setFormData({
																		...formData,
																		ssh_key_path: e.target.value,
																	})
																}
																placeholder="~/.ssh/id_rsa"
																className="flex-1"
															/>
															<Button
																type="button"
																variant="outline"
																size="sm"
																onClick={async () => {
																	const selected = await open({
																		multiple: false,
																		directory: false,
																		title: "Select SSH Key",
																	});
																	if (selected) {
																		setFormData({
																			...formData,
																			ssh_key_path: selected as string,
																		});
																	}
																}}
															>
																Browse
															</Button>
														</div>
													</Field>
													<Field>
														<FieldLabel htmlFor="ssh-key-passphrase">
															SSH Key Passphrase
														</FieldLabel>
														<Input
															id="ssh-key-passphrase"
															type="password"
															value={formData.ssh_password}
															onChange={(e) =>
																setFormData({
																	...formData,
																	ssh_password: e.target.value,
																})
															}
															placeholder="Optional for encrypted keys"
														/>
													</Field>
												</>
											) : (
												<Field>
													<FieldLabel htmlFor="ssh-password">
														SSH Password
													</FieldLabel>
													<div className="relative">
														<Input
															id="ssh-password"
															type={showSshPassword ? "text" : "password"}
															value={formData.ssh_password}
															onChange={(e) =>
																setFormData({
																	...formData,
																	ssh_password: e.target.value,
																})
															}
															className="pr-10"
														/>
														<button
															type="button"
															onClick={() =>
																setShowSshPassword(!showSshPassword)
															}
															className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
														>
															{showSshPassword ? (
																<EyeSlash className="w-3 h-3" />
															) : (
																<Eye className="w-3 h-3" />
															)}
														</button>
													</div>
												</Field>
											)}
										</div>
									)}
								</div>
							</>
						)}
					</FieldGroup>
					{formData.type === "duckdb" && duckDbHelperProgress && (
						<div className="mt-4">
							<DuckDbHelperProgress progress={duckDbHelperProgress} />
						</div>
					)}

					<AlertDialogFooter className="mt-6">
						<Button
							variant="outline"
							type="button"
							onClick={onCancel}
							disabled={isBusy}
						>
							Cancel
						</Button>
						{!usesFile && (
							<Button
								variant="secondary"
								type="button"
								onClick={handleTestConnection}
								disabled={isTesting}
							>
								{isTesting && <Spinner />}
								Test Connection
							</Button>
						)}
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting && <Spinner />}
							{isEditMode ? "Save" : "Create"}
						</Button>
					</AlertDialogFooter>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
}
