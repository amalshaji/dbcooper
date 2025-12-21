import { useState, useEffect } from "react";
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
  { value: "redis", label: "Redis (Coming Soon)", disabled: true, icon: <RedisIcon className="w-4 h-4" /> },
  { value: "clickhouse", label: "ClickHouse (Coming Soon)", disabled: true, icon: <ClickhouseIcon className="w-4 h-4" /> },
];

const defaultPorts: Record<ConnectionType, number> = {
  postgres: 5432,
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
};

export function ConnectionForm({ onSubmit, onCancel, isOpen, initialData }: ConnectionFormProps) {
  const [formData, setFormData] = useState<ConnectionFormData>(defaultFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
      });
    } else {
      setFormData(defaultFormData);
    }
  }, [initialData, isOpen]);

  const handleTypeChange = (type: ConnectionType) => {
    setFormData({
      ...formData,
      type,
      port: defaultPorts[type],
    });
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      const result = await api.postgres.testConnection({
        host: formData.host,
        port: formData.port,
        database: formData.database,
        username: formData.username,
        password: formData.password,
        ssl: formData.ssl,
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
      <AlertDialogContent>
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

            <Field>
              <FieldLabel htmlFor="connection-database">Database</FieldLabel>
              <Input
                id="connection-database"
                type="text"
                required
                value={formData.database}
                onChange={(e) => setFormData({ ...formData, database: e.target.value })}
                placeholder="my_database"
              />
            </Field>

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

            <Field>
              <FieldLabel htmlFor="connection-password">Password</FieldLabel>
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
          </FieldGroup>

          <AlertDialogFooter>
            <Button variant="outline" type="button" onClick={onCancel}>
              Cancel
            </Button>
            <Button 
              variant="secondary" 
              type="button" 
              onClick={handleTestConnection}
              disabled={isTesting}
            >
              {isTesting && <Spinner className="mr-2" />}
              Test Connection
            </Button>
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

