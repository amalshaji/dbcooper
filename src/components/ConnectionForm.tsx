import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ConnectionType } from "@/types/connection";
import { api, ConnectionFormData, Connection } from "@/lib/tauri";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { PostgresqlIcon } from "@/components/icons/postgres";
import { RedisIcon } from "@/components/icons/redis";
import { ClickhouseIcon } from "@/components/icons/clickhouse";
import { SqliteIcon } from "@/components/icons/sqlite";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Eye, EyeSlash } from "@phosphor-icons/react";

interface ConnectionFormProps {
  onSubmit: (data: ConnectionFormData) => Promise<void>;
  onCancel: () => void;
  isOpen: boolean;
  initialData?: Connection | null;
}

const databaseTypes: { value: ConnectionType; label: string; disabled: boolean; icon: React.ReactNode }[] = [
  { value: "postgres", label: "PostgreSQL", disabled: false, icon: <PostgresqlIcon className="w-4 h-4" /> },
  { value: "sqlite", label: "SQLite", disabled: false, icon: <SqliteIcon className="w-4 h-4" /> },
  { value: "redis", label: "Redis", disabled: false, icon: <RedisIcon className="w-4 h-4" /> },
  { value: "clickhouse", label: "ClickHouse (Coming Soon)", disabled: true, icon: <ClickhouseIcon className="w-4 h-4" /> },
];

const defaultPorts: Record<ConnectionType, number> = {
  postgres: 5432,
  sqlite: 0,
  redis: 6379,
  clickhouse: 9000,
};

const defaultFormData: ConnectionFormData = {
  type: "postgres",
  name: "",
  host: "localhost",
  port: 5432,
  database: "",
  username: "",
  password: "",
  ssl: false,
  db_type: "postgres",
  file_path: undefined,
  ssh_enabled: false,
  ssh_host: "",
  ssh_port: 22,
  ssh_user: "",
  ssh_password: "",
  ssh_key_path: "",
  ssh_use_key: false,
};

export function ConnectionForm({ onSubmit, onCancel, isOpen, initialData }: ConnectionFormProps) {
  const [formData, setFormData] = useState<ConnectionFormData>(defaultFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSshPassword, setShowSshPassword] = useState(false);

  const isEditMode = !!initialData;

  useEffect(() => {
    if (initialData) {
      setFormData({
        type: initialData.type || "postgres",
        name: initialData.name,
        host: initialData.host,
        port: initialData.port,
        database: initialData.database,
        username: initialData.username,
        password: initialData.password,
        ssl: initialData.ssl === 1,
        db_type: initialData.db_type || "postgres",
        file_path: initialData.file_path || undefined,
        ssh_enabled: initialData.ssh_enabled === 1,
        ssh_host: initialData.ssh_host || "",
        ssh_port: initialData.ssh_port || 22,
        ssh_user: initialData.ssh_user || "",
        ssh_password: initialData.ssh_password || "",
        ssh_key_path: initialData.ssh_key_path || "",
        ssh_use_key: initialData.ssh_use_key === 1,
      });
    } else {
      setFormData(defaultFormData);
    }
  }, [initialData, isOpen]);

  const handleTypeChange = (type: ConnectionType) => {
    setFormData({
      ...formData,
      type,
      db_type: type,
      port: defaultPorts[type],
    });
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      // Use unified test connection for Redis and SQLite, postgres test for Postgres
      const result = formData.type === "redis" || formData.type === "sqlite"
        ? await api.database.testConnection({
            id: 0,
            uuid: "",
            type: formData.type,
            name: formData.name,
            host: formData.host,
            port: formData.port,
            database: formData.database,
            username: formData.username,
            password: formData.password,
            ssl: formData.ssl ? 1 : 0,
            db_type: formData.db_type,
            file_path: formData.file_path || null,
            ssh_enabled: formData.ssh_enabled ? 1 : 0,
            ssh_host: formData.ssh_host || "",
            ssh_port: formData.ssh_port || 22,
            ssh_user: formData.ssh_user || "",
            ssh_password: formData.ssh_password || "",
            ssh_key_path: formData.ssh_key_path || "",
            ssh_use_key: formData.ssh_use_key ? 1 : 0,
            created_at: "",
            updated_at: "",
          })
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
      toast.error("Failed to test connection");
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit(formData);
      if (!isEditMode) {
        setFormData(defaultFormData);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{isEditMode ? "Edit Connection" : "New Connection"}</AlertDialogTitle>
          <AlertDialogDescription>
            {isEditMode ? "Update your database connection settings" : "Create a new database connection"}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="connection-type">Database Type</FieldLabel>
              <Select
                items={databaseTypes}
                value={formData.type}
                onValueChange={(value) => handleTypeChange(value as ConnectionType)}
              >
                <SelectTrigger id="connection-type">
                  <div className="flex items-center gap-2">
                    {databaseTypes.find(db => db.value === formData.type)?.icon}
                    <span>{databaseTypes.find(db => db.value === formData.type)?.label}</span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {databaseTypes.map((item) => (
                      <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                        <div className="flex items-center gap-2">
                          {item.icon}
                          <span>{item.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="connection-name">Name</FieldLabel>
              <Input
                id="connection-name"
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Production DB"
              />
            </Field>

            {/* SQLite-specific fields */}
            {formData.type === "sqlite" && (
              <Field>
                <FieldLabel htmlFor="connection-file-path">Database File</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="connection-file-path"
                    type="text"
                    required
                    value={formData.file_path || ""}
                    onChange={(e) => setFormData({ ...formData, file_path: e.target.value })}
                    placeholder="/path/to/database.db"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      const selected = await open({
                        multiple: false,
                        filters: [{ name: "SQLite Database", extensions: ["db", "sqlite", "sqlite3"] }],
                      });
                      if (selected) {
                        setFormData({ ...formData, file_path: selected as string });
                      }
                    }}
                  >
                    Browse
                  </Button>
                </div>
              </Field>
            )}

            {/* Postgres/Server-based connection fields */}
            {formData.type !== "sqlite" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="connection-host">Host</FieldLabel>
                    <Input
                      id="connection-host"
                      type="text"
                      required
                      value={formData.host}
                      onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="connection-port">Port</FieldLabel>
                    <Input
                      id="connection-port"
                      type="number"
                      required
                      value={formData.port}
                      onChange={(e) => setFormData({ ...formData, port: Number(e.target.value) })}
                    />
                  </Field>
                </div>

                {/* Redis uses database index, not database name */}
                {formData.type === "redis" ? (
                  <Field>
                    <FieldLabel htmlFor="connection-database">Database Index (0-15)</FieldLabel>
                    <Input
                      id="connection-database"
                      type="number"
                      min="0"
                      max="15"
                      value={formData.database}
                      onChange={(e) => setFormData({ ...formData, database: e.target.value })}
                      placeholder="0"
                    />
                  </Field>
                ) : (
                  <Field>
                    <FieldLabel htmlFor="connection-database">Database</FieldLabel>
                    <Input
                      id="connection-database"
                      type="text"
                      required={formData.type !== "redis"}
                      value={formData.database}
                      onChange={(e) => setFormData({ ...formData, database: e.target.value })}
                      placeholder="my_database"
                    />
                  </Field>
                )}

                {/* Redis doesn't use username */}
                {formData.type !== "redis" && (
                  <Field>
                    <FieldLabel htmlFor="connection-username">Username</FieldLabel>
                    <Input
                      id="connection-username"
                      type="text"
                      required
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      placeholder="postgres"
                    />
                  </Field>
                )}

                <Field>
                  <FieldLabel htmlFor="connection-password">
                    {formData.type === "redis" ? "Password (Optional)" : "Password"}
                  </FieldLabel>
                  <div className="relative">
                    <Input
                      id="connection-password"
                      type={showPassword ? "text" : "password"}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeSlash className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </button>
                  </div>
                </Field>

                {/* Redis doesn't use SSL */}
                {formData.type !== "redis" && (
                  <Field orientation="horizontal">
                    <input
                      type="checkbox"
                      id="connection-ssl"
                      checked={formData.ssl}
                      onChange={(e) => setFormData({ ...formData, ssl: e.target.checked })}
                      className="rounded border-input"
                    />
                    <FieldLabel htmlFor="connection-ssl">Use SSL</FieldLabel>
                  </Field>
                )}

                {/* SSH Tunnel Section */}
                <div className="border-t pt-4 mt-2">
                  <Field orientation="horizontal">
                    <input
                      type="checkbox"
                      id="connection-ssh-enabled"
                      checked={formData.ssh_enabled}
                      onChange={(e) => setFormData({ ...formData, ssh_enabled: e.target.checked })}
                      className="rounded border-input"
                    />
                    <FieldLabel htmlFor="connection-ssh-enabled">Connect over SSH</FieldLabel>
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
                            onChange={(e) => setFormData({ ...formData, ssh_host: e.target.value })}
                            placeholder="jump-server.example.com"
                          />
                        </Field>

                        <Field>
                          <FieldLabel htmlFor="ssh-port">SSH Port</FieldLabel>
                          <Input
                            id="ssh-port"
                            type="number"
                            value={formData.ssh_port}
                            onChange={(e) => setFormData({ ...formData, ssh_port: Number(e.target.value) })}
                          />
                        </Field>
                      </div>

                      <Field>
                        <FieldLabel htmlFor="ssh-user">SSH User</FieldLabel>
                        <Input
                          id="ssh-user"
                          type="text"
                          value={formData.ssh_user}
                          onChange={(e) => setFormData({ ...formData, ssh_user: e.target.value })}
                          placeholder="ubuntu"
                        />
                      </Field>

                      <Field orientation="horizontal">
                        <input
                          type="checkbox"
                          id="ssh-use-key"
                          checked={formData.ssh_use_key}
                          onChange={(e) => setFormData({ ...formData, ssh_use_key: e.target.checked })}
                          className="rounded border-input"
                        />
                        <FieldLabel htmlFor="ssh-use-key">Use SSH Key</FieldLabel>
                      </Field>

                      {formData.ssh_use_key ? (
                        <Field>
                          <FieldLabel htmlFor="ssh-key-path">SSH Key Path</FieldLabel>
                          <div className="flex gap-2">
                            <Input
                              id="ssh-key-path"
                              type="text"
                              value={formData.ssh_key_path}
                              onChange={(e) => setFormData({ ...formData, ssh_key_path: e.target.value })}
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
                                  setFormData({ ...formData, ssh_key_path: selected as string });
                                }
                              }}
                            >
                              Browse
                            </Button>
                          </div>
                        </Field>
                      ) : (
                        <Field>
                          <FieldLabel htmlFor="ssh-password">SSH Password</FieldLabel>
                          <div className="relative">
                            <Input
                              id="ssh-password"
                              type={showSshPassword ? "text" : "password"}
                              value={formData.ssh_password}
                              onChange={(e) => setFormData({ ...formData, ssh_password: e.target.value })}
                              className="pr-10"
                            />
                            <button
                              type="button"
                              onClick={() => setShowSshPassword(!showSshPassword)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {showSshPassword ? <EyeSlash className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
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

          <AlertDialogFooter className="mt-6">
            <Button variant="outline" type="button" onClick={onCancel}>
              Cancel
            </Button>
            {formData.type !== "sqlite" && (
              <Button
                variant="secondary"
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
              >
                {isTesting && <Spinner className="mr-2" />}
                Test Connection
              </Button>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Spinner className="mr-2" />}
              {isEditMode ? "Save" : "Create"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

